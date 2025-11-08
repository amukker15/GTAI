import { MapContainer, TileLayer, CircleMarker, Polyline } from "react-leaflet";
import { useNavigate } from "react-router-dom";
import { useStore } from "../state/store";
import { useMemo } from "react";

export default function MainScreen() {
  const navigate = useNavigate();
  const trucks = useStore((s) => s.trucks);
  const telemetryByTruckId = useStore((s) => s.telemetryByTruckId);
  const alerts = useStore((s) => s.alerts);

  const totals = useMemo(() => {
    const totalTrucks = trucks.length;
    const activeAlerts = alerts.length;
    const flaggedSet = new Set(alerts.filter(a => a.status !== "OK").map(a => a.truckId));
    const percentFlagged = totalTrucks ? Math.round((flaggedSet.size / totalTrucks) * 100) : 0;
    return { totalTrucks, activeAlerts, percentFlagged };
  }, [trucks, alerts]);

  return (
    <div className="page grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card h-[60vh] lg:h-[78vh]">
        <div className="card-h font-semibold">Fleet Map</div>
        <div className="card-b h-full">
          <MapContainer
            center={[39.5, -98.35]}
            zoom={4}
            className="h-full rounded-lg"
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {trucks.map((t) => {
              const latest = telemetryByTruckId[t.id]?.slice(-1)[0];
              if (!latest) return null;
              return (
                <CircleMarker
                  key={t.id}
                  center={[latest.lat, latest.lng]}
                  radius={6}
                  pathOptions={{ color: "#2563eb" }}
                  eventHandlers={{ click: () => navigate(`/truck/${t.id}`) }}
                />
              );
            })}
            {trucks.map((t) => {
              const hist = telemetryByTruckId[t.id] || [];
              if (hist.length < 2) return null;
              const points = hist.map(p => [p.lat, p.lng]) as [number, number][];
              return <Polyline key={t.id + "-line"} positions={points} pathOptions={{ color: "#93c5fd" }} />;
            })}
          </MapContainer>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="card">
          <div className="card-h font-semibold">Summary</div>
          <div className="card-b grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-3xl font-bold">{totals.totalTrucks}</div>
              <div className="text-gray-500 text-sm">Trucks</div>
            </div>
            <div>
              <div className="text-3xl font-bold">{totals.activeAlerts}</div>
              <div className="text-gray-500 text-sm">Active Alerts</div>
            </div>
            <div>
              <div className="text-3xl font-bold">{totals.percentFlagged}%</div>
              <div className="text-gray-500 text-sm">% Flagged</div>
            </div>
          </div>
        </div>

        <div className="card h-[40vh]">
          <div className="card-h font-semibold">Active Alerts</div>
          <div className="card-b h-full overflow-auto space-y-2">
            {alerts.length === 0 && <div className="text-gray-500">No active alerts.</div>}
            {alerts.map((a) => (
              <button
                key={a.id}
                onClick={() => navigate(`/truck/${a.truckId}`)}
                className="w-full text-left p-3 rounded border hover:bg-gray-50"
              >
                <div className="font-semibold">{a.truckId}</div>
                <div className="text-sm text-gray-600">
                  {a.status} • Drowsy for {a.secondsDrowsy}s • {new Date(a.startedAt).toLocaleTimeString()}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
