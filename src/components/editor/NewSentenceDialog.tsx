import { useState } from "react";
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
  Spinner,
  Textarea,
} from "@fluentui/react-components";
import { api } from "../../services/backend";
import { useEditor } from "../../stores/editor";

interface NewSentenceDialogProps {
  open: boolean;
  onClose: () => void;
}

export function NewSentenceDialog({ open, onClose }: NewSentenceDialogProps) {
  const audioPath = useEditor((s) => s.audioPath);
  const addSentence = useEditor((s) => s.addSentence);

  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("0");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    const s = parseFloat(start);
    const e = parseFloat(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s >= e) {
      setError("开始时间需小于结束时间");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let finalText = text.trim();
      if (!finalText) {
        const segs = await api.transcribeAudio(audioPath, s, e, () => {});
        finalText = segs
          .map((x) => x.text)
          .join(" ")
          .trim();
      }
      addSentence({ start: s, end: e, text: finalText });
      setStart("0");
      setEnd("0");
      setText("");
      onClose();
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>新建句子</DialogTitle>
          <DialogContent>
            <div style={{ display: "flex", gap: "8px" }}>
              <Field label="开始（秒）">
                <Input
                  type="number"
                  step="0.1"
                  value={start}
                  onChange={(_, d) => setStart(d.value)}
                />
              </Field>
              <Field label="结束（秒）">
                <Input type="number" step="0.1" value={end} onChange={(_, d) => setEnd(d.value)} />
              </Field>
            </div>
            <Field label="文本（留空则自动识别）" style={{ marginTop: "8px" }}>
              <Textarea value={text} onChange={(_, d) => setText(d.value)} rows={3} />
            </Field>
            {error && (
              <div style={{ color: "var(--colorStatusDangerForeground1)", marginTop: "8px" }}>
                {error}
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button appearance="primary" onClick={() => void confirm()} disabled={busy}>
              {busy ? <Spinner size="tiny" /> : "确定"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
