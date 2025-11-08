import { Route, Routes } from "react-router-dom";
import AppHeader from "./components/AppHeader";
import MainScreen from "./pages/MainScreen";
import TruckDetail from "./pages/SpecificTruck";
import LongTerm from "./pages/LongTerm";
import DriverSelection from "./pages/DriverSelection";
import { useEffect } from "react";
import { useStore } from "./state/store";
import { DarkModeProvider } from "./context/DarkModeContext";

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
    <DarkModeProvider>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <AppHeader />
        <Routes>
          <Route path="/" element={<MainScreen />} />
          <Route path="/driver-studio" element={<DriverSelection />} />
          <Route path="/truck/:truckId" element={<TruckDetail />} />
          <Route path="/long-term/:truckId" element={<LongTerm />} />
        </Routes>
      </div>
    </DarkModeProvider>
  );
}
