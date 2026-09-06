import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  ProgressBar,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  ArrowDownloadRegular,
  ArrowRedoRegular,
  ArrowUndoRegular,
  CopyRegular,
  EditRegular,
  MoreHorizontalRegular,
} from "@fluentui/react-icons";
import { NewSentenceDialog } from "../components/editor/NewSentenceDialog";
import { PptDialog } from "../components/editor/PptDialog";
import { SentenceEditor } from "../components/editor/SentenceEditor";
import { SentenceList } from "../components/editor/SentenceList";
import { SplitDialog } from "../components/editor/SplitDialog";
import { WaveformPlayer } from "../components/editor/WaveformPlayer";
import type { SentenceAction } from "../components/editor/types";
import { api } from "../services/backend";
import { useEditor } from "../stores/editor";
import type { OpenProject, Sentence } from "../types";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", height: "100%" },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    flexShrink: 0,
  },
  title: { flex: 1, minWidth: 0 },
  titleRow: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  titleText: {
    fontSize: "14px",
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  body: { flex: 1, display: "flex", minHeight: 0 },
  left: { width: "280px", flexShrink: 0, minHeight: 0 },
  right: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  editor: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  player: { flexShrink: 0, padding: "6px 8px 10px" },
  toast: {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: 1100,
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    boxShadow: tokens.shadow16,
    padding: "10px 14px",
    maxWidth: "420px",
  },
});

interface Busy {
  label: string;
  value: number | null;
  cancellable: boolean;
}

