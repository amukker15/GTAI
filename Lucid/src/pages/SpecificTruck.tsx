// src/pages/TruckDetail.tsx
import { Link, useParams } from "react-router-dom";
import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import type { LatLngTuple } from "leaflet";
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
import type { Telemetry, Thresholds } from "../lib/types";

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

  // Local UI state
  const [showThresholds, setShowThresholds] = useState(false);
  const [thLocal, setThLocal] = useState<Thresholds | null>(thresholds);
  const saveThresholds = useStore((s) => s.saveThresholds);

  const history: Telemetry[] = telemetryByTruckId[truckId] || [];
  const latest = history[history.length - 1];

  // Fallback center if no data yet (US center)
  const center: LatLngTuple = latest ? [latest.lat, latest.lng] : [39.5, -98.35];

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
  const statusText = useMemo(() => {
    if (!thresholds) return "OK";
    return computeStatus(latest, history, thresholds);
  }, [latest, history, thresholds]);

  // Handlers
  const onSaveThresholds = async () => {
    if (!thLocal) return;
    await saveThresholds(thLocal);
    setShowThresholds(false);
  };

  return (
    <div className="page">
      {/* Top bar */}
      <div className="mb-4 flex items-center justify-between">
        <Link to="/" className="text-blue-600 underline">🏠 Home</Link>
        <div className="text-sm text-gray-600">Truck: {truckId}</div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top-left: local map with colored segments */}
        <div className="card lg:col-span-1 h-[40vh]">
          <div className="card-h flex items-center justify-between">
            <span className="font-semibold">Local Map & Route</span>
            <button
              onClick={() => setShowThresholds(true)}
              className="px-2 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200"
            >
              Edit thresholds
            </button>
          </div>
          <div className="card-b h-full">
            <MapContainer
              center={center}
              zoom={10}
              className="h-full rounded-lg"
              scrollWheelZoom
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors"
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
        </div>

        {/* Top-right: chart + toggles + status */}
        <div className="card lg:col-span-2 h-[56vh]">
          <div className="card-h font-semibold">Signals</div>
          <div className="card-b h-full flex flex-col gap-3">
            {/* Variable toggles */}
            <div className="flex flex-wrap gap-2">
              {Object.keys(VAR_LABEL).map((k) => {
                const key = k as VarKey;
                const active = selectedVar === key;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedVar(key)}
                    className={`px-3 py-1 rounded border text-sm ${
                      active ? "bg-blue-600 text-white border-blue-600" : "bg-white hover:bg-gray-50"
                    }`}
                  >
                    {VAR_LABEL[key]}
                  </button>
                );
              })}
            </div>

            {/* Chart */}
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
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
                  <Brush height={20} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Status box + Long-term link */}
            <div className="flex items-center justify-between">
              <div
                className="px-3 py-2 rounded font-medium"
                style={{ backgroundColor: statusToColor(statusText as any), color: "white" }}
              >
                Status: {statusText}
              </div>
              <Link
                to={`/long-term/${truckId}`}
                className="px-3 py-2 rounded bg-blue-600 text-white"
              >
                Long-term data →
              </Link>
            </div>
          </div>
        </div>

        {/* Bottom-left: live driver feed placeholder */}
        <div className="card lg:col-span-1 h-[40vh]">
          <div className="card-h font-semibold">Live Driver Feed</div>
          <div className="card-b h-full flex items-center justify-center">
            <div className="w-full h-full border-2 border-dashed rounded flex items-center justify-center text-gray-500">
              ▶ Live feed (placeholder)
            </div>
          </div>
        </div>

        {/* Bottom-right: alert history for this trip */}
        <div className="card lg:col-span-2 h-[28vh]">
          <div className="card-h font-semibold">Alert History (this trip)</div>
          <div className="card-b h-full overflow-auto space-y-2">
            {truckAlerts.length === 0 && <div className="text-gray-500">No alerts for this truck.</div>}
            {truckAlerts.map((a) => (
              <div key={a.id} className="p-3 rounded border">
                <div className="font-semibold">{a.status}</div>
                <div className="text-sm text-gray-600">
                  {new Date(a.startedAt).toLocaleTimeString()} • Drowsy for {a.secondsDrowsy}s • {a.reason}
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
