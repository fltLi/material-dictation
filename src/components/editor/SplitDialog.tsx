import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
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
  Switch,
  Textarea,
} from "@fluentui/react-components";
import { PauseFilled, PlayFilled } from "@fluentui/react-icons";
import { api } from "../../services/backend";
import { useEditor } from "../../stores/editor";
import type { Sentence } from "../../types";

interface SplitDialogProps {
  sentence: Sentence | null;
  onClose: () => void;
}

function splitText(text: string): [string, string] {
  const words = text.split(/\s+/).filter(Boolean);
  const mid = Math.floor(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

export function SplitDialog({ sentence, onClose }: SplitDialogProps) {
  const audioPath = useEditor((s) => s.audioPath);
  const sentences = useEditor((s) => s.sentences);
  const splitSentence = useEditor((s) => s.splitSentence);

  const sentenceNo = sentence ? sentences.findIndex((x) => x.id === sentence.id) + 1 : 0;

  const audioRef = useRef<HTMLAudioElement>(null);
  const [splitTime, setSplitTime] = useState("0");
  const [leftText, setLeftText] = useState("");
  const [rightText, setRightText] = useState("");
  const [reRecognize, setReRecognize] = useState(true);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sentence) return;
    const mid = (sentence.start + sentence.end) / 2;
    setSplitTime(mid.toFixed(2));
    const [l, r] = splitText(sentence.text);
    setLeftText(l);
    setRightText(r);
    setReRecognize(true);
    setError(null);
    setPlaying(false);
  }, [sentence]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a || !sentence) return;
    if (playing) {
      a.pause();
      return;
    }
    a.currentTime = sentence.start;
    void a.play();
  };

  const confirm = async () => {
    if (!sentence) return;
    const t = parseFloat(splitTime);
    if (!Number.isFinite(t) || t <= sentence.start || t >= sentence.end) {
      setError("切分时间需在句子时间范围内");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let l = leftText;
      let r = rightText;
      if (reRecognize) {
        const ls = await api.transcribeAudio(audioPath, sentence.start, t, () => {});
        const rs = await api.transcribeAudio(audioPath, t, sentence.end, () => {});
        l = ls
          .map((x) => x.text)
          .join(" ")
          .trim();
        r = rs
          .map((x) => x.text)
          .join(" ")
          .trim();
      }
      splitSentence(
        sentence.id,
        { start: sentence.start, end: t, text: l },
        { start: t, end: sentence.end, text: r },
      );
      onClose();
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={sentence !== null} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{sentenceNo > 0 ? `切分句子 ${sentenceNo}` : "切分句子"}</DialogTitle>
          <DialogContent>
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
              <Field label="切分位置（秒）">
                <Input
                  type="number"
                  step="0.1"
                  value={splitTime}
                  onChange={(_, d) => setSplitTime(d.value)}
                />
              </Field>
              <Button
                icon={playing ? <PauseFilled /> : <PlayFilled />}
                onClick={togglePlay}
                aria-label="播放本句"
              />
              <Switch
                checked={reRecognize}
                onChange={(_, d) => setReRecognize(d.checked)}
                label="切分后重新识别"
              />
            </div>
            {!reRecognize && (
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <Field label="前半句">
                  <Textarea value={leftText} onChange={(_, d) => setLeftText(d.value)} rows={3} />
                </Field>
                <Field label="后半句">
                  <Textarea value={rightText} onChange={(_, d) => setRightText(d.value)} rows={3} />
                </Field>
              </div>
            )}
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
      <audio
        ref={audioRef}
        src={convertFileSrc(audioPath)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          if (sentence && e.currentTarget.currentTime >= sentence.end) {
            e.currentTarget.pause();
            e.currentTarget.currentTime = sentence.start;
          }
        }}
        style={{ display: "none" }}
      />
    </Dialog>
  );
}
