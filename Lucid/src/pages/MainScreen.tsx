import { MapContainer, TileLayer, CircleMarker, Polyline } from "react-leaflet";
import { useNavigate } from "react-router-dom";
import { useStore } from "../state/store";
import { useMemo } from "react";
import { computeStatus, statusToColor } from "../lib/status";
import { useDarkMode } from "../context/DarkModeContext";
import { AlertCircle, AlertTriangle, CheckCircle } from "lucide-react";

export default function MainScreen() {
  const navigate = useNavigate();
  const trucks = useStore((s) => s.trucks);
  const telemetryByTruckId = useStore((s) => s.telemetryByTruckId);
  const alerts = useStore((s) => s.alerts);
  const thresholds = useStore((s) => s.thresholds);
  const { darkMode } = useDarkMode();

  const totals = useMemo(() => {
    const totalTrucks = trucks.length;
    const activeAlerts = alerts.filter(a => a.status !== "OK").length;
    const criticalAlerts = alerts.filter(a => a.status === "ASLEEP").length;
    const flaggedSet = new Set(alerts.filter(a => a.status !== "OK").map(a => a.truckId));
    const percentFlagged = totalTrucks ? Math.round((flaggedSet.size / totalTrucks) * 100) : 0;
    return { totalTrucks, activeAlerts, criticalAlerts, percentFlagged };
  }, [trucks, alerts]);

  const getStatusBadge = (status: string) => {
    if (status === "ASLEEP") {
      return (
        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          CRITICAL
        </span>
      );
    }
    if (status === "DROWSY_SOON") {
      return (
        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          WARNING
        </span>
      );
    }
    return (
      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 flex items-center gap-1">
        <CheckCircle className="w-3 h-3" />
        OK
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
    <div className="fixed inset-0 flex pt-[73px]">
      {/* Left: Full-height Map */}
      <div className="w-2/3 h-full">
        <MapContainer
          center={[39.5, -98.35]}
          zoom={4}
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

      {/* Right: Info Sidebar */}
      <div className="w-1/3 h-full bg-gray-50 dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Hero Stats */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Fleet Overview</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totals.totalTrucks}</div>
                <div className="text-gray-600 dark:text-gray-400 text-xs mt-1">Active Trucks</div>
              </div>
              <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{totals.activeAlerts}</div>
                <div className="text-gray-600 dark:text-gray-400 text-xs mt-1">Active Alerts</div>
              </div>
              <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">{totals.criticalAlerts}</div>
                <div className="text-gray-600 dark:text-gray-400 text-xs mt-1">Critical</div>
              </div>
              <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{totals.percentFlagged}%</div>
                <div className="text-gray-600 dark:text-gray-400 text-xs mt-1">Flagged</div>
              </div>
            </div>
          </div>

          {/* Active Alerts */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Active Alerts</h2>
              {alerts.filter(a => a.status !== "OK").length > 0 && (
                <div className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </div>
              )}
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 max-h-64 overflow-y-auto">
              {alerts.filter(a => a.status !== "OK").length === 0 ? (
                <div className="text-center py-8 text-gray-400 dark:text-gray-500">
                  <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
                  <div className="text-sm">All drivers safe</div>
                </div>
              ) : (
                <div className="p-2 space-y-2">
                  {alerts.filter(a => a.status !== "OK").map((a) => (
                    <button
                      key={a.id}
                      onClick={() => navigate(`/truck/${a.truckId}`)}
                      className={`w-full text-left p-3 rounded-lg border transition-all hover:shadow-md ${
                        a.status === "ASLEEP" 
                          ? "bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/30" 
                          : "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-gray-900 dark:text-white">{a.truckId}</span>
                        {getStatusBadge(a.status)}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        {a.reason}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Drowsy for {a.secondsDrowsy}s • {new Date(a.startedAt).toLocaleTimeString()}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Fleet List */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">All Drivers</h2>
            <div className="space-y-2">
              {trucks.map((t) => {
                const status = thresholds ? getTruckStatus(t.id) : "OK";
                const alert = alerts.find(a => a.truckId === t.id && a.status !== "OK");
                
                return (
                  <button
                    key={t.id}
                    onClick={() => navigate(`/truck/${t.id}`)}
                    className="w-full text-left p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span 
                            className="w-2 h-2 rounded-full" 
                            style={{ backgroundColor: statusToColor(status) }}
                          ></span>
                          <span className="font-semibold text-sm text-gray-900 dark:text-white">{t.id}</span>
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t.driverName}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-500">
                          {t.route.from} → {t.route.to}
                        </div>
                      </div>
                      {alert && (
                        <div className="ml-2">
                          {getStatusBadge(alert.status)}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
