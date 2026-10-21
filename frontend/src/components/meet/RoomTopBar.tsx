import type { ReactNode } from "react";
import { ArrowLeft, MessageSquare, PanelRightClose, PanelRightOpen } from "lucide-react";
import SessionTimer from "./SessionTimer";

interface RoomTopBarProps {
  name: string;
  practice: string;
  panelOpen: boolean;
  panelId: string;
  onBack: () => void;
  /** The mode-switch button: "Switch to chat" on the live page, "Switch to live consultation" on the chat page. */
  switchLabel?: string;
  switchIcon?: ReactNode;
  onSwitch: () => void;
  onTogglePanel: () => void;
  /** What the panel toggle calls the panel, for screen readers. */
  panelNoun?: string;
}

export default function RoomTopBar({ name, practice, panelOpen, panelId, onBack, switchLabel = "Switch to chat", switchIcon, onSwitch, onTogglePanel, panelNoun = "transcript panel" }: RoomTopBarProps) {
  return (
    <header className="room-bar">
      <button type="button" className="room-bar__icon room-bar__back" onClick={onBack} aria-label="Back to profile">
        <ArrowLeft size={18} aria-hidden="true" />
      </button>
      <div className="room-bar__who">
        <h1>{name}</h1>
        <p>{practice}</p>
      </div>
      <div className="room-bar__meta">
        <SessionTimer />
      </div>
      <button type="button" className="room-bar__chat" onClick={onSwitch} aria-label={switchLabel}>
        {switchIcon ?? <MessageSquare size={16} aria-hidden="true" />}
        <span className="room-bar__chat-label">{switchLabel}</span>
      </button>
      <button type="button" className="room-bar__icon room-bar__toggle" onClick={onTogglePanel} aria-label={panelOpen ? `Hide ${panelNoun}` : `Show ${panelNoun}`} aria-expanded={panelOpen} aria-controls={panelId}>
        {panelOpen ? <PanelRightClose size={18} aria-hidden="true" /> : <PanelRightOpen size={18} aria-hidden="true" />}
      </button>
    </header>
  );
}
