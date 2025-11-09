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

export type SessionResetResponse = {
  success: boolean;
  rows_cleared: number;
};

export type MeasurementsResponse = {
  measurements: Array<{
    driver_id: string;
    session_id: string;
    ts: string;
    perclos: number;
    perclos_percent: number;
    ear_threshold: number;
    pitchdown_avg: number;
    pitchdown_max: number;
    droop_time: number;
    droop_duty: number;
    pitch_threshold: number;
    yawn_count: number;
    yawn_time: number;
    yawn_duty: number;
    yawn_peak: number;
    confidence: string;
    fps: number;
  }>;
};

class VideoAnalysisService {
  private sessionId: string = `session_${Date.now()}`;
  private driverId: string = "demo_driver";
  private intervalId: number | null = null;
  private currentTimestamp: number = 0;
  private isRunning: boolean = false;
  private onAnalysisCallback?: (result: AnalysisResult) => void;

  constructor() {
    this.sessionId = `session_${Date.now()}`;
  }

  setAnalysisCallback(callback: (result: AnalysisResult) => void) {
    this.onAnalysisCallback = callback;
  }

  async startAnalysis(driverId?: string): Promise<void> {
    if (this.isRunning) {
      console.log("Analysis already running");
      return;
    }

    this.driverId = driverId || "demo_driver";
    this.isRunning = true;
    this.currentTimestamp = 30; // Start at 30 seconds

    console.log(`[VideoAnalysis] Starting analysis for driver ${this.driverId}, session ${this.sessionId}`);

    // Run first analysis immediately
    await this.performAnalysis();

    // Set up 30-second interval
    this.intervalId = window.setInterval(async () => {
      if (this.isRunning) {
        await this.performAnalysis();
      }
    }, 30000);
  }

  async stopAnalysis(): Promise<void> {
    console.log("[VideoAnalysis] Stopping analysis");
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async resetSession(): Promise<void> {
    console.log("[VideoAnalysis] Resetting session");
    await this.stopAnalysis();
    
    try {
      // Clear Snowflake data
      const formData = new FormData();
      formData.append("session_id", this.sessionId);
      
      const response = await fetch("http://localhost:8000/api/session/reset", {
        method: "POST",
        mode: "cors",
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error(`Reset failed: ${response.statusText}`);
      }
      
      const result: SessionResetResponse = await response.json();
      console.log(`[VideoAnalysis] Reset complete, cleared ${result.rows_cleared} rows`);
      
      // Generate new session ID and reset timestamp
      this.sessionId = `session_${Date.now()}`;
      this.currentTimestamp = 0;
      
    } catch (error) {
      console.error("[VideoAnalysis] Reset failed:", error);
      throw error;
    }
  }

  private async performAnalysis(): Promise<void> {
    try {
      console.log(`[VideoAnalysis] Analyzing at timestamp ${this.currentTimestamp}s`);
      
      // Fetch the demo video
      const videoResponse = await fetch("http://localhost:8000/api/footage/video", {
        method: "GET",
        mode: "cors",
      });
      if (!videoResponse.ok) {
        throw new Error("Failed to fetch demo video");
      }
      
      const videoBlob = await videoResponse.blob();
      
      // Create form data for analysis
      const formData = new FormData();
      formData.append("video", videoBlob, "demo_video.mp4");
      formData.append("timestamp", this.currentTimestamp.toString());
      formData.append("session_id", this.sessionId);
      formData.append("driver_id", this.driverId);
      
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
      console.log(`[VideoAnalysis] Analysis complete for ${this.currentTimestamp}s:`, result);
      
      // Trigger callback with result
      if (this.onAnalysisCallback) {
        this.onAnalysisCallback(result);
      }
      
      // Increment timestamp for next analysis
      this.currentTimestamp += 30;
      
    } catch (error) {
      console.error(`[VideoAnalysis] Analysis failed at ${this.currentTimestamp}s:`, error);
    }
  }

  async getRecentMeasurements(): Promise<MeasurementsResponse> {
    try {
      const response = await fetch(
        `http://localhost:8000/api/measurements?session_id=${this.sessionId}&limit=50`,
        {
          method: "GET",
          mode: "cors",
        }
      );
      
      if (!response.ok) {
        throw new Error("Failed to fetch measurements");
      }
      
      return await response.json();
    } catch (error) {
      console.error("[VideoAnalysis] Failed to fetch measurements:", error);
      return { measurements: [] };
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getDriverId(): string {
    return this.driverId;
  }

  getCurrentTimestamp(): number {
    return this.currentTimestamp;
  }

  isAnalysisRunning(): boolean {
    return this.isRunning;
  }
}

// Export singleton instance
export const videoAnalysisService = new VideoAnalysisService();
