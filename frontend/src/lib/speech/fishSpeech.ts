// Plays an answer with the lawyer's Fish Audio voice through the backend's POST /api/speak, one sentence
// per request (two prefetched ahead), and feeds the lip-sync driver a timeline for every sentence.
//
// Sync: every sentence is decoded and scheduled on one AudioContext at an exact context time; the driver
// reads the context time the output device is actually playing (getOutputTimestamp), so the mouth follows
// real playback, including output latency and a suspended context. No JS timers decide the mouth.
import { computeEnvelope } from "../lipsync/envelope";
import { detectLang, type Lang } from "../lipsync/g2p";
import { buildTimeline, type Segment } from "../lipsync/timeline";
import type { LipSyncDriver } from "../lipsync/driver";

export interface FishSpeakCallbacks {
  onProgress: (charIndex: number) => void;
  onEnd: () => void;
  /** Speech could not be produced from `fromChar` on (earlier sentences have finished playing). */
  onFail: (fromChar: number) => void;
}

interface Part {
  text: string;
  start: number; // char offset in the full answer
}

interface Loaded {
  buffer: AudioBuffer;
  segments: Segment[] | null;
}

const ABBREVIATIONS = new Set(["art", "arts", "s", "ss", "sec", "secs", "no", "nos", "vs", "v", "dr", "mr", "mrs", "ms", "ltd", "co", "cl", "o", "r", "e.g", "i.e", "etc", "viz", "govt", "hon'ble"]);
const MAX_PART = 280;
const FIRST_PART = 70;

