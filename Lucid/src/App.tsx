import { Route, Routes } from "react-router-dom";
import AppHeader from "./components/AppHeader";
import { useLocation } from "react-router-dom";
import Phone from "./pages/Phone";
import MainScreen from "./pages/MainScreen";
import TruckDetail from "./pages/SpecificTruck";
import LongTerm from "./pages/LongTerm";
import DriverSelection from "./pages/DriverSelection";
import { useEffect } from "react";
import { useStore } from "./state/store";
import { DarkModeProvider } from "./context/DarkModeContext";

export default function App() {
  const location = useLocation();
  const fetchTrucks = useStore((s) => s.fetchTrucks);
  const loadThresholds = useStore((s) => s.loadThresholds);
  const startTelemetry = useStore((s) => s.pollTelemetry);
  const startAlerts = useStore((s) => s.pollAlerts);
  const startGlobalTimer = useStore((s) => s.startGlobalTimer);
  const stopGlobalTimer = useStore((s) => s.stopGlobalTimer);
  const fetchVideoInfo = useStore((s) => s.fetchVideoInfo);

  useEffect(() => {
    fetchTrucks();
    loadThresholds();
    fetchVideoInfo(); // Auto-detect video file in footage directory
    const stopT = startTelemetry();
    const stopA = startAlerts();
    
    // Start global timer for video analysis
    startGlobalTimer();
    
    return () => {
      stopT?.();
      stopA?.();
      stopGlobalTimer();
    };
  }, []);

  return (
    <DarkModeProvider>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        {/* Hide the main header on the phone screen so the page shows only the phone UI */}
        {location.pathname !== "/phone" && <AppHeader />}
        <Routes>
          <Route path="/" element={<MainScreen />} />
          <Route path="/driver-studio" element={<DriverSelection />} />
          <Route path="/truck/:truckId" element={<TruckDetail />} />
          <Route path="/routes" element={<LongTerm />} />
          <Route path="/long-term/:truckId" element={<LongTerm />} />
          <Route path="/phone" element={<Phone />} />
        </Routes>
      </div>
    </DarkModeProvider>
  );
}
