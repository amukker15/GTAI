import { create } from "zustand";
import type { Alert, Telemetry, Thresholds, Truck } from "../lib/types";
import { getAlerts, getTelemetry, getThresholds, saveThresholds, getTrucks } from "../api/mock";
import type { DriverStatus } from "../lib/status";

type StateReasonPayload = {
  signal: string;
  value: number | string | null;
  threshold: number | string | null;
  relation: string;
};

type StateApiResponse = {
  ts_end: string;
  session_id: string;
  driver_id: string;
  state: string;
  risk_score: number;
  state_confidence: string;
  reasons?: StateReasonPayload[];
};

const SIGNAL_LABELS: Record<string, string> = {
  perclos_30s: "PERCLOS",
  yawn_duty_30s: "Yawning duty",
  yawn_count_30s: "Yawns",
  droop_duty_30s: "Head droop",
  droop_time_30s: "Head droop time",
  pitchdown_max_30s: "Head pitch max",
  pitchdown_avg_30s: "Head pitch avg",
  pitch_thresh_Tp: "Head threshold",
  confidence: "Confidence",
  fps: "FPS",
};

const PERCENT_SIGNALS = new Set(["perclos_30s", "yawn_duty_30s", "droop_duty_30s"]);

const mapServerStateToDriverStatus = (state: string | undefined | null): DriverStatus | undefined => {
  if (!state) return undefined;
  const normalized = state.toLowerCase();
  if (normalized === "lucid") return "OK";
  if (normalized === "drowsy") return "DROWSY_SOON";
  if (normalized === "asleep") return "ASLEEP";
  return undefined;
};

const formatReasonValue = (signal: string, value: number | string | null | undefined) => {
  if (value === null || value === undefined) return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numeric) && PERCENT_SIGNALS.has(signal)) {
    return `${(numeric * 100).toFixed(1)}%`;
  }
  if (Number.isFinite(numeric)) {
    return numeric.toFixed(2);
  }
  return String(value);
};

const formatStateReason = (reasons?: StateReasonPayload[]): string | undefined => {
  if (!reasons?.length) return undefined;
  const primary = reasons[0];
  const label = SIGNAL_LABELS[primary.signal] ?? primary.signal;
  if (primary.relation === "missing") {
    return `${label} data missing`;
  }
  const valueText = formatReasonValue(primary.signal, primary.value);
  const thresholdText = formatReasonValue(primary.signal, primary.threshold);
  return `${label} ${valueText} ${primary.relation} ${thresholdText}`;
};

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
  driver_state?: DriverStatus;
  driver_state_label?: string;
  driver_state_reason?: string;
  driver_state_confidence?: string;
  driver_risk_score?: number;
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
  performVideoAnalysis: (targetTimestamp?: number) => Promise<void>;
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
      const videoLimit = get().videoDuration;

      set({ 
        globalElapsedTime: elapsed,
        secondsSinceLastApiCall: sinceLast
      });

      // Trigger API call every 30 seconds
      if (elapsed > 0 && elapsed % 30 === 0) {
        if (!videoLimit || elapsed <= videoLimit) {
          get().performVideoAnalysis(elapsed);
        }
      }

      if (videoLimit && elapsed >= videoLimit) {
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

  performVideoAnalysis: async (targetTimestamp?: number) => {
    try {
      const state = get();
      const currentTime = typeof targetTimestamp === "number" ? targetTimestamp : state.globalElapsedTime;
      const sessionId = state.currentSessionId;

      // Prevent multiple simultaneous analysis calls
      if (state.isAnalysisRunning) {
        console.log(`[VideoAnalysis] Skipping analysis at ${currentTime}s - analysis already running`);
        return;
      }

      if (currentTime <= 0) {
        return;
      }

      // Set analysis running flag
      set({ isAnalysisRunning: true });

      const videoTimestamp = currentTime;

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

      let driverState: DriverStatus | undefined;
      let driverStateLabel: string | undefined;
      let driverStateReason: string | undefined;
      let driverStateConfidence: string | undefined;
      let driverRiskScore: number | undefined;

      try {
        const statePayload = {
          ts_end: result.ts_end,
          session_id: result.session_id ?? sessionId,
          driver_id: result.driver_id ?? "demo_driver",
          perclos_30s: result.perclos_30s,
          ear_thresh_T: result.ear_thresh_T,
          pitchdown_avg_30s: result.pitchdown_avg_30s,
          pitchdown_max_30s: result.pitchdown_max_30s,
          droop_time_30s: result.droop_time_30s,
          droop_duty_30s: result.droop_duty_30s,
          pitch_thresh_Tp: result.pitch_thresh_Tp,
          yawn_count_30s: result.yawn_count_30s,
          yawn_time_30s: result.yawn_time_30s,
          yawn_duty_30s: result.yawn_duty_30s,
          yawn_peak_30s: result.yawn_peak_30s,
          confidence: result.confidence,
          fps: result.fps,
        };

        const stateResponse = await fetch("http://localhost:8000/v1/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(statePayload),
        });

        if (stateResponse.ok) {
          const stateData: StateApiResponse = await stateResponse.json();
          driverStateLabel = stateData.state;
          driverState = mapServerStateToDriverStatus(stateData.state);
          driverStateReason = formatStateReason(stateData.reasons);
          driverStateConfidence = stateData.state_confidence;
          driverRiskScore = stateData.risk_score;
        } else {
          console.warn("[VideoAnalysis] State endpoint responded with status", stateResponse.status);
        }
      } catch (stateError) {
        console.warn("[VideoAnalysis] Failed to classify driver state:", stateError);
      }

      const enhancedResult: AnalysisResult = {
        ...result,
        driver_state: driverState,
        driver_state_label: driverStateLabel,
        driver_state_reason: driverStateReason,
        driver_state_confidence: driverStateConfidence,
        driver_risk_score: driverRiskScore,
      };

      // Update store with new result
      set((state) => ({
        analysisResults: [...state.analysisResults, enhancedResult],
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
