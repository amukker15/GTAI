// src/pages/TruckDetail.tsx
import { Link, useParams } from "react-router-dom";
import { useMemo } from "react";
import { useStore } from "../state/store";
import type { LatLngTuple, LatLngBoundsExpression } from "leaflet";
import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Brush,
  ResponsiveContainer,
} from "recharts";
import { computeStatus, statusToColor } from "../lib/status";
import type { DriverStatus } from "../lib/status";
import type { Telemetry, Thresholds, Truck } from "../lib/types";
import { useDarkMode } from "../context/DarkModeContext";
import { AlertCircle, AlertTriangle, Home, Radar, Timeline } from "../components/icons";
import VideoPlayer from "../components/VideoPlayer";

type VarKey = "perclos" | "headDownDegrees" | "yawnCount30s" | "heartRate" | "hrvRmssd";

const VAR_LABEL: Record<VarKey, string> = {
  perclos: "PERCLOS",
  headDownDegrees: "Head Down (°)",
  yawnCount30s: "Yawns / 30s",
  heartRate: "Heart Rate (bpm)",
  hrvRmssd: "HRV RMSSD (ms)",
};

const MAP_LEGEND = [
  { label: "Lucid", color: statusToColor("OK") },
  { label: "Warning", color: statusToColor("DROWSY_SOON") },
  { label: "Critical", color: statusToColor("ASLEEP") },
];

const SURFACE_CLASS =
  "relative rounded-3xl border border-slate-200/70 dark:border-slate-800/70 bg-white/95 dark:bg-slate-950/60 shadow-[0_25px_45px_-35px_rgba(15,23,42,0.9)] backdrop-blur";

type ChartTooltipPayload = {
  value?: number | string;
  dataKey?: string | number;
};

type ChartTooltipProps = {
  active?: boolean;
  payload?: ChartTooltipPayload[];
  label?: string | number;
};

const SignalTooltip = ({ active, payload, label }: ChartTooltipProps) => {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  const numericValue = typeof point.value === "number" ? point.value : Number(point.value);
  const formattedValue = Number.isFinite(numericValue)
    ? numericValue.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : point.value ?? "—";
  const dataKey = (point.dataKey ?? "") as VarKey | string;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-950/90 px-3 py-2 shadow-xl">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-base font-semibold text-slate-900 dark:text-white">{formattedValue}</div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400">
        {VAR_LABEL[dataKey as VarKey] ?? dataKey}
      </div>
    </div>
  );
};

