import { Route, Routes } from "react-router-dom";
import AppHeader from "./components/AppHeader";
import MainScreen from "./pages/MainScreen";
import TruckDetail from "./pages/TruckDetail";
import LongTerm from "./pages/LongTerm";
import { useEffect } from "react";
import { useStore } from "./state/store";

export default function App() {
  const fetchTrucks = useStore((s) => s.fetchTrucks);
  const loadThresholds = useStore((s) => s.loadThresholds);
  const startTelemetry = useStore((s) => s.pollTelemetry);
  const startAlerts = useStore((s) => s.pollAlerts);

  useEffect(() => {
    fetchTrucks();
    loadThresholds();
    const stopT = startTelemetry();
    const stopA = startAlerts();
    return () => {
      stopT?.();
      stopA?.();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <AppHeader />
      <Routes>
        <Route path="/" element={<MainScreen />} />
        <Route path="/truck/:truckId" element={<TruckDetail />} />
        <Route path="/long-term/:truckId" element={<LongTerm />} />
      </Routes>
    </div>
  );
}
