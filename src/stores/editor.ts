import { create } from "zustand";
import type { PptSettings, Sentence } from "../types";

const HISTORY_LIMIT = 100;

export const DEFAULT_PPT_SETTINGS: PptSettings = {
  listenTimes: 3,
  speeds: [1, 1, 1],
  gapSeconds: 0.5,
  fullTextSpeed: 1,
};

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `s-${Date.now().toString(36)}-${idCounter}`;
}

function sortByStart(list: Sentence[]): Sentence[] {
  return [...list].sort((a, b) => a.start - b.start);
}

interface HistorySource {
  sentences: Sentence[];
  past: Sentence[][];
}

function nextHistory(
  source: HistorySource,
  next: Sentence[],
): Pick<EditorState, "sentences" | "past" | "future" | "dirty"> {
  return {
    sentences: sortByStart(next),
    past: [...source.past, source.sentences].slice(-HISTORY_LIMIT),
    future: [],
    dirty: true,
  };
}

export interface EditorState {
  projectName: string;
  audioPath: string;
  duration: number;
  sentences: Sentence[];
  activeId: string | null;
  selectedIds: string[];
  pptSettings: PptSettings;
  past: Sentence[][];
  future: Sentence[][];
  dirty: boolean;
  seekTo: { time: number; nonce: number; play: boolean } | null;

  init: (p: {
    projectName: string;
    audioPath: string;
    duration: number;
    sentences: Sentence[];
  }) => void;
  renameProject: (name: string) => void;
  setPptSettings: (patch: Partial<PptSettings>) => void;
  markClean: () => void;

  selectOnly: (id: string) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;

  updateSentence: (id: string, patch: Partial<Pick<Sentence, "start" | "end" | "text">>) => void;
  addSentence: (s: { start: number; end: number; text: string }) => void;
  deleteSentences: (ids: string[]) => void;
  mergeSelected: () => void;
  mergeUp: (id: string) => void;
  splitSentence: (
    id: string,
    left: { start: number; end: number; text: string },
    right: { start: number; end: number; text: string },
  ) => void;
  replaceAllSentences: (segs: { start: number; end: number; text: string }[]) => void;

  undo: () => void;
  redo: () => void;
  requestSeek: (time: number) => void;
  playFrom: (time: number) => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  projectName: "",
  audioPath: "",
  duration: 0,
  sentences: [],
  activeId: null,
  selectedIds: [],
  pptSettings: DEFAULT_PPT_SETTINGS,
  past: [],
  future: [],
  dirty: false,
  seekTo: null,

  init: (p) =>
    set({
      projectName: p.projectName,
      audioPath: p.audioPath,
      duration: p.duration,
      sentences: sortByStart(p.sentences),
      activeId: null,
      selectedIds: [],
      pptSettings: DEFAULT_PPT_SETTINGS,
      past: [],
      future: [],
      dirty: false,
      seekTo: null,
    }),

  renameProject: (name) => set({ projectName: name, dirty: true }),
  setPptSettings: (patch) =>
    set((s) => ({ pptSettings: { ...s.pptSettings, ...patch }, dirty: true })),
  markClean: () => set({ dirty: false }),

  selectOnly: (id) => set({ activeId: id, selectedIds: [id] }),
  toggleSelect: (id) =>
    set((s) => ({
      activeId: id,
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  clearSelection: () => set({ activeId: null, selectedIds: [] }),

  updateSentence: (id, patch) => {
    const s = get();
    const next = s.sentences.map((x) => (x.id === id ? { ...x, ...patch } : x));
    set({ ...nextHistory(s, next), activeId: s.activeId, selectedIds: s.selectedIds });
  },

  addSentence: (input) => {
    const s = get();
    const ns: Sentence = { id: newId(), ...input };
    set({
      ...nextHistory(s, [...s.sentences, ns]),
      activeId: ns.id,
      selectedIds: [ns.id],
    });
  },

  deleteSentences: (ids) => {
    const s = get();
    const next = s.sentences.filter((x) => !ids.includes(x.id));
    set({
      ...nextHistory(s, next),
      activeId: s.activeId && ids.includes(s.activeId) ? null : s.activeId,
      selectedIds: s.selectedIds.filter((x) => !ids.includes(x)),
    });
  },

  mergeSelected: () => {
    const s = get();
    if (s.selectedIds.length < 2) return;
    const indices = s.selectedIds
      .map((id) => s.sentences.findIndex((x) => x.id === id))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    if (indices.length < 2) return;
    if (!indices.every((v, i) => i === 0 || v === indices[i - 1] + 1)) return;
    const first = s.sentences[indices[0]];
    const last = s.sentences[indices[indices.length - 1]];
    const merged: Sentence = {
      id: newId(),
      start: first.start,
      end: last.end,
      text: indices.map((i) => s.sentences[i].text).join(" "),
    };
    const next = s.sentences.filter((_, i) => !indices.includes(i));
    next.splice(indices[0], 0, merged);
    set({ ...nextHistory(s, next), activeId: merged.id, selectedIds: [merged.id] });
  },

  mergeUp: (id) => {
    const s = get();
    const idx = s.sentences.findIndex((x) => x.id === id);
    if (idx <= 0) return;
    const prev = s.sentences[idx - 1];
    const cur = s.sentences[idx];
    const merged: Sentence = {
      id: newId(),
      start: prev.start,
      end: cur.end,
      text: `${prev.text} ${cur.text}`,
    };
    const next = s.sentences.filter((_, i) => i !== idx - 1 && i !== idx);
    next.splice(idx - 1, 0, merged);
    set({ ...nextHistory(s, next), activeId: merged.id, selectedIds: [merged.id] });
  },

  splitSentence: (id, left, right) => {
    const s = get();
    const idx = s.sentences.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const l: Sentence = { id: newId(), ...left };
    const r: Sentence = { id: newId(), ...right };
    const next = [...s.sentences.slice(0, idx), l, r, ...s.sentences.slice(idx + 1)];
    set({ ...nextHistory(s, next), activeId: l.id, selectedIds: [l.id, r.id] });
  },

  replaceAllSentences: (segs) => {
    const s = get();
    const next = segs.map((seg) => ({ id: newId(), ...seg }));
    set({ ...nextHistory(s, next), activeId: null, selectedIds: [] });
  },

  undo: () => {
    const s = get();
    if (s.past.length === 0) return;
    const prev = s.past[s.past.length - 1];
    set({
      sentences: prev,
      past: s.past.slice(0, -1),
      future: [s.sentences, ...s.future].slice(0, HISTORY_LIMIT),
      dirty: true,
    });
  },

  redo: () => {
    const s = get();
    if (s.future.length === 0) return;
    const next = s.future[0];
    set({
      sentences: next,
      past: [...s.past, s.sentences].slice(-HISTORY_LIMIT),
      future: s.future.slice(1),
      dirty: true,
    });
  },

  requestSeek: (time) => set({ seekTo: { time, nonce: Date.now(), play: false } }),
  playFrom: (time) => set({ seekTo: { time, nonce: Date.now(), play: true } }),
}));
