//! 统一错误类型。实现 `Serialize` 以便 Tauri 命令可直接返回本类型，
//! 序列化结果为错误消息字符串，前端 `invoke` 拒绝时拿到的即该字符串。

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("I/O 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON 错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("未找到 ffmpeg，请先安装 ffmpeg")]
    FfmpegNotFound,

    #[error("ffmpeg 执行失败: {0}")]
    Ffmpeg(String),

    #[error("音频解码失败: {0}")]
    Audio(String),

    #[error("尚未加载模型")]
    ModelNotLoaded,

    #[error("whisper 识别失败: {0}")]
    Whisper(String),

    #[error("输入无效: {0}")]
    InvalidInput(String),

    #[error("网络请求失败: {0}")]
    Http(String),

    #[error("任务已取消")]
    Cancelled,

    #[error("{0}")]
    Other(String),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
