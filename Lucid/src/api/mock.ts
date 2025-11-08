import type { Alert, Telemetry, Thresholds, Truck } from "../lib/types";

let thresholds: Thresholds = {
  perclosHigh: 0.4,
  headDownDegHigh: 25,
  yawnCountHigh: 3,
  hrLow: 50,
  hrvLow: 20,
  predictionWindowSec: [30, 120],
};

// Major US Freight Corridors with realistic waypoints
const freightCorridors = {
  // I-95 Corridor (East Coast)
  i95: [
    { city: "Miami, FL", lat: 25.7617, lng: -80.1918 },
    { city: "Jacksonville, FL", lat: 30.3322, lng: -81.6557 },
    { city: "Savannah, GA", lat: 32.0809, lng: -81.0912 },
    { city: "Fayetteville, NC", lat: 35.0527, lng: -78.8784 },
    { city: "Richmond, VA", lat: 37.5407, lng: -77.4360 },
    { city: "Washington, DC", lat: 38.9072, lng: -77.0369 },
    { city: "Baltimore, MD", lat: 39.2904, lng: -76.6122 },
    { city: "Philadelphia, PA", lat: 39.9526, lng: -75.1652 },
    { city: "New York, NY", lat: 40.7128, lng: -74.0060 },
    { city: "New Haven, CT", lat: 41.3083, lng: -72.9279 },
    { city: "Providence, RI", lat: 41.8240, lng: -71.4128 },
    { city: "Boston, MA", lat: 42.3601, lng: -71.0589 },
  ],
  // I-10 Corridor (Southern transcontinental)
  i10: [
    { city: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
    { city: "Phoenix, AZ", lat: 33.4484, lng: -112.0740 },
    { city: "Tucson, AZ", lat: 32.2226, lng: -110.9747 },
    { city: "El Paso, TX", lat: 31.7619, lng: -106.4850 },
    { city: "San Antonio, TX", lat: 29.4241, lng: -98.4936 },
    { city: "Houston, TX", lat: 29.7604, lng: -95.3698 },
    { city: "Baton Rouge, LA", lat: 30.4515, lng: -91.1871 },
    { city: "New Orleans, LA", lat: 29.9511, lng: -90.0715 },
    { city: "Mobile, AL", lat: 30.6954, lng: -88.0399 },
    { city: "Tallahassee, FL", lat: 30.4383, lng: -84.2807 },
    { city: "Jacksonville, FL", lat: 30.3322, lng: -81.6557 },
  ],
  // I-40 Corridor (Southern transcontinental)
  i40: [
    { city: "Barstow, CA", lat: 34.8958, lng: -117.0228 },
    { city: "Flagstaff, AZ", lat: 35.1983, lng: -111.6513 },
    { city: "Albuquerque, NM", lat: 35.0844, lng: -106.6504 },
    { city: "Amarillo, TX", lat: 35.2220, lng: -101.8313 },
    { city: "Oklahoma City, OK", lat: 35.4676, lng: -97.5164 },
    { city: "Little Rock, AR", lat: 34.7465, lng: -92.2896 },
    { city: "Memphis, TN", lat: 35.1495, lng: -90.0490 },
    { city: "Nashville, TN", lat: 36.1627, lng: -86.7816 },
    { city: "Knoxville, TN", lat: 35.9606, lng: -83.9207 },
    { city: "Asheville, NC", lat: 35.5951, lng: -82.5515 },
    { city: "Greensboro, NC", lat: 36.0726, lng: -79.7920 },
    { city: "Raleigh, NC", lat: 35.7796, lng: -78.6382 },
  ],
  // I-80 Corridor (Northern transcontinental)
  i80: [
    { city: "San Francisco, CA", lat: 37.7749, lng: -122.4194 },
    { city: "Sacramento, CA", lat: 38.5816, lng: -121.4944 },
    { city: "Reno, NV", lat: 39.5296, lng: -119.8138 },
    { city: "Salt Lake City, UT", lat: 40.7608, lng: -111.8910 },
    { city: "Cheyenne, WY", lat: 41.1400, lng: -104.8202 },
    { city: "North Platte, NE", lat: 41.1239, lng: -100.7654 },
    { city: "Omaha, NE", lat: 41.2565, lng: -95.9345 },
    { city: "Des Moines, IA", lat: 41.5868, lng: -93.6250 },
    { city: "Chicago, IL", lat: 41.8781, lng: -87.6298 },
    { city: "Toledo, OH", lat: 41.6528, lng: -83.5379 },
    { city: "Cleveland, OH", lat: 41.4993, lng: -81.6944 },
    { city: "New York, NY", lat: 40.7128, lng: -74.0060 },
  ],
  // I-70 Corridor (Central transcontinental)
  i70: [
    { city: "Denver, CO", lat: 39.7392, lng: -104.9903 },
    { city: "Kansas City, MO", lat: 39.0997, lng: -94.5786 },
    { city: "St. Louis, MO", lat: 38.6270, lng: -90.1994 },
    { city: "Indianapolis, IN", lat: 39.7684, lng: -86.1581 },
    { city: "Columbus, OH", lat: 39.9612, lng: -82.9988 },
    { city: "Baltimore, MD", lat: 39.2904, lng: -76.6122 },
  ],
  // I-5 Corridor (West Coast)
  i5: [
    { city: "Seattle, WA", lat: 47.6062, lng: -122.3321 },
    { city: "Portland, OR", lat: 45.5152, lng: -122.6784 },
    { city: "Eugene, OR", lat: 44.0521, lng: -123.0868 },
    { city: "Redding, CA", lat: 40.5865, lng: -122.3917 },
    { city: "Sacramento, CA", lat: 38.5816, lng: -121.4944 },
    { city: "Stockton, CA", lat: 37.9577, lng: -121.2908 },
    { city: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
    { city: "San Diego, CA", lat: 32.7157, lng: -117.1611 },
  ],
  // I-35 Corridor (North-South Central)
  i35: [
    { city: "Duluth, MN", lat: 46.7867, lng: -92.1005 },
    { city: "Minneapolis, MN", lat: 44.9778, lng: -93.2650 },
    { city: "Des Moines, IA", lat: 41.5868, lng: -93.6250 },
    { city: "Kansas City, MO", lat: 39.0997, lng: -94.5786 },
    { city: "Wichita, KS", lat: 37.6872, lng: -97.3301 },
    { city: "Oklahoma City, OK", lat: 35.4676, lng: -97.5164 },
    { city: "Dallas, TX", lat: 32.7767, lng: -96.7970 },
    { city: "Austin, TX", lat: 30.2672, lng: -97.7431 },
    { city: "San Antonio, TX", lat: 29.4241, lng: -98.4936 },
    { city: "Laredo, TX", lat: 27.5306, lng: -99.4803 },
  ],
  // I-75 Corridor (Great Lakes to Florida)
  i75: [
    { city: "Detroit, MI", lat: 42.3314, lng: -83.0458 },
    { city: "Toledo, OH", lat: 41.6528, lng: -83.5379 },
    { city: "Dayton, OH", lat: 39.7589, lng: -84.1916 },
    { city: "Cincinnati, OH", lat: 39.1031, lng: -84.5120 },
    { city: "Lexington, KY", lat: 38.0406, lng: -84.5037 },
    { city: "Knoxville, TN", lat: 35.9606, lng: -83.9207 },
    { city: "Chattanooga, TN", lat: 35.0456, lng: -85.3097 },
    { city: "Atlanta, GA", lat: 33.7490, lng: -84.3880 },
    { city: "Macon, GA", lat: 32.8407, lng: -83.6324 },
    { city: "Tampa, FL", lat: 27.9506, lng: -82.4572 },
    { city: "Naples, FL", lat: 26.1420, lng: -81.7948 },
  ],
};

const trucks: Truck[] = [
  // I-95 Corridor
  {
    id: "MA-001",
    driverName: "J. Martinez",
    company: "Acme Logistics",
    route: { from: "Boston, MA", to: "Miami, FL" },
    path: [],
  },
  {
    id: "NY-205",
    driverName: "S. Chen",
    company: "Acme Logistics",
    route: { from: "New York, NY", to: "Richmond, VA" },
    path: [],
  },
  // I-10 Corridor
  {
    id: "CA-403",
    driverName: "M. Johnson",
    company: "Western Freight",
    route: { from: "Los Angeles, CA", to: "Houston, TX" },
    path: [],
  },
  {
    id: "TX-104",
    driverName: "R. Patel",
    company: "Southern Express",
    route: { from: "San Antonio, TX", to: "Jacksonville, FL" },
    path: [],
  },
  // I-40 Corridor
  {
    id: "NC-512",
    driverName: "K. Williams",
    company: "Cross Country Transport",
    route: { from: "Raleigh, NC", to: "Albuquerque, NM" },
    path: [],
  },
  {
    id: "TN-308",
    driverName: "D. Thompson",
    company: "Midwest Haulers",
    route: { from: "Nashville, TN", to: "Flagstaff, AZ" },
    path: [],
  },
  // I-80 Corridor
  {
    id: "IL-202",
    driverName: "K. Ahmed",
    company: "Acme Logistics",
    route: { from: "Chicago, IL", to: "San Francisco, CA" },
    path: [],
  },
  {
    id: "NE-701",
    driverName: "L. Rodriguez",
    company: "Plains Transport",
    route: { from: "Omaha, NE", to: "New York, NY" },
    path: [],
  },
  // I-70 Corridor
  {
    id: "CO-620",
    driverName: "A. Kim",
    company: "Mountain Express",
    route: { from: "Denver, CO", to: "Baltimore, MD" },
    path: [],
  },
  {
    id: "MO-415",
    driverName: "T. Davis",
    company: "Heartland Logistics",
    route: { from: "St. Louis, MO", to: "Columbus, OH" },
    path: [],
  },
  // I-5 Corridor
  {
    id: "WA-903",
    driverName: "N. Nguyen",
    company: "Pacific Freight",
    route: { from: "Seattle, WA", to: "San Diego, CA" },
    path: [],
  },
  {
    id: "OR-156",
    driverName: "E. Brown",
    company: "Northwest Carriers",
    route: { from: "Portland, OR", to: "Los Angeles, CA" },
    path: [],
  },
  // I-35 Corridor
  {
    id: "TX-101",
    driverName: "R. Diaz",
    company: "Acme Logistics",
    route: { from: "Dallas, TX", to: "Minneapolis, MN" },
    path: [],
  },
  {
    id: "KS-247",
    driverName: "B. Miller",
    company: "Central Plains Freight",
    route: { from: "Wichita, KS", to: "Laredo, TX" },
    path: [],
  },
  // I-75 Corridor
  {
    id: "MI-834",
    driverName: "P. Wilson",
    company: "Great Lakes Transport",
    route: { from: "Detroit, MI", to: "Tampa, FL" },
    path: [],
  },
  {
    id: "GA-529",
    driverName: "C. Jackson",
    company: "Southern Freight",
    route: { from: "Atlanta, GA", to: "Cincinnati, OH" },
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
