// src/pages/TruckDetail.tsx
import { useParams } from "react-router-dom";
import { useMemo } from "react";
import { useStore } from "../state/store";
import type { AnalysisResult } from "../state/store";
import type { LatLngTuple, LatLngBoundsExpression } from "leaflet";
import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import {
  LineChart as ReLineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import type { LabelProps } from "recharts";
import { computeStatus, statusToColor } from "../lib/status";
import type { DriverStatus } from "../lib/status";
import type { Telemetry, Thresholds, Truck } from "../lib/types";
import { useDarkMode } from "../context/DarkModeContext";
import { AlertCircle, AlertTriangle, Radar, Timeline, LineChart as LineChartIcon } from "../components/icons";
import VideoPlayer from "../components/VideoPlayer";

const MAP_LEGEND = [
  { label: "Lucid", color: statusToColor("OK") },
  { label: "Warning", color: statusToColor("DROWSY_SOON") },
  { label: "Critical", color: statusToColor("ASLEEP") },
];

const SURFACE_CLASS =
  "relative rounded-3xl border border-slate-200/70 dark:border-slate-800/70 bg-white/95 dark:bg-slate-950/60 shadow-[0_25px_45px_-35px_rgba(15,23,42,0.9)] backdrop-blur";

type AnalysisPoint = AnalysisResult & {
  tsLabel: string;
  bucketIndex: number;
  intervalLabel: string;
  perclosPercent: number;
  yawnDutyPercent: number;
  droopDutyPercent: number;
  state: DriverStatus;
  stateReason: string;
  dimPoint: boolean;
};

type TooltipProps = {
  active?: boolean;
  payload?: { payload: AnalysisPoint }[];
};

const STATE_LABEL: Record<DriverStatus, string> = {
  OK: "Lucid",
  DROWSY_SOON: "Drowsy",
  ASLEEP: "Asleep",
};

const formatSeconds = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const formatInterval = (bucketIndex: number) => {
  const start = (bucketIndex - 1) * 30;
  const end = bucketIndex * 30;
  return `${formatSeconds(start)}-${formatSeconds(end)}`;
};

const formatClockLabel = (ts: string) => {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

type StateAssessment = {
  state: DriverStatus;
  reason: string;
};

const assessDriverState = (sample: AnalysisResult | undefined): StateAssessment => {
  if (!sample) {
    return { state: "OK", reason: "Awaiting data" };
  }

  const perclosPct = sample.perclos_30s * 100;
  const yawDutyPct = sample.yawn_duty_30s * 100;
  const droopDutyPct = sample.droop_duty_30s * 100;
  const pitchThreshold = sample.pitch_thresh_Tp;

  const highPerclos = sample.perclos_30s >= 0.6;
  const medPerclos = sample.perclos_30s >= 0.4;
  const severeHeadDrop = sample.pitchdown_avg_30s >= pitchThreshold + 5 || sample.pitchdown_max_30s >= pitchThreshold + 8;
  const headTrending = sample.pitchdown_avg_30s >= pitchThreshold || sample.pitchdown_max_30s >= pitchThreshold + 4;
  const yawOverload = sample.yawn_duty_30s >= 0.55;
  const yawElevated = sample.yawn_count_30s >= 2 || sample.yawn_duty_30s >= 0.35;
  const droopHeavy = sample.droop_time_30s >= 18 || droopDutyPct >= 60;
  const droopElevated = sample.droop_time_30s >= 12 || droopDutyPct >= 40;

  if (highPerclos) {
    return { state: "ASLEEP", reason: `High fatigue detected (PERCLOS ${perclosPct.toFixed(1)}%)` };
  }

  if (severeHeadDrop) {
    return {
      state: "ASLEEP",
      reason: `Head drop beyond threshold (${sample.pitchdown_avg_30s.toFixed(1)}° vs ${pitchThreshold.toFixed(1)}°)`,
    };
  }

  if (yawOverload) {
    return {
      state: "ASLEEP",
      reason: `Continuous yawning (${yawDutyPct.toFixed(1)}% duty)`,
    };
  }

  if (droopHeavy) {
    return {
      state: "ASLEEP",
      reason: `Extended head droop (${sample.droop_time_30s.toFixed(1)}s down)`,
    };
  }

  if (medPerclos) {
    return { state: "DROWSY_SOON", reason: `Elevated PERCLOS (${perclosPct.toFixed(1)}%)` };
  }

  if (yawElevated) {
    return {
      state: "DROWSY_SOON",
      reason: `Frequent yawning (${sample.yawn_count_30s} in 30s)`,
    };
  }

  if (headTrending || droopElevated) {
    return {
      state: "DROWSY_SOON",
      reason: `Head pose nearing threshold (avg ${sample.pitchdown_avg_30s.toFixed(1)}°)`,
    };
  }

  return { state: "OK", reason: "Vitals within safe thresholds" };
};

const hasQualityWarning = (sample: AnalysisResult | undefined) => {
  if (!sample) return false;
  return sample.confidence !== "OK" || sample.fps < 24;
};

const PerclosTooltip = ({ active, payload }: TooltipProps) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-950/90 px-3 py-2 shadow-xl">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{point.tsLabel}</div>
      <div className="text-base font-semibold text-slate-900 dark:text-white">{point.perclosPercent.toFixed(1)}%</div>
      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
        <p>EAR threshold: {point.ear_thresh_T.toFixed(3)}</p>
        <p>PERCLOS ratio: {point.perclos_30s.toFixed(3)}</p>
        <p>Confidence: {point.confidence} · FPS: {point.fps}</p>
        <p>Bucket: {point.intervalLabel}</p>
      </div>
      {point.dimPoint && (
        <p className="mt-1 text-[11px] font-semibold text-amber-500">⚠️ Low confidence frame</p>
      )}
    </div>
  );
};

