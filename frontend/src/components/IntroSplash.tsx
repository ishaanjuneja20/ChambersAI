import { useEffect, useState } from "react";
import LogoLoader from "./LogoLoader";

const SEEN_KEY = "chambersai.introSeen";
const SAFETY_MS = 1600; // the splash leaves by itself after ~1 s; this only guards against an animation event that never arrives

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
    /* ignore: private browsing or blocked storage, the splash just replays next time */
  }
}

// The startup splash: the logo blinks four times on black, once per browser session (a flag in sessionStorage; index.html reads it before
// the first paint so a repeat visit never flashes it). The app is already mounted underneath; the overlay just fades off it.
export default function IntroSplash({ onDone }: { onDone: () => void }) {
  const [visible, setVisible] = useState(() => !hasSeenIntro());

  const finish = () => {
    markIntroSeen();
    setVisible(false);
    onDone();
  };

  useEffect(() => {
    // The static black cover from index.html (up since the first paint) hands over to the real overlay, which is the same black.
    document.getElementById("boot-cover")?.remove();
    if (!visible) {
      onDone();
      return;
    }
    markIntroSeen();
    const timer = window.setTimeout(finish, SAFETY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;
  return <LogoLoader variant="screen" onDone={finish} />;
}
