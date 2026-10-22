import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useReducedMotion } from "framer-motion";
import { ChevronUp, FileText, X } from "lucide-react";
import type { Citation, TranscriptTurn } from "../../lib/consultTypes";
import { formatSize, type AttachedFile } from "../../lib/attachments";
import SourcesPanel from "../SourcesPanel";
import GeneralTag from "../GeneralTag";
import { showGeneralNotice } from "../../lib/generalAnswer";
import PageTaggedText from "../PageTaggedText";
import DocumentCard from "./DocumentCard";
import type { LiveCaption } from "./Subtitles";

export type TabKey = "transcript" | "sources" | "documents";

const FILE_STATUS: Record<AttachedFile["status"], string> = {
  uploading: "Uploading…",
  analysing: "Analysing…",
  attached: "Analysed",
  demo: "Attached (demo: not analysed)",
  error: "Upload failed",
};

interface RoomPanelProps {
  id: string;
  transcript: TranscriptTurn[];
  liveCaption: LiveCaption | null;
  citations: Citation[];
  files: AttachedFile[];
  /** Which tabs to show, in order (default: Transcript, Sources, Documents). The chat page has no transcript tab: its thread is the page. */
  tabKeys?: TabKey[];
  /** Tablet: the panel is a drawer, so it gets a close button. */
  onClose: () => void;
  /** Phone: the panel is a bottom sheet; the handle expands / collapses it. */
  expanded: boolean;
  onToggleExpanded: (expanded?: boolean) => void;
}

export default function RoomPanel({
  id,
  transcript,
  liveCaption,
  citations,
  files,
  tabKeys = ["transcript", "sources", "documents"],
  onClose,
  expanded,
  onToggleExpanded,
}: RoomPanelProps) {
  const [tab, setTab] = useState<TabKey>(tabKeys[0]);
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    transcript: null,
    sources: null,
    documents: null,
  });
  const reduceMotion = useReducedMotion();
  const dragStart = useRef<number | null>(null);

  const allTabs: { key: TabKey; label: string; count: number }[] = [
    { key: "transcript", label: "Transcript", count: 0 },
    { key: "sources", label: "Sources", count: citations.length },
    { key: "documents", label: "Documents", count: files.length },
  ];
  const tabs = tabKeys.map((key) => allTabs.find((t) => t.key === key)!);

  // Newest message in view; the live caption counts as the last, in-progress message.
  useEffect(() => {
    if (tab !== "transcript") return;
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [transcript, liveCaption, tab, expanded, reduceMotion]);

  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.key === tab);
    const next = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setTab(tabs[next].key);
    tabRefs.current[tabs[next].key]?.focus();
  };

  // Phone bottom sheet: tap the handle, or swipe it up / down.
  const onHandleDown = (e: PointerEvent) => {
    dragStart.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId); // the release arrives here even if the pointer has moved off the handle
  };
  const onHandleUp = (e: PointerEvent) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (start === null) return;
    const dy = e.clientY - start;
    if (Math.abs(dy) < 8) onToggleExpanded();
    else onToggleExpanded(dy < 0);
  };

  return (
    <section className="room-panel" id={id} aria-label="Conversation details">
      <button
        type="button"
        className="room-panel__handle"
        aria-label={expanded ? "Collapse panel" : "Expand panel"}
        aria-expanded={expanded}
        onPointerDown={onHandleDown}
        onPointerUp={onHandleUp}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpanded();
          }
        }}
      >
        <span aria-hidden="true" />
        <ChevronUp size={16} className="room-panel__handle-icon" aria-hidden="true" />
      </button>

      <div className="room-panel__head">
        <div className="room-panel__tabs" role="tablist" aria-label="Conversation details" onKeyDown={onTabKeyDown}>
          {tabs.map((t) => (
            <button
              key={t.key}
              ref={(el) => (tabRefs.current[t.key] = el)}
              type="button"
              role="tab"
              id={`${id}-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`${id}-panel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              className={`room-panel__tab${tab === t.key ? " room-panel__tab--active" : ""}`}
              onClick={() => {
                setTab(t.key);
                if (!expanded) onToggleExpanded(true);
              }}
            >
              {t.label}
              {t.count > 0 && (
                <span className="room-panel__count" aria-label={`${t.count} ${t.key === "sources" ? "sources" : "files"}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <button type="button" className="room-panel__close" onClick={onClose} aria-label="Close panel">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="room-panel__body" ref={listRef}>
        {tabKeys.includes("transcript") && (
          <div role="tabpanel" id={`${id}-panel-transcript`} aria-labelledby={`${id}-tab-transcript`} hidden={tab !== "transcript"} tabIndex={0} className="room-panel__pane">
            <div className="room-transcript" aria-live="polite" aria-relevant="additions text">
              {transcript.length === 0 && !liveCaption && <p className="room-panel__empty">No messages yet. Ask a question to begin.</p>}
              {transcript.map((turn) => (
                <Fragment key={turn.id}>
                  {showGeneralNotice(turn.general) && <GeneralTag className="room-turn__tag" />}
                  <p className={`room-turn room-turn--${turn.role}${showGeneralNotice(turn.general) ? " room-turn--general" : ""}`}>
                    <PageTaggedText text={turn.text} />
                  </p>
                </Fragment>
              ))}
              {liveCaption && (
                <>
                  {showGeneralNotice(liveCaption.general) && <GeneralTag className="room-turn__tag" />}
                  <p className={`room-turn room-turn--lawyer room-turn--live${showGeneralNotice(liveCaption.general) ? " room-turn--general" : ""}`}>{liveCaption.text.slice(0, liveCaption.visibleChars) || "…"}</p>
                </>
              )}
            </div>
          </div>
        )}

        <div role="tabpanel" id={`${id}-panel-sources`} aria-labelledby={`${id}-tab-sources`} hidden={tab !== "sources"} tabIndex={0} className="room-panel__pane">
          <SourcesPanel citations={citations} embedded />
        </div>

        <div role="tabpanel" id={`${id}-panel-documents`} aria-labelledby={`${id}-tab-documents`} hidden={tab !== "documents"} tabIndex={0} className="room-panel__pane">
          {files.length === 0 ? (
            <p className="room-panel__empty">No documents attached in this session.</p>
          ) : (
            <ul className="room-docs">
              {files.map((f) =>
                f.doc && f.status === "attached" ? (
                  <li key={f.id}>
                    <DocumentCard file={f} />
                  </li>
                ) : (
                  <li key={f.id} className={`room-doc${f.status === "error" ? " room-doc--error" : ""}`}>
                    <FileText size={18} aria-hidden="true" />
                    <span className="room-doc__name">{f.name}</span>
                    <span className="room-doc__meta">
                      {formatSize(f.size)} · {f.status === "error" ? (f.error ?? FILE_STATUS.error) : FILE_STATUS[f.status]}
                    </span>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
