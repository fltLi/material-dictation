import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  InferenceBackend,
  MediaInfo,
  ModelEntry,
  ModelStatus,
  PptOptions,
  PptSentence,
  Segment,
  Settings,
  Theme,
  TranscribeProgress,
  UpdateInfo,
} from "../types";

export const api = {
  ffmpegAvailable: () => invoke<boolean>("ffmpeg_available"),

  normalizeMedia: (inputPath: string) => invoke<MediaInfo>("normalize_media", { inputPath }),

  waveform: (audioPath: string, buckets: number) =>
    invoke<number[]>("waveform", { audioPath, buckets }),

  exportAudio: (audioPath: string, start: number | null, end: number | null, name: string) =>
    invoke<string>("export_audio", { audioPath, start, end, name }),

  transcribeAudio: (
    audioPath: string,
    start: number,
    end: number,
    onProgress: (p: TranscribeProgress) => void,
  ) => {
    const channel = new Channel<TranscribeProgress>();
    channel.onmessage = onProgress;
    return invoke<Segment[]>("transcribe_audio", {
      audioPath,
      start,
      end,
      onProgress: channel,
    });
  },

  cancelTranscribe: () => invoke<void>("cancel_transcribe"),

  listModels: () => invoke<ModelEntry[]>("list_models"),

  modelStatus: () => invoke<ModelStatus>("model_status"),

  availableBackends: () => invoke<InferenceBackend[]>("available_backends"),

  addModel: (path: string) => invoke<ModelEntry>("add_model", { path }),

  removeModel: (id: string) => invoke<void>("remove_model", { id }),

  loadModel: (id: string, onProgress: (msg: string) => void) => {
    const channel = new Channel<{ message: string }>();
    channel.onmessage = (p) => onProgress(p.message);
    return invoke<void>("load_model", { id, onProgress: channel });
  },

  getSettings: () => invoke<Settings>("get_settings"),

  setSettings: (settings: Settings) => invoke<void>("set_settings", { settings }),

  setTheme: (settings: Settings, theme: Theme) =>
    invoke<void>("set_settings", { settings: { ...settings, theme } }),

  setBackend: (settings: Settings, backend: InferenceBackend) =>
    invoke<void>("set_settings", { settings: { ...settings, backend } }),

  checkUpdate: () => invoke<UpdateInfo>("check_update"),

  generatePptx: (audioPath: string, sentences: PptSentence[], options: PptOptions) =>
    invoke<string>("generate_pptx", { audioPath, sentences, options }),
};
