# Material Dictation

面向英语学习者的听写材料 PPT 生成工具：导入一段音视频，本地自动识别出带时间戳的句子，稍作编辑即可一键生成课件 PPT。

## :sparkles: 功能

- **导入**：拖入音频或视频（视频自动提取音频）
- **识别**：本地 Whisper 识别，自动切分句子并打时间戳
- **编辑**：波形图定位、改时间 / 文本、合并、切分、多选、撤销恢复；播放快捷键全局可用
- **PPT**：全文听写 + 逐句听写 + 全文听读

## :rocket: 快速开始

前置条件：Rust 1.75+、Node 22 + pnpm 10、ffmpeg、CMake、LLVM/libclang、C/C++ 工具链及 [Tauri](https://tauri.app) 平台依赖（详见 `.github/workflows/*.yml`）。

```bash
pnpm install
pnpm tauri dev
```

## :sparkles: 模型获取

whisper-rs 使用 whisper.cpp 的 ggml `.bin` 模型。推荐到 HuggingFace 的
[`ggerganov/whisper.cpp`](https://huggingface.co/ggerganov/whisper.cpp)
下载（如 `ggml-tiny.bin`、`ggml-base.bin`、`ggml-small.bin`），
再到「设置 → 选择模型 → 添加模型」选择该 `.bin` 文件即可。

## :page_facing_up: 许可证

**Code**: MPL-2.0, 2026, fltLi
