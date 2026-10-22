// Client for the backend's document analysis (docs/CONTRACTS.md, "Document analysis"):
//   POST   {VITE_API_URL}/sessions/{sessionId}/documents            multipart field "file" (a text PDF)
//   DELETE {VITE_API_URL}/sessions/{sessionId}/documents/{docId}
// Questions about the documents go to /sessions/{sessionId}/ask/stream (askApi.ts). The PDF itself is never kept in the browser's storage.

const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

/** True when a backend is configured; otherwise attachments stay local (demo mode: nothing is uploaded or analysed). */
export const documentsBackendEnabled = API_URL !== "";

export interface DocAnalysis {
  title: string;
  summary: string;
  key_points: string[];
  legal_issues: string[];
  risks: string[];
  dates_and_amounts: string[];
}

/** What the backend returns for an uploaded PDF, and what the session store keeps (plus when it was uploaded). */
export interface AnalysedDocument {
  doc_id: string;
  filename: string;
  pages: number;
  analysis: DocAnalysis;
}

/** The backend refused or failed the request; `message` is safe to show (the backend's own `detail` when it sent one). */
export class DocumentApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DocumentApiError";
  }
}

const NETWORK_MESSAGE = "Couldn't reach the server. Please try again.";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);

async function errorFrom(res: Response, fallback: string): Promise<DocumentApiError> {
  let detail = "";
  try {
    const body: unknown = await res.json();
    if (isRecord(body) && typeof body.detail === "string") detail = body.detail; // FastAPI validation errors send a list instead: use the fallback
  } catch {
    /* not JSON */
  }
  return new DocumentApiError(res.status, detail || fallback);
}

/** Validates the upload response; a body of the wrong shape is a failure, never half a card. */
export function toAnalysedDocument(raw: unknown): AnalysedDocument | null {
  if (!isRecord(raw) || typeof raw.doc_id !== "string" || !isRecord(raw.analysis)) return null;
  const a = raw.analysis;
  const filename = typeof raw.filename === "string" ? raw.filename : "";
  return {
    doc_id: raw.doc_id,
    filename,
    pages: typeof raw.pages === "number" ? raw.pages : 0,
    analysis: {
      title: typeof a.title === "string" && a.title.trim() ? a.title : filename || "Document",
      summary: typeof a.summary === "string" ? a.summary : "",
      key_points: strings(a.key_points),
      legal_issues: strings(a.legal_issues),
      risks: strings(a.risks),
      dates_and_amounts: strings(a.dates_and_amounts),
    },
  };
}

export interface UploadOptions {
  /** Aborting cancels the request. */
  signal?: AbortSignal;
  /** Defaults to VITE_API_URL. */
  baseUrl?: string;
}

/** Uploads a PDF and returns its analysis. Throws DocumentApiError (the 422 scanned-PDF / 413 / 409 / 503 messages come through as sent). */
export async function uploadDocument(sessionId: string, file: File, options: UploadOptions = {}): Promise<AnalysedDocument> {
  const base = (options.baseUrl ?? API_URL).replace(/\/$/, "");
  const body = new FormData();
  body.append("file", file);
  let res: Response;
  try {
    res = await fetch(`${base}/sessions/${encodeURIComponent(sessionId)}/documents`, { method: "POST", body, signal: options.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new DocumentApiError(0, NETWORK_MESSAGE);
  }
  if (!res.ok) throw await errorFrom(res, `The document couldn't be analysed (error ${res.status}). Please try again.`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const doc = toAnalysedDocument(json);
  if (!doc) throw new DocumentApiError(res.status, "The server sent an unexpected reply. Please try again.");
  return doc;
}

/** Deletes a document on the server. A 404 (already expired or removed) counts as deleted. Throws DocumentApiError otherwise. */
export async function deleteDocument(sessionId: string, docId: string, options: Pick<UploadOptions, "baseUrl"> = {}): Promise<void> {
  const base = (options.baseUrl ?? API_URL).replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/sessions/${encodeURIComponent(sessionId)}/documents/${encodeURIComponent(docId)}`, { method: "DELETE" });
  } catch {
    throw new DocumentApiError(0, NETWORK_MESSAGE);
  }
  if (res.ok || res.status === 404) return;
  throw await errorFrom(res, `The document couldn't be removed (error ${res.status}). Please try again.`);
}
