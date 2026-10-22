// Document attachments for a consultation, shared by the live page (MeetInputBar), the chat page and the Documents tab. The list is kept
// per session in memory, so switching between Meet and Chat keeps the same documents. With a backend, a PDF is uploaded and analysed
// (documentsApi.ts); the analysis (never the PDF) is also saved with the session (sessionsStore.ts) and comes back after a reload.
// Without one (demo mode) the file just stays in the browser as before.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { deleteDocument, documentsBackendEnabled, uploadDocument, DocumentApiError, type AnalysedDocument } from "./documentsApi";
import { getSessionDocuments, saveSessionDocuments } from "./sessionsStore";

/** Demo mode accepts all of these (nothing is read); with a backend only PDFs are, because only text PDFs can be analysed. */
export const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".txt", ".png", ".jpg", ".jpeg"];
export const BACKEND_EXTENSIONS = [".pdf"];
/** What the file pickers offer. */
export const ACCEPTED_EXTENSIONS = documentsBackendEnabled ? BACKEND_EXTENSIONS : ALLOWED_EXTENSIONS;
export const MAX_FILES = 5;
/** The backend keeps at most 3 documents per session. */
export const MAX_BACKEND_FILES = 3;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const ONLY_PDF_MESSAGE = "Only text PDFs are supported";

/** How long the chip says "Uploading…" before it says "Analysing…". fetch() reports no upload progress, and the analysis is the long part. */
export const ANALYSING_AFTER_MS = 1200;

export type AttachedStatus = "uploading" | "analysing" | "attached" | "demo" | "error";

export type AttachedFile = {
  id: string;
  sessionId: string;
  name: string;
  size: number;
  status: AttachedStatus;
  /** The upload error (status "error"), or why a removal failed (status unchanged). */
  error?: string;
  /** The backend's analysis, once uploaded. Kept with the session. */
  doc?: AnalysedDocument;
  uploadedAt?: string;
  /** The DELETE is in flight. */
  removing?: boolean;
};

export interface AttachOptions {
  /** Defaults to whether VITE_API_URL is set. */
  backend?: boolean;
  /** Defaults to VITE_API_URL. */
  baseUrl?: string;
  analysingAfterMs?: number;
}

export function isAllowedFile(file: File, backend = documentsBackendEnabled): boolean {
  const name = file.name.toLowerCase();
  return (backend ? BACKEND_EXTENSIONS : ALLOWED_EXTENSIONS).some((ext) => name.endsWith(ext));
}

export const maxFiles = (backend = documentsBackendEnabled) => (backend ? MAX_BACKEND_FILES : MAX_FILES);

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- per-session store ----
const EMPTY: AttachedFile[] = [];
const bySession = new Map<string, AttachedFile[]>();
const inFlight = new Map<string, AbortController>(); // uploads that can still be cut off, by file id
const listeners = new Set<() => void>();

// The first read of a session brings back its saved analyses (a reload; the same list from then on, so the snapshot is stable).
function filesOf(sessionId: string): AttachedFile[] {
  let files = bySession.get(sessionId);
  if (!files) {
    files = documentsBackendEnabled
      ? getSessionDocuments(sessionId).map((d) => ({
          id: `doc-${d.doc_id}`,
          sessionId,
          name: d.filename,
          size: d.size,
          status: "attached" as const,
          doc: { doc_id: d.doc_id, filename: d.filename, pages: d.pages, analysis: d.analysis },
          uploadedAt: d.uploadedAt,
        }))
      : EMPTY;
    bySession.set(sessionId, files);
  }
  return files;
}

function persist(sessionId: string, files: AttachedFile[]) {
  saveSessionDocuments(
    sessionId,
    files.flatMap((f) => (f.doc && f.uploadedAt ? [{ ...f.doc, size: f.size, uploadedAt: f.uploadedAt }] : [])),
  );
}

function update(sessionId: string, fn: (files: AttachedFile[]) => AttachedFile[]) {
  const next = fn(filesOf(sessionId));
  bySession.set(sessionId, next);
  persist(sessionId, next);
  listeners.forEach((listener) => listener());
}

const patch = (sessionId: string, id: string, changes: Partial<AttachedFile>) =>
  update(sessionId, (files) => files.map((f) => (f.id === id ? { ...f, ...changes } : f)));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const getSessionFiles = filesOf;

/** The documents of this session that have been analysed: while there is one, questions go to the document endpoint. */
export function getAnalysedDocuments(sessionId: string): AnalysedDocument[] {
  return filesOf(sessionId).flatMap((f) => (f.doc && f.status === "attached" && !f.removing ? [f.doc] : []));
}

/** The files attached in this session (read-only; the same list Meet and Chat both show). */
export function useSessionFiles(sessionId: string): AttachedFile[] {
  return useSyncExternalStore(subscribe, () => filesOf(sessionId));
}

/** The title shown in the "Answering using your document" banner: the first one's, plus how many more. */
export function documentBannerTitle(docs: AnalysedDocument[]): string {
  if (docs.length === 0) return "";
  const title = docs[0].analysis.title;
  return docs.length === 1 ? title : `${title} and ${docs.length - 1} more`;
}

