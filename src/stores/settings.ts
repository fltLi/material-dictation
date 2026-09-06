import { create } from "zustand";
import { api } from "../services/backend";
import type { InferenceBackend, ModelEntry, Settings, Theme } from "../types";

interface SettingsStore {
  settings: Settings | null;
  loaded: boolean;
  load: () => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  setBackend: (backend: InferenceBackend) => Promise<void>;
  addModelEntry: (entry: ModelEntry) => void;
  removeModelEntry: (id: string) => Promise<void>;
  setLastModel: (id: string | null) => Promise<void>;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: null,
  loaded: false,

  load: async () => {
    const settings = await api.getSettings();
    set({ settings, loaded: true });
  },

  setTheme: async (theme) => {
    const settings = get().settings;
    if (!settings) return;
    const next = { ...settings, theme };
    await api.setSettings(next);
    set({ settings: next });
  },

  setBackend: async (backend) => {
    const settings = get().settings;
    if (!settings) return;
    const next = { ...settings, backend };
    await api.setSettings(next);
    set({ settings: next });
  },

  addModelEntry: (entry) => {
    const settings = get().settings;
    if (!settings) return;
    set({ settings: { ...settings, models: [...settings.models, entry] } });
  },

  removeModelEntry: async (id) => {
    await api.removeModel(id);
    const settings = get().settings;
    if (!settings) return;
    const lastModelId = settings.lastModelId === id ? null : settings.lastModelId;
    set({
      settings: {
        ...settings,
        models: settings.models.filter((m) => m.id !== id),
        lastModelId,
      },
    });
  },

  setLastModel: async (id) => {
    const settings = get().settings;
    if (!settings) return;
    const next = { ...settings, lastModelId: id };
    await api.setSettings(next);
    set({ settings: next });
  },
}));
