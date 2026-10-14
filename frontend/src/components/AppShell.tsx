import { type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { DEMO_MODE } from "../lib/contract";

const NAV_ITEMS = [
  { to: "/home", label: "New consultation" },
  { to: "/consultations", label: "My consultations" },
  { to: "/profile", label: "Profile & settings" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="brand-mark" aria-hidden="true" />
          ChambersAI
        </div>
        <nav className="app-header__nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="app-header__user">
          {DEMO_MODE && <span className="badge badge--demo">Demo mode</span>}
          {user && (
            <button className="btn btn--ghost btn--small" onClick={() => signOut()}>
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">General legal information, not legal advice.</footer>
    </div>
  );
}
