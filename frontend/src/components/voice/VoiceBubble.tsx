import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Mic, X } from "lucide-react";
import { drawBubbleFrame, type BubbleMode } from "./bubbleCanvas";
import "./VoiceBubble.css";

const BUTTON_SIZE = 44;
const BUBBLE_SIZE_DESKTOP = 200;
const BUBBLE_SIZE_PHONE = 150;

interface VoiceBubbleProps {
  expanded: boolean;
  mode: BubbleMode;
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  transcriptPreview?: string;
  label: string;
  anchor?: "inline" | "above";
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onCancel: () => void;
}

function lastWords(text: string, count = 6): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(-count).join(" ");
}

export default function VoiceBubble({
  expanded,
  mode,
  analyserRef,
  transcriptPreview,
  label,
  anchor = "inline",
  onPointerDown,
  onPointerUp,
  onCancel,
}: VoiceBubbleProps) {
  const prefersReducedMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>();
  const smoothedLevelRef = useRef(0);
  const containerRef = useRef<HTMLButtonElement>(null);
  const isPhone = typeof window !== "undefined" && window.matchMedia("(max-width: 480px)").matches;
  const bubbleSize = isPhone ? BUBBLE_SIZE_PHONE : BUBBLE_SIZE_DESKTOP;

  // Canvas animation loop: reads the analyser directly every frame via refs, so React never
  // re-renders for this. Pauses when the tab is hidden or the bubble isn't expanded.
  useEffect(() => {
    if (!expanded || prefersReducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssSize = bubbleSize;
    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
    ctx.scale(dpr, dpr);

    const freqData = new Uint8Array(64);
    const start = performance.now();

    const tick = (now: number) => {
      const t = (now - start) / 1000;
      let level = 0;
      let low = 0;
      let mid = 0;
      let high = 0;
      const analyser = analyserRef.current;
      if (analyser) {
        analyser.getByteFrequencyData(freqData);
        const n = freqData.length;
        const third = Math.floor(n / 3);
        let sum = 0;
        let lowSum = 0;
        let midSum = 0;
        let highSum = 0;
        for (let i = 0; i < n; i++) {
          sum += freqData[i];
          if (i < third) lowSum += freqData[i];
          else if (i < third * 2) midSum += freqData[i];
          else highSum += freqData[i];
        }
        level = sum / n / 255;
        low = lowSum / third / 255;
        mid = midSum / third / 255;
        high = highSum / (n - third * 2) / 255;
      }
      // Attack/release envelope: fast rise, slower fall, so motion feels fluid, not jittery.
      const attack = 0.45;
      const release = 0.12;
      const k = level > smoothedLevelRef.current ? attack : release;
      smoothedLevelRef.current += (level - smoothedLevelRef.current) * k;

      drawBubbleFrame(ctx, {
        width: cssSize,
        height: cssSize,
        t,
        level: smoothedLevelRef.current,
        bands: { low, mid, high },
        mode,
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const onVisibility = () => {
      if (document.hidden) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [expanded, mode, analyserRef, bubbleSize, prefersReducedMotion]);

  // Reduced motion: no canvas animation at all, just a glow that tracks level directly on the
  // element's box-shadow via a lightweight rAF (brightness-only, no shape/flow motion).
  useEffect(() => {
    if (!expanded || !prefersReducedMotion) return;
    const el = containerRef.current;
    if (!el) return;
    const freqData = new Uint8Array(64);
    let raf: number;
    const tick = () => {
      const analyser = analyserRef.current;
      let level = 0;
      if (analyser) {
        analyser.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) sum += freqData[i];
        level = sum / freqData.length / 255;
      }
      el.style.setProperty("--rim-glow", String(0.3 + level * 0.7));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [expanded, prefersReducedMotion, analyserRef]);

  const size = expanded ? bubbleSize : BUTTON_SIZE;
  const borderRadius = expanded ? "42%" : "50%";

  return (
    <div className={`voice-bubble-anchor${anchor === "above" ? " voice-bubble-anchor--above" : ""}`}>
      <motion.button
        ref={containerRef}
        type="button"
        className={`voice-bubble${anchor === "above" ? " voice-bubble--above" : ""}${expanded ? " voice-bubble--expanded" : " voice-bubble--button"}`}
        animate={{ width: size, height: size, borderRadius }}
        transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 26, duration: 0.3 }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={(e) => expanded && onPointerUp(e)}
        aria-pressed={expanded}
        aria-label={expanded ? "Listening — release or tap to stop and send" : label}
      >
        {!expanded && <Mic size={18} aria-hidden="true" />}

        {expanded && !prefersReducedMotion && <canvas ref={canvasRef} className="voice-bubble__canvas" aria-hidden="true" />}
        {expanded && <div className="voice-bubble__sheen" aria-hidden="true" />}

        {expanded && (
          <div className="voice-bubble__content">
            <span className="voice-bubble__dot-row">
              <span className="voice-bubble__dot" aria-hidden="true" />
              Mic is on
            </span>
            <p className="voice-bubble__status">{mode === "processing" ? "Processing…" : "Listening…"}</p>
          </div>
        )}

        {expanded && (
          <span
            role="button"
            tabIndex={0}
            className="voice-bubble__cancel"
            aria-label="Cancel"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onCancel();
              }
            }}
          >
            <X size={14} />
          </span>
        )}
      </motion.button>

      {expanded && (
        <div className="sr-only" aria-live="polite">
          Listening
        </div>
      )}

      {expanded && transcriptPreview && <p className="voice-bubble__transcript">"{lastWords(transcriptPreview)}"</p>}
    </div>
  );
}
