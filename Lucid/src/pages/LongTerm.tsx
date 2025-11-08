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

  const cardClass =
    "rounded-2xl border border-gray-200/70 dark:border-gray-700 bg-white/90 dark:bg-gray-900/70 shadow-xl backdrop-blur flex flex-col";
  const cardHeaderClass =
    "flex items-center justify-between px-5 py-4 border-b border-gray-100/60 dark:border-gray-800";
  const cardBodyClass = "flex-1 px-5 py-4";

  return (
    <div
      className="page pt-0 pb-10 space-y-6"
      style={{ marginTop: "var(--app-header-height, 96px)" }}
    >
      {/* Header matching SpecificTruck style */}
      <div className="rounded-2xl border border-gray-200/70 dark:border-gray-700 bg-white/90 dark:bg-gray-900/70 shadow-xl backdrop-blur px-6 py-5">
        <div className="flex flex-wrap items-center gap-5 justify-between">
          <Link
            to={`/truck/${truckId}`}
            className="flex items-center gap-3 text-blue-600 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-200 transition-colors"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/40">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </span>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Back to driver</div>
              <div className="text-base font-semibold">Live View</div>
            </div>
          </Link>
          <div className="flex-1 min-w-[200px] text-center">
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Truck ID</div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-white">{truckId}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">Long-term Analytics</div>
          </div>
        </div>

        {/* Date Range Filters */}
        <div className="mt-5 pt-5 border-t border-gray-100/60 dark:border-gray-800">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">From Date</span>
                <input
                  type="date"
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">To Date</span>
                <input
                  type="date"
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm text-gray-600 dark:text-gray-300 font-medium">
                {Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24))} days
              </span>
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-blue-600 mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400 font-medium">Loading analytics data...</p>
          </div>
        </div>
      )}
      {err && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-800 dark:text-red-200 font-medium">{err}</p>
          </div>
        </div>
      )}
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
