import type { Citation } from "../lib/consultTypes";
import "./SourcesPanel.css";

const LABELS: Record<Citation["confidence"], string> = {
  verified: "Verified source",
  interpretation: "AI interpretation",
  none: "No reliable source found",
};

function SourceBadge({ citation }: { citation: Citation }) {
  const content = (
    <>
      <span className={`source-badge__tag source-badge__tag--${citation.confidence}`}>{LABELS[citation.confidence]}</span>
      <span className="source-badge__label">{citation.label}</span>
    </>
  );
  if (citation.sourceUrl) {
    return (
      <a className="source-badge" href={citation.sourceUrl} target="_blank" rel="noreferrer">
        {content}
      </a>
    );
  }
  return <div className="source-badge">{content}</div>;
}

export default function SourcesPanel({ citations }: { citations: Citation[] }) {
  return (
    <aside className="sources-panel card" aria-label="Sources">
      <h3>Sources</h3>
      {citations.length === 0 ? (
        <p className="sources-panel__empty">No sources cited yet.</p>
      ) : (
        <ul className="source-list">
          {citations.map((c, i) => (
            <li key={i}>
              <SourceBadge citation={c} />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
