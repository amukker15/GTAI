import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import DarkModeToggle from "./DarkModeToggle";
import { Radar, User, LineChart } from "./icons";
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
  const navRefs = useRef<(HTMLElement | null)[]>([]);
  const trucks = useStore((s) => s.trucks);
  const alerts = useStore((s) => s.alerts);
  const telemetryByTruckId = useStore((s) => s.telemetryByTruckId);
  const resetGlobalTimer = useStore((s) => s.resetGlobalTimer);
  const secondsSinceLastApiCall = useStore((s) => s.secondsSinceLastApiCall);
  const firstTruckId = trucks[0]?.id ?? null;
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  const pathname = location.pathname;

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

    const lastUpdated = secondsSinceLastApiCall === 0 
      ? "Just updated"
      : `${secondsSinceLastApiCall}s ago`;

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
        icon: <User className="w-5 h-5" />,
        match: (path) => path.startsWith("/driver-studio") || path.startsWith("/truck/"),
        disabled: false,
      },
      {
        key: "analytics",
        label: "Analytics",
        description: "Trend analytics",
        to: firstTruckId ? `/long-term/${firstTruckId}` : "/",
        icon: <LineChart className="w-5 h-5" />,
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

  const activeIndex = navItems.findIndex((item) => item.match(pathname));

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

  // Update indicator position based on active tab
  useEffect(() => {
    const updateIndicator = () => {
      if (activeIndex >= 0 && navRefs.current[activeIndex]) {
        const activeTab = navRefs.current[activeIndex];
        if (activeTab) {
          const parent = activeTab.parentElement;
          if (parent) {
            const parentRect = parent.getBoundingClientRect();
            const tabRect = activeTab.getBoundingClientRect();
            setIndicatorStyle({
              left: tabRect.left - parentRect.left,
              width: tabRect.width,
            });
          }
        }
      }
    };

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [activeIndex]);

  const handleLogoClick = async () => {
    try {
      console.log("[AppHeader] Logo clicked - resetting global timer and clearing Snowflake data");
      await resetGlobalTimer();
      // Navigate to home if not already there
      if (pathname !== "/") {
        navigate("/");
      }
    } catch (error) {
      console.error("[AppHeader] Failed to reset session:", error);
    }
  };

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
        <div 
          key={item.key} 
          ref={(el) => { navRefs.current[index] = el; }}
          className={baseClasses} 
          aria-disabled="true"
        >
          {content}
        </div>
      );
    }

    return (
      <Link 
        key={item.key} 
        to={item.to} 
        ref={(el) => { navRefs.current[index] = el; }}
        className={baseClasses}
      >
        {content}
      </Link>
    );
  };

  return (
    <header
      ref={headerRef}
      className="fixed top-0 left-0 right-0 z-50 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm"
    >
      <div className="relative mx-auto max-w-full px-6 py-3">
        <div className="flex items-center justify-between gap-6">
          {/* Brand Section - Left */}
          <div className="flex items-center">
            <button 
              onClick={handleLogoClick}
              className="focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg transition-transform hover:scale-105"
              title="Click to reset demo session"
            >
              <img 
                src="/media/logo.png" 
                alt="Lucid" 
                className="h-10 w-auto [filter:drop-shadow(1px_0_0_rgb(40,40,40))_drop-shadow(-1px_0_0_rgb(51,51,51))_drop-shadow(0_1px_0_rgb(51,51,51))_drop-shadow(0_-1px_0_rgb(51,51,51))_drop-shadow(1px_1px_0_rgb(51,51,51))_drop-shadow(-1px_-1px_0_rgb(51,51,51))_drop-shadow(1px_-1px_0_rgb(51,51,51))_drop-shadow(-1px_1px_0_rgb(51,51,51))] dark:[filter:drop-shadow(1px_0_0_rgba(30,41,59,0.5))_drop-shadow(-1px_0_0_rgba(30,41,59,0.5))_drop-shadow(0_1px_0_rgba(30,41,59,0.5))_drop-shadow(0_-1px_0_rgba(30,41,59,0.5))_drop-shadow(1px_1px_0_rgba(30,41,59,0.5))_drop-shadow(-1px_-1px_0_rgba(30,41,59,0.5))_drop-shadow(1px_-1px_0_rgba(30,41,59,0.5))_drop-shadow(-1px_1px_0_rgba(30,41,59,0.5))]"
              />
            </button>
          </div>

          {/* Navigation - Center */}
          <div className="flex justify-center">
            <nav className="relative flex items-stretch bg-slate-100 dark:bg-slate-800/50 rounded-lg p-1">
              {/* Sliding indicator */}
              <div
                className="absolute top-1 bottom-1 bg-white dark:bg-slate-700 rounded-md shadow-sm transition-all duration-300 ease-out"
                style={{
                  left: `${indicatorStyle.left}px`,
                  width: `${indicatorStyle.width}px`,
                }}
              />
              {navItems.map((item, index) => renderNavTab(item, index))}
            </nav>
          </div>

          {/* Dark Mode Toggle + Phone button - Right */}
          <div className="flex items-center gap-3">
            <DarkModeToggle />
            <button
              title="Open Phone"
              onClick={() => navigate('/phone')}
              className="text-sm font-medium px-3 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              Phone
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