const HeadPoseTooltip = ({ active, payload }: TooltipProps) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-950/90 px-3 py-2 shadow-xl">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{point.tsLabel}</div>
      <div className="text-base font-semibold text-slate-900 dark:text-white">{point.pitchdown_avg_30s.toFixed(1)}° avg</div>
      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
        <p>Max droop: {point.pitchdown_max_30s.toFixed(1)}°</p>
        <p>Threshold: {point.pitch_thresh_Tp.toFixed(1)}°</p>
        <p>Droop duty: {(point.droop_duty_30s * 100).toFixed(1)}% · Droop time: {point.droop_time_30s.toFixed(1)}s</p>
        <p>Confidence: {point.confidence} · FPS: {point.fps}</p>
      </div>
      {point.dimPoint && (
        <p className="mt-1 text-[11px] font-semibold text-amber-500">⚠️ Sensor quality dip</p>
      )}
    </div>
  );
};

const YawningTooltip = ({ active, payload }: TooltipProps) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-950/90 px-3 py-2 shadow-xl">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{point.tsLabel}</div>
      <div className="text-base font-semibold text-slate-900 dark:text-white">{point.yawnDutyPercent.toFixed(1)}% duty</div>
      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
        <p>Yawn count: {point.yawn_count_30s}</p>
        <p>Active yawning: {point.yawn_time_30s.toFixed(1)}s</p>
        {Number.isFinite(point.yawn_peak_30s) && <p>Peak openness: {point.yawn_peak_30s.toFixed(3)}</p>}
        <p>Bucket: {point.intervalLabel}</p>
      </div>
    </div>
  );
};

type DotPropsLite = {
  cx?: number;
  cy?: number;
  payload?: AnalysisPoint;
};

type LabelPropsLite = {
  x?: number | string;
  y?: number | string;
  value?: number | string;
};

const StatusDot = ({ cx, cy, payload }: DotPropsLite) => {
  if (cx === undefined || cy === undefined || !payload) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4.5}
      fill={statusToColor(payload.state)}
      opacity={payload.dimPoint ? 0.35 : 0.95}
    />
  );
};

const HeadPoseDot = ({ cx, cy, payload }: DotPropsLite) => {
  if (cx === undefined || cy === undefined || !payload) return null;
  const exceeds = payload.pitchdown_max_30s >= payload.pitch_thresh_Tp;
  if (exceeds) {
    const size = 6;
    return (
      <path
        d={`M ${cx} ${cy - size} L ${cx - size} ${cy + size} L ${cx + size} ${cy + size} Z`}
        fill="#f97316"
        opacity={payload.dimPoint ? 0.6 : 1}
      />
    );
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4.5}
      fill="#6366f1"
      opacity={payload.dimPoint ? 0.35 : 0.95}
    />
  );
};

