//! 媒体导入、规范化、波形与导出。统一使用 ffmpeg 处理音频与视频。

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub path: String,
    pub duration_secs: f64,
    pub sample_rate: u32,
    pub channels: u16,
}

fn check_ffmpeg() -> bool {
    std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub fn ffmpeg_available() -> bool {
    check_ffmpeg()
}

/// 把任意媒体文件规范化为 16kHz 单声道 16-bit WAV，写到应用数据目录，返回元信息。
#[tauri::command]
pub fn normalize_media(app: AppHandle, input_path: String) -> Result<MediaInfo> {
    normalize_media_inner(&app, &input_path)
}

fn normalize_media_inner(app: &AppHandle, input_path: &str) -> Result<MediaInfo> {
    if !check_ffmpeg() {
        return Err(Error::FfmpegNotFound);
    }
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| Error::Other(e.to_string()))?;
    let audio_dir = base.join("audio");
    std::fs::create_dir_all(&audio_dir)?;

    let out_path = audio_dir.join(format!("{}.wav", uuid::Uuid::new_v4()));
    let status = std::process::Command::new("ffmpeg")
        .arg("-y")
        .arg("-i")
        .arg(input_path)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(&out_path)
        .status()?;

    if !status.success() {
        return Err(Error::Ffmpeg("媒体规范化失败".into()));
    }

    let reader = hound::WavReader::open(&out_path).map_err(|e| Error::Audio(e.to_string()))?;
    let spec = reader.spec();
    let duration_secs = reader.len() as f64 / f64::from(spec.sample_rate);

    Ok(MediaInfo {
        path: out_path.to_string_lossy().into_owned(),
        duration_secs,
        sample_rate: spec.sample_rate,
        channels: spec.channels,
    })
}

/// 计算波形峰值，返回 `buckets` 个 [0,1] 归一化峰值。
#[tauri::command]
pub fn waveform(audio_path: String, buckets: usize) -> Result<Vec<f32>> {
    let (samples, _rate) = read_wav_mono_f32(&audio_path)?;
    let buckets = buckets.max(1);
    let mut peaks = vec![0f32; buckets];
    if samples.is_empty() {
        return Ok(peaks);
    }
    let per = (samples.len() / buckets).max(1);
    for (i, peak) in peaks.iter_mut().enumerate() {
        let start = i * per;
        let end = ((i + 1) * per).min(samples.len());
        let mut m = 0f32;
        for s in &samples[start..end] {
            let a = s.abs();
            if a > m {
                m = a;
            }
        }
        *peak = m;
    }
    Ok(peaks)
}

/// 导出（切片后的）音频到系统下载目录。`start`/`end` 为 `None` 时导出整段。
#[tauri::command]
pub fn export_audio(
    app: AppHandle,
    audio_path: String,
    start: Option<f32>,
    end: Option<f32>,
    name: String,
) -> Result<String> {
    let downloads = app
        .path()
        .download_dir()
        .map_err(|e| Error::Other(e.to_string()))?;
    std::fs::create_dir_all(&downloads)?;

    let safe = sanitize_filename(&name);
    let mut out_path = downloads.join(format!("{}.wav", safe));
    out_path = unique_path(out_path);

    if start.is_none() && end.is_none() {
        std::fs::copy(&audio_path, &out_path)?;
    } else {
        if !check_ffmpeg() {
            return Err(Error::FfmpegNotFound);
        }
        let mut cmd = std::process::Command::new("ffmpeg");
        cmd.arg("-y").arg("-i").arg(&audio_path);
        if let Some(s) = start {
            cmd.arg("-ss").arg(format!("{s:.3}"));
        }
        if let Some(e) = end {
            cmd.arg("-to").arg(format!("{e:.3}"));
        }
        cmd.arg("-c:a").arg("pcm_s16le").arg(&out_path);
        let status = cmd.status()?;
        if !status.success() {
            return Err(Error::Ffmpeg("导出音频失败".into()));
        }
    }

    Ok(out_path.to_string_lossy().into_owned())
}

/// 读取单声道 WAV 为 f32 采样（[-1,1]），返回采样与采样率。
pub fn read_wav_mono_f32(path: &str) -> Result<(Vec<f32>, u32)> {
    let mut reader = hound::WavReader::open(path).map_err(|e| Error::Audio(e.to_string()))?;
    let spec = reader.spec();
    let sample_rate = spec.sample_rate;

    let samples: Vec<f32> = match (spec.sample_format, spec.bits_per_sample) {
        (hound::SampleFormat::Float, 32) => reader
            .samples::<f32>()
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| Error::Audio(e.to_string()))?,
        (hound::SampleFormat::Int, 16) => reader
            .samples::<i16>()
            .map(|s| s.map(|v| v as f32 / i16::MAX as f32))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| Error::Audio(e.to_string()))?,
        (hound::SampleFormat::Int, 24) => reader
            .samples::<i32>()
            .map(|s| s.map(|v| v as f32 / (1 << 23) as f32))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| Error::Audio(e.to_string()))?,
        (hound::SampleFormat::Int, 32) => reader
            .samples::<i32>()
            .map(|s| s.map(|v| v as f32 / i32::MAX as f32))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| Error::Audio(e.to_string()))?,
        _ => {
            return Err(Error::Audio(format!(
                "不支持的 WAV 格式: {:?}/{}",
                spec.sample_format, spec.bits_per_sample
            )));
        }
    };

    Ok((samples, sample_rate))
}

pub(crate) fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "audio".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn unique_path(path: std::path::PathBuf) -> std::path::PathBuf {
    if !path.exists() {
        return path;
    }
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    let ext = path
        .extension()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let parent = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    for i in 1.. {
        let candidate = parent.join(format!("{stem} ({i}).{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::sanitize_filename;

    #[test]
    fn replaces_illegal_chars() {
        assert_eq!(sanitize_filename("a/b:c*?"), "a_b_c__");
        assert_eq!(sanitize_filename("  "), "audio");
        assert_eq!(sanitize_filename("ok"), "ok");
    }
}
