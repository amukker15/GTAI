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
  const resetGlobalTimer = useStore((s) => s.resetGlobalTimer);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  const pathname = location.pathname;

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
        label: "Route Analysis",
        description: "LLM-guided planning",
        to: "/routes",
        icon: <LineChart className="w-5 h-5" />,
        match: (path) => path.startsWith("/routes") || path.startsWith("/long-term"),
        disabled: false,
      },
    ],
    []
  );

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
        <div className="grid grid-cols-3 items-center gap-6">
          {/* Brand Section - Left */}
          <div className="flex items-center gap-4">
            <button 
              onClick={handleLogoClick}
              className="focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg transition-transform hover:scale-105"
              title="Click to reset demo session"
            >
              <img 
                src="/media/logo.png" 
                alt="Lucid" 
                className="h-10 w-auto [filter:drop-shadow(1px_0_0_rgb(15,23,42))_drop-shadow(-1px_0_0_rgb(15,23,42))_drop-shadow(0_1px_0_rgb(15,23,42))_drop-shadow(0_-1px_0_rgb(15,23,42))_drop-shadow(1px_1px_0_rgb(15,23,42))_drop-shadow(-1px_-1px_0_rgb(15,23,42))_drop-shadow(1px_-1px_0_rgb(15,23,42))_drop-shadow(-1px_1px_0_rgb(15,23,42))] dark:[filter:drop-shadow(1px_0_0_rgba(30,41,59,0.5))_drop-shadow(-1px_0_0_rgba(30,41,59,0.5))_drop-shadow(0_1px_0_rgba(30,41,59,0.5))_drop-shadow(0_-1px_0_rgba(30,41,59,0.5))_drop-shadow(1px_1px_0_rgba(30,41,59,0.5))_drop-shadow(-1px_-1px_0_rgba(30,41,59,0.5))_drop-shadow(1px_-1px_0_rgba(30,41,59,0.5))_drop-shadow(-1px_1px_0_rgba(30,41,59,0.5))]"
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

          {/* Phone button + Dark Mode Toggle - Right */}
          <div className="flex items-center gap-3 justify-end">
            <button
              title="Open Phone"
              onClick={() => navigate('/phone')}
              className="text-sm font-medium px-3 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 opacity-0 hover:opacity-100 transition-opacity duration-300"
            >
              Phone
            </button>
            <DarkModeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
