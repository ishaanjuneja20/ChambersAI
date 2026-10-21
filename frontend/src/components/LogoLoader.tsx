import { createPortal } from "react-dom";
import "./LogoLoader.css";

interface LogoLoaderProps {
  /** "screen": the startup splash, fixed over the whole viewport. "box": absolutely positioned over its (positioned) parent, e.g. the live page's video box. */
  variant?: "screen" | "box";
  /** Repeat the blink burst until the parent sets `leaving` (the model loader). Off: play once, then leave by itself (the startup splash). */
  loop?: boolean;
  /** Start the fade-out now (looping loaders only; a one-shot loader leaves by itself). */
  leaving?: boolean;
  /** Called when the fade-out has finished: the parent unmounts the loader here. */
  onDone?: () => void;
}

// The "logo blink" loader: the ChambersAI logo blinks four times with hard on/off cuts (ON OFF ON OFF ON OFF ON, 100 ms each), then stays on.
// The blinking is a CSS keyframes animation (step-end), no timers; the overlay then fades out over 200 ms.
export default function LogoLoader({ variant = "screen", loop = false, leaving = false, onDone }: LogoLoaderProps) {
  const className = ["logo-loader", `logo-loader--${variant}`, loop ? "logo-loader--loop" : "logo-loader--once", leaving && "logo-loader--leaving"].filter(Boolean).join(" ");

  const loader = (
    <div
      className={className}
      role="status"
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && e.animationName === "logo-loader-out") onDone?.();
      }}
    >
      <img className="logo-loader__logo" src="/brand/logo-white.png" alt="" draggable={false} />
      <span className="sr-only">Loading ChambersAI</span>
    </div>
  );
  // A fixed overlay inside a transformed ancestor (the page transitions) would only cover that ancestor: put it on <body>.
  return variant === "screen" ? createPortal(loader, document.body) : loader;
}
