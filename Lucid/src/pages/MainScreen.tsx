import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from "react-leaflet";
import { useNavigate } from "react-router-dom";
import { useStore } from "../state/store";
import { useMemo } from "react";
import { computeStatus, statusToColor } from "../lib/status";
import { useDarkMode } from "../context/DarkModeContext";
import { AlertCircle, AlertTriangle, CheckCircle } from "../components/icons";

type CityMarker = { name: string; coords: [number, number] };

const CITY_MARKERS: CityMarker[] = [
  { name: "Savannah, GA", coords: [32.0809, -81.0912] },
  { name: "Atlanta, GA", coords: [33.749, -84.388] },
  { name: "New York City, NY", coords: [40.7128, -74.006] },
  { name: "Dallas, TX", coords: [32.7767, -96.797] },
  { name: "Los Angeles, CA", coords: [34.0522, -118.2437] },
  { name: "Seattle, WA", coords: [47.6062, -122.3321] },
  { name: "Salt Lake City, UT", coords: [40.7608, -111.891] },
  { name: "Chicago, IL", coords: [41.8781, -87.6298] },
];

const MAJOR_ROUTES: [number, number][][] = [
  [
    [32.0809, -81.0912],
    [32.2833, -81.2354],
    [32.6570, -81.7504],
    [32.8890, -82.4108],
    [32.8407, -83.6324],
    [33.1754, -83.9389],
    [33.4471, -84.1469],
    [33.7490, -84.3880],
  ],
  [
    [32.0809, -81.0912],
    [32.7765, -79.9311],
    [34.0007, -81.0348],
    [35.2271, -80.8431],
    [36.0726, -79.7920],
    [38.9072, -77.0369],
    [39.9526, -75.1652],
    [40.7128, -74.0060],
  ],
  [
    [33.7490, -84.3880],
    [35.0456, -85.3097],
    [36.1627, -86.7816],
    [38.2527, -85.7585],
    [39.7684, -86.1581],
    [41.8781, -87.6298],
  ],
  [
    [33.7490, -84.3880],
    [33.5207, -86.8025],
    [32.2988, -90.1848],
    [32.5252, -93.7502],
    [32.7767, -96.7970],
  ],
  [
    [32.7767, -96.7970],
    [34.0526, -97.1303],
    [34.7304, -96.6783],
    [35.2220, -97.4395],
    [36.1539, -95.9928],
    [37.0902, -94.5120],
    [38.6270, -90.1994],
    [39.7817, -89.6501],
    [41.8781, -87.6298],
  ],
  [
    [32.7767, -96.7970],
    [32.4487, -99.7331],
    [31.9973, -102.0779],
    [31.7619, -106.4850],
    [32.2226, -110.9747],
    [33.4484, -112.0740],
    [33.9533, -117.3960],
    [34.0522, -118.2437],
  ],
  [
    [40.7128, -74.0060],
    [40.4397, -79.9959],
    [41.4810, -81.7982],
    [41.5048, -87.7582],
    [41.8781, -87.6298],
  ],
  [
    [41.8781, -87.6298],
    [41.2590, -95.9378],
    [41.1400, -104.8202],
    [40.7608, -111.8910],
  ],
  [
    [32.7767, -96.7970],
    [35.2210, -101.8313],
    [35.0844, -106.6504],
    [38.5733, -109.5498],
    [40.7608, -111.8910],
  ],
  [
    [40.7608, -111.8910],
    [40.2338, -111.6585],
    [37.0965, -113.5684],
    [36.1699, -115.1398],
    [34.8958, -117.0173],
    [34.0522, -118.2437],
  ],
  [
    [34.0522, -118.2437],
    [35.3733, -119.0187],
    [36.7378, -119.7871],
    [38.5816, -121.4944],
    [40.5865, -122.3917],
    [42.3265, -122.8756],
    [45.5152, -122.6784],
    [47.6062, -122.3321],
  ],
  [
    [40.7608, -111.8910],
    [41.2230, -111.9738],
    [43.6150, -116.2023],
    [45.6721, -118.7886],
    [47.6588, -117.4260],
    [47.6062, -122.3321],
  ],
];

