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
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  fetchRouteAnalytics,
  type RouteAnalyticsRow,
  type RouteAnalyticsResponse,
} from "../api/snowflake";
import { getRouteById } from "../api/referenceData";

type RouteOption = { label: string; value: string };

export default function RouteAnalysis() {
  const { truckId } = useParams();
  const [from, setFrom] = useState(() => isoDateOffset(-14));
  const [to, setTo] = useState(() => isoDateOffset(0));
  const [dataset, setDataset] = useState<RouteAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetchRouteAnalytics({
          start: `${from}T00:00:00Z`,
          end: `${to}T23:59:59Z`,
          includeNarrative: true,
        });
        if (!cancelled) {
          setDataset(res);
          setSelectedRoute(res.routes[0]?.routeId ?? null);
        }
      } catch (error: any) {
        if (!cancelled) {
          setErr(error?.message ?? "Unable to reach Snowflake route analytics.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const routes = dataset?.routes ?? [];
  const chartData = useMemo(
    () =>
      routes.map((route) => ({
        route: route.routeId,
        avgRisk: Number((route.avgRisk ?? 0).toFixed(1)),
        drowsyValue: (route.drowsyRate ?? 0) * 100,
        asleepValue: (route.asleepRate ?? 0) * 100,
      })),
    [routes]
  );

  const selectedDetails = useMemo(() => {
    return routes.find((r) => r.routeId === selectedRoute) ?? null;
  }, [routes, selectedRoute]);

  const routeOptions = useMemo<RouteOption[]>(() => {
    return routes.map((route) => {
      const id = route.routeId;
      const meta = getRouteById(id);
      return {
        value: id,
        label: meta ? `${meta.from} → ${meta.to}` : id,
      };
    });
  }, [routes]);

  const highlightCards = useMemo(() => buildHighlightCards(routes), [routes]);

  return (
    <div className="page pt-0 pb-12 space-y-6" style={{ marginTop: "var(--app-header-height, 96px)" }}>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm p-8">
        <div className="text-center space-y-3">
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500 dark:text-gray-400">Snowflake Route Intelligence</p>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">Route Analysis</h1>
          <p className="text-base text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Snowflake crunches every 30-second vigilance window, then Snowflake Cortex explains what operations should do next.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200/70 dark:border-gray-700 bg-white/90 dark:bg-gray-900/70 shadow-xl backdrop-blur px-6 py-5 space-y-5">
        <div className="flex flex-wrap items-center gap-4 justify-between">
          {truckId ? (
            <Link
              to={`/truck/${truckId}`}
              className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-300 hover:text-blue-500 dark:hover:text-blue-200"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/40">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </span>
              Back to driver {truckId}
            </Link>
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Select any route below to inspect Cortex recommendations.
            </div>
          )}
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Generated {dataset?.generatedAt ? new Date(dataset.generatedAt).toLocaleString() : "—"}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <DateInput label="From date" value={from} onChange={setFrom} />
          <DateInput label="To date" value={to} onChange={setTo} />
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Focus route</label>
            <select
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              value={selectedRoute ?? ""}
              onChange={(e) => setSelectedRoute(e.target.value || null)}
            >
              <option value="">All routes</option>
              {routeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading && <LoadingState />}
      {err && <ErrorCallout message={err} />}

      {!loading && !err && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {highlightCards.map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-5"
              >
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{card.title}</p>
                <p className="mt-2 text-3xl font-semibold text-gray-900 dark:text-white">{card.value}</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{card.helper}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <div className="xl:col-span-2 card h-[420px]">
              <div className="card-h font-semibold">Avg risk vs fatigue rate</div>
              <div className="card-b h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="route" />
                    <YAxis yAxisId="left" label={{ value: "Risk (0-100)", angle: -90, position: "insideLeft" }} />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tickFormatter={(v) => `${v}%`}
                      label={{ value: "Fatigue %", angle: 90, position: "insideRight" }}
                    />
                    <Tooltip
                      formatter={(value: number, key) => {
                        if (key === "avgRisk") {
                          return [`${value.toFixed(1)} risk`, "Avg Risk"];
                        }
                        return [`${value.toFixed(1)}%`, key === "drowsyValue" ? "Drowsy pct" : "Asleep pct"];
                      }}
                    />
                    <Legend />
                    <Bar yAxisId="left" dataKey="avgRisk" name="Avg Risk" fill="#2563eb" />
                    <Bar yAxisId="right" dataKey="drowsyValue" name="Drowsy %" fill="#f97316" />
                    <Bar yAxisId="right" dataKey="asleepValue" name="Asleep %" fill="#dc2626" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card h-[420px]">
              <div className="card-h font-semibold flex items-center justify-between">
                <span>Route insight</span>
                {selectedDetails && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {selectedDetails.routeId}
                  </span>
                )}
              </div>
              <div className="card-b space-y-4 overflow-y-auto">
                {selectedDetails ? (
                  <>
                    <InsightRow label="Avg risk" value={`${(selectedDetails.avgRisk ?? 0).toFixed(1)}`} />
                    <InsightRow label="Drowsy windows" value={percent(selectedDetails.drowsyRate ?? 0)} />
                    <InsightRow label="Asleep windows" value={percent(selectedDetails.asleepRate ?? 0)} />
                    <InsightRow label="Nighttime driving" value={percent(selectedDetails.nighttimeProportion ?? 0)} />
                    <InsightRow label="Rest stops / 100 km" value={formatNumber(selectedDetails.restStopsPer100km)} />
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3 text-sm text-gray-700 dark:text-gray-200">
                      {selectedDetails.cortexSummary ?? "Snowflake Cortex did not return a summary for this route."}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Select a route to see AI recommendations.</p>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-h font-semibold">Route table</div>
            <div className="card-b overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                    <th className="py-2">Route</th>
                    <th className="py-2">Avg risk</th>
                    <th className="py-2">Drowsy %</th>
                    <th className="py-2">Asleep %</th>
                    <th className="py-2">Rest stops</th>
                    <th className="py-2">Night %</th>
                    <th className="py-2">Windows</th>
                    <th className="py-2">Riskiest window</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => {
                    const id = route.routeId;
                    const isActive = id === selectedRoute;
                    return (
                      <tr
                        key={id}
                        onClick={() => setSelectedRoute(id)}
                        className={`border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50/40 dark:hover:bg-blue-900/20 cursor-pointer ${
                          isActive ? "bg-blue-50/50 dark:bg-blue-900/30" : ""
                        }`}
                      >
                        <td className="py-2 font-medium text-gray-900 dark:text-white">{id}</td>
                        <td className="py-2">{(route.avgRisk ?? 0).toFixed(1)}</td>
                        <td className="py-2">{percent(route.drowsyRate ?? 0)}</td>
                        <td className="py-2">{percent(route.asleepRate ?? 0)}</td>
                        <td className="py-2">{formatNumber(route.restStopsPer100km)}</td>
                        <td className="py-2">{percent(route.nighttimeProportion ?? 0)}</td>
                        <td className="py-2">{route.windowCount ?? 0}</td>
                        <td className="py-2 text-xs text-gray-500 dark:text-gray-400">
                          {route.riskiestTs
                            ? new Date(route.riskiestTs).toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function buildHighlightCards(routes: RouteAnalyticsRow[]) {
  if (!routes.length) return [
    { title: "Highest risk route", value: "—", helper: "Waiting for Snowflake data" },
    { title: "Most night driving", value: "—", helper: "Waiting for Snowflake data" },
    { title: "Rest-stop gap", value: "—", helper: "Waiting for Snowflake data" },
  ];

  const byRisk = [...routes].sort((a, b) => (b.avgRisk ?? 0) - (a.avgRisk ?? 0));
  const byNight = [...routes].sort((a, b) => (b.nighttimeProportion ?? 0) - (a.nighttimeProportion ?? 0));
  const restGap = [...routes].sort((a, b) => {
    const density = (a.restStopsPer100km ?? 0) - (b.restStopsPer100km ?? 0);
    return density;
  });

  return [
    {
      title: "Highest avg risk",
      value: `${byRisk[0].routeId} · ${(byRisk[0].avgRisk ?? 0).toFixed(1)}`,
      helper: `${percent(byRisk[0].asleepRate ?? 0)} asleep buckets`,
    },
    {
      title: "Most night driving",
      value: `${byNight[0].routeId} · ${percent(byNight[0].nighttimeProportion ?? 0)}`,
      helper: "Prioritize earlier dispatch",
    },
    {
      title: "Rest-stop gap",
      value: `${restGap[0].routeId} · ${formatNumber(restGap[0].restStopsPer100km)} stops`,
      helper: `${percent(restGap[0].drowsyRate ?? 0)} drowsy rate`,
    },
  ];
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | undefined | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(1);
}

function isoDateOffset(daysFromToday: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{label}</label>
      <input
        type="date"
        className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-semibold text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-blue-600 mb-4"></div>
        <p className="text-gray-600 dark:text-gray-400 font-medium">Loading route intelligence...</p>
      </div>
    </div>
  );
}

function ErrorCallout({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6">
      <div className="flex items-center gap-3">
        <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-red-800 dark:text-red-200 font-medium">{message}</p>
      </div>
    </div>
  );
}
