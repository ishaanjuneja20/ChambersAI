import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import LogoLoader from "../LogoLoader";

const BURST_MS = 700; // the four blinks; the overlay only leaves once the burst it is in has finished
const HOLD_MS = 300; // a short hold with the logo on after the first burst
const CYCLE_MS = 1400; // matches LogoLoader's blink cycle
const REDUCED_MIN_MS = 600;
const FADE_GUARD_MS = 400; // the fade is 200 ms; if its animation event never arrives, unmount anyway

// The black logo-blink loader inside the live page's video box. It is mounted with the page (every time the live page opens) and stays until
// the avatar has rendered its first real frame (`waiting` goes false): it plays at least one full burst plus a short hold, never leaves in
// the middle of a burst, then fades out. It is one persistent element, so its animation never restarts while the 3D component loads.
export default function AvatarLoadOverlay({ waiting, onLeaving }: { waiting: boolean; onLeaving?: () => void }) {
  const reduceMotion = useReducedMotion();
  const shownAt = useRef(performance.now());
  const [phase, setPhase] = useState<"shown" | "leaving" | "done">("shown");
  const onLeavingRef = useRef(onLeaving);
  onLeavingRef.current = onLeaving;

  useEffect(() => {
    if (phase !== "shown" || waiting) return;
    const elapsed = performance.now() - shownAt.current;
    let leaveAt = Math.max(elapsed, reduceMotion ? REDUCED_MIN_MS : BURST_MS + HOLD_MS);
    if (!reduceMotion && leaveAt % CYCLE_MS < BURST_MS) leaveAt += BURST_MS - (leaveAt % CYCLE_MS); // wait out a burst that has begun
    const timer = window.setTimeout(() => setPhase("leaving"), leaveAt - elapsed);
    return () => window.clearTimeout(timer);
  }, [phase, waiting, reduceMotion]);

  useEffect(() => {
    if (phase !== "leaving") return;
    onLeavingRef.current?.();
    const timer = window.setTimeout(() => setPhase("done"), FADE_GUARD_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "done") return null;
  return <LogoLoader variant="box" loop leaving={phase === "leaving"} onDone={() => setPhase("done")} />;
}
