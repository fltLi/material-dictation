//! whisper-rs（whisper.cpp 绑定）语音识别：进度上报与取消。

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager, State};
use whisper_rs::{FullParams, SamplingStrategy};

use crate::{
    error::{Error, Result},
    service::audio::read_wav_mono_f32,
    state::AppState,
};

#[derive(Debug, Clone, Serialize)]
pub struct TranscribeProgress {
    pub done: usize,
    pub total: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SegmentDto {
    pub start: f32,
    pub end: f32,
    pub text: String,
}

/// 识别音频 `[start, end]` 区间，返回按时间排序的句子片段。
#[tauri::command]
pub async fn transcribe_audio(
    app: AppHandle,
    audio_path: String,
    start: f32,
    end: f32,
    on_progress: Channel<TranscribeProgress>,
) -> Result<Vec<SegmentDto>> {
    let (model, cancel) = {
        let state = app.state::<AppState>();
        let guard = state
            .model
            .lock()
            .map_err(|e| Error::Other(e.to_string()))?;
        let model = (*guard).clone().ok_or(Error::ModelNotLoaded)?;
        (model, state.cancel.clone())
    };
    cancel.store(false, Ordering::SeqCst);

    tauri::async_runtime::spawn_blocking(move || {
        transcribe_range(
            &model.context,
            &audio_path,
            start,
            end,
            &cancel,
            on_progress,
        )
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

#[tauri::command]
pub fn cancel_transcribe(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// whisper 层的原生中止回调。
///
/// whisper-rs 0.16.0 的 `set_abort_callback_safe` 存在 double-box 类型错误：
/// 其 trampoline 会把 user_data 强转回具体闭包类型而实际存储的是 boxed trait
/// object，导致返回未定义值（常为非零），whisper 因而误判“已取消”，让编码阶段
/// 返回 “failed to encode”。这里改用原始 C 回调 + 指向取消标志的 user_data，
/// 彻底规避该缺陷，同时保持真正的可取消能力。
unsafe extern "C" fn whisper_abort_requested(data: *mut std::ffi::c_void) -> bool {
    if data.is_null() {
        return false;
    }
    let flag = &*(data as *const AtomicBool);
    flag.load(Ordering::SeqCst)
}

fn transcribe_range(
    ctx: &whisper_rs::WhisperContext,
    audio_path: &str,
    start: f32,
    end: f32,
    cancel: &Arc<AtomicBool>,
    on_progress: Channel<TranscribeProgress>,
) -> Result<Vec<SegmentDto>> {
    let (samples, sample_rate) = read_wav_mono_f32(audio_path)?;
    let sr = sample_rate as f32;

    let start_idx = ((start * sr) as usize).min(samples.len());
    let end_idx = ((end * sr) as usize).min(samples.len()).max(start_idx);
    let slice = &samples[start_idx..end_idx];
    if slice.is_empty() {
        return Ok(Vec::new());
    }

    run_full(ctx, slice, start, cancel, on_progress)
}

fn run_full(
    ctx: &whisper_rs::WhisperContext,
    slice: &[f32],
    start: f32,
    cancel: &Arc<AtomicBool>,
    on_progress: Channel<TranscribeProgress>,
) -> Result<Vec<SegmentDto>> {
    let mut state = ctx
        .create_state()
        .map_err(|e| Error::Whisper(format!("{e:?}")))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(default_threads());
    params.set_language(None); // 自动检测语言
    params.set_print_progress(false);
    params.set_print_realtime(false);

    params.set_progress_callback_safe(move |progress: i32| {
        let _ = on_progress.send(TranscribeProgress {
            done: progress.clamp(0, 100) as usize,
            total: 100,
            message: format!("识别中 {progress}%"),
        });
    });
    // 取消用原生回调实现（见 `whisper_abort_requested` 的说明）。user_data 指向
    // `cancel` 持有的 AtomicBool；它在我们持有的 Arc 存活期内有效，而 whisper 只在
    // 本次 `state.full` 调用期间回调，因此指针不会悬空。
    let cancel_ptr = &**cancel as *const AtomicBool as *mut std::ffi::c_void;
    unsafe {
        params.set_abort_callback(Some(whisper_abort_requested));
        params.set_abort_callback_user_data(cancel_ptr);
    }
    state.full(params, slice).map_err(|e| {
        if cancel.load(Ordering::SeqCst) {
            Error::Cancelled
        } else {
            Error::Whisper(format!("{e:?}"))
        }
    })?;

    let n = state.full_n_segments();
    let mut out = Vec::with_capacity(n as usize);
    for i in 0..n {
        if let Some(seg) = state.get_segment(i) {
            // whisper.cpp 段时间戳单位为厘秒（10ms）。识别输入是切片 [start, end]，
            // 因此 whisper 返回的时间戳相对切片起点，需再加上绝对偏移 start。
            let t0 = start + seg.start_timestamp() as f32 / 100.0;
            let t1 = start + seg.end_timestamp() as f32 / 100.0;
            let text = seg
                .to_str_lossy()
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            if !text.is_empty() {
                out.push(SegmentDto {
                    start: t0,
                    end: t1,
                    text,
                });
            }
        }
    }
    Ok(out)
}

fn default_threads() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(4)
        .min(8)
}