export function EditorView({ project }: { project: OpenProject }) {
  const styles = useStyles();
  const init = useEditor((s) => s.init);
  const projectName = useEditor((s) => s.projectName);
  const renameProject = useEditor((s) => s.renameProject);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const playFrom = useEditor((s) => s.playFrom);
  const deleteSentences = useEditor((s) => s.deleteSentences);
  const mergeUp = useEditor((s) => s.mergeUp);

  const [nameDraft, setNameDraft] = useState(project.projectName);
  const [renameOpen, setRenameOpen] = useState(false);
  const [pptOpen, setPptOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [splitTarget, setSplitTarget] = useState<Sentence | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const autoRecognizedRef = useRef(false);

  useEffect(() => {
    init({
      projectName: project.projectName,
      audioPath: project.media.path,
      duration: project.media.durationSecs,
      sentences: project.sentences,
    });
  }, [project, init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  };

  const openRename = () => {
    setNameDraft(projectName);
    setRenameOpen(true);
  };

  const commitName = () => {
    const v = nameDraft.trim();
    if (v && v !== projectName) renameProject(v);
    setRenameOpen(false);
  };

  const reRecognize = async (ids: string[]) => {
    const audioPath = useEditor.getState().audioPath;
    setBusy({ label: "正在识别…", value: null, cancellable: true });
    try {
      for (let i = 0; i < ids.length; i++) {
        const s = useEditor.getState().sentences.find((x) => x.id === ids[i]);
        if (!s) continue;
        const segs = await api.transcribeAudio(audioPath, s.start, s.end, (p) =>
          setBusy({
            label: p.message,
            value: p.total ? p.done / p.total : null,
            cancellable: true,
          }),
        );
        const text = segs
          .map((x) => x.text)
          .join(" ")
          .trim();
        if (text) useEditor.getState().updateSentence(s.id, { text });
        setBusy({
          label: `识别中 ${i + 1}/${ids.length}`,
          value: (i + 1) / ids.length,
          cancellable: true,
        });
      }
      showToast("重新识别完成");
    } catch (e) {
      const msg = typeof e === "string" ? e : String(e);
      if (!msg.includes("取消")) showToast(msg);
    } finally {
      setBusy(null);
    }
  };

  const reRecognizeAll = async () => {
    const { audioPath, duration } = useEditor.getState();
    setBusy({ label: "正在识别全文…", value: null, cancellable: true });
    try {
      const segs = await api.transcribeAudio(audioPath, 0, duration, (p) =>
        setBusy({ label: p.message, value: p.total ? p.done / p.total : null, cancellable: true }),
      );
      useEditor.getState().replaceAllSentences(segs);
      showToast("全文重新识别完成");
    } catch (e) {
      const msg = typeof e === "string" ? e : String(e);
      if (!msg.includes("取消")) showToast(msg);
    } finally {
      setBusy(null);
    }
  };

  // 进入编辑器（空句）后，若需要则自动开始全文识别；识别结果经 replaceAllSentences
  // 会把“空的初始状态”压入撤销栈，因此可一路撤回。
  useEffect(() => {
    if (!project.autoTranscribe || autoRecognizedRef.current) return;
    autoRecognizedRef.current = true;
    void reRecognizeAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportRange = async (start: number | null, end: number | null, name: string) => {
    try {
      const path = await api.exportAudio(useEditor.getState().audioPath, start, end, name);
      showToast(`音频已导出到 ${path}`);
    } catch (e) {
      showToast(typeof e === "string" ? e : String(e));
    }
  };

  const copyFull = async () => {
    const text = useEditor
      .getState()
      .sentences.map((s) => s.text)
      .join("\n");
    await navigator.clipboard.writeText(text);
    showToast("已复制全文");
  };

  const generatePptx = async () => {
    const { audioPath, sentences, pptSettings } = useEditor.getState();
    if (sentences.length === 0) {
      showToast("没有可生成的句子");
      return;
    }
    setBusy({ label: "正在生成 PPT…", value: null, cancellable: false });
    try {
      const path = await api.generatePptx(
        audioPath,
        sentences.map((s) => ({ start: s.start, end: s.end, text: s.text })),
        { projectName: useEditor.getState().projectName, ...pptSettings },
      );
      useEditor.getState().markClean();
      showToast(`PPT 已导出到 ${path}`);
    } catch (e) {
      showToast(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleAction = (action: SentenceAction, id: string) => {
    const state = useEditor.getState();
    const sent = state.sentences.find((x) => x.id === id);
    switch (action) {
      case "delete":
        deleteSentences([id]);
        break;
      case "merge-up":
        mergeUp(id);
        break;
      case "copy":
        if (sent) {
          void navigator.clipboard.writeText(sent.text);
          showToast("已复制到剪贴板");
        }
        break;
      case "seek":
        if (sent) playFrom(sent.start);
        break;
      case "re-recognize":
        void reRecognize([id]);
        break;
      case "export":
        if (sent)
          void exportRange(sent.start, sent.end, `句子_${state.sentences.indexOf(sent) + 1}`);
        break;
      case "split":
        if (sent) setSplitTarget(sent);
        break;
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.titleRow} title={projectName}>
          <Text className={styles.titleText}>{projectName}</Text>
          <Button
            size="small"
            appearance="subtle"
            icon={<EditRegular />}
            onClick={openRename}
            aria-label="重命名项目"
          />
        </div>
        <Button
          size="small"
          appearance="subtle"
          icon={<ArrowUndoRegular />}
          disabled={!canUndo}
          onClick={undo}
          aria-label="撤销 (Ctrl+Z)"
        />
        <Button
          size="small"
          appearance="subtle"
          icon={<ArrowRedoRegular />}
          disabled={!canRedo}
          onClick={redo}
          aria-label="恢复 (Ctrl+Y)"
        />
        <Button appearance="primary" onClick={() => setPptOpen(true)}>
          生成 PPT
        </Button>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Button
              size="small"
              appearance="subtle"
              icon={<MoreHorizontalRegular />}
              aria-label="更多操作"
            />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<ArrowClockwiseRegular />} onClick={() => void reRecognizeAll()}>
                重新识别
              </MenuItem>
              <MenuItem
                icon={<ArrowDownloadRegular />}
                onClick={() => void exportRange(null, null, projectName)}
              >
                导出音频
              </MenuItem>
              <MenuItem icon={<CopyRegular />} onClick={() => void copyFull()}>
                复制全文
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>

      <div className={styles.body}>
        <div className={styles.left}>
          <SentenceList onAction={handleAction} onNewSentence={() => setNewOpen(true)} />
        </div>
        <div className={styles.right}>
          <div className={styles.editor}>
            <SentenceEditor onAction={handleAction} onReRecognizeMany={reRecognize} />
          </div>
          <div className={styles.player}>
            <WaveformPlayer
              onSplitAt={(id) => {
                const s = useEditor.getState().sentences.find((x) => x.id === id);
                if (s) setSplitTarget(s);
              }}
            />
          </div>
        </div>
      </div>

      {renameOpen && (
        <Dialog open onOpenChange={(_, d) => !d.open && setRenameOpen(false)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>重命名项目</DialogTitle>
              <DialogContent>
                <Field label="项目名称">
                  <Input
                    value={nameDraft}
                    onChange={(_, d) => setNameDraft(d.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitName();
                      else if (e.key === "Escape") setRenameOpen(false);
                    }}
                  />
                </Field>
              </DialogContent>
              <DialogActions>
                <Button appearance="secondary" onClick={() => setRenameOpen(false)}>
                  取消
                </Button>
                <Button appearance="primary" onClick={commitName}>
                  确定
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}

      {/* 仅在真正打开时才挂载对话框；若始终挂载，Fluent Dialog 在关闭后会残留
          一个 aria-hidden 的 surface，可能与其他 Dialog（如启动时加载模型的弹窗）
          叠加成“看起来打开了却点不动”的模态层。 */}
      {newOpen && <NewSentenceDialog open onClose={() => setNewOpen(false)} />}
      {splitTarget && <SplitDialog sentence={splitTarget} onClose={() => setSplitTarget(null)} />}
      {pptOpen && (
        <PptDialog
          open
          onClose={() => setPptOpen(false)}
          onGenerate={() => {
            setPptOpen(false);
            void generatePptx();
          }}
        />
      )}

      {busy && (
        <Dialog open>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>{busy.cancellable ? "音频识别" : "处理中"}</DialogTitle>
              <DialogContent>
                <Text>{busy.label}</Text>
                {busy.value != null && <ProgressBar value={busy.value} />}
              </DialogContent>
              <DialogActions>
                {busy.cancellable ? (
                  <Button appearance="secondary" onClick={() => void api.cancelTranscribe()}>
                    取消
                  </Button>
                ) : (
                  <Button appearance="secondary" onClick={() => setBusy(null)}>
                    关闭
                  </Button>
                )}
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}

      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  );
}
