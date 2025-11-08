// src/lib/status.ts
import type { Telemetry, Thresholds } from "./types";

export type DriverStatus = "OK" | "DROWSY_SOON" | "ASLEEP";

export function computeStatus(
  latest: Telemetry | undefined,
  history: Telemetry[],
  th: Thresholds
): DriverStatus {
  if (!latest) return "OK";
  const overPerclos = latest.perclos >= th.perclosHigh;
  const headDown = latest.headDownDegrees >= th.headDownDegHigh;
  const yawny = latest.yawnCount30s >= th.yawnCountHigh;
  const lowHR = latest.heartRate > 0 && latest.heartRate <= th.hrLow;
  const lowHRV = latest.hrvRmssd > 0 && latest.hrvRmssd <= th.hrvLow;

  const riskScore =
    (overPerclos ? 2 : 0) +
    (headDown ? 1 : 0) +
    (yawny ? 1 : 0) +
    (lowHR ? 1 : 0) +
    (lowHRV ? 1 : 0);

  // basic “worsening” check over the last 3 samples (~60–90s)
  const recent = history.slice(-3);
  const worsening =
    recent.length >= 3 &&
    recent[2].perclos > recent[1].perclos &&
    recent[1].perclos > recent[0].perclos;

  if (riskScore >= 3 && overPerclos) return "ASLEEP";
  if (riskScore >= 2 && (overPerclos || worsening)) return "DROWSY_SOON";
  return "OK";
}

export function statusToColor(s: DriverStatus): string {
  if (s === "ASLEEP") return "#ef4444";      // red-500
  if (s === "DROWSY_SOON") return "#f59e0b"; // amber-500
  return "#10b981";                           // emerald-500
}
