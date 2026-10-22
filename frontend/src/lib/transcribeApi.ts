// Speech-to-text through the backend, POST /api/transcribe (multipart, field "audio_file"; docs/CONTRACTS.md, backend/main.py).
// The browser holds no keys. The uploaded recording is the source of truth for what the user said; the browser's own
// SpeechRecognition transcript is only a fallback when the upload fails. Without a backend (demo mode) it is all there is.

import { detectMetaIntent } from "./metaIntent";

const BASE = (import.meta.env.VITE_TTS_API_URL || import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

/** True when a backend is configured; otherwise voice stays browser-only. */
export const transcribeEnabled = BASE !== "";

// Short, because they show in a single line under the input bar.
export const MSG_NOTHING_HEARD = "Didn't catch that. Please try again.";
export const MSG_UNAVAILABLE = "Voice isn't available right now. Please type your question.";
export const MSG_FAILED = "Couldn't transcribe that. Try again, or type your question.";

const TIMEOUT_MS = 30000;

// ---- What counts as "nothing was said". Edit the numbers and the list here.

/** A recording shorter than this is a tap, not a question: it is not uploaded. */
export const MIN_RECORDING_MS = 700;
/** Loudest the microphone ever got (0 = silence, 1 = full scale). A recording that never rose above this is room noise: not uploaded. */
export const MIN_PEAK_LEVEL = 0.02;
/** A transcript with fewer letters than this (after dropping punctuation and spaces) is not a question. */
export const MIN_TRANSCRIPT_CHARS = 4;
/** What the speech model tends to "hear" in silence or noise. Compared with the whole transcript, ignoring case and punctuation. */
export const SILENCE_HALLUCINATIONS = ["thank you", "thanks", "thanks for watching", "thank you for watching", "you", "bye", "okay", "ok", "uh", "hmm", "so"];

/** Lower case, punctuation and symbols turned into spaces, spaces collapsed: "Thank you." -> "thank you". */
export function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when a transcript should not be sent as a question: too short, only punctuation, or a known silence hallucination.
 * A greeting or help request ("Hi.", "Hey", "Help") is short but real: it is answered with the lawyer's introduction.
 */
export function isJunkTranscript(text: string): boolean {
  const normalized = normalizeTranscript(text);
  if (SILENCE_HALLUCINATIONS.includes(normalized)) return true;
  if (detectMetaIntent(text)) return false;
  return normalized.replace(/\s/g, "").length < MIN_TRANSCRIPT_CHARS;
}

/** False for a recording too short or too quiet to hold speech. A measurement that is not available (undefined) is not held against it. */
export function isRecordingUsable(measure: { durationMs?: number; peakLevel?: number }): boolean {
  if (measure.durationMs !== undefined && measure.durationMs < MIN_RECORDING_MS) return false;
  if (measure.peakLevel !== undefined && measure.peakLevel < MIN_PEAK_LEVEL) return false;
  return true;
}

/** The backend answered with a non-2xx status (503: voice is not configured on the server; 413: over 15 MB). */
export class TranscribeHttpError extends Error {
  constructor(readonly status: number) {
    super(`POST /api/transcribe failed: ${status}`);
    this.name = "TranscribeHttpError";
  }
}

const extensionFor = (type: string) => (/mp4|aac/.test(type) ? "mp4" : /ogg/.test(type) ? "ogg" : "webm");

/** Uploads one recording and returns the transcript (trimmed; "" when nothing was said). Rejects on any failure; aborting `signal` rejects with an AbortError. */
export async function transcribeRecording(blob: Blob, options: { baseUrl?: string; signal?: AbortSignal } = {}): Promise<string> {
  const base = (options.baseUrl ?? BASE).replace(/\/$/, "");
  const form = new FormData();
  form.append("audio_file", blob, `recording.${extensionFor(blob.type)}`);

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const relay = () => timeout.abort();
  options.signal?.addEventListener("abort", relay);
  try {
    const res = await fetch(`${base}/api/transcribe`, { method: "POST", body: form, signal: timeout.signal });
    if (!res.ok) throw new TranscribeHttpError(res.status);
    const data: unknown = await res.json();
    const text = typeof data === "object" && data !== null && "text" in data ? (data as { text: unknown }).text : undefined;
    if (typeof text !== "string") throw new Error("POST /api/transcribe returned no text");
    return text.trim();
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", relay);
  }
}

export type SpokenText = { text: string } | { error: string };

/**
 * What the user said, once they stop talking. `blob` is the recording (null when nothing was captured),
 * `browserText` the live SpeechRecognition transcript (may be empty), `durationMs` and `peakLevel` how long and
 * how loud the recording was. Never returns an empty or junk text: that is an error (isJunkTranscript, isRecordingUsable),
 * except in demo mode, where an empty result simply means nothing was heard (as before) and `{ text: "" }` is returned.
 */
export async function resolveSpokenText(input: {
  blob: Blob | null;
  browserText: string;
  durationMs?: number;
  peakLevel?: number;
  signal?: AbortSignal;
  baseUrl?: string;
}): Promise<SpokenText> {
  const base = input.baseUrl ?? BASE;
  const fallback = input.browserText.trim();
  if (!base) return { text: fallback };
  // A tap or room noise is not uploaded at all, whatever the browser thought it heard.
  if (!isRecordingUsable(input)) return { error: MSG_NOTHING_HEARD };
  if (!input.blob || input.blob.size === 0) return fallback && !isJunkTranscript(fallback) ? { text: fallback } : { error: MSG_NOTHING_HEARD };
  try {
    const text = await transcribeRecording(input.blob, { baseUrl: base, signal: input.signal });
    return isJunkTranscript(text) ? { error: MSG_NOTHING_HEARD } : { text }; // the recording is the truth: silence is silence, even if the browser guessed words
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (fallback) return isJunkTranscript(fallback) ? { error: MSG_NOTHING_HEARD } : { text: fallback };
    return { error: error instanceof TranscribeHttpError && error.status === 503 ? MSG_UNAVAILABLE : MSG_FAILED };
  }
}
