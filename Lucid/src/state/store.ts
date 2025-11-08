import { create } from "zustand";
import type { Alert, Telemetry, Thresholds, Truck } from "../lib/types";
import { getAlerts, getTelemetry, getThresholds, saveThresholds, getTrucks } from "../api/mock";

type VarKey = "perclos" | "headDownDegrees" | "yawnCount30s" | "heartRate" | "hrvRmssd";

type Store = {
  trucks: Truck[];
  telemetryByTruckId: Record<string, Telemetry[]>;
  alerts: Alert[];
  thresholds: Thresholds | null;
  selectedVar: VarKey;
  fetchTrucks: () => Promise<void>;
  pollTelemetry: () => () => void;
  pollAlerts: () => () => void;
  loadThresholds: () => Promise<void>;
  saveThresholds: (t: Thresholds) => Promise<void>;
  setSelectedVar: (v: VarKey) => void;
};

export const useStore = create<Store>((set) => ({
  trucks: [],
  telemetryByTruckId: {},
  alerts: [],
  thresholds: null,
  selectedVar: "perclos",

  fetchTrucks: async () => {
    const t = await getTrucks();
    set({ trucks: t });
  },

  pollTelemetry: () => {
    let cancelled = false;
    const pull = async () => {
      const all = await getTelemetry();
      const map: Record<string, Telemetry[]> = {};
      all.forEach((it) => {
        (map[it.truckId] ||= []).push(it);
      });
      if (!cancelled) set({ telemetryByTruckId: map });
    };
    pull();
    const id = setInterval(pull, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  },

  pollAlerts: () => {
    let cancelled = false;
    const pull = async () => {
      const a = await getAlerts();
      if (!cancelled) set({ alerts: a });
    };
    pull();
    const id = setInterval(pull, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  },

  loadThresholds: async () => {
    const th = await getThresholds();
    set({ thresholds: th });
  },

  saveThresholds: async (t) => {
    const saved = await saveThresholds(t);
    set({ thresholds: saved });
  },

  setSelectedVar: (v) => set({ selectedVar: v }),
}));
