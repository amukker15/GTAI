import DarkModeToggle from "./DarkModeToggle";
import { Shield } from "./icons";

export default function AppHeader() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-700/50 shadow-sm">
      <div className="mx-auto max-w-full px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          <div>
            <div className="text-xl font-bold text-gray-900 dark:text-white">Lucid</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">Real-time Driver Safety Monitoring</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <DarkModeToggle />
          <div className="text-right">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">Acme Logistics</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">Fleet Management</div>
          </div>
        </div>
      </div>
    </header>
  );
}
