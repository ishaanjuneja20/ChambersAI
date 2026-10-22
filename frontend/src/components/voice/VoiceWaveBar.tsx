import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { drawWaveBarFrame } from "./bubbleCanvas";
import type { VoiceUi } from "./VoiceButton";
import "./VoiceWaveBar.css";

// The input bar's listening state: a full-width, Siri-style wave layer that sits behind the bar's controls and fades in over them.
// One canvas, sized to the bar and redrawn only while listening / processing; its amplitude follows the live mic level
// (the analyser from useVoiceInput). prefers-reduced-motion swaps the flowing waves for a static gradient and a level meter.

function lastWords(text: string, count = 9): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(-count).join(" ");
}

// Smoothed overall level + three frequency bands from the analyser, written into `out` (no React state involved).
function readLevels(analyser: AnalyserNode | null, freq: Uint8Array<ArrayBuffer>, out: { level: number; low: number; mid: number; high: number }) {
  let level = 0;
  let low = 0;
  let mid = 0;
  let high = 0;
  if (analyser) {
    analyser.getByteFrequencyData(freq);
    const n = freq.length;
    const third = Math.floor(n / 3);
    let sum = 0;
    let lowSum = 0;
    let midSum = 0;
    let highSum = 0;
    for (let i = 0; i < n; i++) {
      sum += freq[i];
      if (i < third) lowSum += freq[i];
      else if (i < third * 2) midSum += freq[i];
      else highSum += freq[i];
    }
    level = sum / n / 255;
    low = lowSum / third / 255;
    mid = midSum / third / 255;
    high = highSum / (n - third * 2) / 255;
  }
  const k = level > out.level ? 0.45 : 0.12; // fast attack, slow release
  out.level += (level - out.level) * k;
  out.low = low;
  out.mid = mid;
  out.high = high;
}

export default function VoiceWaveBar({ ui, active, mode }: { ui: VoiceUi | null; active: boolean; mode: "listening" | "processing" }) {
  const reduceMotion = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meterRef = useRef<HTMLSpanElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const analyserRef = ui?.analyserRef;

  // Flowing waves: runs only while active, resizes with the bar, pauses while the tab is hidden.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!active || reduceMotion || !canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w = 1;
    let h = 1;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const freq = new Uint8Array(64);
    const levels = { level: 0, low: 0, mid: 0, high: 0 };
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      readLevels(analyserRef?.current ?? null, freq, levels);
      drawWaveBarFrame(ctx, { width: w, height: h, t: (now - start) / 1000, level: levels.level, bands: { low: levels.low, mid: levels.mid, high: levels.high }, mode: modeRef.current });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.setTimeout(() => ctx.clearRect(0, 0, canvas.width, canvas.height), 300); // after the fade-out
    };
  }, [active, reduceMotion, analyserRef]);

  // Reduced motion: a plain level meter, no flowing shapes.
  useEffect(() => {
    if (!active || !reduceMotion) return;
    const freq = new Uint8Array(64);
    const levels = { level: 0, low: 0, mid: 0, high: 0 };
    let raf = 0;
    const tick = () => {
      readLevels(analyserRef?.current ?? null, freq, levels);
      meterRef.current?.style.setProperty("--level", String(Math.min(1, levels.level * 2.2)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduceMotion, analyserRef]);

  const caption = mode === "processing" ? (ui?.transcribing ? "Transcribing…" : "Processing…") : ui?.transcript ? lastWords(ui.transcript) : "Listening…";

  return (
    <div ref={wrapRef} className={`voice-wave${active ? " voice-wave--on" : ""}${mode === "processing" ? " voice-wave--processing" : ""}${reduceMotion ? " voice-wave--static" : ""}`}>
      <div className="voice-wave__visual" aria-hidden="true">
        {reduceMotion ? <span ref={meterRef} className="voice-wave__meter" /> : <canvas ref={canvasRef} className="voice-wave__canvas" />}
      </div>
      <p className="voice-wave__text" aria-hidden="true">
        {caption}
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {active ? (mode === "processing" ? (ui?.transcribing ? "Transcribing" : "Processing") : "Listening") : ""}
      </p>
    </div>
  );
}