/** Sentence split that keeps legal abbreviations ("Art. 226", "s. 63", "v.") inside their sentence. */
export function splitSentences(text: string): Part[] {
  const parts: Part[] = [];
  let start = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const piece = raw.trim();
    if (piece) {
      const prev = parts[parts.length - 1];
      if (prev && (piece.length < 25 || prev.text.length < 25) && prev.text.length + piece.length < MAX_PART) {
        prev.text = text.slice(prev.start, start + lead + piece.length);
      } else parts.push({ text: piece, start: start + lead });
    }
    start = end;
  };
  for (const m of text.matchAll(/[.!?।]+["')\]]*\s+|[;:]\s+(?=\S)/g)) {
    const end = (m.index ?? 0) + m[0].length;
    const before = text.slice(start, m.index).split(/\s+/).pop()?.toLowerCase().replace(/^[("']+/, "") ?? "";
    if (m[0].startsWith(".") && (ABBREVIATIONS.has(before) || /^\d+$/.test(before) && /^\s*\d/.test(text.slice(end)))) continue;
    if (m[0][0] === ";" || m[0][0] === ":") {
      if (end - start < MAX_PART * 0.6) continue; // only split long sentences at ; and :
    }
    push(end);
  }
  push(text.length);
  // Audio for a part only plays once Fish has synthesised all of it (about real time), so the first part is
  // kept to the opening clause: speech starts sooner while the rest is fetched during playback.
  const first = parts[0];
  if (first && first.text.length > FIRST_PART) {
    const m = /[,;:]\s/g;
    let cut = -1;
    for (let r = m.exec(first.text); r; r = m.exec(first.text)) {
      if (r.index + 1 > FIRST_PART) break;
      if (r.index + 1 >= 15) cut = r.index + 2;
    }
    if (cut > 0) {
      parts.splice(0, 1, { text: first.text.slice(0, cut).trim(), start: first.start }, { text: first.text.slice(cut).trim(), start: first.start + cut });
    }
  }
  // last resort for very long sentences: split at commas
  return parts.flatMap((p) => {
    if (p.text.length <= MAX_PART) return [p];
    const out: Part[] = [];
    let s = 0;
    while (p.text.length - s > MAX_PART) {
      const cut = p.text.lastIndexOf(", ", s + MAX_PART);
      const end = cut > s + 40 ? cut + 2 : s + MAX_PART;
      out.push({ text: p.text.slice(s, end).trim(), start: p.start + s });
      s = end;
    }
    out.push({ text: p.text.slice(s).trim(), start: p.start + s });
    return out;
  });
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export class FishSpeechPlayer {
  private ctx: AudioContext | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private aborter: AbortController | null = null;
  private raf = 0;
  private gen = 0;
  // onEnd of the answer in progress. Like browser speechSynthesis.cancel() (which fires 'end'), stopping or
  // replacing an answer still completes it, so the consultation records it the same way on both voices.
  private pendingEnd: (() => void) | null = null;

  constructor(
    private readonly apiUrl: string,
    private readonly driver: LipSyncDriver,
  ) {}

  /** Context time of the sample the output device is playing right now. */
  private playbackTime = (): number => {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0 && ctx.state === "running") {
      return ts.contextTime + Math.max(0, performance.now() - ts.performanceTime) / 1000;
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  };

  private context(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private async load(part: Part, lawyerId: string, lang: Lang, signal: AbortSignal): Promise<Loaded> {
    const res = await fetch(`${this.apiUrl}/api/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: part.text, lawyer_id: lawyerId, lang }),
      signal,
    });
    if (!res.ok) throw new Error(`speak ${res.status}`);
    const body = (await res.json()) as { audio_base64: string; timing?: { source: string; segments: Segment[] } };
    const buffer = await this.context().decodeAudioData(base64ToBuffer(body.audio_base64));
    const segments = body.timing?.source === "fish-timestamps" ? body.timing.segments : null;
    return { buffer, segments };
  }

  speak(text: string, lawyerId: string, cb: FishSpeakCallbacks): void {
    this.stop();
    const gen = ++this.gen;
    this.pendingEnd = cb.onEnd;
    const ctx = this.context();
    const lang = detectLang(text);
    const parts = splitSentences(text);
    const aborter = new AbortController();
    this.aborter = aborter;
    const driverGen = this.driver.begin(this.playbackTime, "fish-timestamps");
    const scheduled: Array<{ startAt: number; end: number; part: Part }> = [];
    let finishedLoading = false;
    let lastChar = -1;

    const tick = () => {
      if (gen !== this.gen) return;
      const now = this.playbackTime();
      const cur = scheduled.find((s) => now >= s.startAt && now < s.end) ?? scheduled.filter((s) => s.end <= now).pop();
      if (cur) {
        const frac = Math.min(1, (now - cur.startAt) / (cur.end - cur.startAt));
        // reveal captions a whole word at a time, never past the sentence being heard
        const partEnd = cur.part.start + cur.part.text.length;
        const space = text.indexOf(" ", cur.part.start + Math.round(frac * cur.part.text.length));
        const ci = frac >= 1 || space < 0 ? partEnd : Math.min(space, partEnd);
        if (ci !== lastChar) {
          lastChar = ci;
          cb.onProgress(ci);
        }
      }
      const last = scheduled[scheduled.length - 1];
      if (finishedLoading && last && now >= last.end) {
        this.finish(gen);
        this.pendingEnd = null;
        cb.onEnd();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };

    const loads = new Map<number, Promise<Loaded>>();
    const want = (i: number) => {
      if (i < parts.length && !loads.has(i)) loads.set(i, this.load(parts[i], lawyerId, lang, aborter.signal));
    };

    void (async () => {
      let nextStart = 0;
      for (let i = 0; i < parts.length; i++) {
        want(i);
        want(i + 1);
        want(i + 2);
        let loaded: Loaded;
        try {
          loaded = await loads.get(i)!;
        } catch {
          if (gen !== this.gen) return;
          // let what was already scheduled finish, then hand the rest to the fallback voice
          finishedLoading = true;
          const waitEnd = () => {
            if (gen !== this.gen) return;
            if (this.playbackTime() >= nextStart) {
              this.finish(gen);
              this.pendingEnd = null; // the fallback voice takes over and ends the answer itself
              cb.onFail(parts[i].start);
            } else setTimeout(waitEnd, 50);
          };
          waitEnd();
          return;
        }
        if (gen !== this.gen) return;
        const { buffer, segments } = loaded;
        const env = computeEnvelope(buffer.getChannelData(0), buffer.sampleRate);
        const timeline = buildTimeline(parts[i].text, lang, buffer.duration, segments, env);
        const startAt = Math.max(ctx.currentTime + 0.08, nextStart);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(startAt);
        this.sources.push(src);
        this.driver.addClip(driverGen, startAt, timeline);
        scheduled.push({ startAt, end: startAt + buffer.duration, part: parts[i] });
        nextStart = startAt + buffer.duration;
        if (i === 0) this.raf = requestAnimationFrame(tick);
      }
      finishedLoading = true;
    })();
  }

  private finish(gen: number) {
    if (gen !== this.gen) return;
    cancelAnimationFrame(this.raf);
    this.sources = [];
    this.aborter = null;
    this.driver.stop();
  }

  stop(): void {
    this.gen++;
    cancelAnimationFrame(this.raf);
    this.aborter?.abort();
    this.aborter = null;
    for (const src of this.sources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.driver.stop();
    const end = this.pendingEnd;
    this.pendingEnd = null;
    end?.();
  }

  dispose(): void {
    this.pendingEnd = null; // unmounting: nothing left to record into
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
