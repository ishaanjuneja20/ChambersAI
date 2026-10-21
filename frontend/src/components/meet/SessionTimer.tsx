import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

const pad = (n: number) => String(n).padStart(2, "0");

// Elapsed time since the page opened (client-side only). Its own component, so the once-a-second tick re-renders nothing else.
export default function SessionTimer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const label = h > 0 ? `${h}:${pad(m)}:${pad(seconds % 60)}` : `${pad(m)}:${pad(seconds % 60)}`;
  return (
    <span className="room-timer" role="timer" aria-label={`Session time ${label}`}>
      <Clock size={14} aria-hidden="true" />
      {label}
    </span>
  );
}
