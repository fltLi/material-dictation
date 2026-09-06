import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  ProgressBar,
  Text,
  Title1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import { api } from "../services/backend";
import type { OpenProject } from "../types";

const useStyles = makeStyles({
  root: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "20px",
    padding: "32px",
  },
  drop: {
    width: "min(640px, 92%)",
    height: "220px",
    border: `2px dashed ${tokens.colorNeutralStroke1}`,
    borderRadius: "12px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    cursor: "pointer",
    transition: "background 0.15s",
    ":hover": { background: tokens.colorNeutralBackground1Hover },
  },
  hint: { color: tokens.colorNeutralForeground3 },
});

type Phase =
  | { kind: "processing"; label: string }
  | { kind: "transcribing"; label: string; value: number | null }
  | null;

interface StartViewProps {
  onOpen: (p: OpenProject) => void;
  onOpenSettings: () => void;
}

export function StartView({ onOpen, onOpenSettings }: StartViewProps) {
  const styles = useStyles();
  const [phase, setPhase] = useState<Phase>(null);
  const [ffmpegMissing, setFfmpegMissing] = useState(false);
  const [modelMissing, setModelMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const handleFile = useCallback(
    async (path: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        setPhase({ kind: "processing", label: "正在处理媒体…" });
        const ffmpegOk = await api.ffmpegAvailable();
        if (!ffmpegOk) {
          setFfmpegMissing(true);
          return;
        }
        const media = await api.normalizeMedia(path);

        const status = await api.modelStatus();
        if (!status.loaded) {
          setModelMissing(true);
          return;
        }

        // 转码完成后立即进入空编辑界面，识别交给编辑页自动触发。
        onOpen({
          media,
          projectName: projectNameFromPath(path),
          sentences: [],
          autoTranscribe: true,
        });
      } catch (e) {
        setError(typeof e === "string" ? e : String(e));
      } finally {
        busyRef.current = false;
        setPhase(null);
      }
    },
    [onOpen],
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop" && event.payload.paths.length > 0) {
          void handleFile(event.payload.paths[0]);
        }
      })
      .then((f) => {
        unlisten = f;
      });
    return () => {
      if (unlisten) unlisten();
    };
  }, [handleFile]);

  const browse = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "媒体文件",
          extensions: [
            "mp3",
            "wav",
            "m4a",
            "aac",
            "flac",
            "ogg",
            "mp4",
            "mkv",
            "mov",
            "avi",
            "webm",
          ],
        },
      ],
    });
    if (typeof selected === "string") void handleFile(selected);
  };

  const cancel = () => {
    void api.cancelTranscribe();
  };

  return (
    <div className={styles.root}>
      <Title1>Material Dictation</Title1>
      <Text className={styles.hint}>面向英语学习者的听写材料 PPT 生成工具</Text>

      <div className={styles.drop} onClick={() => void browse()}>
        <ArrowDownloadRegular fontSize={40} />
        <Text>将媒体文件拖拽到此处开始编辑</Text>
        <Text size={200} className={styles.hint}>
          支持音频与视频文件，点击可选择文件
        </Text>
      </div>

      <Dialog open={phase !== null}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{phase?.kind === "transcribing" ? "音频识别" : "处理媒体"}</DialogTitle>
            <DialogContent>
              <Text>{phase?.kind === "processing" ? phase.label : phase?.label}</Text>
              {phase?.kind === "transcribing" && phase.value != null && (
                <ProgressBar value={phase.value} />
              )}
            </DialogContent>
            {phase?.kind === "transcribing" && (
              <DialogActions>
                <Button appearance="secondary" onClick={cancel}>
                  取消
                </Button>
              </DialogActions>
            )}
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={ffmpegMissing}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>未检测到 ffmpeg</DialogTitle>
            <DialogContent>处理音视频需要 ffmpeg，请先安装后再试。</DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setFfmpegMissing(false)}>
                取消
              </Button>
              <Button
                appearance="primary"
                onClick={() => {
                  setFfmpegMissing(false);
                  void openUrl("https://www.bing.com/search?q=ffmpeg+%E4%B8%8B%E8%BD%BD");
                }}
              >
                前往必应搜索
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={modelMissing}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>尚未加载模型</DialogTitle>
            <DialogContent>请先在设置中加载 whisper 模型，再进行识别。</DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setModelMissing(false)}>
                取消
              </Button>
              <Button
                appearance="primary"
                onClick={() => {
                  setModelMissing(false);
                  onOpenSettings();
                }}
              >
                打开设置
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={error !== null}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>出错了</DialogTitle>
            <DialogContent>
              <Text>{error}</Text>
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => setError(null)}>
                确定
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

function projectNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/);
  const last = parts[parts.length - 1] ?? "untitled";
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(0, dot) : last;
}