/** The session id to ask with: the session's own endpoint (which reads its documents) while it has an analysed one, else undefined (the plain /ask/stream). */
export const sessionForAsk = (sessionId: string): string | undefined => (getAnalysedDocuments(sessionId).length > 0 ? sessionId : undefined);

/** The analysed documents of the session, kept current as they are added and removed. */
export function useSessionDocuments(sessionId: string): AnalysedDocument[] {
  const files = useSessionFiles(sessionId);
  return files.flatMap((f) => (f.doc && f.status === "attached" && !f.removing ? [f.doc] : []));
}

const messageOf = (error: unknown) => (error instanceof DocumentApiError ? error.message : "Upload failed");

/**
 * Adds files to a session. Returns the reason some were turned away (null when all were taken) and a promise that settles once
 * every upload has finished (it never rejects: a failed upload is a file with status "error").
 */
export function attachFiles(sessionId: string, incoming: FileList | File[], options: AttachOptions = {}): { rejection: string | null; done: Promise<void> } {
  const backend = options.backend ?? documentsBackendEnabled;
  const limit = maxFiles(backend);
  const list = Array.from(incoming);
  const none = { rejection: null, done: Promise.resolve() };
  if (list.length === 0) return none;

  const active = filesOf(sessionId).filter((f) => f.status !== "error").length; // a failed upload frees its place
  const limitMessage = `You can attach up to ${limit} ${backend ? "documents" : "files"}.`;
  if (limit - active <= 0) return { rejection: limitMessage, done: Promise.resolve() };

  const accepted: File[] = [];
  let rejection: string | null = null;
  for (const file of list) {
    if (accepted.length >= limit - active) {
      rejection = limitMessage;
      break;
    }
    if (!isAllowedFile(file, backend)) {
      rejection = backend ? ONLY_PDF_MESSAGE : `${file.name} isn't supported. Use PDF, Word, text or image files.`;
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      rejection = `${file.name} is larger than 10 MB.`;
      continue;
    }
    accepted.push(file);
  }

  const uploads = accepted.map((file) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    update(sessionId, (prev) => [...prev, { id, sessionId, name: file.name, size: file.size, status: "uploading" }]);

    if (!backend) {
      // Demo mode: a mocked round trip; the file stays in the browser, not analysed.
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          patch(sessionId, id, { status: "demo" });
          resolve();
        }, 450),
      );
    }

    const controller = new AbortController();
    inFlight.set(id, controller);
    const toAnalysing = setTimeout(() => {
      if (filesOf(sessionId).some((f) => f.id === id && f.status === "uploading")) patch(sessionId, id, { status: "analysing" });
    }, options.analysingAfterMs ?? ANALYSING_AFTER_MS);

    return uploadDocument(sessionId, file, { signal: controller.signal, baseUrl: options.baseUrl })
      .then((doc) => patch(sessionId, id, { status: "attached", doc, uploadedAt: new Date().toISOString(), error: undefined }))
      .catch((error) => {
        if (controller.signal.aborted) return; // removed while uploading: nothing to show
        patch(sessionId, id, { status: "error", error: messageOf(error) });
      })
      .finally(() => {
        clearTimeout(toAnalysing);
        inFlight.delete(id);
      });
  });

  return { rejection, done: Promise.all(uploads).then(() => undefined) };
}

/**
 * Removes a file. An analysed document is deleted on the server first (it is kept in the list, with a message, if that fails);
 * an upload in progress is cut off. Resolves to an error message, or null when it is gone.
 */
export async function removeAttachedFile(file: AttachedFile, options: Pick<AttachOptions, "baseUrl"> = {}): Promise<string | null> {
  inFlight.get(file.id)?.abort();
  inFlight.delete(file.id);
  if (file.doc && documentsBackendEnabled) {
    patch(file.sessionId, file.id, { removing: true, error: undefined });
    try {
      await deleteDocument(file.sessionId, file.doc.doc_id, options);
    } catch (error) {
      const message = error instanceof DocumentApiError ? error.message : "Couldn't remove the document. Please try again.";
      patch(file.sessionId, file.id, { removing: false, error: message });
      return message;
    }
  }
  update(file.sessionId, (prev) => prev.filter((f) => f.id !== file.id));
  return null;
}

/** Attach / remove documents for a session, with the shared limits and upload behaviour. `enabled` false ignores new files. */
export function useAttachments(sessionId: string, enabled: boolean) {
  const files = useSessionFiles(sessionId);
  const [error, setError] = useState<string | null>(null);
  const errorTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(errorTimer.current), []);

  const showError = useCallback((message: string) => {
    setError(message);
    window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setError(null), 5000);
  }, []);

  const addFiles = (incoming: FileList | File[]) => {
    if (!enabled) return;
    const { rejection } = attachFiles(sessionId, incoming);
    if (rejection) showError(rejection);
  };

  const removeFile = (id: string) => {
    const file = files.find((f) => f.id === id);
    if (file) void removeAttachedFile(file);
  };

  return { files, error, addFiles, removeFile, atLimit: files.filter((f) => f.status !== "error").length >= maxFiles() };
}
