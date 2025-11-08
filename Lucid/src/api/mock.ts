import type { Alert, Telemetry, Thresholds, Truck } from "../lib/types";

let thresholds: Thresholds = {
  perclosHigh: 0.4,
  headDownDegHigh: 25,
  yawnCountHigh: 3,
  hrLow: 50,
  hrvLow: 20,
  predictionWindowSec: [30, 120],
};

const trucks: Truck[] = [
  {
    id: "TX-101",
    driverName: "R. Diaz",
    company: "Acme Logistics",
    route: { from: "Dallas, TX", to: "Atlanta, GA" },
    path: [],
  },
  {
    id: "IL-202",
    driverName: "K. Ahmed",
    company: "Acme Logistics",
    route: { from: "Chicago, IL", to: "Miami, FL" },
    path: [],
  },
];

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

const telemetryByTruck: Record<string, Telemetry[]> = {};
const alerts: Alert[] = [];

function seed() {
  const now = Date.now();
  const bases = [
    { id: "TX-101", lat: 32.7767, lng: -96.7970 },
    { id: "IL-202", lat: 41.8781, lng: -87.6298 },
  ];

  bases.forEach((b) => {
    const arr: Telemetry[] = [];
    for (let i = 30; i >= 0; i--) {
      const t = new Date(now - i * 30000).toISOString();
      const perclos = Math.max(0, Math.min(1, 0.25 + rand(-0.05, 0.18)));
      const headDownDegrees = Math.max(0, 10 + rand(-5, 22));
      const yawnCount30s = Math.max(0, Math.round(rand(0, 4)));
      const heartRate = Math.round(rand(55, 85));
      const hrvRmssd = Math.round(rand(18, 45));
      arr.push({
        truckId: b.id,
        timestamp: t,
        perclos,
        headDownDegrees,
        yawnCount30s,
        heartRate,
        hrvRmssd,
        lat: b.lat + rand(-0.6, 0.6) + (30 - i) * 0.01,
        lng: b.lng + rand(-0.6, 0.6) + (30 - i) * 0.01,
      });
    }
    telemetryByTruck[b.id] = arr;
  });

  // Seed 2 alerts so list isn’t empty on first load
  const t0 = new Date(now - 15000).toISOString();
  alerts.unshift({
    id: `TX-101-${t0}`,
    truckId: "TX-101",
    startedAt: t0,
    status: "DROWSY_SOON",
    secondsDrowsy: 90,
    reason: "Threshold exceeded",
  });
  const t1 = new Date(now - 45000).toISOString();
  alerts.unshift({
    id: `IL-202-${t1}`,
    truckId: "IL-202",
    startedAt: t1,
    status: "ASLEEP",
    secondsDrowsy: 120,
    reason: "High PERCLOS",
  });
}
seed();

function tickOnce() {
  const t = new Date().toISOString();
  Object.keys(telemetryByTruck).forEach((id) => {
    const last = telemetryByTruck[id][telemetryByTruck[id].length - 1];
    const next: Telemetry = {
      truckId: id,
      timestamp: t,
      perclos: Math.max(0, Math.min(1, last.perclos + Math.random() * 0.08 - 0.03)),
      headDownDegrees: Math.max(0, last.headDownDegrees + Math.random() * 6 - 3),
      yawnCount30s: Math.max(0, Math.round(Math.random() * 4)),
      heartRate: Math.round(last.heartRate + Math.random() * 8 - 4),
      hrvRmssd: Math.round(last.hrvRmssd + Math.random() * 10 - 5),
      lat: last.lat + Math.random() * 0.1 - 0.05,
      lng: last.lng + Math.random() * 0.1 - 0.05,
    };
    telemetryByTruck[id].push(next);

    // simple alerting
    if (
      next.perclos >= thresholds.perclosHigh ||
      next.headDownDegrees >= thresholds.headDownDegHigh ||
      next.yawnCount30s >= thresholds.yawnCountHigh
    ) {
      alerts.unshift({
        id: `${id}-${t}`,
        truckId: id,
        startedAt: t,
        status: next.perclos >= thresholds.perclosHigh ? "ASLEEP" : "DROWSY_SOON",
        secondsDrowsy: Math.round(30 + Math.random() * 210),
        reason: "Threshold exceeded",
      });
      if (alerts.length > 200) alerts.pop();
    }
  });
}
setInterval(tickOnce, 30000);

export async function getTrucks(): Promise<Truck[]> {
  return structuredClone(trucks);
}
export async function getTelemetry(truckId?: string): Promise<Telemetry[]> {
  if (truckId) return structuredClone(telemetryByTruck[truckId] || []);
  return Object.values(telemetryByTruck).flat();
}
export async function getAlerts(truckId?: string): Promise<Alert[]> {
  return structuredClone(alerts.filter((a) => (truckId ? a.truckId === truckId : true)));
}
export async function getThresholds(): Promise<Thresholds> {
  return structuredClone(thresholds);
}
export async function saveThresholds(t: Thresholds): Promise<Thresholds> {
  thresholds = { ...t };
  return structuredClone(thresholds);
}
