import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import Decorations from "./Decorations";
import RotatingBadge from "./RotatingBadge";
import "./AuthLayout.css";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <div className="auth-shell__brand">
          <Decorations />
          <img className="auth-shell__logo" src="/brand/logo-white.png" alt="ChambersAI" />
          <div className="divider-gold divider-gold--left" aria-hidden="true">
            <span />
          </div>
          <p className="auth-shell__headline">Legal clarity, in conversation.</p>
          <p className="auth-shell__tagline">
            Talk through your legal question with an AI advocate matched to your situation.
          </p>
          <div className="auth-shell__badge">
            <RotatingBadge />
          </div>
        </div>
        <div className="auth-shell__panel page-fade" key={location.pathname}>
          {children}
        </div>
      </div>
    </div>
  );
}
