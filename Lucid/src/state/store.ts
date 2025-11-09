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

const SAMPLE_INTERVAL_SECONDS = 30;
const MIN_REQUIRED_SAMPLES = 3;
const MIN_ANALYSIS_DURATION = SAMPLE_INTERVAL_SECONDS * MIN_REQUIRED_SAMPLES;

const getStopThreshold = (videoDuration: number | null): number => {
  if (typeof videoDuration !== "number" || Number.isNaN(videoDuration)) {
    return MIN_ANALYSIS_DURATION;
  }
  return Math.max(videoDuration, MIN_ANALYSIS_DURATION);
};

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

type CachedAnalysisResult = AnalysisResult & {
  cached_at: number;
  from_cache: boolean;
};

type ScheduledCall = {
  timestamp: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  lastAttempt?: number;
};

type CallTracker = {
  scheduledCalls: ScheduledCall[];
  maxRetries: number;
  retryDelay: number;
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
  analysisCache: Record<string, CachedAnalysisResult>;
  callTracker: CallTracker;
  completedCalls: Set<number>;
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
  getCachedResult: (timestamp: number) => CachedAnalysisResult | null;
  getAnalysisProgress: () => { completed: number; total: number; pending: ScheduledCall[] };
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
  analysisCache: {},
  callTracker: {
    scheduledCalls: [],
    maxRetries: 3,
    retryDelay: 5000,
  },
  completedCalls: new Set<number>(),

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
    const videoLimit = get().videoDuration;
    const stopThreshold = getStopThreshold(videoLimit);
    
    // Pre-schedule all API calls for deterministic execution
    const scheduledCalls: ScheduledCall[] = [];
    for (let timestamp = SAMPLE_INTERVAL_SECONDS; timestamp <= stopThreshold; timestamp += SAMPLE_INTERVAL_SECONDS) {
      scheduledCalls.push({
        timestamp,
        status: 'pending',
        attempts: 0,
      });
    }

    set({ 
      appStartTime: startTime, 
      isAnalysisRunning: false,
      callTracker: {
        ...get().callTracker,
        scheduledCalls,
      },
      completedCalls: new Set<number>(),
    });

    console.log(`[Timer] Scheduled ${scheduledCalls.length} API calls:`, scheduledCalls.map(c => c.timestamp));

    // Update elapsed time every second and manage API calls
    globalTimerInterval = window.setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - get().appStartTime) / 1000);
      const sinceLast = get().lastApiCallTime > 0 ? Math.floor((now - get().lastApiCallTime) / 1000) : elapsed;

      set({ 
        globalElapsedTime: elapsed,
        secondsSinceLastApiCall: sinceLast
      });

      // Check for pending API calls that should be executed
      const state = get();
      const pendingCalls = state.callTracker.scheduledCalls.filter(
        call => call.timestamp <= elapsed && call.status === 'pending'
      );

      // Execute pending calls
      pendingCalls.forEach(call => {
        console.log(`[Timer] Executing scheduled call for ${call.timestamp}s`);
        get().performVideoAnalysis(call.timestamp);
      });

      // Check for failed calls that need retry
      const failedCalls = state.callTracker.scheduledCalls.filter(
        call => call.status === 'failed' && 
        call.attempts < state.callTracker.maxRetries &&
        (!call.lastAttempt || (now - call.lastAttempt) > state.callTracker.retryDelay)
      );

      // Retry failed calls
      failedCalls.forEach(call => {
        console.log(`[Timer] Retrying failed call for ${call.timestamp}s (attempt ${call.attempts + 1})`);
        get().performVideoAnalysis(call.timestamp);
      });

      // Stop timer when all calls are completed or max time reached
      if (elapsed >= stopThreshold) {
        const allCallsCompleted = state.callTracker.scheduledCalls.every(
          call => call.status === 'completed'
        );
        if (allCallsCompleted || elapsed >= stopThreshold + 30) {
          console.log(`[Timer] Stopping - elapsed: ${elapsed}s, completed: ${allCallsCompleted}`);
          get().stopGlobalTimer();
        }
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
    
    // Reset all timing data and clear cache
    const newStartTime = Date.now();
    const newSessionId = `session_${newStartTime}`;
    
    set({
      appStartTime: newStartTime,
      globalElapsedTime: 0,
      lastApiCallTime: 0,
      secondsSinceLastApiCall: 0,
      analysisResults: [],
      currentSessionId: newSessionId,
      isAnalysisRunning: false,
      analysisCache: {},
      callTracker: {
        scheduledCalls: [],
        maxRetries: 3,
        retryDelay: 5000,
      },
      completedCalls: new Set<number>(),
    });
    
    console.log("[Reset] Cleared all analysis cache and reset session");
    
    // Start new timer
    get().startGlobalTimer();
  },

  updateElapsedTime: (elapsed: number) => {
    set({ globalElapsedTime: elapsed });
  },

  performVideoAnalysis: async (targetTimestamp?: number) => {
    const state = get();
    const currentTime = typeof targetTimestamp === "number" ? targetTimestamp : state.globalElapsedTime;
    const sessionId = state.currentSessionId;
    const cacheKey = `${sessionId}_${currentTime}`;

    if (currentTime <= 0) {
      return;
    }

    // Check cache first - return cached result immediately
    const cachedResult = state.analysisCache[cacheKey];
    if (cachedResult) {
      console.log(`[VideoAnalysis] Returning cached result for ${currentTime}s`);
      return;
    }

    // Check if this call is already completed
    if (state.completedCalls.has(currentTime)) {
      console.log(`[VideoAnalysis] Call for ${currentTime}s already completed`);
      return;
    }

    // Update call tracker to mark as processing
    const updatedCalls = state.callTracker.scheduledCalls.map(call => 
      call.timestamp === currentTime 
        ? { ...call, status: 'processing' as const, attempts: call.attempts + 1, lastAttempt: Date.now() }
        : call
    );

    set((state) => ({
      callTracker: { ...state.callTracker, scheduledCalls: updatedCalls }
    }));

    try {
      console.log(`[VideoAnalysis] Performing analysis at ${currentTime}s (attempt ${updatedCalls.find(c => c.timestamp === currentTime)?.attempts || 1})`);
      
      // Create form data for analysis (no need to upload video - backend will use footage directory)
      const formData = new FormData();
      formData.append("timestamp", currentTime.toString());
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
      console.log(`[VideoAnalysis] Analysis complete for ${currentTime}s:`, result);

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

      // Create cached result
      const cachedResult: CachedAnalysisResult = {
        ...enhancedResult,
        cached_at: Date.now(),
        from_cache: false,
      };

      // Update store with new result, cache it, and mark call as completed
      set((state) => {
        const updatedCompletedCalls = new Set(state.completedCalls);
        updatedCompletedCalls.add(currentTime);

        const updatedCallTracker = state.callTracker.scheduledCalls.map(call => 
          call.timestamp === currentTime 
            ? { ...call, status: 'completed' as const }
            : call
        );

        return {
          analysisResults: [...state.analysisResults, enhancedResult],
          lastApiCallTime: Date.now(),
          secondsSinceLastApiCall: 0,
          analysisCache: {
            ...state.analysisCache,
            [cacheKey]: cachedResult,
          },
          completedCalls: updatedCompletedCalls,
          callTracker: {
            ...state.callTracker,
            scheduledCalls: updatedCallTracker,
          },
        };
      });
      
    } catch (error) {
      console.error(`[VideoAnalysis] Analysis failed for ${currentTime}s:`, error);
      
      // Mark call as failed in tracker
      const failedCalls = state.callTracker.scheduledCalls.map(call => 
        call.timestamp === currentTime 
          ? { ...call, status: 'failed' as const }
          : call
      );

      set((state) => ({
        callTracker: { ...state.callTracker, scheduledCalls: failedCalls }
      }));
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

  getCachedResult: (timestamp: number) => {
    const state = get();
    const cacheKey = `${state.currentSessionId}_${timestamp}`;
    const cached = state.analysisCache[cacheKey];
    if (cached) {
      return {
        ...cached,
        from_cache: true,
      };
    }
    return null;
  },

  getAnalysisProgress: () => {
    const state = get();
    const completed = state.callTracker.scheduledCalls.filter(call => call.status === 'completed').length;
    const total = state.callTracker.scheduledCalls.length;
    const pending = state.callTracker.scheduledCalls.filter(call => 
      call.status === 'pending' || call.status === 'processing' || call.status === 'failed'
    );
    
    return { completed, total, pending };
  },
}));
