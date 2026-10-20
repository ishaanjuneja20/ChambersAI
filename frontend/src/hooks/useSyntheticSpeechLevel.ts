import { useEffect, useRef, useState } from "react";

// Demo-mode only: there's no real TTS audio to analyze (the browser speaks via
// SpeechSynthesis, which exposes no AnalyserNode-compatible stream), so this produces a
// plausible, non-random-looking mouth-open envelope for as long as `active` is true. Feeds the
// same `audioLevel` prop a real analyzed level would, so Avatar doesn't know the difference.
export function useSyntheticSpeechLevel(active: boolean): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number>();

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      // Two overlapping sine waves read as "talking" better than one smooth pulse.
      const wave = 0.5 + 0.3 * Math.sin(t * 9) + 0.2 * Math.sin(t * 17 + 1);
      setLevel(Math.max(0, Math.min(1, wave)));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);

  return level;
}