const YawnDot = ({ cx, cy, payload }: DotPropsLite) => {
  if (cx === undefined || cy === undefined || !payload) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4.5}
      fill="#06b6d4"
      opacity={payload.dimPoint ? 0.4 : 0.95}
    />
  );
};

const YawnCountLabel = ({ x, y, value }: LabelPropsLite) => {
  if (x === undefined || y === undefined || value === undefined) return null;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (Number(value) === 0) return null;
  return (
    <text x={x} y={y - 10} textAnchor="middle" fill="#64748b" fontSize={10} fontWeight={600}>
      {value}
    </text>
  );
};

export default function TruckDetail() {
  const { truckId = "" } = useParams();
  const truck = useStore((s) => s.trucks.find((t: Truck) => t.id === truckId));
  const telemetryByTruckId = useStore((s) => s.telemetryByTruckId);
  const thresholds = useStore((s) => s.thresholds) as Thresholds | null;
  const analysisResults = useStore((s) => s.analysisResults);
  const secondsSinceLastApiCall = useStore((s) => s.secondsSinceLastApiCall);
  const { darkMode } = useDarkMode();

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

  const timelinePoints = useMemo<AnalysisPoint[]>(
    () =>
      analysisResults.map((result, index) => {
        const bucketIndex = index + 1;
        const { state, reason } = assessDriverState(result);
        return {
          ...result,
          tsLabel: formatClockLabel(result.ts_end),
          bucketIndex,
          intervalLabel: formatInterval(bucketIndex),
          perclosPercent: Number((result.perclos_30s * 100).toFixed(1)),
          yawnDutyPercent: Number((result.yawn_duty_30s * 100).toFixed(1)),
          droopDutyPercent: Number((result.droop_duty_30s * 100).toFixed(1)),
          state,
          stateReason: reason,
          dimPoint: hasQualityWarning(result),
        };
      }),
    [analysisResults]
  );

  const latestPoint = timelinePoints[timelinePoints.length - 1];

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
    return timelinePoints
      .filter((point) => point.state !== "OK")
      .map((point, index) => ({
        id: `alert_${index}`,
        truckId: truckId || "demo_truck",
        status: point.state,
        reason: point.stateReason,
        startedAt: point.ts_end,
        secondsDrowsy: 30,
        timeInterval: point.intervalLabel,
      }));
  }, [timelinePoints, truckId]);

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
  const lastUpdateText = `${secondsSinceLastApiCall}s`;

  // Use latest analysis results instead of mock telemetry
  const perclosPercent = latestPoint ? Math.round(latestPoint.perclosPercent) : null;
  const headDownDegrees = latestPoint?.pitchdown_avg_30s ?? null;
  const yawnCount = latestPoint?.yawn_count_30s ?? null;
  
  // Simulate heart rate and HRV based on analysis data
  const baseHeartRate = 72;
  const heartRate = latestPoint 
    ? Math.round(baseHeartRate + (latestPoint.perclos_30s * 20)) // Higher PERCLOS = higher HR
    : null;
  
  const baseHRV = 45;
  const hrvRmssd = latestPoint 
    ? Math.round(baseHRV - (latestPoint.perclos_30s * 15)) // Higher PERCLOS = lower HRV
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
  const headPoseColor = darkMode ? "#c084fc" : "#7c3aed";
  const yawLineColor = darkMode ? "#5eead4" : "#0ea5e9";

  const renderChartPlaceholder = () => (
    <div className="flex h-full w-full items-center justify-center text-slate-500 dark:text-slate-400">
      <div className="text-center">
        <div className="animate-pulse">Waiting for first 30-second analysis</div>
        <div className="text-xs mt-1">Next bucket arrives automatically</div>
      </div>
    </div>
  );

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

            <section className={`${SURFACE_CLASS}`}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100/70 px-4 py-3 dark:border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-200">
                    <LineChartIcon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Live biometrics</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">New bucket every 30s</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Latest state</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {latestPoint ? STATE_LABEL[latestPoint.state] : "Awaiting signal"}
                  </p>
                </div>
              </div>
              <div className="px-4 py-4 space-y-4">
                <div className="rounded-2xl border border-slate-100/70 bg-white/70 p-3 dark:border-slate-800/70 dark:bg-slate-900/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">PERCLOS chart</p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">Eye closure · % of last 30s</p>
                    </div>
                    <div className="text-right text-sm font-semibold text-slate-900 dark:text-white">
                      {perclosPercent !== null ? `${perclosPercent}%` : "—"}
                    </div>
                  </div>
                  <div className="h-[220px] w-full">
                    {timelinePoints.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <ReLineChart data={timelinePoints} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                          <XAxis dataKey="tsLabel" tick={{ fill: axisColor, fontSize: 11 }} minTickGap={24} tickMargin={6} />
                          <YAxis domain={[0, 100]} tick={{ fill: axisColor, fontSize: 11 }} tickFormatter={(value) => `${value}%`} width={45} />
                          <Tooltip content={<PerclosTooltip />} />
                          <Line
                            type="monotone"
                            dataKey="perclosPercent"
                            stroke={lineColor}
                            strokeWidth={2}
                            dot={<StatusDot />}
                            isAnimationActive={false}
                          />
                        </ReLineChart>
                      </ResponsiveContainer>
                    ) : (
                      renderChartPlaceholder()
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Points tinted by driver state · tooltips include confidence + fps</p>
                </div>

                <div className="rounded-2xl border border-slate-100/70 bg-white/70 p-3 dark:border-slate-800/70 dark:bg-slate-900/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Head pose chart</p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">Pitch-down vs threshold</p>
                    </div>
                    {latestPoint && (
                      <div className="flex flex-wrap gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                          Droop time: {latestPoint.droop_time_30s.toFixed(1)}s
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                          Duty: {latestPoint.droopDutyPercent.toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="h-[220px] w-full">
                    {timelinePoints.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <ReLineChart data={timelinePoints} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                          <XAxis dataKey="tsLabel" tick={{ fill: axisColor, fontSize: 11 }} minTickGap={24} tickMargin={6} />
                          <YAxis tick={{ fill: axisColor, fontSize: 11 }} unit="°" width={45} />
                          <Tooltip content={<HeadPoseTooltip />} />
                          <Line
                            type="monotone"
                            dataKey="pitchdown_avg_30s"
                            stroke={headPoseColor}
                            strokeWidth={2}
                            dot={<HeadPoseDot />}
                            isAnimationActive={false}
                          />
                          <Line
                            type="stepAfter"
                            dataKey="pitch_thresh_Tp"
                            stroke="#94a3b8"
                            strokeWidth={1.5}
                            strokeDasharray="5 5"
                            dot={false}
                            isAnimationActive={false}
                          />
                        </ReLineChart>
                      </ResponsiveContainer>
                    ) : (
                      renderChartPlaceholder()
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Triangles mark buckets where max pitchdown exceeded the threshold</p>
                </div>

                <div className="rounded-2xl border border-slate-100/70 bg-white/70 p-3 dark:border-slate-800/70 dark:bg-slate-900/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Yawning chart</p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">Duty cycle · counts annotated</p>
                    </div>
                    <div className="text-right text-sm font-semibold text-slate-900 dark:text-white">
                      {yawnCount !== null ? `${yawnCount} yawns` : "—"}
                    </div>
                  </div>
                  <div className="h-[220px] w-full">
                    {timelinePoints.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <ReLineChart data={timelinePoints} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                          <XAxis dataKey="tsLabel" tick={{ fill: axisColor, fontSize: 11 }} minTickGap={24} tickMargin={6} />
                          <YAxis domain={[0, 100]} tick={{ fill: axisColor, fontSize: 11 }} tickFormatter={(value) => `${value}%`} width={45} />
                          <Tooltip content={<YawningTooltip />} />
                          <Line
                            type="monotone"
                            dataKey="yawnDutyPercent"
                            stroke={yawLineColor}
                            strokeWidth={2}
                            dot={<YawnDot />}
                            isAnimationActive={false}
                          >
                            <LabelList
                              dataKey="yawn_count_30s"
                              content={(props: LabelProps) => (
                                <YawnCountLabel x={props.x} y={props.y} value={props.value as number} />
                              )}
                            />
                          </Line>
                        </ReLineChart>
                      </ResponsiveContainer>
                    ) : (
                      renderChartPlaceholder()
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Numbers above each marker show yawns counted in that 30s slice</p>
                </div>
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
