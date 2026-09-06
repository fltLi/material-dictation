// 与后端 DTO 对应（后端已 serde rename_all = camelCase）。

export type Theme = "light" | "dark";
export type InferenceBackend = "cpu" | "cuda" | "metal" | "vulkan";

export interface ModelEntry {
  id: string;
  name: string;
  path: string;
  kind: string;
}

export interface ModelStatus {
  loaded: boolean;
  name: string | null;
  id: string | null;
}

export interface Settings {
  theme: Theme;
  backend: InferenceBackend;
  lastModelId: string | null;
  models: ModelEntry[];
}

export interface MediaInfo {
  path: string;
  durationSecs: number;
  sampleRate: number;
  channels: number;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface TranscribeProgress {
  done: number;
  total: number;
  message: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
}

export interface PptSentence {
  start: number;
  end: number;
  text: string;
}

export interface PptOptions {
  projectName: string;
  listenTimes: number;
  speeds: number[];
  gapSeconds: number;
  fullTextSpeed: number;
}

/** 编辑器内的 PPT 生成设置（不含项目名）。 */
export interface PptSettings {
  listenTimes: number;
  speeds: number[];
  gapSeconds: number;
  fullTextSpeed: number;
}

/** 前端编辑模型中的句子（带稳定 id）。 */
export interface Sentence {
  id: string;
  start: number;
  end: number;
  text: string;
}

/** 打开媒体后进入编辑器的项目快照。 */
export interface OpenProject {
  media: MediaInfo;
  projectName: string;
  sentences: Sentence[];
  /** 为 true 时进入编辑器后自动进行全文识别（先把空状态记为初始，再把结果入撤销栈）。 */
  autoTranscribe?: boolean;
}
