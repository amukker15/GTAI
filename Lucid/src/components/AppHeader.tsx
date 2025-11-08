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
  const activeIndex = navItems.findIndex((item) => item.match(pathname));

  const renderNavTab = (item: NavItem, index: number) => {
    const isActive = item.match(pathname);
    const baseClasses = `relative flex items-center justify-center gap-2 flex-1 px-4 py-2.5 transition-colors duration-200 ${
      isActive
        ? "text-blue-600 dark:text-blue-400"
        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
    } ${item.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`;

    const content = (
      <div className="flex items-center gap-2 relative z-10">
        <span>{item.icon}</span>
        <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>
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
      className="fixed top-0 left-0 right-0 z-50 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm"
    >
      <div className="relative mx-auto max-w-6xl px-3 py-3">
        <div className="grid grid-cols-3 items-center gap-6">
          {/* Brand Section - Left */}
          <div className="flex items-center justify-start">
            <img 
              src="/media/logo.png" 
              alt="Lucid" 
              className="h-12 w-auto" 
              style={{ filter: 'drop-shadow(3px 3px 6px rgba(0, 0, 0, 0.5))' }}
            />
          </div>

          {/* Navigation - Center */}
          <div className="flex justify-center">
            <nav className="relative flex items-stretch bg-slate-50/80 dark:bg-slate-800/50 rounded-lg p-1">
              {/* Sliding indicator */}
              <div
                className="absolute top-1 bottom-1 left-1 bg-white dark:bg-slate-700 rounded-md shadow-sm transition-all duration-300 ease-out"
                style={{
                  transform: `translateX(${activeIndex >= 0 ? activeIndex * 100 : 0}%)`,
                  width: `calc((100% - 0.5rem) / ${navItems.length})`,
                }}
              />
              {navItems.map((item, index) => renderNavTab(item, index))}
            </nav>
          </div>

          {/* Stats & Controls - Right */}
          <div className="flex items-center justify-end gap-4">
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
                className="w-24 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
              />
            </form>

            {/* Theme Toggle */}
            <DarkModeToggle />
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
