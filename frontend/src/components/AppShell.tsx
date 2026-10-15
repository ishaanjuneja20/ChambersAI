import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Home, MessageSquarePlus, History, Settings, PanelLeftClose, PanelLeftOpen, Menu, X } from "lucide-react";
import "./AppShell.css";

const COLLAPSE_KEY = "chambersai.sidebarCollapsed";

const NAV_ITEMS = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/consultation/new", label: "New Consultation", icon: MessageSquarePlus },
  { to: "/consultations", label: "My Consultations", icon: History },
  { to: "/profile", label: "Profile & Settings", icon: Settings },
];

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
  } catch {
    /* ignore: private browsing or blocked storage, collapse state just won't persist */
  }
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onRequestClose?: () => void; // only passed for the mobile slide-over copy
}

function Sidebar({ collapsed, onToggleCollapse, onRequestClose }: SidebarProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <aside className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}>
      <div className="sidebar__top">
        <img className="sidebar__logo" src="/brand/logo-white.png" alt="ChambersAI" />
        {onRequestClose ? (
          <button type="button" className="sidebar__collapse-btn" onClick={onRequestClose} aria-label="Close menu">
            <X size={18} />
          </button>
        ) : (
          <button
            type="button"
            className="sidebar__collapse-btn"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        )}
      </div>

      <nav className="sidebar__nav" aria-label="Primary">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <div className="nav-item" key={to}>
            <motion.div
              whileHover={prefersReducedMotion ? undefined : { scale: 1.04 }}
              transition={{ type: "spring", stiffness: 420, damping: 18 }}
            >
              <NavLink to={to} className={({ isActive }) => `nav-item__link${isActive ? " active" : ""}`} onClick={onRequestClose}>
                <span className="nav-item__icon">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="nav-item__label">{label}</span>
              </NavLink>
            </motion.div>
            {collapsed && !onRequestClose && <span className="nav-item__tooltip">{label}</span>}
          </div>
        ))}
      </nav>

      <p className="sidebar__footer-note">General information, not legal advice.</p>
    </aside>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => writeCollapsed(collapsed), [collapsed]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <div className="shell">
      <div className="shell__desktop-sidebar">
        <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="shell__backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              className="shell__mobile-sidebar"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 32 }}
            >
              <Sidebar collapsed={false} onToggleCollapse={() => setCollapsed((c) => !c)} onRequestClose={() => setMobileOpen(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="shell__main">
        <div className="shell__mobile-bar">
          <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
          <span className="shell__mobile-bar-logo">
            <img src="/brand/logo-white.png" alt="ChambersAI" />
          </span>
        </div>
        <div className="shell__content">{children}</div>
      </div>
    </div>
  );
}
