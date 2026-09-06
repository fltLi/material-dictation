import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Button, Text, makeStyles, tokens } from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  ArrowDownFilled,
  ArrowUpFilled,
  CutRegular,
  PauseFilled,
  PlayFilled,
} from "@fluentui/react-icons";
import { api } from "../../services/backend";
import { useEditor } from "../../stores/editor";
import { useSettings } from "../../stores/settings";
import { formatTime } from "../../utils/format";

// 可视时间窗口：展示的秒数（刻度数字每 2s 标注一个）。
const VISIBLE_SECONDS = 12;
const CANVAS_H = 168;
/** 顶部时间刻度带的高度（px）。 */
const RULER_H = 32;

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "6px", minHeight: 0 },
  canvas: {
    width: "100%",
    height: `${CANVAS_H}px`,
    background: tokens.colorNeutralBackground1,
    borderRadius: "6px",
    cursor: "ew-resize",
    touchAction: "none",
  },
  controls: { display: "flex", gap: "10px", alignItems: "center", paddingBottom: "2px" },
  center: { flex: 1, display: "flex", justifyContent: "center", gap: "8px", alignItems: "center" },
  divider: {
    width: "1px",
    height: "30px",
    background: tokens.colorNeutralStroke2,
    flexShrink: 0,
  },
  right: { display: "flex", gap: "8px", alignItems: "center" },
  time: {
    fontVariantNumeric: "tabular-nums",
    minWidth: "110px",
    color: tokens.colorNeutralForeground3,
  },
});

interface WaveformPlayerProps {
  onSplitAt: (id: string, time: number) => void;
}

