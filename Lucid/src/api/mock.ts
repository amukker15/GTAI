import type { Alert, Telemetry, Thresholds, Truck } from "../lib/types";
import { apiRequest, type ApiRequestOptions } from "./client";
import { DRIVERS, getRouteById } from "./referenceData";

const DEFAULT_THRESHOLDS: Thresholds = {
  perclosHigh: 0.4,
  headDownDegHigh: 25,
  yawnCountHigh: 3,
  hrLow: 50,
  hrvLow: 20,
  predictionWindowSec: [30, 120],
};

const cloneThresholds = (th: Thresholds): Thresholds => ({
  ...th,
  predictionWindowSec: [...th.predictionWindowSec] as Thresholds["predictionWindowSec"],
});

function buildFallbackTrucks(): Truck[] {
  if (!DRIVERS.length) return [];
  return DRIVERS.map((driver) => {
    const route = getRouteById(driver.routeId);
    return {
      id: driver.truckId,
      driverName: driver.driverName,
      company: driver.company ?? "Lucid Freight",
      route: route ? { from: route.from, to: route.to } : { from: "", to: "" },
      path: [],
    } satisfies Truck;
  });
}

async function requestOrFallback<T>(
  path: string,
  options: ApiRequestOptions | undefined,
  fallback: () => T
): Promise<T> {
  try {
    return await apiRequest<T>(path, options);
  } catch (err) {
    console.warn(`[Snowflake API] falling back for ${path}:`, err);
    return fallback();
  }
}

export async function getTrucks(): Promise<Truck[]> {
  return requestOrFallback<Truck[]>("/trucks", undefined, buildFallbackTrucks);
}

export async function getTelemetry(truckId?: string): Promise<Telemetry[]> {
  return requestOrFallback<Telemetry[]>(
    "/telemetry",
    truckId ? { searchParams: { truckId } } : undefined,
    () => []
  );
}

export async function getAlerts(truckId?: string): Promise<Alert[]> {
  return requestOrFallback<Alert[]>(
    "/alerts",
    truckId ? { searchParams: { truckId } } : undefined,
    () => []
  );
}

export async function getThresholds(): Promise<Thresholds> {
  return requestOrFallback<Thresholds>("/thresholds", undefined, () => cloneThresholds(DEFAULT_THRESHOLDS));
}

export async function saveThresholds(payload: Thresholds): Promise<Thresholds> {
  return requestOrFallback<Thresholds>("/thresholds", { method: "PUT", body: payload }, () => cloneThresholds(payload));
}

export { DRIVERS, ROUTES } from "./referenceData";
