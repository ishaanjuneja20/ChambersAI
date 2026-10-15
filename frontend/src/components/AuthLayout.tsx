import type { ReactNode } from "react";
import "./AuthLayout.css";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-shell">
        <div className="auth-shell__brand">
          <img className="auth-shell__logo" src="/brand/logo-white.png" alt="ChambersAI" />
          <p className="auth-shell__tagline">
            Talk through your legal question with an AI advocate matched to your situation. General
            information to help you understand your options — not a replacement for a licensed
            advocate.
          </p>
        </div>
        <div className="auth-shell__panel">{children}</div>
      </div>
    </div>
  );
}
