// src/pages/TruckDetail.tsx
import { Link, useParams } from "react-router-dom";
import { useMemo, useState } from "react";
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
import type { Telemetry, Thresholds } from "../lib/types";
import { useDarkMode } from "../context/DarkModeContext";
import { Home } from "../components/icons";

type VarKey = "perclos" | "headDownDegrees" | "yawnCount30s" | "heartRate" | "hrvRmssd";

const VAR_LABEL: Record<VarKey, string> = {
  perclos: "PERCLOS",
  headDownDegrees: "Head Down (°)",
  yawnCount30s: "Yawns/30s",
  heartRate: "Heart Rate (bpm)",
  hrvRmssd: "HRV RMSSD (ms)",
};

export default function TruckDetail() {
  const { truckId = "" } = useParams();
  const telemetryByTruckId = useStore((s) => s.telemetryByTruckId);
  const allAlerts = useStore((s) => s.alerts);
  const thresholds = useStore((s) => s.thresholds) as Thresholds | null;
  const selectedVar = useStore((s) => s.selectedVar);
  const setSelectedVar = useStore((s) => s.setSelectedVar);
  const { darkMode } = useDarkMode();

  // Local UI state
  const [showThresholds, setShowThresholds] = useState(false);
  const [thLocal, setThLocal] = useState<Thresholds | null>(thresholds);
  const saveThresholds = useStore((s) => s.saveThresholds);

  const history: Telemetry[] = telemetryByTruckId[truckId] || [];
  const latest = history[history.length - 1];

  // Fallback center if no data yet (US center)
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

  // Build chart data
  const chartData = useMemo(
    () =>
      history.map((h) => ({
        time: new Date(h.timestamp).toLocaleTimeString(),
        perclos: Number(h.perclos.toFixed(3)),
        headDownDegrees: h.headDownDegrees,
        yawnCount30s: h.yawnCount30s,
        heartRate: h.heartRate,
        hrvRmssd: h.hrvRmssd,
      })),
    [history]
  );

  // Color route segments by status (compute with small rolling window)
  const coloredSegments = useMemo(() => {
    if (!thresholds || history.length < 2) return [];
    const segs: { pts: LatLngTuple[]; color: string; key: string }[] = [];
    // window of last 3 points for status
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

  // Filter alerts for this truck
  const truckAlerts = useMemo(
    () => allAlerts.filter((a) => a.truckId === truckId),
    [allAlerts, truckId]
  );

  // Status text
  const statusText = useMemo<DriverStatus>(() => {
    if (!thresholds) return "OK";
    return computeStatus(latest, history, thresholds);
  }, [latest, history, thresholds]);
  const statusColor = statusToColor(statusText);
  const mapTileUrl = darkMode
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  const cardClass =
    "rounded-2xl border border-gray-200/70 dark:border-gray-700 bg-white/90 dark:bg-gray-900/70 shadow-xl backdrop-blur flex flex-col";
  const cardHeaderClass =
    "flex items-center justify-between px-5 py-4 border-b border-gray-100/60 dark:border-gray-800";
  const cardBodyClass = "flex-1 px-5 py-4";

  // Handlers
  const onSaveThresholds = async () => {
    if (!thLocal) return;
    await saveThresholds(thLocal);
    setShowThresholds(false);
  };

  return (
    <div className="page pt-28 pb-10 space-y-6">
      <div className="rounded-2xl border border-gray-200/70 dark:border-gray-700 bg-white/90 dark:bg-gray-900/70 shadow-xl backdrop-blur px-6 py-5 flex flex-wrap items-center gap-5 justify-between">
        <Link
          to="/"
          className="flex items-center gap-3 text-blue-600 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-200 transition-colors"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/40">
            <Home className="w-5 h-5" />
          </span>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Back to fleet</div>
            <div className="text-base font-semibold">Overview</div>
          </div>
        </Link>
        <div className="flex-1 min-w-[200px] text-right">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Truck ID</div>
          <div className="text-2xl font-semibold text-gray-900 dark:text-white">{truckId}</div>
          {latest && (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Updated {new Date(latest.timestamp).toLocaleTimeString()}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Current status</span>
          <span
            className="px-4 py-2 rounded-full font-semibold text-sm text-white"
            style={{ backgroundColor: statusColor }}
          >
            {statusText}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className={`${cardClass} xl:col-span-1 min-h-[360px]`}>
          <div className={cardHeaderClass}>
            <span className="font-semibold">Driver Region View</span>
            <button
              onClick={() => setShowThresholds(true)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Edit thresholds
            </button>
          </div>
          <div className={`${cardBodyClass} pt-4`}>
            <div className="h-[280px] rounded-xl overflow-hidden ring-1 ring-gray-200/60 dark:ring-gray-800">
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
                    key={seg.key + "-" + idx}
                    positions={seg.pts}
                    pathOptions={{ color: seg.color, weight: 5, opacity: 0.9 }}
                  />
                ))}
              </MapContainer>
            </div>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              View is constrained to ~200 miles around the driver&apos;s latest position.
            </p>
          </div>
        </div>

        <div className={`${cardClass} xl:col-span-2 min-h-[420px]`}>
          <div className={cardHeaderClass}>
            <span className="font-semibold">Signals</span>
            <Link
              to={`/long-term/${truckId}`}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold shadow hover:bg-blue-500 transition-colors"
            >
              Long-term data →
            </Link>
          </div>
          <div className={`${cardBodyClass} flex flex-col gap-4`}>
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

            <div className="flex-1 min-h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.4)" />
                  <XAxis dataKey="time" minTickGap={30} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey={selectedVar}
                    stroke="#2563eb"
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                  <Brush height={24} travellerWidth={10} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className={`${cardClass} xl:col-span-1 min-h-[320px]`}>
          <div className={cardHeaderClass}>
            <span className="font-semibold">Live Driver Feed</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">Secure stream</span>
          </div>
          <div className={`${cardBodyClass} flex items-center justify-center`}>
            <div className="w-full h-[220px] rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-500 dark:text-gray-400 bg-gray-50/60 dark:bg-gray-800/30">
              Live video feed (coming soon)
            </div>
          </div>
        </div>

        <div className={`${cardClass} xl:col-span-2 min-h-[320px]`}>
          <div className={cardHeaderClass}>
            <span className="font-semibold">Alert History</span>
            <span className="text-sm text-gray-500 dark:text-gray-400">{truckAlerts.length} events</span>
          </div>
          <div className={`${cardBodyClass} space-y-3 overflow-auto`}>
            {truckAlerts.length === 0 && (
              <div className="text-gray-500 dark:text-gray-400">No alerts for this truck.</div>
            )}
            {truckAlerts.map((a) => (
              <div
                key={a.id}
                className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col gap-1"
                style={{ borderLeftWidth: 4, borderLeftColor: statusToColor(a.status) }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{a.status}</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {new Date(a.startedAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300">{a.reason}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Drowsy for {a.secondsDrowsy}s
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Thresholds drawer */}
      {showThresholds && (
        <div className="fixed inset-0 z-20">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowThresholds(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl p-4 overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Edit thresholds</h2>
              <button className="px-3 py-1 rounded bg-gray-100" onClick={() => setShowThresholds(false)}>
                ✕
              </button>
            </div>

            <ThresholdEditor
              initial={thresholds}
              onChange={setThLocal}
              values={thLocal}
            />

            <div className="mt-4 flex gap-2">
              <button
                className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                onClick={onSaveThresholds}
                disabled={!thLocal}
              >
                Save
              </button>
              <button
                className="px-3 py-2 rounded bg-gray-100"
                onClick={() => {
                  setThLocal(thresholds ?? null);
                  setShowThresholds(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small inline thresholds editor to avoid extra files */
function ThresholdEditor({
  initial,
  values,
  onChange,
}: {
  initial: Thresholds | null;
  values: Thresholds | null;
  onChange: (t: Thresholds | null) => void;
}) {
  const base: Thresholds =
    values ??
    initial ?? {
      perclosHigh: 0.4,
      headDownDegHigh: 25,
      yawnCountHigh: 3,
      hrLow: 50,
      hrvLow: 20,
      predictionWindowSec: [30, 120],
    };

  const set = <K extends keyof Thresholds>(k: K, v: Thresholds[K]) =>
    onChange({ ...base, [k]: v });

  return (
    <div className="grid grid-cols-2 gap-3">
      <Num label="PERCLOS high" value={base.perclosHigh} step={0.01} min={0} max={1}
        onChange={(v) => set("perclosHigh", v)} />
      <Num label="Head down deg high" value={base.headDownDegHigh} step={1} min={0} max={90}
        onChange={(v) => set("headDownDegHigh", v)} />
      <Num label="Yawns per 30s high" value={base.yawnCountHigh} step={1} min={0} max={10}
        onChange={(v) => set("yawnCountHigh", v)} />
      <Num label="HR low (bpm)" value={base.hrLow} step={1} min={20} max={120}
        onChange={(v) => set("hrLow", v)} />
      <Num label="HRV RMSSD low (ms)" value={base.hrvLow} step={1} min={1} max={100}
        onChange={(v) => set("hrvLow", v)} />
      <div className="col-span-2 grid grid-cols-2 gap-3">
        <Num label="Predict min (s)" value={base.predictionWindowSec[0]} step={5} min={10} max={300}
          onChange={(v) => set("predictionWindowSec", [v, base.predictionWindowSec[1]])} />
        <Num label="Predict max (s)" value={base.predictionWindowSec[1]} step={5} min={10} max={600}
          onChange={(v) => set("predictionWindowSec", [base.predictionWindowSec[0], v])} />
      </div>
    </div>
  );
}

function Num({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col text-sm gap-1">
      <span className="text-gray-600">{label}</span>
      <input
        type="number"
        className="border rounded px-2 py-1"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
