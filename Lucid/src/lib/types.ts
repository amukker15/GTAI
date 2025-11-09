export type Telemetry = {
  truckId: string;
  timestamp: string;   // ISO
  perclos: number;     // 0..1
  headDownDegrees: number;
  yawnCount15s: number;
  heartRate: number;
  hrvRmssd: number;    // ms
  lat: number;
  lng: number;
};

export type Alert = {
  id: string;
  truckId: string;
  startedAt: string;   // ISO
  status: "OK" | "DROWSY_SOON" | "ASLEEP";
  secondsDrowsy: number;
  reason: string;
};

export type Thresholds = {
  perclosHigh: number;
  headDownDegHigh: number;
  yawnCountHigh: number;
  hrLow: number;
  hrvLow: number;
  predictionWindowSec: [number, number];
};

export type Truck = {
  id: string;
  driverName: string;
  company: string;
  route: { from: string; to: string };
  path: Array<{ lat: number; lng: number; t: string }>;
};