export function WaveformPlayer({ onSplitAt }: WaveformPlayerProps) {
  const styles = useStyles();
  const audioPath = useEditor((s) => s.audioPath);
  const duration = useEditor((s) => s.duration);
  const sentences = useEditor((s) => s.sentences);
  const activeId = useEditor((s) => s.activeId);
  const seekTo = useEditor((s) => s.seekTo);
  const dark = useSettings((s) => s.settings?.theme === "dark") ?? false;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const dragRef = useRef<{ x: number; startTime: number; moved: boolean } | null>(null);
  const playingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const lastSyncSentenceRef = useRef(-1);

  // 来自外部（句子编辑“播放/转到”等）的定位/播放请求。
  useEffect(() => {
    if (!seekTo) return;
    const a = audioRef.current;
    const t = Math.min(Math.max(seekTo.time, 0), Math.max(0, duration));
    currentTimeRef.current = t;
    setCurrentTime(t);
    if (a) {
      a.currentTime = t;
      if (seekTo.play) void a.play();
    }
  }, [seekTo, duration]);

  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [width, setWidth] = useState(800);
  playingRef.current = playing;
  currentTimeRef.current = currentTime;

  useEffect(() => {
    if (!audioPath) return;
    api
      .waveform(audioPath, 1000)
      .then(setPeaks)
      .catch(() => setPeaks(null));
  }, [audioPath]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth || 800);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.min(Math.max(t, 0), Math.max(0, duration));
      currentTimeRef.current = clamped;
      setCurrentTime(clamped);
      if (audioRef.current) audioRef.current.currentTime = clamped;
    },
    [duration],
  );

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playingRef.current) a.pause();
    else void a.play();
  }, []);

  const currentIndex = useCallback(() => {
    const t = currentTimeRef.current;
    for (let i = 0; i < sentences.length; i++) {
      if (t >= sentences[i].start && t < sentences[i].end) return i;
    }
    return -1;
  }, [sentences]);

  const prevSentence = useCallback(() => {
    const i = currentIndex();
    const t = currentTimeRef.current;
    let targetIdx = -1;
    if (i > 0) targetIdx = i - 1;
    else if (i < 0) {
      // 不在任何句内：找当前时刻之前最近的句子。
      for (let k = 0; k < sentences.length; k++) {
        if (sentences[k].start < t - 0.05) targetIdx = k;
      }
    }
    if (targetIdx < 0) targetIdx = 0;
    const s = sentences[targetIdx];
    if (s) {
      useEditor.getState().selectOnly(s.id);
      seek(s.start);
    }
  }, [currentIndex, seek, sentences]);

  const nextSentence = useCallback(() => {
    const i = currentIndex();
    const t = currentTimeRef.current;
    let target = i >= 0 && i + 1 < sentences.length ? sentences[i + 1] : undefined;
    if (!target) target = sentences.find((s) => s.start > t + 0.05);
    if (target) {
      useEditor.getState().selectOnly(target.id);
      seek(target.start);
    }
  }, [currentIndex, seek, sentences]);

  const replay = useCallback(() => {
    const i = currentIndex();
    const target = i >= 0 ? sentences[i] : undefined;
    seek(target ? target.start : 0);
    const a = audioRef.current;
    if (a) void a.play();
  }, [currentIndex, seek, sentences]);

  const splitAt = useCallback(() => {
    const i = currentIndex();
    if (i < 0) return;
    // 从播放开启切分时应先暂停，避免对话框背后继续出声。
    audioRef.current?.pause();
    onSplitAt(sentences[i].id, currentTimeRef.current);
  }, [currentIndex, onSplitAt, sentences]);

  // #6 全局快捷键：PageUp/PageDown 切句、Space 播放/暂停、←/→ 快退/快进 5 秒。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      switch (e.key) {
        case "PageUp":
          e.preventDefault();
          prevSentence();
          break;
        case "PageDown":
          e.preventDefault();
          nextSentence();
          break;
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(currentTimeRef.current - 5);
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(currentTimeRef.current + 5);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevSentence, nextSentence, togglePlay, seek]);

  // #10 播放时把当前句同步到句子编辑面板。
  const handleTime = () => {
    const a = audioRef.current;
    if (!a) return;
    const t = a.currentTime;
    currentTimeRef.current = t;
    setCurrentTime(t);
    if (!playingRef.current) return;
    const idx = sentences.findIndex((s) => t >= s.start && t < s.end);
    if (idx >= 0 && idx !== lastSyncSentenceRef.current) {
      lastSyncSentenceRef.current = idx;
      useEditor.getState().selectOnly(sentences[idx].id);
    }
  };

  // 波形图绘制。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = CANVAS_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, CANVAS_H);

    const pxPerSec = width / VISIBLE_SECONDS;
    const viewLeft = currentTime - VISIBLE_SECONDS / 2;
    const waveTop = RULER_H;
    const waveBottom = CANVAS_H;

    // 时间刻度（顶部）：0.1s/0.5s/1s 三种长度的短竖线，每秒上方标一个时刻。
    const tickColor = dark ? "#9aa0a6" : "#9a9a9a";
    const labelColor = dark ? "#d5d8dc" : "#5a5a5a";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = labelColor;
    ctx.strokeStyle = tickColor;
    ctx.lineWidth = 1;
    const lo = Math.floor(viewLeft * 10) / 10;
    const hi = viewLeft + VISIBLE_SECONDS;
    for (let i = 0; ; i++) {
      const t = lo + i * 0.1;
      if (t > hi + 1e-6) break;
      const x = (t - viewLeft) * pxPerSec;
      if (x < -2 || x > width + 2) continue;
      const frac = Math.round(t * 10) / 10;
      const isSec = Math.abs(frac - Math.round(frac)) < 1e-6;
      const isHalf = Math.abs(frac - (Math.floor(frac) + 0.5)) < 1e-6;
      const len = isSec ? 13 : isHalf ? 9 : 5;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - len);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      if (isSec && Math.round(t) % 2 === 0 && t >= -1e-6 && t <= Math.floor(duration) + 1e-6) {
        ctx.fillText(formatTime(t).slice(0, -2), x, RULER_H - 16);
      }
    }

    // 句子色带。
    for (const s of sentences) {
      const x0 = (s.start - viewLeft) * pxPerSec;
      const x1 = (s.end - viewLeft) * pxPerSec;
      if (x1 < 0 || x0 > width) continue;
      const isActive = s.id === activeId;
      ctx.fillStyle = isActive ? "rgba(0,120,212,0.45)" : "rgba(0,120,212,0.16)";
      ctx.fillRect(
        Math.max(0, x0),
        waveTop,
        Math.min(width, x1) - Math.max(0, x0),
        waveBottom - waveTop,
      );
      ctx.fillStyle = isActive ? "#0078d4" : "#6ea8d8";
      ctx.fillRect(Math.max(0, x0), waveTop, 2, waveBottom - waveTop);
      ctx.fillRect(Math.min(width, x1) - 2, waveTop, 2, waveBottom - waveTop);
    }

    // 波形峰值。
    if (peaks && peaks.length > 0) {
      const barW = Math.max(1, (duration / peaks.length) * pxPerSec);
      ctx.fillStyle = "#9aa0a6";
      const midY = (waveTop + waveBottom) / 2;
      const maxH = waveBottom - waveTop;
      for (let i = 0; i < peaks.length; i++) {
        const t = (i / peaks.length) * duration;
        const x = (t - viewLeft) * pxPerSec;
        if (x < -barW || x > width) continue;
        const h = Math.max(2, peaks[i] * (maxH - 8));
        ctx.fillRect(x, midY - h / 2, barW, h);
      }
    }

    // 中央播放头。
    ctx.strokeStyle = "#d13438";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, CANVAS_H);
    ctx.stroke();
  }, [peaks, currentTime, width, duration, sentences, activeId, dark]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, startTime: currentTimeRef.current, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 2) d.moved = true;
    seek(d.startTime - dx / (width / VISIBLE_SECONDS));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (!d.moved) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const t =
        currentTimeRef.current -
        VISIBLE_SECONDS / 2 +
        (e.clientX - rect.left) / (width / VISIBLE_SECONDS);
      const hit = sentences.find((s) => t >= s.start && t <= s.end);
      if (hit) {
        useEditor.getState().selectOnly(hit.id);
        seek(hit.start); // 点击句子后把播放位置对齐到句首
      }
    }
  };

  return (
    <div className={styles.root}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      />
      <audio
        ref={audioRef}
        src={convertFileSrc(audioPath)}
        onTimeUpdate={handleTime}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          lastSyncSentenceRef.current = -1;
        }}
        onEnded={() => {
          setPlaying(false);
          lastSyncSentenceRef.current = -1;
        }}
      />
      <div className={styles.controls}>
        <Text className={styles.time}>{formatTime(currentTime)}</Text>
        <div className={styles.center}>
          <Button
            size="medium"
            appearance="subtle"
            icon={<ArrowUpFilled />}
            onClick={prevSentence}
            title="上一句 (PageUp)"
            aria-label="上一句 (PageUp)"
          />
          <Button
            size="medium"
            appearance="subtle"
            icon={playing ? <PauseFilled /> : <PlayFilled />}
            onClick={togglePlay}
            title="播放 / 暂停 (空格)"
            aria-label="播放 / 暂停"
          />
          <Button
            size="medium"
            appearance="subtle"
            icon={<ArrowDownFilled />}
            onClick={nextSentence}
            title="下一句 (PageDown)"
            aria-label="下一句 (PageDown)"
          />
        </div>
        <span className={styles.divider} />
        <div className={styles.right}>
          <Button
            size="medium"
            appearance="subtle"
            icon={<ArrowClockwiseRegular />}
            onClick={replay}
            title="重播本句"
            aria-label="重播本句"
          />
          <Button
            size="medium"
            appearance="subtle"
            icon={<CutRegular />}
            onClick={splitAt}
            title="在当前位置切分"
            aria-label="在当前位置切分"
          />
        </div>
      </div>
    </div>
  );
}