export default function TruckDetail() {
  const { truckId = "" } = useParams();
  const truck = useStore((s) => s.trucks.find((t: Truck) => t.id === truckId));
  const telemetryByTruckId = useStore((s) => s.telemetryByTruckId);
  const allAlerts = useStore((s) => s.alerts);
  const thresholds = useStore((s) => s.thresholds) as Thresholds | null;
  const selectedVar = useStore((s) => s.selectedVar);
  const setSelectedVar = useStore((s) => s.setSelectedVar);
  const analysisResults = useStore((s) => s.analysisResults);
  const secondsSinceLastApiCall = useStore((s) => s.secondsSinceLastApiCall);
  const { darkMode } = useDarkMode();

  // Get latest analysis result for current data display
  const latestAnalysis = analysisResults[analysisResults.length - 1];

  // Local UI state

  const history: Telemetry[] = telemetryByTruckId[truckId] || [];
  const latest = history[history.length - 1];
  const center: LatLngTuple = latest ? [latest.lat, latest.lng] : [39.5, -98.35];
  const focusBounds = useMemo<LatLngBoundsExpression | undefined>(() => {
    if (!latest) return undefined;
    const latPad = 2;
    const lngPad = 3;
    return [
      [latest.lat - latPad, latest.lng - lngPad],
      [latest.lat + latPad, latest.lng + lngPad],
    ] as LatLngBoundsExpression;
  }, [latest]);
  const mapKey = latest ? `${truckId}-${latest.timestamp}` : "no-data";

  // Build chart data from analysis results
  const chartData = useMemo(
    () =>
      analysisResults.map((result) => {
        // Simulate heart rate and HRV based on analysis data
        const baseHeartRate = 72;
        const baseHRV = 45;
        const heartRate = Math.round(baseHeartRate + (result.perclos_30s * 20)); // Higher PERCLOS = higher HR
        const hrvRmssd = Math.round(baseHRV - (result.perclos_30s * 15)); // Higher PERCLOS = lower HRV
        
        return {
          time: new Date(result.ts_end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          perclos: Number((result.perclos_30s).toFixed(3)),
          headDownDegrees: result.pitchdown_avg_30s,
          yawnCount30s: result.yawn_count_30s,
          heartRate: heartRate,
          hrvRmssd: hrvRmssd,
        };
      }),
    [analysisResults]
  );

  // Color route segments by status (compute with small rolling window)
  const coloredSegments = useMemo(() => {
    if (!thresholds || history.length < 2) return [];
    const segs: { pts: LatLngTuple[]; color: string; key: string }[] = [];
    for (let i = 1; i < history.length; i++) {
      const slice = history.slice(Math.max(0, i - 3), i + 1);
      const cur = history[i];
      const status = computeStatus(cur, slice, thresholds);
      segs.push({
        pts: [
          [history[i - 1].lat, history[i - 1].lng],
          [history[i].lat, history[i].lng],
        ] as LatLngTuple[],
        color: statusToColor(status),
        key: `${i}-${status}`,
      });
    }
    return segs;
  }, [history, thresholds]);

  // Generate alerts based on analysis results
  const truckAlerts = useMemo(() => {
    return analysisResults
      .map((result, index) => {
        const isDrowsy = result.perclos_30s > 0.4 || result.yawn_count_30s > 2;
        const isAsleep = result.perclos_30s > 0.6 || result.confidence !== "OK";
        
        if (isAsleep) {
          return {
            id: `alert_${index}`,
            truckId: truckId || "demo_truck",
            status: "ASLEEP",
            reason: `High fatigue detected (PERCLOS: ${(result.perclos_30s * 100).toFixed(1)}%)`,
            startedAt: result.ts_end,
            secondsDrowsy: 30,
            timeInterval: `${Math.floor(index * 30 / 60)}:${String(index * 30 % 60).padStart(2, '0')}-${Math.floor((index + 1) * 30 / 60)}:${String((index + 1) * 30 % 60).padStart(2, '0')}`
          };
        } else if (isDrowsy) {
          return {
            id: `alert_${index}`,
            truckId: truckId || "demo_truck", 
            status: "DROWSY_SOON",
            reason: `Drowsiness indicators (PERCLOS: ${(result.perclos_30s * 100).toFixed(1)}%, Yawns: ${result.yawn_count_30s})`,
            startedAt: result.ts_end,
            secondsDrowsy: 30,
            timeInterval: `${Math.floor(index * 30 / 60)}:${String(index * 30 % 60).padStart(2, '0')}-${Math.floor((index + 1) * 30 / 60)}:${String((index + 1) * 30 % 60).padStart(2, '0')}`
          };
        }
        return null;
      })
      .filter(Boolean);
  }, [analysisResults, truckId]);

  // Status text
  const statusText = useMemo<DriverStatus>(() => {
    if (!thresholds) return "OK";
    return computeStatus(latest, history, thresholds);
  }, [latest, history, thresholds]);
  const statusColor = statusToColor(statusText);
  const mapTileUrl = darkMode
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  const driverName = truck?.driverName ?? "Demo Driver";
  const routeLabel = truck ? `${truck.route.from} → ${truck.route.to}` : "Demo Route";
  const companyLabel = truck?.company ?? "—";
  const lastUpdateText = secondsSinceLastApiCall === 0 
    ? "Just updated"
    : `${secondsSinceLastApiCall}s ago`;

  // Use latest analysis results instead of mock telemetry
  const perclosPercent = latestAnalysis ? Math.round(latestAnalysis.perclos_30s * 100) : null;
  const headDownDegrees = latestAnalysis?.pitchdown_avg_30s ?? null;
  const yawnCount = latestAnalysis?.yawn_count_30s ?? null;
  
  // Simulate heart rate and HRV based on analysis data
  const baseHeartRate = 72;
  const heartRate = latestAnalysis 
    ? Math.round(baseHeartRate + (latestAnalysis.perclos_30s * 20)) // Higher PERCLOS = higher HR
    : null;
  
  const baseHRV = 45;
  const hrvRmssd = latestAnalysis 
    ? Math.round(baseHRV - (latestAnalysis.perclos_30s * 15)) // Higher PERCLOS = lower HRV
    : null;

  const biometrics = [
    {
      key: "perclos",
      label: "Fatigue (PERCLOS)",
      value: perclosPercent !== null ? `${perclosPercent}%` : "—",
      helper: "Latest 30s window",
      progress: perclosPercent,
    },
    {
      key: "heartRate",
      label: "Heart Rate",
      value: heartRate !== null ? `${heartRate} bpm` : "—",
      helper: "Live sensor reading",
    },
    {
      key: "hrvRmssd",
      label: "HRV RMSSD",
      value: hrvRmssd !== null ? `${hrvRmssd} ms` : "—",
      helper: "Short-term variability",
    },
    {
      key: "headDownDegrees",
      label: "Head Down",
      value: headDownDegrees !== null ? `${headDownDegrees.toFixed(0)}°` : "—",
      helper: "Inclination vs forward",
    },
    {
      key: "yawnCount30s",
      label: "Yawns / 30s",
      value: yawnCount !== null ? yawnCount.toString() : "—",
      helper: "Recent interval",
    },
  ];

  const axisColor = darkMode ? "#94a3b8" : "#475569";
  const gridColor = darkMode ? "rgba(148,163,184,0.35)" : "rgba(15,23,42,0.08)";
  const lineColor = darkMode ? "#38bdf8" : "#2563eb";

  const latestChartData = chartData[chartData.length - 1];
  const selectedValue = latestChartData ? latestChartData[selectedVar] : null;
  const formattedSelectedValue = useMemo(() => {
    if (selectedValue === null || selectedValue === undefined) return "—";
    if (typeof selectedValue === "number") {
      if (selectedVar === "perclos") return `${Math.round(selectedValue * 100)}%`;
      if (selectedVar === "headDownDegrees") return `${selectedValue.toFixed(0)}°`;
      if (selectedVar === "yawnCount30s") return selectedValue.toFixed(0);
      if (selectedVar === "heartRate") return `${selectedValue.toFixed(0)} bpm`;
      if (selectedVar === "hrvRmssd") return `${selectedValue.toFixed(0)} ms`;
      return selectedValue.toLocaleString();
    }
    return selectedValue;
  }, [selectedValue, selectedVar]);

  return (
    <div
      className="relative page px-4 pb-12 pt-4 sm:px-6 lg:px-10"
      style={{ marginTop: "var(--app-header-height, 96px)" }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-gradient-to-b from-sky-100 via-transparent to-transparent dark:from-slate-900/70" />

      <div className="space-y-3">
        <section className={`${SURFACE_CLASS} overflow-hidden px-4 py-3`}>
          <div className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-sky-200/40 to-transparent dark:from-sky-500/10" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
                <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">Driver Studio</p>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">{driverName}</h1>
                <div className="flex flex-wrap gap-2 mt-1">
                  <span className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {routeLabel}
                  </span>
                </div>
              </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Last update</span>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">{lastUpdateText}</div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
                  style={{ backgroundColor: statusColor }}
                >
                  {statusText === "OK" ? "Lucid" : statusText === "DROWSY_SOON" ? "Warning" : statusText === "ASLEEP" ? "Critical" : statusText}
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
          <div className="space-y-3">
            <section className={`${SURFACE_CLASS}`}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100/70 px-4 py-3 dark:border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-200">
                    <Radar className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Route focus</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Regional track</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500 dark:text-slate-400">
                  {MAP_LEGEND.map((item) => (
                    <span key={item.label} className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="h-[260px] overflow-hidden rounded-lg border border-slate-100 shadow-sm dark:border-slate-800">
                  <MapContainer
                    key={mapKey}
                    center={center}
                    bounds={focusBounds}
                    zoom={focusBounds ? undefined : 6}
                    scrollWheelZoom
                    className="h-full w-full"
                  >
                    <TileLayer
                      url={mapTileUrl}
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    />
                    {coloredSegments.map((seg, idx) => (
                      <Polyline
                        key={`${seg.key}-${idx}`}
                        positions={seg.pts}
                        pathOptions={{ color: seg.color, weight: 5, opacity: 0.85 }}
                      />
                    ))}
                  </MapContainer>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Map auto-centers around driver location (~200mi radius).
                </p>
              </div>
            </section>

            {/* Biometric Chart - Single Chart with Selector */}
            <section className={`${SURFACE_CLASS}`}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100/70 px-4 py-3 dark:border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-200">
                    <LineChart className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Biometric tracking</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{VAR_LABEL[selectedVar]}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(VAR_LABEL).map((k) => {
                    const key = k as VarKey;
                    const active = selectedVar === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedVar(key)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          active
                            ? "bg-blue-600 text-white shadow border border-blue-600"
                            : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                        }`}
                      >
                        {VAR_LABEL[key]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="h-[300px] w-full min-h-[300px] min-w-[400px]">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%" minHeight={300} minWidth={400}>
                      <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="time" 
                          tick={{ fill: axisColor, fontSize: 12 }}
                          tickMargin={8}
                          minTickGap={30}
                        />
                        <YAxis 
                          tick={{ fill: axisColor, fontSize: 12 }}
                          tickMargin={8}
                        />
                        <Tooltip content={<SignalTooltip />} />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey={selectedVar}
                          stroke={lineColor}
                          strokeWidth={2}
                          dot={false}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                        <Brush height={24} travellerWidth={10} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                      <div className="text-center">
                        <div className="animate-pulse">Loading analysis data...</div>
                        <div className="text-xs mt-1">Waiting for first 30-second analysis</div>
                      </div>
                    </div>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Current value: {formattedSelectedValue}
                </p>
              </div>
            </section>

            <section className={`${SURFACE_CLASS}`}>
              <div className="flex items-center justify-between border-b border-slate-100/70 px-4 py-3 dark:border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-200">
                    <Timeline className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Alert history</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{truckAlerts.length} events</p>
                  </div>
                </div>
                <span className="rounded-lg bg-rose-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">
                  Live
                </span>
              </div>
              <div className="max-h-[300px] overflow-y-auto px-4 py-3">
                {truckAlerts.length === 0 && (
                  <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                      <Timeline className="h-4 w-4" />
                    </div>
                    <h3 className="mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300">No alerts recorded</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Driver maintains good alertness.</p>
                  </div>
                )}
                {truckAlerts.length > 0 && (
                  <div className="space-y-2">
                    {truckAlerts.map((a: any, idx: number) => {
                      const isCritical = a.status === "ASLEEP";
                      const tint = statusToColor(a.status as DriverStatus);
                      const Icon = isCritical ? AlertCircle : AlertTriangle;
                      return (
                        <div key={a.id} className="flex gap-3">
                          <div className="relative flex flex-col items-center">
                            <span
                              className="flex h-8 w-8 items-center justify-center rounded-full border-2 bg-white shadow-sm dark:bg-slate-950"
                              style={{ borderColor: tint, color: tint }}
                            >
                              <Icon className="h-3 w-3" />
                            </span>
                            {idx !== truckAlerts.length - 1 && (
                              <div className="mt-1 h-full w-0.5 bg-gradient-to-b from-slate-300 via-slate-200 to-transparent dark:from-slate-600 dark:via-slate-700" />
                            )}
                          </div>
                          <div className="flex-1 rounded-lg border border-slate-200/70 bg-white/50 px-3 py-2 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/30" style={{ borderLeftColor: tint, borderLeftWidth: 2 }}>
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2">
                                <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-200">
                                  Video {a.timeInterval}
                                </span>
                                <span className="text-xs font-semibold text-slate-900 dark:text-white">
                                  {isCritical ? "Critical" : "Warning"}
                                </span>
                              </div>
                              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                {new Date(a.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                            <p className="text-xs text-slate-700 dark:text-slate-200 mb-1">{a.reason}</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                              30s interval: {a.timeInterval}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-3">
            <section className={`${SURFACE_CLASS}`}>
              <div className="border-b border-slate-100/70 px-4 py-3 dark:border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-200">
                    <Radar className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Driver vitals</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Live snapshot</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 p-3">
                {biometrics.map((stat) => {
                  const progress = stat.progress ?? null;
                  const safeProgress = progress !== null ? Math.min(Math.max(progress, 0), 100) : null;
                  return (
                    <div
                      key={stat.key}
                      className={`rounded-lg border border-slate-200/70 bg-slate-50/30 px-3 py-2 dark:border-slate-800/70 dark:bg-slate-900/30 ${safeProgress !== null ? 'flex items-center justify-between gap-3' : ''}`}
                    >
                      <div className="flex-1">
                        <p className="text-[10px] uppercase tracking-wide font-medium text-slate-500 dark:text-slate-400">{stat.label}</p>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{stat.value}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">{stat.helper}</p>
                      </div>
                      {safeProgress !== null && (
                        <div className="flex-shrink-0">
                          <div className="relative h-12 w-12">
                            <div
                              className="absolute inset-0 rounded-full"
                              style={{
                                background: `conic-gradient(#0ea5e9 ${safeProgress}%, rgba(148,163,184,0.2) ${safeProgress}% 100%)`,
                              }}
                            />
                            <div className="absolute inset-1 flex items-center justify-center rounded-full bg-white text-[10px] font-bold text-slate-900 dark:bg-slate-950 dark:text-white">
                              {safeProgress}%
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className={`${SURFACE_CLASS} overflow-hidden`}>
              <div className="border-b border-slate-100/70 px-4 py-3 dark:border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-200">
                    <Radar className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Live driver feed</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Secure stream</p>
                  </div>
                </div>
              </div>
              <div className="px-4 py-3">
                <VideoPlayer className="h-[160px] w-full" />
              </div>
            </section>
          </div>
        </div>
      </div>

    </div>
  );
}

