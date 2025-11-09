import { useEffect, useState, useRef } from "react";
import { AlertTriangle } from "../components/icons";

export default function Phone() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flashVisible, setFlashVisible] = useState(false);
  const [dotFlashing, setDotFlashing] = useState(false);

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };

  const formatDate = (date: Date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const dayName = days[date.getDay()];
    const monthName = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    
    return `${dayName}, ${monthName} ${day}, ${year}`;
  };

  async function runQuery() {
    // avoid overlapping requests
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setRows(null);
    
    // Flash the dot red when query happens
    setDotFlashing(true);
    setTimeout(() => setDotFlashing(false), 200);
    
    try {
      const resp = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT * FROM STATUS_TABLE ORDER BY TIME_CREATED DESC LIMIT 1;' }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setError(json.error || JSON.stringify(json));
      } else {
        const resultRows = json.result || [];
        setRows(resultRows);

        // Trigger flash only when any returned row contains the literal 'DROWSY_SOON'
        const triggerMatch = (resultRows || []).some((row: Record<string, any>) =>
          Object.values(row).some((v) => String(v) === 'DROWSY_SOON')
        );
        if (triggerMatch) {
          triggerFlash();
        }
      }
    } catch (e: any) {
      setError(String(e));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  // keep a ref that mirrors loading to avoid stale closures in the interval
  const loadingRef = useRef<boolean>(false);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // flash control refs
  const isFlashingRef = useRef(false);
  const flashTimeoutRef = useRef<number | null>(null);

  function clearFlashTimers() {
    if (flashTimeoutRef.current) {
      clearTimeout(flashTimeoutRef.current as unknown as number);
      flashTimeoutRef.current = null;
    }
    isFlashingRef.current = false;
    setFlashVisible(false);
  }

  function triggerFlash() {
    if (isFlashingRef.current) return;
    isFlashingRef.current = true;
    setFlashVisible(true);
    // hide after 3 seconds total
    flashTimeoutRef.current = window.setTimeout(() => {
      clearFlashTimers();
    }, 3000);
  }

  // run query immediately and then every half second
  useEffect(() => {
    // initial run
    runQuery();
    const id = setInterval(() => {
      runQuery();
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cleanup flash timers on unmount
  useEffect(() => {
    return () => {
      clearFlashTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center text-center bg-white dark:bg-slate-900 p-6">
      {/* yellow alert overlay with fade-in */}
      {flashVisible && (
        <div 
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 animate-fadeIn"
          style={{ backgroundColor: '#eab308' }} // yellow-500
        >
          <AlertTriangle className="w-32 h-32 text-slate-900" strokeWidth={2.5} />
          <p className="text-4xl font-bold text-slate-900">
            Please be attentive
          </p>
        </div>
      )}
      <div className="w-full max-w-3xl">
        <div className="flex flex-col items-center gap-6">
          <div className="flex items-center gap-4">
            <div className="font-mono text-6xl font-bold tracking-wider text-slate-900 dark:text-white">
              {formatTime(currentTime)}
            </div>
            {/* Status indicator dot */}
            <div 
              className={`w-4 h-4 rounded-full transition-colors duration-200 ${
                dotFlashing ? 'bg-red-500' : 'bg-slate-400 dark:bg-slate-600'
              }`}
            />
          </div>

          <div className="text-lg font-medium text-slate-600 dark:text-slate-400">
            {formatDate(currentTime)}
          </div>
        </div>
      </div>
    </div>
  );
}
