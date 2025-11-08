import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../state/store";
import { computeStatus, statusToColor } from "../lib/status";
import { Search, CheckCircle, AlertTriangle, AlertCircle } from "../components/icons";

export default function DriverSelection() {
  const navigate = useNavigate();
  const trucks = useStore((state) => state.trucks);
  const telemetryByTruckId = useStore((state) => state.telemetryByTruckId);
  const alerts = useStore((state) => state.alerts);
  const thresholds = useStore((state) => state.thresholds);
  const [searchTerm, setSearchTerm] = useState("");

  const getTruckStatus = (truckId: string) => {
    if (!thresholds) return "OK";
    const history = telemetryByTruckId[truckId] || [];
    const latest = history[history.length - 1];
    return computeStatus(latest, history, thresholds);
  };

  const getStatusBadge = (status: string) => {
    const baseClasses =
      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide";

    if (status === "ASLEEP") {
      return (
        <span className={`${baseClasses} border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200`}>
          <AlertCircle className="h-3 w-3" />
          Critical
        </span>
      );
    }

    if (status === "DROWSY_SOON") {
      return (
        <span className={`${baseClasses} border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200`}>
          <AlertTriangle className="h-3 w-3" />
          Warning
        </span>
      );
    }

    return (
      <span className={`${baseClasses} border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200`}>
        <CheckCircle className="h-3 w-3" />
        Lucid
      </span>
    );
  };

  const filteredTrucks = useMemo(() => {
    if (!searchTerm.trim()) return trucks;
    const term = searchTerm.toLowerCase();
    return trucks.filter(
      (truck) =>
        truck.driverName.toLowerCase().includes(term) ||
        truck.id.toLowerCase().includes(term) ||
        truck.company.toLowerCase().includes(term)
    );
  }, [trucks, searchTerm]);

  const filteredTruckIds = useMemo(() => new Set(filteredTrucks.map((truck) => truck.id)), [filteredTrucks]);


  const filteredAlertCount = useMemo(() => {
    return alerts.filter((alert) => alert.status !== "OK" && filteredTruckIds.has(alert.truckId)).length;
  }, [alerts, filteredTruckIds]);

  const getDriverInitials = (name: string) => {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div
      className="min-h-screen bg-white dark:bg-gray-900"
      style={{ paddingTop: "var(--app-header-height, 96px)" }}
    >
      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-8">
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.4em] text-gray-500 dark:text-gray-400">Driver Studio</p>
            <h1 className="mt-2 text-4xl font-bold text-gray-900 dark:text-white">Select a Driver</h1>
            <p className="mt-3 text-lg text-gray-600 dark:text-gray-300">Look at their real-time activity feed</p>
          </div>
          
          <div className="mt-8 mx-auto max-w-lg">
            <label htmlFor="driver-search" className="sr-only">
              Search drivers, trucks, or companies
            </label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                id="driver-search"
                type="text"
                placeholder="Search drivers, trucks, or companies..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-4 pl-12 pr-16 text-base text-gray-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:bg-gray-600"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-sm font-medium text-gray-500 transition hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-600"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          
          <div className="mt-6 flex justify-center gap-8 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-blue-500"></div>
              <span className="font-medium text-gray-900 dark:text-white">{filteredTrucks.length}</span>
              <span className="text-gray-600 dark:text-gray-300">drivers</span>
            </div>
            {filteredAlertCount > 0 && (
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-amber-500"></div>
                <span className="font-medium text-gray-900 dark:text-white">{filteredAlertCount}</span>
                <span className="text-gray-600 dark:text-gray-300">alerts</span>
              </div>
            )}
          </div>
        </div>

        {filteredTrucks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center dark:border-gray-600 dark:bg-gray-800/50">
            {trucks.length === 0 ? (
              <div>
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700">
                  <Search className="h-7 w-7 text-gray-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">No drivers available</h3>
                <p className="mt-2 text-gray-600 dark:text-gray-400">Waiting for driver data to load...</p>
              </div>
            ) : (
              <div>
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700">
                  <Search className="h-7 w-7 text-gray-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">No drivers found</h3>
                <p className="mt-2 text-gray-600 dark:text-gray-400">Try adjusting your search terms.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredTrucks.map((truck) => {
              const status = getTruckStatus(truck.id);
              const alert = alerts.find((item) => item.truckId === truck.id && item.status !== "OK");
              const history = telemetryByTruckId[truck.id] || [];
              const latest = history[history.length - 1];
              const statusColor = statusToColor(status);

              return (
                <button
                  key={truck.id}
                  onClick={() => navigate(`/truck/${truck.id}`)}
                  className="group relative flex h-full flex-col rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-400 hover:shadow-md hover:-translate-y-0.5 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-500"
                >
                  <div className="absolute inset-x-5 top-0 h-1 rounded-b-full" style={{ backgroundColor: statusColor }} />
                  
                  <div className="flex items-start justify-between gap-3 pt-2">
                    <div className="flex items-start gap-3">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold text-white"
                        style={{ backgroundColor: statusColor }}
                      >
                        {getDriverInitials(truck.driverName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Truck {truck.id}</p>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">{truck.driverName}</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-300">{truck.company}</p>
                      </div>
                    </div>
                    {getStatusBadge(alert?.status ?? status)}
                  </div>

                  <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-700">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Current Route</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {truck.route.from} → {truck.route.to}
                    </p>
                  </div>

                  {latest && (
                    <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                      Updated {new Date(latest.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  )}

                  {alert && (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
                      <span className="font-medium">Active Alert:</span> {alert.reason}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
