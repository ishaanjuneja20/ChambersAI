import { FileText, X } from "lucide-react";
import { formatSize, type AttachedFile } from "../lib/attachments";
import "./AttachmentChips.css";

// The attached-file chips above a composer (Meet's input bar and the Chat composer).
export default function AttachmentChips({ files, onRemove }: { files: AttachedFile[]; onRemove: (id: string) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="meet-input-bar__chips">
      {files.map((f) => (
        <span key={f.id} className={`meet-input-bar__chip${f.status === "error" ? " meet-input-bar__chip--error" : ""}`}>
          <FileText size={14} aria-hidden="true" />
          <span className="meet-input-bar__chip-name">{f.file.name}</span>
          <span className="meet-input-bar__chip-meta">
            {f.status === "uploading" && "Uploading…"}
            {f.status === "attached" && "Attached"}
            {f.status === "demo" && "Attached (demo: not analysed)"}
            {f.status === "error" && (f.error ?? "Error")}
            {(f.status === "attached" || f.status === "demo") && ` · ${formatSize(f.file.size)}`}
          </span>
          <button type="button" className="meet-input-bar__chip-remove" aria-label={`Remove ${f.file.name}`} onClick={() => onRemove(f.id)}>
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}
