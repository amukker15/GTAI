import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";

type VideoPlayerProps = {
  className?: string;
};

export default function VideoPlayer({ className = "" }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const appStartTime = useStore((s) => s.appStartTime);
  const globalElapsedTime = useStore((s) => s.globalElapsedTime);
  const videoDuration = useStore((s) => s.videoDuration);

  // Calculate current video time based on global elapsed time (loop based on actual duration)
  const VIDEO_DURATION = videoDuration || 64;
  const currentVideoTime = globalElapsedTime % VIDEO_DURATION;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedData = () => {
      setIsLoading(false);
      setError(null);
      // Auto-play the video and sync to current time
      video.currentTime = currentVideoTime;
      video.play().catch(e => console.log("Auto-play blocked:", e));
    };

    const handleError = () => {
      setError("Failed to load video");
      setIsLoading(false);
    };

    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("error", handleError);

    return () => {
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("error", handleError);
    };
  }, [currentVideoTime]);

  // Keep video synchronized with global time
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isLoading) return;

    // Sync video time every second to stay accurate
    const interval = setInterval(() => {
      const timeDiff = Math.abs(video.currentTime - currentVideoTime);
      if (timeDiff > 1) {
        video.currentTime = currentVideoTime;
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentVideoTime, isLoading]);

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg ${className}`}>
        <div className="text-red-500 mb-2">⚠️</div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
        <button
          onClick={() => {
            setError(null);
            setIsLoading(true);
            if (videoRef.current) {
              videoRef.current.load();
            }
          }}
          className="mt-2 px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={`relative bg-black rounded-lg overflow-hidden ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
          <div className="text-white text-sm">Loading live feed...</div>
        </div>
      )}
      
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        src="http://localhost:8000/api/footage/video"
        muted
        autoPlay
        playsInline
        loop
      />
      
      {/* Live indicator - no controls */}
      <div className="absolute top-2 right-2">
        <span className="px-2 py-1 bg-red-500 text-white text-xs font-semibold rounded">
          LIVE
        </span>
      </div>
    </div>
  );
}