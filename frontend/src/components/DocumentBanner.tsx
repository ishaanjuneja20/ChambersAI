import { FileText } from "lucide-react";
import { documentBannerTitle, useSessionDocuments } from "../lib/attachments";
import "./DocumentBanner.css";

// One line above a composer while the session has an analysed document: its questions are answered using it (Meet and Chat).
export default function DocumentBanner({ sessionId }: { sessionId: string }) {
  const documents = useSessionDocuments(sessionId);
  if (documents.length === 0) return null;
  const title = documentBannerTitle(documents);
  return (
    <p className="doc-banner" role="status" title={title}>
      <FileText size={14} aria-hidden="true" />
      <span className="doc-banner__text">
        Answering using your document: <strong>{title}</strong>
      </span>
    </p>
  );
}
