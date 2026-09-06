//! 全局应用状态与共享类型。

use std::sync::{atomic::AtomicBool, Arc, Mutex};

use serde::{Deserialize, Serialize};

/// 推理后端。GPU 后端需在编译期启用对应 feature（`cuda` / `metal` / `vulkan`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InferenceBackend {
    Cpu,
    Cuda,
    Metal,
    Vulkan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
}

/// 一个已添加的 whisper 模型（whisper.cpp 的 ggml `.bin` 格式）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    /// 模型格式标识，当前固定为 `ggml`。
    pub kind: String,
}

/// 持久化到磁盘的应用设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: Theme,
    pub backend: InferenceBackend,
    pub last_model_id: Option<String>,
    pub models: Vec<ModelEntry>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::Light,
            backend: InferenceBackend::Cpu,
            last_model_id: None,
            models: Vec::new(),
        }
    }
}

/// 已加载进内存的模型。
pub struct LoadedModel {
    pub id: String,
    pub name: String,
    pub context: Arc<whisper_rs::WhisperContext>,
}

/// 由 Tauri 管理的全局状态。
pub struct AppState {
    pub model: Mutex<Option<Arc<LoadedModel>>>,
    pub settings: Mutex<Settings>,
    pub cancel: Arc<AtomicBool>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            model: Mutex::new(None),
            settings: Mutex::new(Settings::default()),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}
