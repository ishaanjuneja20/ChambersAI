import { FileText, Loader2, X } from "lucide-react";
import { formatSize, type AttachedFile } from "../lib/attachments";
import "./AttachmentChips.css";

const STATUS_TEXT: Partial<Record<AttachedFile["status"], string>> = {
  uploading: "Uploading…",
  analysing: "Analysing…",
  attached: "Analysed",
  demo: "Attached (demo: not analysed)",
};

// The attached-file chips above a composer (Meet's input bar and the Chat composer). A failed upload shows the backend's message under its chip.
export default function AttachmentChips({ files, onRemove }: { files: AttachedFile[]; onRemove: (id: string) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="meet-input-bar__chips">
      {files.map((f) => {
        const busy = f.status === "uploading" || f.status === "analysing" || f.removing;
        return (
          <div key={f.id} className="meet-input-bar__chip-wrap">
            <span className={`meet-input-bar__chip${f.status === "error" ? " meet-input-bar__chip--error" : ""}`} aria-busy={busy || undefined}>
              {busy ? <Loader2 size={14} className="meet-input-bar__chip-spinner" aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
              <span className="meet-input-bar__chip-name">{f.name}</span>
              <span className="meet-input-bar__chip-meta" role={busy ? "status" : undefined}>
                {f.removing ? "Removing…" : f.status === "error" ? "Failed" : STATUS_TEXT[f.status]}
                {(f.status === "attached" || f.status === "demo") && !f.removing && ` · ${formatSize(f.size)}`}
              </span>
              <button type="button" className="meet-input-bar__chip-remove" aria-label={`Remove ${f.name}`} disabled={f.removing} onClick={() => onRemove(f.id)}>
                <X size={12} />
              </button>
            </span>
            {f.error && (
              <p className="meet-input-bar__chip-error" role="alert">
                {f.error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
