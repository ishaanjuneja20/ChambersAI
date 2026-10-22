// Client for the backend's streaming answer endpoint, POST {VITE_API_URL}/ask/stream (docs/CONTRACTS.md).
// Server-sent events cannot be read with EventSource (it cannot POST), so this reads the fetch body stream and
// parses the `data:` lines itself. No keys live in the browser: the backend holds Gemini and Fish credentials.

const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

/** True when a backend is configured; otherwise the app runs in demo mode with canned answers. */
export const askBackendEnabled = API_URL !== "";

export interface AskCitation {
  n: number;
  text: string;
}

/**
 * `general: true` marks a general-guidance answer (docs/CONTRACTS.md, tier 2): not from verified sources, no citations. The key is only
 * present when it is true, so a cited answer's events look exactly as before.
 */
export type AskEvent =
  | { type: "sentence"; text: string; speak: string; newCitations: AskCitation[]; general?: true }
  | { type: "done"; citations: AskCitation[]; general?: true }
  | { type: "refused"; answer: string }
  | { type: "error"; message: string };

export interface AskRequest {
  /** The lawyer's `domain` id, e.g. "criminal". */
  lawyer: string;
  question: string;
  lang?: "en" | "hi";
  /** Aborting cancels the request and ends the stream with an AbortError. */
  signal?: AbortSignal;
  /** Defaults to VITE_API_URL. */
  baseUrl?: string;
  /** The stream fails with AskTimeoutError when nothing at all has arrived for this long (the response not started, or a pause between events). Default ASK_TIMEOUT_MS. */
  timeoutMs?: number;
  /** When the session has an analysed document: asks POST /sessions/{sessionId}/ask/stream (same events) so the answer can use it. */
  sessionId?: string;
}

/** How long the answer may stay silent before the request is given up on. */
export const ASK_TIMEOUT_MS = 30_000;

/** What the person sees when the request failed or timed out, whatever the reason. */
export const ASK_FAILED_MESSAGE = "Sorry, that took too long. Please try again.";

/** Nothing arrived from the backend for `timeoutMs`; the request was cancelled. */
export class AskTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`ask stream timed out after ${timeoutMs} ms`);
    this.name = "AskTimeoutError";
  }
}

/** The backend answered with a non-2xx status (503: the model is unavailable; 404: unknown lawyer). */
export class AskHttpError extends Error {
  constructor(readonly status: number) {
    super(`ask stream failed: ${status}`);
    this.name = "AskHttpError";
  }
}

/** Incremental parser for a text/event-stream body: feed it decoded chunks, get back the `data` payload of every completed event. */
export class SseParser {
  private buffer = "";
  private heldCR = false; // a chunk ended in "\r": it may be the first half of "\r\n"

  push(chunk: string): string[] {
    let text = (this.heldCR ? "\r" : "") + chunk;
    this.heldCR = text.endsWith("\r");
    if (this.heldCR) text = text.slice(0, -1);
    this.buffer += text.replace(/\r\n?/g, "\n");
    return this.drain();
  }

  /** End of the body: an event that was not followed by a blank line is still delivered. */
  flush(): string[] {
    if (this.heldCR) this.buffer += "\n";
    this.heldCR = false;
    this.buffer += "\n\n";
    return this.drain();
  }

  private drain(): string[] {
    const out: string[] = [];
    let end: number;
    while ((end = this.buffer.indexOf("\n\n")) >= 0) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue; // comments (":"), "event:", "id:" and "retry:" are not used by the backend
        data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) out.push(data.join("\n"));
    }
    return out;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function toCitations(v: unknown): AskCitation[] {
  if (!Array.isArray(v)) return [];
  const out: AskCitation[] = [];
  v.forEach((c, i) => {
    // new_citations is [{n, text}]; `done.citations` is documented as the plain numbered list of strings
    if (typeof c === "string") out.push({ n: i + 1, text: c });
    else if (isRecord(c) && typeof c.text === "string") out.push({ n: typeof c.n === "number" ? c.n : i + 1, text: c.text });
  });
  return out;
}

/** Validates one parsed event; anything that is not one of the four documented shapes is dropped (null). */
export function toAskEvent(raw: unknown): AskEvent | null {
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case "sentence":
      if (typeof raw.text !== "string") return null;
      return {
        type: "sentence",
        text: raw.text,
        speak: typeof raw.speak === "string" ? raw.speak : raw.text,
        newCitations: raw.general === true ? [] : toCitations(raw.new_citations),
        ...(raw.general === true ? { general: true as const } : {}),
      };
    case "done":
      return { type: "done", citations: raw.general === true ? [] : toCitations(raw.citations), ...(raw.general === true ? { general: true as const } : {}) };
    case "refused":
      return typeof raw.answer === "string" ? { type: "refused", answer: raw.answer } : null;
    case "error":
      return { type: "error", message: typeof raw.message === "string" ? raw.message : "" };
    default:
      return null;
  }
}

/** The streaming endpoint: the session's, which also reads its documents, or the plain one. */
export const askPath = (sessionId?: string) => (sessionId ? `/sessions/${encodeURIComponent(sessionId)}/ask/stream` : "/ask/stream");

/**
 * Asks one question and yields the answer's events as they arrive. The stream ends after the first terminal
 * event (done / refused / error) or when the body closes. Throws AskHttpError for a non-2xx response,
 * AskTimeoutError when nothing arrives for `timeoutMs`, and rethrows the AbortError when `signal` aborts;
 * breaking out of the loop cancels the request.
 */
export async function* askStream(req: AskRequest): AsyncGenerator<AskEvent, void, undefined> {
  const timeoutMs = req.timeoutMs ?? ASK_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => clearTimeout(timer);
  const arm = () => {
    disarm();
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  };
  const onCallerAbort = () => controller.abort();
  if (req.signal?.aborted) controller.abort();
  else req.signal?.addEventListener("abort", onCallerAbort, { once: true });

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    arm();
    const res = await fetch(`${(req.baseUrl ?? API_URL).replace(/\/$/, "")}${askPath(req.sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ lawyer: req.lawyer, question: req.question, ...(req.lang ? { lang: req.lang } : {}), voice: true }),
      signal: controller.signal,
    });
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      throw new AskHttpError(res.status);
    }
    if (!res.body) throw new Error("ask stream returned no body");

    reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    const parse = function* (payloads: string[]) {
      for (const payload of payloads) {
        let raw: unknown;
        try {
          raw = JSON.parse(payload);
        } catch {
          continue; // a damaged event is skipped rather than ending the answer
        }
        const event = toAskEvent(raw);
        if (event) yield event;
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      arm(); // something arrived
      for (const event of parse(parser.push(decoder.decode(value, { stream: true })))) {
        disarm(); // the wait while the caller handles an event is not the backend's silence
        yield event;
        if (event.type !== "sentence") return;
        arm();
      }
    }
    disarm();
    for (const event of parse(parser.push(decoder.decode()).concat(parser.flush()))) {
      yield event;
      if (event.type !== "sentence") return;
    }
  } catch (error) {
    if (timedOut) throw new AskTimeoutError(timeoutMs);
    throw error;
  } finally {
    disarm();
    req.signal?.removeEventListener("abort", onCallerAbort);
    void reader?.cancel().catch(() => {}); // no-op once the body is fully read; frees the connection when the caller stops early
  }
}
