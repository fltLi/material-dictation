import { useEffect, useState } from "react";
import {
  Button,
  Field,
  Input,
  Text,
  Textarea,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useEditor } from "../../stores/editor";
import { formatTime } from "../../utils/format";
import {
  ArrowClockwiseRegular,
  ArrowDownloadRegular,
  CopyRegular,
  CutRegular,
  DeleteRegular,
  MergeRegular,
  PlayRegular,
} from "@fluentui/react-icons";
import type { SentenceAction } from "./types";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
    overflowY: "auto",
  },
  actions: { display: "flex", flexWrap: "wrap", gap: "6px" },
  meta: { color: tokens.colorNeutralForeground3, fontVariantNumeric: "tabular-nums" },
  bulk: { display: "flex", flexDirection: "column", gap: "8px" },
});

interface SentenceEditorProps {
  onAction: (action: SentenceAction, id: string) => void;
  onReRecognizeMany: (ids: string[]) => void;
}

export function SentenceEditor({ onAction, onReRecognizeMany }: SentenceEditorProps) {
  const styles = useStyles();
  const sentences = useEditor((s) => s.sentences);
  const activeId = useEditor((s) => s.activeId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const updateSentence = useEditor((s) => s.updateSentence);
  const deleteSentences = useEditor((s) => s.deleteSentences);
  const mergeSelected = useEditor((s) => s.mergeSelected);

  const sentence = activeId ? (sentences.find((s) => s.id === activeId) ?? null) : null;

  const [textDraft, setTextDraft] = useState("");
  const [startDraft, setStartDraft] = useState("0");
  const [endDraft, setEndDraft] = useState("0");

  useEffect(() => {
    if (sentence) {
      setTextDraft(sentence.text);
      setStartDraft(sentence.start.toFixed(2));
      setEndDraft(sentence.end.toFixed(2));
    }
  }, [sentence]);

  const commitText = () => {
    if (sentence && textDraft !== sentence.text) {
      updateSentence(sentence.id, { text: textDraft });
    }
  };

  const commitStart = () => {
    if (!sentence) return;
    const v = parseFloat(startDraft);
    if (Number.isFinite(v) && v >= 0 && v < sentence.end) {
      updateSentence(sentence.id, { start: v });
    } else {
      setStartDraft(sentence.start.toFixed(2));
    }
  };

  const commitEnd = () => {
    if (!sentence) return;
    const v = parseFloat(endDraft);
    if (Number.isFinite(v) && v > sentence.start) {
      updateSentence(sentence.id, { end: v });
    } else {
      setEndDraft(sentence.end.toFixed(2));
    }
  };

  const multi = selectedIds.length > 1;

  return (
    <div className={styles.root}>
      {multi ? (
        <div className={styles.bulk}>
          <Title3>已选 {selectedIds.length} 个句子</Title3>
          <Text className={styles.meta}>可对选中的连续句子进行批量操作。</Text>
          <div className={styles.actions}>
            <Button icon={<ArrowClockwiseRegular />} onClick={() => onReRecognizeMany(selectedIds)}>
              重新识别
            </Button>
            <Button icon={<MergeRegular />} onClick={mergeSelected}>
              合并
            </Button>
            <Button
              icon={<DeleteRegular />}
              style={{ color: "var(--colorPaletteRedForeground1)" }}
              onClick={() => deleteSentences(selectedIds)}
            >
              删除
            </Button>
          </div>
        </div>
      ) : sentence ? (
        <>
          <Title3>句子 {sentences.findIndex((s) => s.id === sentence.id) + 1}</Title3>
          <Text className={styles.meta}>
            {formatTime(sentence.start)} – {formatTime(sentence.end)}
          </Text>

          <div style={{ display: "flex", gap: "8px" }}>
            <Field label="开始（秒）">
              <Input
                type="number"
                step="0.1"
                value={startDraft}
                onChange={(_, d) => setStartDraft(d.value)}
                onBlur={commitStart}
              />
            </Field>
            <Field label="结束（秒）">
              <Input
                type="number"
                step="0.1"
                value={endDraft}
                onChange={(_, d) => setEndDraft(d.value)}
                onBlur={commitEnd}
              />
            </Field>
          </div>

          <Field label="文本">
            <Textarea
              value={textDraft}
              onChange={(_, d) => setTextDraft(d.value)}
              onBlur={commitText}
              rows={6}
              resize="vertical"
            />
          </Field>

          <div className={styles.actions}>
            <Button icon={<PlayRegular />} onClick={() => onAction("seek", sentence.id)}>
              播放
            </Button>
            <Button
              icon={<ArrowClockwiseRegular />}
              onClick={() => onAction("re-recognize", sentence.id)}
            >
              重新识别
            </Button>
            <Button icon={<CutRegular />} onClick={() => onAction("split", sentence.id)}>
              切分句子
            </Button>
            <Button icon={<ArrowDownloadRegular />} onClick={() => onAction("export", sentence.id)}>
              导出音频
            </Button>
            <Button icon={<CopyRegular />} onClick={() => onAction("copy", sentence.id)}>
              复制文本
            </Button>
            <Button
              icon={<DeleteRegular />}
              style={{ color: "var(--colorPaletteRedForeground1)" }}
              onClick={() => onAction("delete", sentence.id)}
            >
              删除
            </Button>
          </div>
        </>
      ) : (
        <Text className={styles.meta}>选择左侧句子进行编辑</Text>
      )}
    </div>
  );
}
