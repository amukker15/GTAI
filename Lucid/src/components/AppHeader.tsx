import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { JSX } from "react";
import DarkModeToggle from "./DarkModeToggle";
import { Radar, Search as SearchIcon, Shield, Sparkles, Timeline } from "./icons";
import { useStore } from "../state/store";

type NavItem = {
  key: string;
  label: string;
  description: string;
  to: string;
  icon: JSX.Element;
  match: (path: string) => boolean;
  disabled?: boolean;
  size?: "double" | "default";
};

export default function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const headerRef = useRef<HTMLElement | null>(null);
  const trucks = useStore((s) => s.trucks);
  const alerts = useStore((s) => s.alerts);
  const telemetryByTruckId = useStore((s) => s.telemetryByTruckId);
  const firstTruckId = trucks[0]?.id ?? null;
  const [searchTerm, setSearchTerm] = useState("");
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const updateHeight = () => {
      document.documentElement.style.setProperty(
        "--app-header-height",
        `${header.getBoundingClientRect().height}px`
      );
    };

    updateHeight();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(updateHeight);
      ro.observe(header);
      return () => ro.disconnect();
    }

    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  const metrics = useMemo(() => {
    const totalTrucks = trucks.length;
    const activeAlerts = alerts.filter((a) => a.status !== "OK");
    const flaggedDrivers = new Set(activeAlerts.map((a) => a.truckId));
    const fleetHealth = totalTrucks
      ? Math.max(0, Math.round(((totalTrucks - flaggedDrivers.size) / totalTrucks) * 100))
      : 100;

    let latest = 0;
    Object.values(telemetryByTruckId).forEach((samples) => {
      const last = samples.at(-1);
      if (last) {
        const ts = Date.parse(last.timestamp);
        if (!Number.isNaN(ts)) {
          latest = Math.max(latest, ts);
        }
      }
    });

    const lastUpdated = latest
      ? new Date(latest).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "Awaiting data";

    return {
      totalTrucks,
      activeAlerts: activeAlerts.length,
      fleetHealth,
      lastUpdated,
    };
  }, [alerts, telemetryByTruckId, trucks]);

  const navItems = useMemo<NavItem[]>(
    () => [
      {
        key: "overview",
        label: "Mission Control",
        description: "Live fleet pulse",
        to: "/",
        icon: <Radar className="w-5 h-5" />,
        match: (path) => path === "/",
        size: "double",
      },
      {
        key: "driver",
        label: "Driver Studio",
        description: "Deep driver insights",
        to: "/driver-studio",
        icon: <Sparkles className="w-5 h-5" />,
        match: (path) => path.startsWith("/driver-studio") || path.startsWith("/truck/"),
        disabled: false,
      },
      {
        key: "long-term",
        label: "Long Horizon",
        description: "Trend analytics",
        to: firstTruckId ? `/long-term/${firstTruckId}` : "/",
        icon: <Timeline className="w-5 h-5" />,
        match: (path) => path.startsWith("/long-term"),
        disabled: !firstTruckId,
      },
    ],
    [firstTruckId]
  );

  const statPills = [
    {
      label: "Drivers monitored",
      value: metrics.totalTrucks || "—",
      hint: metrics.totalTrucks ? "streaming now" : "loading fleet",
    },
    {
      label: "Live alerts",
      value: metrics.activeAlerts,
      hint: metrics.activeAlerts ? "needs review" : "all clear",
    },
    {
      label: "Fleet health",
      value: `${metrics.fleetHealth}%`,
      hint: "awake & compliant",
    },
    {
      label: "Last sync",
      value: metrics.lastUpdated,
      hint: "system clock",
    },
  ];

  const pathname = location.pathname;

  const renderNavTab = (item: NavItem) => {
    const isActive = item.match(pathname);
    const baseClasses = `flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 ${
      isActive
        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50"
    } ${item.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`;

    const content = (
      <div className="flex items-center gap-2">
        <span className={`${isActive ? "text-blue-600 dark:text-blue-400" : ""}`}>
          {item.icon}
        </span>
        <span className="text-sm font-medium">{item.label}</span>
      </div>
    );

    if (item.disabled) {
      return (
        <div key={item.key} className={baseClasses} aria-disabled="true">
          {content}
        </div>
      );
    }

    return (
      <Link key={item.key} to={item.to} className={baseClasses}>
        {content}
      </Link>
    );
  };

  const handleSearch = (event?: FormEvent) => {
    event?.preventDefault();
    if (!searchTerm.trim()) {
      setSearchFeedback("Enter driver name or truck ID");
      return;
    }
    const term = searchTerm.trim().toLowerCase();
    const match = trucks.find(
      (truck) =>
        truck.id.toLowerCase().includes(term) ||
        truck.driverName?.toLowerCase().includes(term)
    );

    if (match) {
      setSearchFeedback(null);
      navigate(`/truck/${match.id}`);
    } else {
      setSearchFeedback("No matching driver or truck");
    }
  };

  return (
    <header
      ref={headerRef}
      className="fixed top-0 left-0 right-0 z-50 border-b border-slate-200/60 dark:border-slate-700/60 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md"
    >
      <div className="relative mx-auto max-w-6xl px-6 py-3">
        <div className="flex items-center justify-between gap-6">
          {/* Brand Section */}
          <div className="flex items-center">
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Lucid</h1>
          </div>

          {/* Navigation */}
          <nav className="flex items-center gap-1 bg-slate-50/80 dark:bg-slate-800/50 rounded-lg p-1">
            {navItems.map(renderNavTab)}
          </nav>

          {/* Stats & Controls */}
          <div className="flex items-center gap-4">
            {/* Enhanced Stats */}
            <div className="hidden lg:flex items-center gap-4">
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Drivers:</span>
                <span className="text-base font-semibold text-slate-900 dark:text-white">{metrics.totalTrucks || "—"}</span>
              </div>
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Alerts:</span>
                <span className="text-base font-semibold text-red-600 dark:text-red-400">{metrics.activeAlerts}</span>
              </div>
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Health:</span>
                <span className="text-base font-semibold text-green-600 dark:text-green-400">{metrics.fleetHealth}%</span>
              </div>
            </div>

            {/* Search */}
            <form
              onSubmit={handleSearch}
              className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
            >
              <SearchIcon className="w-4 h-4 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  if (searchFeedback) setSearchFeedback(null);
                }}
                placeholder="Search..."
                className="w-32 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
              />
            </form>

            {/* Theme Toggle */}
            <DarkModeToggle />

            {/* User */}
            <div className="hidden md:flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg">
              <span className="text-xs font-medium">AL</span>
            </div>
          </div>
        </div>

        {searchFeedback && (
          <div className="mt-2">
            <p className="text-xs text-rose-500">{searchFeedback}</p>
          </div>
        )}
      </div>
    </header>
  );
}
