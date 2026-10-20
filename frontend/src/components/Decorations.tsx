import { useEffect, useRef } from "react";
import "./Decorations.css";

function Sparkle({ style }: { style: React.CSSProperties }) {
  return (
    <div className="decorations__item" style={style}>
      <svg className="decorations__sparkle-inner" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <path d="M11 0 L13 9 L22 11 L13 13 L11 22 L9 13 L0 11 L9 9 Z" fill="var(--accent-violet)" opacity="0.65" />
      </svg>
    </div>
  );
}

function StripedRing({ style, color }: { style: React.CSSProperties; color: string }) {
  return (
    <div className="decorations__item" style={style}>
      <svg className="decorations__ring-inner" width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
        <circle cx="17" cy="17" r="14" fill="none" stroke={color} strokeWidth="2" strokeDasharray="4 5" opacity="0.5" />
      </svg>
    </div>
  );
}

// A handful of small, non-interactive decorative shapes (sparkles + striped rings) that float,
// rotate and nudge slightly with the cursor. Positioned to never sit over content or controls.
export default function Decorations() {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const onMove = (e: MouseEvent) => {
      const { innerWidth, innerHeight } = window;
      const x = (e.clientX / innerWidth - 0.5) * 2;
      const y = (e.clientY / innerHeight - 0.5) * 2;
      el.querySelectorAll<HTMLElement>(".decorations__item").forEach((item, i) => {
        const strength = 4 + (i % 3) * 2;
        item.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div className="decorations" ref={wrapRef} aria-hidden="true">
      <Sparkle style={{ top: "8%", left: "6%" }} />
      <Sparkle style={{ top: "22%", right: "10%" }} />
      <Sparkle style={{ bottom: "14%", left: "16%" }} />
      <StripedRing style={{ top: "40%", right: "4%" }} color="var(--accent-magenta)" />
      <StripedRing style={{ bottom: "8%", right: "22%" }} color="var(--text-faint)" />
    </div>
  );
}
