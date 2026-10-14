import { useState } from "react";
import type { Citation, TimelineEvent, EvidenceItem } from "../lib/contract";
import SourceBadge from "./SourceBadge";

interface CaseIntelligencePanelProps {
  citations: Citation[];
  nextSteps?: string[];
  timeline?: TimelineEvent[];
  evidence?: EvidenceItem[];
}

const EVIDENCE_LABEL: Record<EvidenceItem["status"], string> = {
  have: "Have",
  missing: "Missing",
  needs_confirmation: "Needs confirmation",
};

export default function CaseIntelligencePanel({ citations, nextSteps, timeline, evidence }: CaseIntelligencePanelProps) {
  const [tab, setTab] = useState<"sources" | "timeline" | "evidence">("sources");

  return (
    <aside className="case-panel" aria-label="Case intelligence">
      <div className="case-panel__tabs" role="tablist">
        <button role="tab" aria-selected={tab === "sources"} className={`case-panel__tab${tab === "sources" ? " case-panel__tab--active" : ""}`} onClick={() => setTab("sources")}>
          Legal sources
        </button>
        <button role="tab" aria-selected={tab === "timeline"} className={`case-panel__tab${tab === "timeline" ? " case-panel__tab--active" : ""}`} onClick={() => setTab("timeline")}>
          Timeline
          <span className="badge badge--demo-mini">demo</span>
        </button>
        <button role="tab" aria-selected={tab === "evidence"} className={`case-panel__tab${tab === "evidence" ? " case-panel__tab--active" : ""}`} onClick={() => setTab("evidence")}>
          Evidence
          <span className="badge badge--demo-mini">demo</span>
        </button>
      </div>

      {tab === "sources" && (
        <div className="case-panel__section">
          {citations.length === 0 ? (
            <p className="case-panel__empty">No sources cited yet.</p>
          ) : (
            <ul className="source-list">
              {citations.map((c, i) => (
                <li key={i}>
                  <SourceBadge citation={c} />
                </li>
              ))}
            </ul>
          )}
          {nextSteps && nextSteps.length > 0 && (
            <div className="case-panel__next-steps">
              <h3>Next steps</h3>
              <ul>
                {nextSteps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "timeline" && (
        <div className="case-panel__section">
          <p className="case-panel__demo-note">Demo data only — not connected to a real case yet.</p>
          <ol className="timeline-list">
            {(timeline ?? []).map((t) => (
              <li key={t.id}>
                <span className="timeline-list__date">{t.date}</span>
                <span>{t.description}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {tab === "evidence" && (
        <div className="case-panel__section">
          <p className="case-panel__demo-note">Demo data only — not connected to a real case yet.</p>
          <ul className="evidence-list">
            {(evidence ?? []).map((e) => (
              <li key={e.id} className={`evidence-list__item evidence-list__item--${e.status}`}>
                <span>{e.label}</span>
                <span className="evidence-list__status">{EVIDENCE_LABEL[e.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
