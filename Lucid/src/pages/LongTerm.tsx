// src/pages/LongTerm.tsx
import { Link, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { fetchLongTermMetrics, type LongTermMetrics, type VarKey } from "../api/snowflake.ts";

export default function LongTerm() {
  const { truckId = "" } = useParams();
  const [from, setFrom] = useState<string>(() => isoDateOffset(-30));
  const [to, setTo] = useState<string>(() => isoDateOffset(0));

  const [data, setData] = useState<LongTermMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const d = await fetchLongTermMetrics(truckId, from + "T00:00:00Z", to + "T23:59:59Z");
        if (!cancelled) setData(d);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load analytics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [truckId, from, to]);

  const barData = useMemo(() => {
    if (!data) return [];
    return data.trips.map(t => ({
      trip: t.tripId,
      perclos: t.hoursToThreshold.perclos,
      headDownDegrees: t.hoursToThreshold.headDownDegrees,
      yawnCount30s: t.hoursToThreshold.yawnCount30s,
      heartRate: t.hoursToThreshold.heartRate,
      hrvRmssd: t.hoursToThreshold.hrvRmssd,
    }));
  }, [data]);

  return (
    <div className="page" style={{ marginTop: "var(--app-header-height, 96px)" }}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <Link to={`/truck/${truckId}`} className="text-blue-600 underline">← Back to Truck</Link>
        <div className="font-semibold">Long-term Analytics</div>
        <div className="text-sm text-gray-600">Truck: {truckId}</div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <div className="text-gray-600 mb-1">From</div>
          <input
            type="date"
            className="border rounded px-2 py-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <div className="text-gray-600 mb-1">To</div>
          <input
            type="date"
            className="border rounded px-2 py-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>

      {loading && <div className="text-gray-600">Loading analytics…</div>}
      {err && <div className="text-red-600">{err}</div>}
      {!loading && !err && data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Card 1: Time-to-threshold by trip (grouped bars) */}
          <div className="card lg:col-span-2 h-[42vh]">
            <div className="card-h font-semibold">Time-to-threshold by trip (hours)</div>
            <div className="card-b h-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="trip" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="perclos" name="PERCLOS" />
                  <Bar dataKey="headDownDegrees" name="Head Down (°)" />
                  <Bar dataKey="yawnCount30s" name="Yawns/30s" />
                  <Bar dataKey="heartRate" name="Heart Rate" />
                  <Bar dataKey="hrvRmssd" name="HRV RMSSD" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Card 2: Correlation “heat map” */}
          <div className="card lg:col-span-1 h-[42vh]">
            <div className="card-h font-semibold">Correlation matrix</div>
            <div className="card-b h-full overflow-auto">
              <CorrelationGrid
                rows={["perclos","headDownDegrees","yawnCount30s","heartRate","hrvRmssd"]}
                cols={["perclos","headDownDegrees","yawnCount30s","heartRate","hrvRmssd"]}
                data={data.correlations}
              />
              <div className="text-xs text-gray-500 mt-2">r ∈ [-1, 1] (blue = negative, red = positive)</div>
            </div>
          </div>

          {/* Card 3: Average risk vs hour-of-shift */}
          <div className="card lg:col-span-3 h-[36vh]">
            <div className="card-h font-semibold">Average risk vs hour of shift</div>
            <div className="card-b h-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.avgRiskByHour}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hour" />
                  <YAxis domain={[0, 1]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="risk" stroke="#2563eb" dot={false} strokeWidth={2} isAnimationActive={false}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Simple heat map rendered with a CSS grid */
function CorrelationGrid({
  rows,
  cols,
  data,
}: {
  rows: VarKey[];
  cols: VarKey[];
  data: { a: VarKey; b: VarKey; r: number }[];
}) {
  const lookup = new Map<string, number>();
  data.forEach((c) => lookup.set(`${c.a}|${c.b}`, c.r));

  return (
    <div className="inline-block">
      <div className="grid" style={{ gridTemplateColumns: `140px repeat(${cols.length}, 60px)` }}>
        {/* header row */}
        <div />
        {cols.map((c) => (
          <div key={"h-" + c} className="text-xs font-medium text-center">{label(c)}</div>
        ))}
        {/* rows */}
        {rows.map((r) => (
          <>
            <div key={"row-" + r} className="text-xs font-medium pr-2 py-1">{label(r)}</div>
            {cols.map((c) => {
              const v = lookup.get(`${r}|${c}`) ?? 0;
              const color = corrColor(v);
              return (
                <div
                  key={`${r}|${c}`}
                  className="h-[32px] w-[60px] flex items-center justify-center text-xs rounded"
                  style={{ backgroundColor: color.bg, color: color.fg }}
                  title={`r=${v.toFixed(2)}`}
                >
                  {v.toFixed(2)}
                </div>
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
}

function corrColor(r: number) {
  // map [-1..1] -> blue..white..red
  const clamp = (x: number) => Math.max(-1, Math.min(1, x));
  r = clamp(r);
  // simple lerp between blue(0,102,204) and white(255,255,255) and red(239,68,68)
  if (r < 0) {
    const t = Math.abs(r);
    const R = Math.round(255 * (1 - t) + 0 * t);
    const G = Math.round(255 * (1 - t) + 102 * t);
    const B = Math.round(255 * (1 - t) + 204 * t);
    return { bg: `rgb(${R},${G},${B})`, fg: t > 0.6 ? "white" : "black" };
  } else {
    const t = r;
    const R = Math.round(255 * (1 - t) + 239 * t);
    const G = Math.round(255 * (1 - t) + 68 * t);
    const B = Math.round(255 * (1 - t) + 68 * t);
    return { bg: `rgb(${R},${G},${B})`, fg: t > 0.6 ? "white" : "black" };
  }
}

function label(k: VarKey) {
  switch (k) {
    case "perclos": return "PERCLOS";
    case "headDownDegrees": return "Head Down (°)";
    case "yawnCount30s": return "Yawns/30s";
    case "heartRate": return "Heart Rate";
    case "hrvRmssd": return "HRV RMSSD";
  }
}

function isoDateOffset(daysFromToday: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}
