import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import "./IntroSplash.css";

const SEEN_KEY = "chambersai.introSeen";

// The seam between "Chambers" and the band "AI" in the artwork, found by scanning the PNG's
// alpha channel for the transparent gap between the letters (≈78.3% of the image width). Do not
// redraw or alter the source PNG — only these two clip-path windows onto it move.
const SEAM_PCT = 78.3;
const LEFT_HIDDEN = "inset(0% 100% 0% 0%)";
const LEFT_SHOWN = `inset(0% ${(100 - SEAM_PCT).toFixed(1)}% 0% 0%)`;
const RIGHT_CLIP = `inset(0% 0% 0% ${SEAM_PCT}%)`;

const WIPE_DURATION = 0.95;
const BAND_DELAY = 0.85;
const BAND_DURATION = 0.6;
const HOLD_DELAY = 1.5;
const HOLD_DURATION = 0.65;
const LIFT_DELAY = 2.2;
const LIFT_DURATION = 0.5;
const TOTAL_MS = (LIFT_DELAY + LIFT_DURATION) * 1000; // time until the panel starts sliding away
const EXIT_SLIDE_DURATION = 0.5; // panel sliding away into the page underneath
const REDUCED_MOTION_HOLD_MS = 500;

function hasSeenIntro(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markIntroSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore: private browsing or blocked storage, intro just replays next time */
  }
}

interface IntroSplashProps {
  forcePlay?: boolean;
  onDone: () => void;
}

export default function IntroSplash({ forcePlay = false, onDone }: IntroSplashProps) {
  const prefersReducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(() => forcePlay || !hasSeenIntro());
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<number>();

  // Skip: click or any key jumps straight to the end state, no slide-away animation.
  const skip = () => {
    markIntroSeen();
    window.clearTimeout(timerRef.current);
    setVisible(false);
    onDone();
  };

  // Natural completion: the panel slides away, revealing the sign-in page underneath.
  const startExit = () => {
    markIntroSeen();
    if (prefersReducedMotion) {
      setVisible(false);
      onDone();
      return;
    }
    setExiting(true);
  };

  useEffect(() => {
    if (forcePlay) {
      setVisible(true);
      setExiting(false);
    }
  }, [forcePlay]);

  useEffect(() => {
    if (!visible) return;
    const duration = prefersReducedMotion ? REDUCED_MOTION_HOLD_MS : TOTAL_MS;
    timerRef.current = window.setTimeout(startExit, duration);
    return () => window.clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, prefersReducedMotion]);

  useEffect(() => {
    if (!visible) return;
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <motion.div
      className="intro"
      onClick={skip}
      animate={exiting ? { y: "-100%" } : { y: 0 }}
      transition={{ duration: EXIT_SLIDE_DURATION, ease: [0.65, 0, 0.35, 1] }}
      onAnimationComplete={() => {
        if (exiting) {
          setVisible(false);
          onDone();
        }
      }}
    >
      <span className="sr-only">ChambersAI</span>
      <motion.div
        className="intro__logo-wrap"
        initial={prefersReducedMotion ? false : { y: 0, opacity: 1 }}
        animate={
          prefersReducedMotion
            ? undefined
            : {
                y: [0, 0, -40],
                opacity: [1, 1, 0],
              }
        }
        transition={
          prefersReducedMotion
            ? undefined
            : {
                duration: LIFT_DELAY + LIFT_DURATION,
                times: [0, LIFT_DELAY / (LIFT_DELAY + LIFT_DURATION), 1],
                ease: ["linear", "linear", [0.65, 0, 0.35, 1]],
              }
        }
      >
        {/* Glow pulse during the hold, layered behind both logo halves. */}
        <motion.div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "-18%",
            borderRadius: "50%",
            background: "radial-gradient(circle, var(--glow) 0%, transparent 65%)",
            pointerEvents: "none",
          }}
          initial={{ opacity: 0 }}
          animate={prefersReducedMotion ? { opacity: 0 } : { opacity: [0, 0, 0.35, 0] }}
          transition={{
            duration: HOLD_DELAY + HOLD_DURATION,
            times: [0, HOLD_DELAY / (HOLD_DELAY + HOLD_DURATION), (HOLD_DELAY + HOLD_DURATION * 0.5) / (HOLD_DELAY + HOLD_DURATION), 1],
          }}
        />

        {/* "Chambers" — soft mask wipe + fade, left to right. */}
        <motion.img
          src="/brand/logo-white.png"
          alt=""
          aria-hidden="true"
          initial={prefersReducedMotion ? false : { clipPath: LEFT_HIDDEN, opacity: 0 }}
          animate={{ clipPath: LEFT_SHOWN, opacity: 1 }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: WIPE_DURATION, ease: [0.22, 1, 0.36, 1] }}
        />

        {/* Band "A" + "I" — drops in from above and settles with a light spring. */}
        <motion.img
          src="/brand/logo-white.png"
          alt=""
          aria-hidden="true"
          style={{ clipPath: RIGHT_CLIP }}
          initial={prefersReducedMotion ? false : { y: -36, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : { delay: BAND_DELAY, duration: BAND_DURATION, type: "spring", stiffness: 260, damping: 16 }
          }
        />
      </motion.div>

      <button type="button" className="intro__skip" onClick={skip}>
        Skip
      </button>
    </motion.div>
  );
}
