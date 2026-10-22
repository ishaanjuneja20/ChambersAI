// Demo-mode consultation history, persisted to localStorage only in this browser. Once the
// backend owns GET/DELETE /sessions this file is replaced by calls through lawyersApi-style
// wrappers — see "Changes needed outside frontend/".
import type { TranscriptTurn } from "./consultTypes";
import type { AnalysedDocument } from "./documentsApi";

const KEY = "chambersai.sessions";
const DOCS_KEY = "chambersai.sessionDocs";

/** The backend forgets a document 24 hours after upload (docs/CONTRACTS.md), so a stored analysis older than that is dropped. */
export const DOC_TTL_MS = 24 * 60 * 60 * 1000;

/** An analysed document as kept with its session: the analysis the backend returned, never the PDF. */
export interface StoredDocument extends AnalysedDocument {
  uploadedAt: string;
  /** The size of the PDF, for the chip. */
  size: number;
}

export interface ConsultationSession {
  id: string;
  lawyerId: string;
  lawyerName: string;
  domain: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  transcript: TranscriptTurn[];
}

function readAll(): ConsultationSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ConsultationSession[]) : [];
  } catch {
    return [];
  }
}

function writeAll(sessions: ConsultationSession[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    /* ignore: private browsing or blocked storage */
  }
}

export function listSessions(): ConsultationSession[] {
  return readAll().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getSession(id: string): ConsultationSession | undefined {
  return readAll().find((s) => s.id === id);
}

export function upsertSession(session: ConsultationSession) {
  const all = readAll();
  const idx = all.findIndex((s) => s.id === session.id);
  if (idx >= 0) all[idx] = session;
  else all.unshift(session);
  writeAll(all);
}

// Analysed documents are kept per session id in their own key, beside the sessions: a document can be attached before the first
// question, when the session record does not exist yet.
function readDocs(): Record<string, StoredDocument[]> {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, StoredDocument[]>) : {};
  } catch {
    return {};
  }
}

function writeDocs(all: Record<string, StoredDocument[]>) {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(all));
  } catch {
    /* ignore: private browsing or blocked storage */
  }
}

/** The session's analysed documents that the backend still holds (less than 24 hours old). */
export function getSessionDocuments(sessionId: string, now = Date.now()): StoredDocument[] {
  const list = readDocs()[sessionId];
  if (!Array.isArray(list)) return [];
  return list.filter((d) => d && typeof d.doc_id === "string" && now - new Date(d.uploadedAt).getTime() < DOC_TTL_MS);
}

export function saveSessionDocuments(sessionId: string, documents: StoredDocument[]) {
  const all = readDocs();
  if (documents.length) all[sessionId] = documents;
  else delete all[sessionId];
  writeDocs(all);
}

export function deleteSession(id: string) {
  writeAll(readAll().filter((s) => s.id !== id));
  saveSessionDocuments(id, []);
}

export function deleteAllSessions() {
  writeAll([]);
  writeDocs({});
}
