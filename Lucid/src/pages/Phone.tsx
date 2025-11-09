import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

export default function Phone() {
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(new Date());

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

  return (
    <div className="min-h-screen flex items-center justify-center text-center bg-white dark:bg-slate-900">
      {/* Clock Screen */}
      <div className="flex flex-col items-center gap-8">
        {/* Digital Clock */}
        <div className="font-mono text-9xl font-bold tracking-wider text-slate-900 dark:text-white">
          {formatTime(currentTime)}
        </div>
        
        {/* Date */}
        <div className="text-2xl font-medium text-slate-600 dark:text-slate-400">
          {formatDate(currentTime)}
        </div>

        {/* Back Button */}
        <div className="mt-8">
          <button
            onClick={() => navigate('/')}
            className="rounded-md bg-slate-800 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 transition-colors"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
