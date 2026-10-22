import { FileText, Loader2, Trash2 } from "lucide-react";
import { formatSize, removeAttachedFile, type AttachedFile } from "../../lib/attachments";
import type { DocAnalysis } from "../../lib/documentsApi";
import "./DocumentCard.css";

const SECTIONS: { key: keyof Pick<DocAnalysis, "key_points" | "legal_issues" | "risks" | "dates_and_amounts">; label: string }[] = [
  { key: "key_points", label: "Key points" },
  { key: "legal_issues", label: "Legal issues" },
  { key: "risks", label: "Risks" },
  { key: "dates_and_amounts", label: "Dates and amounts" },
];

// One analysed document in the Documents tab: title, pages, summary, then a collapsible list per section (empty ones are left out).
export default function DocumentCard({ file }: { file: AttachedFile }) {
  const doc = file.doc!;
  const { analysis } = doc;
  return (
    <article className="doc-card" aria-label={analysis.title}>
      <header className="doc-card__head">
        <FileText size={18} aria-hidden="true" />
        <div className="doc-card__heading">
          <h4 className="doc-card__title">{analysis.title}</h4>
          <p className="doc-card__meta">
            {doc.pages} {doc.pages === 1 ? "page" : "pages"} · {formatSize(file.size)}
            {doc.filename && doc.filename !== analysis.title && <> · {doc.filename}</>}
          </p>
        </div>
        <button type="button" className="doc-card__remove" aria-label={`Remove ${analysis.title}`} disabled={file.removing} onClick={() => void removeAttachedFile(file)}>
          {file.removing ? <Loader2 size={16} className="doc-card__spinner" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
        </button>
      </header>
      {file.error && (
        <p className="doc-card__error" role="alert">
          {file.error}
        </p>
      )}
      {analysis.summary && <p className="doc-card__summary">{analysis.summary}</p>}
      {SECTIONS.map(({ key, label }) =>
        analysis[key].length === 0 ? null : (
          <details key={key} className="doc-card__section">
            <summary>
              {label} <span className="doc-card__count">{analysis[key].length}</span>
            </summary>
            <ul>
              {analysis[key].map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </details>
        ),
      )}
    </article>
  );
}
