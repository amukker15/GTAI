import { create } from "zustand";
import type { Alert, Telemetry, Thresholds, Truck } from "../lib/types";
import { DRIVERS, getRouteById } from "../api/referenceData";
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
  perclos_15s: "PERCLOS",
  yawn_duty_15s: "Yawning duty",
  yawn_count_15s: "Yawns",
  droop_duty_15s: "Head droop",
  droop_time_15s: "Head droop time",
  pitchdown_max_15s: "Head pitch max",
  pitchdown_avg_15s: "Head pitch avg",
  pitch_thresh_Tp: "Head threshold",
  confidence: "Confidence",
  fps: "FPS",
};

const PERCENT_SIGNALS = new Set(["perclos_15s", "yawn_duty_15s", "droop_duty_15s"]);

const SAMPLE_INTERVAL_SECONDS = 15;
const MIN_REQUIRED_SAMPLES = 2;
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

type VarKey = "perclos" | "headDownDegrees" | "yawnCount15s" | "heartRate" | "hrvRmssd";

export type AnalysisResult = {
  ts_end: string;
  session_id: string;
  driver_id: string;
  PERCLOS: number;
  perclos_15s: number;
  ear_thresh_T: number;
  pitchdown_avg_15s: number;
  pitchdown_max_15s: number;
  droop_time_15s: number;
  droop_duty_15s: number;
  pitch_thresh_Tp: number;
  yawn_count_15s: number;
  yawn_time_15s: number;
  yawn_duty_15s: number;
  yawn_peak_15s: number;
  confidence: string;
  fps: number;
  driver_state?: DriverStatus;
  driver_state_label?: string;
  driver_state_reason?: string;
  driver_state_confidence?: string;
  driver_risk_score?: number;
  hr_bpm?: number;
  hrv_rmssd_ms?: number;
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
    // Build trucks from static reference data
    const trucks: Truck[] = DRIVERS.map((driver) => {
      const route = getRouteById(driver.routeId);
      return {
        id: driver.truckId,
        driverName: driver.driverName,
        company: driver.company ?? "Lucid Freight",
        route: route ? { from: route.from, to: route.to } : { from: "", to: "" },
        path: [],
      };
    });
    set({ trucks });
  },

  pollTelemetry: () => {
    // No mock telemetry - return empty cleanup function
    return () => {};
  },

  pollAlerts: () => {
    // No mock alerts - return empty cleanup function
    return () => {};
  },

  loadThresholds: async () => {
    // No mock thresholds - set to null
    set({ thresholds: null });
  },

  saveThresholds: async (t) => {
    // Just set the provided thresholds
    set({ thresholds: t });
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
    
    console.log(`[Timer] Video duration: ${videoLimit}s, stop threshold: ${stopThreshold}s`);
    
    // Clear Snowflake data at the start of each new demo session
    const clearData = async () => {
      try {
        const response = await fetch("http://localhost:8000/api/session/reset", {
          method: "POST",
          mode: "cors",
          body: new FormData(),
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log(`[Timer] 🧹 Starting fresh demo - cleared ${result.status_rows_cleared || 0} status records and ${result.drowsiness_rows_cleared || 0} drowsiness records from Snowflake`);
        } else {
          console.warn("[Timer] Failed to clear demo data, but proceeding with demo");
        }
      } catch (error) {
        console.warn("[Timer] Failed to clear demo data:", error);
      }
    };
    
    // Clear data before starting
    clearData();
    
    // Pre-schedule all API calls for deterministic execution
    const scheduledCalls: ScheduledCall[] = [];
    for (let timestamp = SAMPLE_INTERVAL_SECONDS; timestamp <= stopThreshold; timestamp += SAMPLE_INTERVAL_SECONDS) {
      scheduledCalls.push({
        timestamp,
        status: 'pending',
        attempts: 0,
      });
    }
    
    console.log(`[Timer] Scheduled ${scheduledCalls.length} API calls for timestamps:`, scheduledCalls.map(c => `${c.timestamp}s`));

    set({ 
      appStartTime: startTime, 
      isAnalysisRunning: false,
      callTracker: {
        ...get().callTracker,
        scheduledCalls,
      },
      completedCalls: new Set<number>(),
    });


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
        if (allCallsCompleted || elapsed >= stopThreshold + 15) {
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
      
      if (response.ok) {
        const result = await response.json();
        console.log(`[Reset] 🧹 Cleared ${result.status_rows_cleared || 0} status records and ${result.drowsiness_rows_cleared || 0} drowsiness records from Snowflake`);
      } else {
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
    
    // Safety check: don't analyze beyond video duration
    if (state.videoDuration && currentTime > state.videoDuration) {
      console.log(`[VideoAnalysis] Skipping analysis for ${currentTime}s - beyond video duration (${state.videoDuration}s)`);
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
          perclos_15s: result.perclos_15s,
          ear_thresh_T: result.ear_thresh_T,
          pitchdown_avg_15s: result.pitchdown_avg_15s,
          pitchdown_max_15s: result.pitchdown_max_15s,
          droop_time_15s: result.droop_time_15s,
          droop_duty_15s: result.droop_duty_15s,
          pitch_thresh_Tp: result.pitch_thresh_Tp,
          yawn_count_15s: result.yawn_count_15s,
          yawn_time_15s: result.yawn_time_15s,
          yawn_duty_15s: result.yawn_duty_15s,
          yawn_peak_15s: result.yawn_peak_15s,
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

      // Fetch HR and HRV data from simulation API
      let heartRate: number | undefined;
      let heartRateVariability: number | undefined;

      try {
        const vitalsPayload = {
          session_id: sessionId,
          driver_id: "demo_driver",
          state: driverStateLabel || "Lucid",
          seed: null,
          widen_for_low_conf: false,
        };

        const hrResponse = await fetch("http://localhost:8000/v1/sim/hr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(vitalsPayload),
        });

        if (hrResponse.ok) {
          const hrData = await hrResponse.json();
          heartRate = hrData.hr_bpm;
          console.log(`[VideoAnalysis] HR data for ${currentTime}s:`, hrData.hr_bpm, "bpm");
        } else {
          console.warn("[VideoAnalysis] HR endpoint responded with status", hrResponse.status);
        }

        const hrvResponse = await fetch("http://localhost:8000/v1/sim/hrv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(vitalsPayload),
        });

        if (hrvResponse.ok) {
          const hrvData = await hrvResponse.json();
          heartRateVariability = hrvData.hrv_rmssd_ms;
          console.log(`[VideoAnalysis] HRV data for ${currentTime}s:`, hrvData.hrv_rmssd_ms, "ms");
        } else {
          console.warn("[VideoAnalysis] HRV endpoint responded with status", hrvResponse.status);
        }
      } catch (vitalsError) {
        console.warn("[VideoAnalysis] Failed to fetch vitals data:", vitalsError);
      }

      const enhancedResult: AnalysisResult = {
        ...result,
        driver_state: driverState,
        driver_state_label: driverStateLabel,
        driver_state_reason: driverStateReason,
        driver_state_confidence: driverStateConfidence,
        driver_risk_score: driverRiskScore,
        hr_bpm: heartRate,
        hrv_rmssd_ms: heartRateVariability,
      };

      // Save driver status to Snowflake if we have a computed state
      if (driverState) {
        try {
          const statusFormData = new FormData();
          statusFormData.append('status', driverState);
          statusFormData.append('driver_id', result.driver_id ?? "demo_driver");
          statusFormData.append('session_id', result.session_id ?? sessionId);
          
          const statusResponse = await fetch("http://localhost:8000/api/status", {
            method: "POST",
            mode: "cors",
            body: statusFormData,
          });
          
          if (statusResponse.ok) {
            const statusResult = await statusResponse.json();
            console.log(`[VideoAnalysis] Status ${driverState} saved to Snowflake at ${statusResult.timestamp}`);
          } else {
            console.warn(`[VideoAnalysis] Failed to save status to Snowflake: ${statusResponse.statusText}`);
          }
        } catch (statusError) {
          console.warn('[VideoAnalysis] Failed to save driver status to Snowflake:', statusError);
        }
      }

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
