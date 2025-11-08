import { Link, useNavigate } from "react-router-dom";
import { useStore } from "../state/store";
import { useMemo, useState } from "react";
import { computeStatus, statusToColor } from "../lib/status";
import { Search, CheckCircle, AlertTriangle, AlertCircle } from "../components/icons";

export default function DriverSelection() {
  const navigate = useNavigate();
  const trucks = useStore((s) => s.trucks);
  const telemetryByTruckId = useStore((s) => s.telemetryByTruckId);
  const alerts = useStore((s) => s.alerts);
  const thresholds = useStore((s) => s.thresholds);
  const [searchTerm, setSearchTerm] = useState("");

  const getTruckStatus = (truckId: string) => {
    if (!thresholds) return "OK";
    const history = telemetryByTruckId[truckId] || [];
    const latest = history[history.length - 1];
    return computeStatus(latest, history, thresholds);
  };

  const getStatusBadge = (status: string) => {
    const baseClasses = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium";
    
    if (status === "ASLEEP") {
      return (
        <span className={`${baseClasses} bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300`}>
          <AlertCircle className="w-3 h-3" />
          Critical
        </span>
      );
    }
    if (status === "DROWSY_SOON") {
      return (
        <span className={`${baseClasses} bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300`}>
          <AlertTriangle className="w-3 h-3" />
          Warning
        </span>
      );
    }
    return (
      <span className={`${baseClasses} bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300`}>
        <CheckCircle className="w-3 h-3" />
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
      className="min-h-screen bg-gray-50 dark:bg-gray-900"
      style={{ paddingTop: "var(--app-header-height, 96px)" }}
    >
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Driver Studio
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Select a driver to view detailed insights and monitoring data
          </p>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search drivers, trucks, or companies..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Driver Grid */}
        {filteredTrucks.length === 0 ? (
          <div className="text-center py-12">
            {trucks.length === 0 ? (
              <div>
                <div className="w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto mb-4 flex items-center justify-center">
                  <Search className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  No drivers available
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Waiting for driver data to load...
                </p>
              </div>
            ) : (
              <div>
                <div className="w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto mb-4 flex items-center justify-center">
                  <Search className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  No drivers found
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Try adjusting your search terms
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTrucks.map((truck) => {
              const status = getTruckStatus(truck.id);
              const alert = alerts.find((a) => a.truckId === truck.id && a.status !== "OK");
              const history = telemetryByTruckId[truck.id] || [];
              const latest = history[history.length - 1];
              const statusColor = statusToColor(status);

              return (
                <button
                  key={truck.id}
                  onClick={() => navigate(`/truck/${truck.id}`)}
                  className="group relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-left hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-600 transition-all duration-200 hover:-translate-y-1"
                >
                  {/* Status indicator */}
                  <div className="absolute top-4 right-4">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: statusColor }}
                    />
                  </div>

                  {/* Driver Avatar */}
                  <div className="flex items-start gap-4 mb-4">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                      style={{ backgroundColor: statusColor }}
                    >
                      {getDriverInitials(truck.driverName)}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 dark:text-white text-lg">
                        {truck.driverName}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Truck {truck.id}
                      </p>
                    </div>
                  </div>

                  {/* Route Information */}
                  <div className="mb-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Current Route</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {truck.route.from} → {truck.route.to}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      {truck.company}
                    </p>
                  </div>

                  {/* Status Badge */}
                  <div className="flex items-center justify-between">
                    <div>{getStatusBadge(alert?.status ?? status)}</div>
                    {latest && (
                      <div className="text-xs text-gray-500 dark:text-gray-500">
                        Updated {new Date(latest.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    )}
                  </div>

                  {/* Alert indicator if present */}
                  {alert && (
                    <div className="mt-3 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                      <p className="text-xs text-red-700 dark:text-red-300 font-medium">
                        Active Alert: {alert.reason}
                      </p>
                    </div>
                  )}

                  {/* Hover indicator */}
                  <div className="absolute inset-0 rounded-xl border-2 border-transparent group-hover:border-blue-300 dark:group-hover:border-blue-600 transition-colors pointer-events-none" />
                </button>
              );
            })}
          </div>
        )}

        {/* Footer Stats */}
        {trucks.length > 0 && (
          <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {filteredTrucks.length}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {searchTerm ? "Filtered Drivers" : "Total Drivers"}
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {filteredTrucks.filter((t) => getTruckStatus(t.id) === "OK").length}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">Lucid Status</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {alerts.filter((a) => a.status !== "OK" && filteredTrucks.some((t) => t.id === a.truckId)).length}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">Active Alerts</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}