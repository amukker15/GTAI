import type { Thresholds } from "../lib/types";
import { apiRequest } from "./client";
import type { ApiRequestOptions } from "./client";

export type TripPoint = {
  tripId: string;
  startIso: string;
  hoursToThreshold: {
    perclos: number;
    headDownDegrees: number;
    yawnCount30s: number;
    heartRate: number;
    hrvRmssd: number;
  };
};

export type CorrelationCell = {
  a: VarKey;
  b: VarKey;
  r: number;
};

export type RiskPoint = { hour: number; risk: number };

export type VarKey =
  | "perclos"
  | "headDownDegrees"
  | "yawnCount30s"
  | "heartRate"
  | "hrvRmssd";

export type LongTermMetrics = {
  trips: TripPoint[];
  correlations: CorrelationCell[];
  avgRiskByHour: RiskPoint[];
  thresholds: Thresholds;
};

const DEFAULT_THRESHOLDS: Thresholds = {
  perclosHigh: 0.4,
  headDownDegHigh: 25,
  yawnCountHigh: 3,
  hrLow: 50,
  hrvLow: 20,
  predictionWindowSec: [30, 120],
};

const EMPTY_LONG_TERM: LongTermMetrics = {
  trips: [],
  correlations: [],
  avgRiskByHour: [],
  thresholds: DEFAULT_THRESHOLDS,
};

export async function fetchLongTermMetrics(
  truckId: string,
  fromIso: string,
  toIso: string
): Promise<LongTermMetrics> {
  const options: ApiRequestOptions = {
    method: "POST",
    body: { truckId, from: fromIso, to: toIso },
  };

  try {
    return await apiRequest<LongTermMetrics>("/analytics/long-term", options);
  } catch (err) {
    console.warn("[Snowflake API] falling back for long-term analytics:", err);
    return EMPTY_LONG_TERM;
  }
}
