import { useState } from "react";
import { Button, makeStyles, tokens } from "@fluentui/react-components";
import {
  AddRegular,
  ArrowClockwiseRegular,
  ArrowDownloadRegular,
  CopyRegular,
  CutRegular,
  DeleteRegular,
  MergeRegular,
  PlayRegular,
} from "@fluentui/react-icons";
import { useEditor } from "../../stores/editor";
import type { SentenceAction } from "./types";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  list: { flex: 1, overflowY: "auto", padding: "4px" },
  item: {
    padding: "8px 10px",
    borderRadius: "6px",
    cursor: "pointer",
    marginBottom: "4px",
    border: "1px solid transparent",
    "&:hover": { background: tokens.colorNeutralBackground1Hover },
  },
  itemSelected: {
    background: tokens.colorNeutralBackground1Selected,
    border: `1px solid ${tokens.colorBrandBackground}`,
  },
  title: { fontWeight: 600, fontSize: "13px" },
  text: {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    color: tokens.colorNeutralForeground3,
    fontSize: "12px",
  },
  footer: { padding: "8px", borderTop: `1px solid ${tokens.colorNeutralStroke1}` },
  menu: {
    position: "fixed",
    zIndex: 1000,
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "6px",
    boxShadow: tokens.shadow16,
    padding: "4px",
    minWidth: "160px",
  },
  menuItem: { display: "block", width: "100%", textAlign: "left", justifyContent: "flex-start" },
});

interface SentenceListProps {
  onAction: (action: SentenceAction, id: string) => void;
  onNewSentence: () => void;
}

export function SentenceList({ onAction, onNewSentence }: SentenceListProps) {
  const styles = useStyles();
  const sentences = useEditor((s) => s.sentences);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectOnly = useEditor((s) => s.selectOnly);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  const fire = (action: SentenceAction, id: string) => {
    setMenu(null);
    onAction(action, id);
  };

  return (
    <div className={styles.root}>
      <div className={styles.list}>
        {sentences.map((s, i) => {
          const selected = selectedIds.includes(s.id);
          return (
            <div
              key={s.id}
              className={`${styles.item}${selected ? ` ${styles.itemSelected}` : ""}`}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) toggleSelect(s.id);
                else selectOnly(s.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selectedIds.includes(s.id)) selectOnly(s.id);
                setMenu({ x: e.clientX, y: e.clientY, id: s.id });
              }}
            >
              <div className={styles.title}>句子 {i + 1}</div>
              <div className={styles.text}>{s.text}</div>
            </div>
          );
        })}
      </div>
      <div className={styles.footer}>
        <Button
          appearance="subtle"
          icon={<AddRegular />}
          onClick={onNewSentence}
          style={{ width: "100%", justifyContent: "flex-start" }}
        >
          新建句子
        </Button>
      </div>

      {menu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 999 }}
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div className={styles.menu} style={{ left: menu.x, top: menu.y }}>
            <Button
              className={styles.menuItem}
              appearance="subtle"
              icon={<PlayRegular />}
              onClick={() => fire("seek", menu.id)}
            >
              播放
            </Button>
            <Button
              className={styles.menuItem}
              appearance="subtle"
              icon={<ArrowClockwiseRegular />}
              onClick={() => fire("re-recognize", menu.id)}
            >
              重新识别
            </Button>
            <Button
              className={styles.menuItem}
              appearance="subtle"
              icon={<CutRegular />}
              onClick={() => fire("split", menu.id)}
            >
              切分句子
            </Button>
            <Button
              className={styles.menuItem}
              appearance="subtle"
              icon={<MergeRegular />}
              onClick={() => fire("merge-up", menu.id)}
            >
              合并到上句
            </Button>
            <Button
              className={styles.menuItem}
              appearance="subtle"
              icon={<ArrowDownloadRegular />}
              onClick={() => fire("export", menu.id)}
            >
              导出音频
            </Button>
            <Button
              className={styles.menuItem}
              appearance="subtle"
              icon={<CopyRegular />}
              onClick={() => fire("copy", menu.id)}
            >
              复制文本
            </Button>
            <Button
              className={styles.menuItem}
              appearance="subtle"
              icon={<DeleteRegular />}
              style={{ color: "var(--colorPaletteRedForeground1)" }}
              onClick={() => fire("delete", menu.id)}
            >
              删除
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
