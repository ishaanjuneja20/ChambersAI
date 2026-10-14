// Demo-mode "My Consultations" persistence. Purely local to this browser (localStorage) —
// once the backend owns /sessions this whole file is replaced by api.ts calls.
import type { SessionSummaryItem, TranscriptTurn } from "./contract";

const KEY = "chambersai.sessions";

interface StoredSession extends SessionSummaryItem {
  transcript: TranscriptTurn[];
}

function readAll(): StoredSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredSession[]) : [];
  } catch {
    return [];
  }
}

function writeAll(sessions: StoredSession[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    /* ignore: storage unavailable */
  }
}

export function listSessions(): SessionSummaryItem[] {
  return readAll()
    .map(({ transcript, ...summary }) => summary)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getSession(id: string): StoredSession | undefined {
  return readAll().find((s) => s.id === id);
}

export function upsertSession(session: StoredSession) {
  const all = readAll();
  const idx = all.findIndex((s) => s.id === session.id);
  if (idx >= 0) all[idx] = session;
  else all.unshift(session);
  writeAll(all);
}

export function deleteSession(id: string) {
  writeAll(readAll().filter((s) => s.id !== id));
}

export function deleteAllSessions() {
  writeAll([]);
}
