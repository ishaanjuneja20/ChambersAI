import type { Citation } from "../lib/contract";

const LABELS: Record<Citation["verification"], string> = {
  verified: "Verified source",
  interpretation: "AI interpretation",
  none: "No reliable source found",
};

export default function SourceBadge({ citation }: { citation: Citation }) {
  const content = (
    <>
      <span className={`source-badge__tag source-badge__tag--${citation.verification}`}>{LABELS[citation.verification]}</span>
      <span className="source-badge__label">{citation.label}</span>
    </>
  );
  if (citation.source_url) {
    return (
      <a className="source-badge" href={citation.source_url} target="_blank" rel="noreferrer">
        {content}
      </a>
    );
  }
  return <div className="source-badge source-badge--static">{content}</div>;
}
