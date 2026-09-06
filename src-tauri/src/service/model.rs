//! whisper 模型管理：增删与加载。

use std::sync::Arc;

use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager, State};
use uuid::Uuid;

use crate::{
    error::{Error, Result},
    service::settings::save_settings,
    state::{AppState, InferenceBackend, LoadedModel, ModelEntry},
};

#[derive(Debug, Clone, Serialize)]
pub struct LoadProgress {
    pub message: String,
}

fn persist(app: &AppHandle, state: &AppState) -> Result<()> {
    let settings = state
        .settings
        .lock()
        .map_err(|e| Error::Other(e.to_string()))?;
    save_settings(app, &settings)
}

#[tauri::command]
pub fn list_models(state: State<'_, AppState>) -> Vec<ModelEntry> {
    state
        .settings
        .lock()
        .map(|s| s.models.clone())
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelStatus {
    pub loaded: bool,
    pub name: Option<String>,
    pub id: Option<String>,
}

#[tauri::command]
pub fn model_status(state: State<'_, AppState>) -> ModelStatus {
    match state.model.lock() {
        Ok(g) => ModelStatus {
            loaded: g.is_some(),
            name: g.as_ref().map(|m| m.name.clone()),
            id: g.as_ref().map(|m| m.id.clone()),
        },
        Err(_) => ModelStatus {
            loaded: false,
            name: None,
            id: None,
        },
    }
}

/// 报告当前编译产物中可用的推理后端。
#[tauri::command]
pub fn available_backends() -> Vec<InferenceBackend> {
    #[allow(unused_mut)]
    let mut backends = vec![InferenceBackend::Cpu];
    #[cfg(feature = "cuda")]
    backends.push(InferenceBackend::Cuda);
    #[cfg(feature = "metal")]
    backends.push(InferenceBackend::Metal);
    #[cfg(feature = "vulkan")]
    backends.push(InferenceBackend::Vulkan);
    backends
}

/// 添加一个 ggml `.bin` 模型（只记录路径，不复制文件）。
#[tauri::command]
pub fn add_model(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<ModelEntry> {
    add_model_inner(&app, &state, &path)
}

fn add_model_inner(app: &AppHandle, state: &AppState, path: &str) -> Result<ModelEntry> {
    let p = std::path::Path::new(path);
    if !p.is_file() {
        return Err(Error::InvalidInput("文件不存在".into()));
    }
    let name = p
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "model".into());
    let entry = ModelEntry {
        id: Uuid::new_v4().to_string(),
        name,
        path: path.to_string(),
        kind: "ggml".into(),
    };
    {
        let mut settings = state
            .settings
            .lock()
            .map_err(|e| Error::Other(e.to_string()))?;
        settings.models.push(entry.clone());
    }
    persist(app, state)?;
    Ok(entry)
}

#[tauri::command]
pub fn remove_model(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<()> {
    {
        let mut settings = state
            .settings
            .lock()
            .map_err(|e| Error::Other(e.to_string()))?;
        settings.models.retain(|m| m.id != id);
        if settings.last_model_id.as_deref() == Some(id.as_str()) {
            settings.last_model_id = None;
        }
    }
    {
        let mut model = state
            .model
            .lock()
            .map_err(|e| Error::Other(e.to_string()))?;
        if model.as_ref().map(|m| m.id.as_str()) == Some(id.as_str()) {
            *model = None;
        }
    }
    persist(&app, &state)
}

/// 加载模型到内存。按当前设置的后端决定是否启用 GPU。
#[tauri::command]
pub async fn load_model(
    app: AppHandle,
    id: String,
    on_progress: Channel<LoadProgress>,
) -> Result<()> {
    let (path, name, backend) = {
        let state = app.state::<AppState>();
        let settings = state
            .settings
            .lock()
            .map_err(|e| Error::Other(e.to_string()))?;
        let m = settings
            .models
            .iter()
            .find(|m| m.id == id)
            .ok_or(Error::ModelNotLoaded)?;
        (m.path.clone(), m.name.clone(), settings.backend)
    };

    let use_gpu = backend != InferenceBackend::Cpu;
    let _ = on_progress.send(LoadProgress {
        message: "正在加载模型…".into(),
    });

    let context = tauri::async_runtime::spawn_blocking(move || {
        let params = whisper_rs::WhisperContextParameters {
            use_gpu,
            ..Default::default()
        };
        whisper_rs::WhisperContext::new_with_params(&path, params)
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
    .map_err(|e| Error::Whisper(format!("{e:?}")))?;

    let loaded = Arc::new(LoadedModel {
        id: id.clone(),
        name,
        context: Arc::new(context),
    });
    {
        let state = app.state::<AppState>();
        let mut model = state
            .model
            .lock()
            .map_err(|e| Error::Other(e.to_string()))?;
        *model = Some(loaded);
    }
    {
        let state = app.state::<AppState>();
        let mut settings = state
            .settings
            .lock()
            .map_err(|e| Error::Other(e.to_string()))?;
        settings.last_model_id = Some(id);
        let snapshot = settings.clone();
        drop(settings);
        save_settings(&app, &snapshot)?;
    }
    Ok(())
}
