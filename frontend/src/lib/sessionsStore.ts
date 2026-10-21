// Demo-mode consultation history, persisted to localStorage only in this browser. Once the
// backend owns GET/DELETE /sessions this file is replaced by calls through lawyersApi-style
// wrappers — see "Changes needed outside frontend/".
import type { TranscriptTurn } from "./consultTypes";

const KEY = "chambersai.sessions";

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

export function deleteSession(id: string) {
  writeAll(readAll().filter((s) => s.id !== id));
}

export function deleteAllSessions() {
  writeAll([]);
}
