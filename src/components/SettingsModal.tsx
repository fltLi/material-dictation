import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Divider,
  Field,
  InfoLabel,
  Link,
  Radio,
  RadioGroup,
  Spinner,
  Text,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { CheckmarkCircleRegular, DeleteRegular } from "@fluentui/react-icons";
import { api } from "../services/backend";
import { useSettings } from "../stores/settings";
import type { InferenceBackend, Theme } from "../types";

const useStyles = makeStyles({
  section: { marginTop: "12px" },
  modelRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 0",
  },
  modelName: { flex: 1, minWidth: 0 },
  loaded: {
    color: tokens.colorPaletteGreenForeground1,
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    whiteSpace: "nowrap",
  },
  footer: {
    marginTop: "16px",
    display: "flex",
    gap: "12px",
    alignItems: "center",
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const styles = useStyles();
  const settings = useSettings((s) => s.settings);
  const setTheme = useSettings((s) => s.setTheme);
  const setBackend = useSettings((s) => s.setBackend);
  const addModelEntry = useSettings((s) => s.addModelEntry);
  const removeModelEntry = useSettings((s) => s.removeModelEntry);

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<InferenceBackend[] | null>(null);

  // 打开设置时同步当前已加载模型的状态，以便在列表中显示“已加载”。
  useEffect(() => {
    if (!open) return;
    api
      .modelStatus()
      .then((s) => setLoadedModelId(s.id))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    api
      .availableBackends()
      .then(setAvailable)
      .catch(() => setAvailable(["cpu"]));
  }, []);

  const addModel = async () => {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Whisper 模型", extensions: ["bin"] }],
    });
    if (typeof selected === "string") {
      try {
        const entry = await api.addModel(selected);
        addModelEntry(entry);
      } catch (e) {
        setError(typeof e === "string" ? e : String(e));
      }
    }
  };

  const loadModel = async (id: string) => {
    setLoadingId(id);
    try {
      await api.loadModel(id, () => {});
      // 加载成功后把该模型标记为当前已加载模型。
      setLoadedModelId(id);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingId(null);
    }
  };

  const removeModel = async (id: string) => {
    await removeModelEntry(id);
    if (loadedModelId === id) setLoadedModelId(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) onClose();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>设置</DialogTitle>
          <DialogContent>
            <Field label="外观">
              <RadioGroup
                value={settings?.theme}
                onChange={(_, data) => void setTheme(data.value as Theme)}
                layout="horizontal"
              >
                <Radio value="light" label="浅色" />
                <Radio value="dark" label="深色" />
              </RadioGroup>
            </Field>

            <Field label="推理后端">
              <RadioGroup
                value={settings?.backend}
                onChange={(_, data) => void setBackend(data.value as InferenceBackend)}
                layout="horizontal"
              >
                <Radio value="cpu" label="CPU" />
                <Radio
                  value="vulkan"
                  label="Vulkan"
                  disabled={available !== null && !available.includes("vulkan")}
                />
                <Radio
                  value="cuda"
                  label="CUDA"
                  disabled={available !== null && !available.includes("cuda")}
                />
                <Radio
                  value="metal"
                  label="Metal"
                  disabled={available !== null && !available.includes("metal")}
                />
              </RadioGroup>
            </Field>

            <div className={styles.section}>
              <Title3>
                选择模型
                <InfoLabel
                  info="Whisper 是一款开源语音识别模型，用于把音频转写为带时间戳的文字。请使用 whisper.cpp 的 ggml（.bin）模型。"
                  style={{ marginLeft: "8px" }}
                />
              </Title3>
            </div>

            {settings?.models.length ? (
              settings.models.map((m) => {
                const isLoaded = loadedModelId === m.id;
                return (
                  <div className={styles.modelRow} key={m.id}>
                    <Text className={styles.modelName}>
                      {m.name} <span className={styles.muted}>({m.kind})</span>
                    </Text>
                    {settings.lastModelId === m.id && !isLoaded && (
                      <Text size={200} className={styles.muted}>
                        上次使用
                      </Text>
                    )}
                    {isLoaded ? (
                      <Text className={styles.loaded} title="模型已加载，可直接用于识别">
                        <CheckmarkCircleRegular /> 已加载
                      </Text>
                    ) : (
                      <Button
                        size="small"
                        appearance="primary"
                        disabled={loadingId !== null}
                        onClick={() => void loadModel(m.id)}
                      >
                        {loadingId === m.id ? <Spinner size="tiny" /> : "加载"}
                      </Button>
                    )}
                    <Button
                      size="small"
                      appearance="subtle"
                      aria-label={`移除 ${m.name}`}
                      icon={<DeleteRegular />}
                      onClick={() => void removeModel(m.id)}
                    />
                  </div>
                );
              })
            ) : (
              <Text className={styles.muted}>尚未添加模型</Text>
            )}

            <div className={styles.section}>
              <Button onClick={() => void addModel()}>添加模型</Button>
            </div>

            {error && (
              <Text
                size={200}
                style={{ color: "var(--colorStatusDangerForeground1)", marginTop: "8px" }}
              >
                {error}
              </Text>
            )}

            <Divider className={styles.section} />

            <div className={styles.footer}>
              <Link onClick={() => void openUrl("https://huggingface.co/ggerganov/whisper.cpp")}>
                获取 ggml 模型
              </Link>
              <Link onClick={() => void openUrl("https://github.com/fltLi/material-dictation")}>
                源码仓库
              </Link>
              <Link onClick={() => void openUrl("https://www.gnu.org/licenses/gpl-3.0.html")}>
                GPL-3.0 许可证
              </Link>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
