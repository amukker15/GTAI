import { create } from "zustand";
import type { Alert, Telemetry, Thresholds, Truck } from "../lib/types";
import { getAlerts, getTelemetry, getThresholds, saveThresholds, getTrucks } from "../api/mock";

type VarKey = "perclos" | "headDownDegrees" | "yawnCount30s" | "heartRate" | "hrvRmssd";

export type AnalysisResult = {
  ts_end: string;
  session_id: string;
  driver_id: string;
  PERCLOS: number;
  perclos_30s: number;
  ear_thresh_T: number;
  pitchdown_avg_30s: number;
  pitchdown_max_30s: number;
  droop_time_30s: number;
  droop_duty_30s: number;
  pitch_thresh_Tp: number;
  yawn_count_30s: number;
  yawn_time_30s: number;
  yawn_duty_30s: number;
  yawn_peak_30s: number;
  confidence: string;
  fps: number;
};

type Store = {
  trucks: Truck[];
  telemetryByTruckId: Record<string, Telemetry[]>;
  alerts: Alert[];
  thresholds: Thresholds | null;
  selectedVar: VarKey;
  appStartTime: number;
  globalElapsedTime: number;
  lastApiCallTime: number;
  secondsSinceLastApiCall: number;
  analysisResults: AnalysisResult[];
  currentSessionId: string;
  isAnalysisRunning: boolean;
  videoDuration: number | null;
  fetchTrucks: () => Promise<void>;
  pollTelemetry: () => () => void;
  pollAlerts: () => () => void;
  loadThresholds: () => Promise<void>;
  saveThresholds: (t: Thresholds) => Promise<void>;
  setSelectedVar: (v: VarKey) => void;
  startGlobalTimer: () => void;
  stopGlobalTimer: () => void;
  resetGlobalTimer: () => Promise<void>;
  performVideoAnalysis: () => Promise<void>;
  updateElapsedTime: (elapsed: number) => void;
  fetchVideoInfo: () => Promise<void>;
};

let globalTimerInterval: number | null = null;

export const useStore = create<Store>((set, get) => ({
  trucks: [],
  telemetryByTruckId: {},
  alerts: [],
  thresholds: null,
  selectedVar: "perclos",
  appStartTime: Date.now(),
  globalElapsedTime: 0,
  lastApiCallTime: 0,
  secondsSinceLastApiCall: 0,
  analysisResults: [],
  currentSessionId: `session_${Date.now()}`,
  isAnalysisRunning: false,
  videoDuration: null,

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

  startGlobalTimer: () => {
    // Ensure we never create overlapping timers
    if (globalTimerInterval) {
      clearInterval(globalTimerInterval);
      globalTimerInterval = null;
    }

    const startTime = Date.now();
    set({ appStartTime: startTime, isAnalysisRunning: false });

    // Update elapsed time every second
    globalTimerInterval = window.setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - get().appStartTime) / 1000);
      const sinceLast = get().lastApiCallTime > 0 ? Math.floor((now - get().lastApiCallTime) / 1000) : elapsed;
      const videoLimit = get().videoDuration || 64;
      const clampedElapsed = Math.min(elapsed, videoLimit);

      set({ 
        globalElapsedTime: clampedElapsed,
        secondsSinceLastApiCall: sinceLast
      });

      // Trigger API call every 30 seconds
      if (clampedElapsed > 0 && clampedElapsed % 30 === 0 && clampedElapsed <= videoLimit) {
        get().performVideoAnalysis();
      }

      if (clampedElapsed >= videoLimit) {
        get().stopGlobalTimer();
      }
    }, 1000);
  },

  stopGlobalTimer: () => {
    if (globalTimerInterval) {
      clearInterval(globalTimerInterval);
      globalTimerInterval = null;
    }
    set({ isAnalysisRunning: false });
  },

  resetGlobalTimer: async () => {
    // Stop current timer
    get().stopGlobalTimer();
    
    // Clear Snowflake data
    try {
      const formData = new FormData();
      formData.append("session_id", get().currentSessionId);
      
      const response = await fetch("http://localhost:8000/api/session/reset", {
        method: "POST",
        mode: "cors",
        body: formData,
      });
      
      if (!response.ok) {
        console.warn("Failed to reset Snowflake session");
      }
    } catch (error) {
      console.warn("Error resetting Snowflake session:", error);
    }
    
    // Reset all timing data
    const newStartTime = Date.now();
    const newSessionId = `session_${newStartTime}`;
    
    set({
      appStartTime: newStartTime,
      globalElapsedTime: 0,
      lastApiCallTime: 0,
      secondsSinceLastApiCall: 0,
      analysisResults: [],
      currentSessionId: newSessionId,
      isAnalysisRunning: false
    });
    
    // Start new timer
    get().startGlobalTimer();
  },

  updateElapsedTime: (elapsed: number) => {
    set({ globalElapsedTime: elapsed });
  },

  performVideoAnalysis: async () => {
    try {
      const state = get();
      const currentTime = state.globalElapsedTime;
      const sessionId = state.currentSessionId;
      const videoDuration = state.videoDuration || 64;

      // Prevent multiple simultaneous analysis calls
      if (state.isAnalysisRunning) {
        console.log(`[VideoAnalysis] Skipping analysis at ${currentTime}s - analysis already running`);
        return;
      }

      if (currentTime === 0 || currentTime > videoDuration) {
        return;
      }

      // Set analysis running flag
      set({ isAnalysisRunning: true });

      // Clamp timestamp to video duration and avoid wrapping
      const videoTimestamp = Math.min(currentTime, Math.max(videoDuration - 0.01, 0));

      console.log(`[VideoAnalysis] Performing analysis at ${currentTime}s (video time: ${videoTimestamp}s)`);
      
      // Create form data for analysis (no need to upload video - backend will use footage directory)
      const formData = new FormData();
      formData.append("timestamp", videoTimestamp.toString());
      formData.append("session_id", sessionId);
      formData.append("driver_id", "demo_driver");
      
      // Submit for analysis
      const analysisResponse = await fetch("http://localhost:8000/api/window", {
        method: "POST",
        mode: "cors",
        body: formData,
      });
      
      if (!analysisResponse.ok) {
        const errorText = await analysisResponse.text();
        throw new Error(`Analysis failed: ${analysisResponse.statusText} - ${errorText}`);
      }
      
      const result: AnalysisResult = await analysisResponse.json();
      console.log(`[VideoAnalysis] Analysis complete for ${currentTime}s (video: ${videoTimestamp}s):`, result);
      
      // Update store with new result
      set((state) => ({
        analysisResults: [...state.analysisResults, result],
        lastApiCallTime: Date.now(),
        secondsSinceLastApiCall: 0,
        isAnalysisRunning: false
      }));
      
    } catch (error) {
      console.error(`[VideoAnalysis] Analysis failed:`, error);
      // Make sure to clear the running flag even on error
      set({ isAnalysisRunning: false });
    }
  },

  fetchVideoInfo: async () => {
    try {
      const response = await fetch("http://localhost:8000/api/footage/info", {
        method: "GET",
        mode: "cors",
      });
      
      if (response.ok) {
        const videoInfo = await response.json();
        console.log(`[VideoInfo] Detected video: ${videoInfo.filename} (${videoInfo.duration}s, ${videoInfo.format})`);
        set({ videoDuration: videoInfo.duration });
      } else {
        console.warn("[VideoInfo] Failed to fetch video info, using default duration");
      }
    } catch (error) {
      console.warn("[VideoInfo] Failed to fetch video info:", error);
    }
  },
}));
