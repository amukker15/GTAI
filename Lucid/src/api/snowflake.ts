import { apiRequest } from "./client";
import type { ApiRequestOptions } from "./client";

export type RouteAnalyticsRequest = {
  start?: string;
  end?: string;
  routeIds?: string[];
  includeNarrative?: boolean;
  limit?: number;
};

export type RouteAnalyticsRow = {
  routeId: string;
  windowCount: number;
  avgRisk: number;
  drowsyRate: number;
  asleepRate: number;
  avgPerclos: number;
  avgYawnDuty: number;
  avgDroopDuty: number;
  avgYawnCount?: number;
  avgPitchMax?: number;
  avgPitchAvg?: number;
  peakRisk?: number;
  riskiestTs?: string;
  riskiestRisk?: number;
  routeLengthKm?: number;
  visibilityAvgKm?: number;
  elevationChangeM?: number;
  intersectionCount?: number;
  nighttimeProportion?: number;
  restStopsPer100km?: number;
  cortexSummary?: string | null;
};

export type RouteAnalyticsResponse = {
  generatedAt: string;
  routes: RouteAnalyticsRow[];
};

const EMPTY_ROUTE_RESPONSE: RouteAnalyticsResponse = {
  generatedAt: new Date(0).toISOString(),
  routes: [],
};

export async function fetchRouteAnalytics(params: RouteAnalyticsRequest): Promise<RouteAnalyticsResponse> {
  const body: Record<string, unknown> = {};
  if (params.start) body.start = params.start;
  if (params.end) body.end = params.end;
  if (params.routeIds?.length) body.route_ids = params.routeIds;
  if (typeof params.includeNarrative === "boolean") body.include_narrative = params.includeNarrative;
  if (params.limit) body.limit = params.limit;

  const options: ApiRequestOptions = {
    method: "POST",
    body,
  };

  try {
    const raw = await apiRequest<{ generated_at?: string; generatedAt?: string; routes?: any[] }>("/analytics/routes", options);
    return {
      generatedAt: raw.generated_at ?? raw.generatedAt ?? new Date().toISOString(),
      routes: (raw.routes ?? []).map(normalizeRouteRow),
    };
  } catch (err) {
    console.warn("[Snowflake API] falling back for route analytics:", err);
    return EMPTY_ROUTE_RESPONSE;
  }
}

function normalizeRouteRow(row: any): RouteAnalyticsRow {
  return {
    routeId: row.route_id ?? row.routeId ?? "UNKNOWN",
    windowCount: Number(row.window_count ?? row.windowCount ?? 0),
    avgRisk: Number(row.avg_risk ?? row.avgRisk ?? 0),
    drowsyRate: Number(row.drowsy_rate ?? row.drowsyRate ?? 0),
    asleepRate: Number(row.asleep_rate ?? row.asleepRate ?? 0),
    avgPerclos: Number(row.avg_perclos ?? row.avgPerclos ?? 0),
    avgYawnDuty: Number(row.avg_yawn_duty ?? row.avgYawnDuty ?? 0),
    avgDroopDuty: Number(row.avg_droop_duty ?? row.avgDroopDuty ?? 0),
    avgYawnCount: toOptionalNumber(row.avg_yawn_count ?? row.avgYawnCount),
    avgPitchMax: toOptionalNumber(row.avg_pitch_max ?? row.avgPitchMax),
    avgPitchAvg: toOptionalNumber(row.avg_pitch_avg ?? row.avgPitchAvg),
    peakRisk: toOptionalNumber(row.peak_risk ?? row.peakRisk),
    riskiestTs: row.riskiest_ts ?? row.riskiestTs ?? null,
    riskiestRisk: toOptionalNumber(row.riskiest_risk ?? row.riskiestRisk),
    routeLengthKm: toOptionalNumber(row.route_length_km ?? row.routeLengthKm),
    visibilityAvgKm: toOptionalNumber(row.visibility_avg_km ?? row.visibilityAvgKm),
    elevationChangeM: toOptionalNumber(row.elevation_change_m ?? row.elevationChangeM),
    intersectionCount: toOptionalNumber(row.intersection_count ?? row.intersectionCount),
    nighttimeProportion: toOptionalNumber(row.nighttime_proportion ?? row.nighttimeProportion),
    restStopsPer100km: toOptionalNumber(row.rest_stops_per_100km ?? row.restStopsPer100km),
    cortexSummary: row.cortex_summary ?? row.cortexSummary ?? null,
  };
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
}
