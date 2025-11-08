// src/api/snowflake.ts
// Mocked Snowflake analytics for long-term trends

import type { Thresholds } from "../lib/types";

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
  r: number; // -1..+1
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

// Deterministic-ish mock using a simple hash of truckId
function seedFromStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
function rnd(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(1664525, x) + 1013904223) >>> 0;
    return (x >>> 8) / 0xffffff;
  };
}

// Returns 8–14 mock trips + correlations + avg risk curve
export async function fetchLongTermMetrics(
  truckId: string,
  fromIso: string,
  toIso: string
): Promise<LongTermMetrics> {
  const th: Thresholds = {
    perclosHigh: 0.4,
    headDownDegHigh: 25,
    yawnCountHigh: 3,
    hrLow: 50,
    hrvLow: 20,
    predictionWindowSec: [30, 120],
  };

  const r = rnd(seedFromStr(`${truckId}-${fromIso}-${toIso}`));
  const tripCount = 8 + Math.floor(r() * 7);

  const trips: TripPoint[] = Array.from({ length: tripCount }).map((_, i) => {
    const baseHr = 2 + r() * 3; // hours until HR low-ish
    const baseHrv = 2 + r() * 3;
    const perclos = 1 + r() * 5;
    const headDown = 1 + r() * 6;
    const yawns = 0.8 + r() * 3.5;

    return {
      tripId: `T-${i + 1}`,
      startIso: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
      hoursToThreshold: {
        perclos: Number(perclos.toFixed(2)),
        headDownDegrees: Number(headDown.toFixed(2)),
        yawnCount30s: Number(yawns.toFixed(2)),
        heartRate: Number(baseHr.toFixed(2)),
        hrvRmssd: Number(baseHrv.toFixed(2)),
      },
    };
  });

  const vars: VarKey[] = [
    "perclos",
    "headDownDegrees",
    "yawnCount30s",
    "heartRate",
    "hrvRmssd",
  ];
  const correlations: CorrelationCell[] = [];
  for (let i = 0; i < vars.length; i++) {
    for (let j = 0; j < vars.length; j++) {
      const same = i === j;
      const sign = r() > 0.5 ? 1 : -1;
      const mag = same ? 1 : 0.2 + r() * 0.7; // diag = 1.0
      correlations.push({ a: vars[i], b: vars[j], r: same ? 1 : sign * mag });
    }
  }

  const hours = 12;
  const avgRiskByHour: RiskPoint[] = Array.from({ length: hours + 1 }).map(
    (_, h) => {
      // gentle U-shape or rising curve
      const val = Math.max(0, Math.min(1, 0.15 + (h / hours) * 0.7 + (r() - 0.5) * 0.1));
      return { hour: h, risk: Number(val.toFixed(3)) };
    }
  );

  return { trips, correlations, avgRiskByHour, thresholds: th };
}
