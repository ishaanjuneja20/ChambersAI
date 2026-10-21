// Document attachments for a consultation, shared by the live page (MeetInputBar) and the chat page. The list is kept per session in
// memory (File objects can't be stored in localStorage), so switching between Meet and Chat within the app keeps the same documents.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".txt", ".png", ".jpg", ".jpeg"];
export const MAX_FILES = 5;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

export type AttachedFile = {
  id: string;
  file: File;
  status: "uploading" | "attached" | "demo" | "error";
  error?: string;
};

export function isAllowedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Backend contract (proposed, not built yet): POST /sessions/{session_id}/documents (multipart,
// field "file"). In demo mode (no VITE_API_URL) this just mocks the round trip.
async function uploadDocument(sessionId: string, file: File): Promise<void> {
  if (!API_URL) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return;
  }
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_URL}/sessions/${sessionId}/documents`, { method: "POST", body });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}

// ---- per-session store ----
const EMPTY: AttachedFile[] = [];
const bySession = new Map<string, AttachedFile[]>();
const listeners = new Set<() => void>();

function update(sessionId: string, fn: (files: AttachedFile[]) => AttachedFile[]) {
  bySession.set(sessionId, fn(bySession.get(sessionId) ?? EMPTY));
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The files attached in this session (read-only; the same list Meet and Chat both show). */
export function useSessionFiles(sessionId: string): AttachedFile[] {
  return useSyncExternalStore(subscribe, () => bySession.get(sessionId) ?? EMPTY);
}

/** Attach / remove documents for a session, with the shared limits and (demo-mode) upload behaviour. `enabled` false ignores new files. */
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
    const list = Array.from(incoming);
    if (list.length === 0) return;

    const room = MAX_FILES - files.length;
    if (room <= 0) {
      showError(`You can attach up to ${MAX_FILES} files.`);
      return;
    }

    const accepted: File[] = [];
    let rejection: string | null = null;
    for (const file of list) {
      if (accepted.length >= room) {
        rejection = `You can attach up to ${MAX_FILES} files.`;
        break;
      }
      if (!isAllowedFile(file)) {
        rejection = `${file.name} isn't supported. Use PDF, Word, text or image files.`;
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        rejection = `${file.name} is larger than 10 MB.`;
        continue;
      }
      accepted.push(file);
    }
    if (rejection) showError(rejection);

    for (const file of accepted) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      update(sessionId, (prev) => [...prev, { id, file, status: "uploading" }]);
      uploadDocument(sessionId, file)
        .then(() => update(sessionId, (prev) => prev.map((f) => (f.id === id ? { ...f, status: API_URL ? "attached" : "demo" } : f))))
        .catch(() => update(sessionId, (prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: "Upload failed" } : f))));
    }
  };

  const removeFile = (id: string) => update(sessionId, (prev) => prev.filter((f) => f.id !== id));

  return { files, error, addFiles, removeFile, atLimit: files.length >= MAX_FILES };
}