export default function MainScreen() {
  const navigate = useNavigate();
  const trucks = useStore((s) => s.trucks);
  const telemetryByTruckId = useStore((s) => s.telemetryByTruckId);
  const alerts = useStore((s) => s.alerts);
  const thresholds = useStore((s) => s.thresholds);
  const { darkMode } = useDarkMode();
  const cityColor = "#06b6d4";

  const totals = useMemo(() => {
    const totalTrucks = trucks.length;
    const activeAlerts = alerts.filter((a) => a.status !== "OK").length;
    const criticalAlerts = alerts.filter((a) => a.status === "ASLEEP").length;
    const flaggedSet = new Set(alerts.filter((a) => a.status !== "OK").map((a) => a.truckId));
    const percentFlagged = totalTrucks ? Math.round((flaggedSet.size / totalTrucks) * 100) : 0;
    return { totalTrucks, activeAlerts, criticalAlerts, percentFlagged };
  }, [trucks, alerts]);

  const activeAlerts = useMemo(() => alerts.filter((a) => a.status !== "OK"), [alerts]);
  const readinessScore = Math.max(0, 100 - totals.percentFlagged);

  const getStatusBadge = (status: string) => {
    const baseClasses =
      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide shadow-sm ring-1 ring-inset";
    if (status === "ASLEEP") {
      return (
        <span
          className={`${baseClasses} bg-gradient-to-r from-rose-500 to-orange-500 text-white ring-white/10`}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          Critical
        </span>
      );
    }
    if (status === "DROWSY_SOON") {
      return (
        <span
          className={`${baseClasses} bg-amber-100/80 text-amber-900 ring-amber-300/60 dark:bg-amber-400/10 dark:text-amber-200`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Warning
        </span>
      );
    }
    return (
      <span
        className={`${baseClasses} bg-emerald-100/90 text-emerald-900 ring-emerald-300/70 dark:bg-emerald-400/10 dark:text-emerald-200`}
      >
        <CheckCircle className="w-3.5 h-3.5" />
        Lucid
      </span>
    );
  };

  // Get truck status for color coding on map
  const getTruckStatus = (truckId: string) => {
    if (!thresholds) return "OK";
    const history = telemetryByTruckId[truckId] || [];
    const latest = history[history.length - 1];
    return computeStatus(latest, history, thresholds);
  };

  return (
    <div className="fixed inset-0">
      {/* Base Layer: Full-screen Map */}
      <div className="absolute inset-0 z-0" style={{ paddingTop: "var(--app-header-height, 96px)" }}>
        <MapContainer
          center={[39.5, -80]}
          zoom={4}
          minZoom={4}
          className="h-full w-full"
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url={darkMode 
            ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          }
        />
          {CITY_MARKERS.map((city) => (
            <CircleMarker
              key={city.name}
              center={city.coords}
              radius={4}
              pathOptions={{
                color: cityColor,
                fillColor: cityColor,
                fillOpacity: 0.75,
                weight: 2,
              }}
              interactive={false}
            >
              <Tooltip permanent direction="right" offset={[6, 0]} className="city-label">
                <span>{city.name}</span>
              </Tooltip>
            </CircleMarker>
          ))}
          {MAJOR_ROUTES.map((route, idx) => (
            <Polyline
              key={`route-${idx}`}
              positions={route}
              pathOptions={{
                color: "#06b6d4",
                weight: 3.5,
                opacity: 0.5,
                lineCap: "round",
              }}
            />
          ))}
          {trucks.map((t) => {
            const latest = telemetryByTruckId[t.id]?.slice(-1)[0];
            if (!latest) return null;
            const status = getTruckStatus(t.id);
            const color = statusToColor(status);
            return (
              <CircleMarker
                key={t.id}
                center={[latest.lat, latest.lng]}
                radius={8}
                pathOptions={{ 
                  color: color, 
                  fillColor: color, 
                  fillOpacity: 0.8,
                  weight: 2
                }}
                eventHandlers={{ click: () => navigate(`/truck/${t.id}`) }}
              />
            );
          })}
          {trucks.map((t) => {
            const hist = telemetryByTruckId[t.id] || [];
            if (hist.length < 2) return null;
            const points = hist.map(p => [p.lat, p.lng]) as [number, number][];
            return <Polyline key={t.id + "-line"} positions={points} pathOptions={{ color: "#93c5fd", weight: 2, opacity: 0.6 }} />;
          })}
        </MapContainer>
      </div>

      {/* Overlay Layer: Right Pane with Frosted Glass */}
      <div 
        className="fixed right-0 top-0 w-1/3 h-full z-10 border-l border-white/20 dark:border-gray-700/30 bg-white/20 dark:bg-gray-900/20 backdrop-blur-2xl shadow-2xl"
        style={{ paddingTop: "var(--app-header-height, 96px)" }}
      >
        <div className="h-full overflow-y-auto px-6 py-6 space-y-6">
          {/* Header Section */}
          <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-8">
            <div className="text-center">
              <p className="text-xs uppercase tracking-[0.4em] text-gray-500 dark:text-gray-400">Mission Control</p>
              <h1 className="mt-2 text-4xl font-bold text-gray-900 dark:text-white">Fleet Overview</h1>
              <p className="mt-3 text-lg text-gray-600 dark:text-gray-300">Monitor your fleet in real-time</p>
            </div>
          </section>

          {/* Hero Stats */}
          <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Fleet Overview</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500"></span>
                <span className="text-sm text-gray-600 dark:text-gray-300">Live</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-600">
                <p className="text-sm text-slate-600 dark:text-slate-300">Active Trucks</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{totals.totalTrucks}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-600">
                <p className="text-sm text-slate-600 dark:text-slate-300">Active Alerts</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{totals.activeAlerts}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-600">
                <p className="text-sm text-slate-600 dark:text-slate-300">Flagged</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{totals.percentFlagged}%</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-600">
                <p className="text-sm text-slate-600 dark:text-slate-300">Status</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{readinessScore}%</p>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
                <span>Fleet Status</span>
                <span>{readinessScore}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className="h-full bg-blue-600 rounded-full"
                  style={{ width: `${readinessScore}%` }}
                ></div>
              </div>
            </div>
          </section>

          {/* Active Alerts */}
          <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Active Alerts</h3>
              <span className="text-sm text-gray-600 dark:text-gray-300">{activeAlerts.length} open</span>
            </div>
            {activeAlerts.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-500" />
                <p className="text-sm">All drivers stable</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {activeAlerts.map((a) => {
                  const isCritical = a.status === "ASLEEP";
                  return (
                    <button
                      key={a.id}
                      onClick={() => navigate(`/truck/${a.truckId}`)}
                      className={`w-full rounded-lg border p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                        isCritical
                          ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
                          : "border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 text-xs font-medium rounded ${
                              isCritical 
                                ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" 
                                : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                            }`}>
                              {isCritical ? "Critical" : "Warning"}
                            </span>
                            <span className="text-sm font-medium text-gray-900 dark:text-white">Truck {a.truckId}</span>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{a.reason}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                            {a.secondsDrowsy}s • {new Date(a.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Fleet List */}
          <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">All Drivers</h3>
            </div>
            <div className="space-y-3">
              {trucks.map((t) => {
                const status = thresholds ? getTruckStatus(t.id) : "OK";
                const alert = activeAlerts.find((a) => a.truckId === t.id);
                const history = telemetryByTruckId[t.id] || [];
                const latest = history[history.length - 1];
                const perclosPercent = latest ? Math.round(latest.perclos * 100) : null;
                const statusColor = statusToColor(status);

                return (
                  <button
                    key={t.id}
                    onClick={() => navigate(`/truck/${t.id}`)}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: statusColor }}></span>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{t.driverName}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-300">{t.route.from} → {t.route.to}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        {getStatusBadge(alert?.status ?? status)}
                        {perclosPercent !== null && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{perclosPercent}% fatigue</p>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
