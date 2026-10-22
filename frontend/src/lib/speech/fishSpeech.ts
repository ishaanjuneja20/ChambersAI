// Plays an answer with the lawyer's Fish Audio voice through the backend's POST /api/speak, one sentence
// per request (two prefetched ahead), and feeds the lip-sync driver a timeline for every sentence.
//
// Two ways in: speak(fullText) for an answer that is already complete, and begin() / enqueue() / finish() for an
// answer that is still arriving (POST /ask/stream): each sentence is sent to /api/speak the moment it is enqueued
// and plays after the previous one, whatever order the audio comes back in.
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

/** An answer that arrives sentence by sentence: what is shown, and the (marker-free) text that is spoken. */
export interface StreamSentence {
  /** Caption text, e.g. "Murder is punished with death or life imprisonment [1]." */
  caption: string;
  /** Exactly what the voice should say: the same sentence without the [n] markers. */
  speak: string;
}

export interface FishStreamCallbacks {
  /** How much of the caption is spoken so far: a char offset into the enqueued captions joined with CAPTION_JOINER. */
  onProgress: (charIndex: number) => void;
  /** All enqueued sentences have been spoken after finish(), or the answer was stopped (the partial answer still counts as ended). */
  onEnd: () => void;
}

/** Between two enqueued captions. Whoever shows the caption joins the sentences with this, so offsets line up. */
export const CAPTION_JOINER = " ";

interface Part {
  text: string;
  start: number; // char offset in the full answer
}

interface Loaded {
  buffer: AudioBuffer;
  segments: Segment[] | null;
}

interface StreamRun {
  gen: number;
  lawyerId: string;
  signal: AbortSignal;
  driverGen: number;
  lang: Lang | null; // taken from the first sentence: an answer is in one language
  caption: string; // enqueued captions, joined with CAPTION_JOINER
  count: number;
  pending: number; // enqueued, not yet placed on the timeline
  finished: boolean; // finish() was called
  audioFailed: boolean; // a sentence's speech could not be produced: the rest is shown without audio
  nextStart: number; // context time at which the next sentence may start
  chain: Promise<void>; // placing happens in this order, whatever order the audio arrives in
  scheduled: Array<{ startAt: number; end: number; captionStart: number; captionLength: number }>;
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

/** Caption offset `frac` of the way through a sentence: a whole word at a time, never past the end of that sentence. */
export function revealIndex(caption: string, start: number, length: number, frac: number): number {
  const end = start + length;
  if (frac >= 1) return end;
  const space = caption.indexOf(" ", start + Math.round(frac * length));
  return space < 0 ? end : Math.min(space, end);
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
  private run: StreamRun | null = null; // the begin() / enqueue() answer in progress

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

  private async load(text: string, lawyerId: string, lang: Lang, signal: AbortSignal): Promise<Loaded> {
    const res = await fetch(`${this.apiUrl}/api/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lawyer_id: lawyerId, lang }),
      signal,
    });
    if (!res.ok) throw new Error(`speak ${res.status}`);
    const body = (await res.json()) as { audio_base64: string; timing?: { source: string; segments: Segment[] } };
    const buffer = await this.context().decodeAudioData(base64ToBuffer(body.audio_base64));
    const segments = body.timing?.source === "fish-timestamps" ? body.timing.segments : null;
    return { buffer, segments };
  }

  /** Schedules a decoded sentence on the audio clock and hands its viseme timeline to the lip-sync driver. */
  private place(ctx: AudioContext, driverGen: number, loaded: Loaded, text: string, lang: Lang, notBefore: number): { startAt: number; end: number } {
    const { buffer, segments } = loaded;
    const env = computeEnvelope(buffer.getChannelData(0), buffer.sampleRate);
    const timeline = buildTimeline(text, lang, buffer.duration, segments, env);
    const startAt = Math.max(ctx.currentTime + 0.08, notBefore);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(startAt);
    this.sources.push(src);
    this.driver.addClip(driverGen, startAt, timeline);
    return { startAt, end: startAt + buffer.duration };
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
        const ci = revealIndex(text, cur.part.start, cur.part.text.length, frac);
        if (ci !== lastChar) {
          lastChar = ci;
          cb.onProgress(ci);
        }
      }
      const last = scheduled[scheduled.length - 1];
      if (finishedLoading && last && now >= last.end) {
        this.settle(gen);
        this.pendingEnd = null;
        cb.onEnd();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };

    const loads = new Map<number, Promise<Loaded>>();
    const want = (i: number) => {
      if (i < parts.length && !loads.has(i)) loads.set(i, this.load(parts[i].text, lawyerId, lang, aborter.signal));
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
              this.settle(gen);
              this.pendingEnd = null; // the fallback voice takes over and ends the answer itself
              cb.onFail(parts[i].start);
            } else setTimeout(waitEnd, 50);
          };
          waitEnd();
          return;
        }
        if (gen !== this.gen) return;
        const { startAt, end } = this.place(ctx, driverGen, loaded, parts[i].text, lang, nextStart);
        scheduled.push({ startAt, end, part: parts[i] });
        nextStart = end;
        if (i === 0) this.raf = requestAnimationFrame(tick);
      }
      finishedLoading = true;
    })();
  }

  /**
   * Starts an answer that is still arriving. Call enqueue() for every sentence as it comes in and finish() after
   * the last one. Starting a new answer, or stop(), cuts this one off (onEnd still fires, as for speak()).
   */
  begin(lawyerId: string, cb: FishStreamCallbacks): void {
    this.stop();
    const gen = ++this.gen;
    this.pendingEnd = cb.onEnd;
    this.context();
    const aborter = new AbortController();
    this.aborter = aborter;
    const run: StreamRun = {
      gen,
      lawyerId,
      signal: aborter.signal,
      driverGen: this.driver.begin(this.playbackTime, "fish-timestamps"),
      lang: null,
      caption: "",
      count: 0,
      pending: 0,
      finished: false,
      audioFailed: false,
      nextStart: 0,
      chain: Promise.resolve(),
      scheduled: [],
    };
    this.run = run;
    let lastChar = -1;

    const tick = () => {
      if (gen !== this.gen) return;
      const now = this.playbackTime();
      const { scheduled } = run;
      const cur = scheduled.find((s) => now >= s.startAt && now < s.end) ?? scheduled.filter((s) => s.end <= now).pop();
      if (cur) {
        const frac = cur.end > cur.startAt ? Math.min(1, (now - cur.startAt) / (cur.end - cur.startAt)) : 1;
        const ci = revealIndex(run.caption, cur.captionStart, cur.captionLength, frac);
        if (ci !== lastChar) {
          lastChar = ci;
          cb.onProgress(ci);
        }
      }
      const last = scheduled[scheduled.length - 1];
      if (run.finished && run.pending === 0 && (!last || now >= last.end)) {
        this.settle(gen);
        this.pendingEnd = null;
        cb.onEnd();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** One more sentence of the answer: its speech is requested now and plays after the sentences before it. */
  enqueue(sentence: StreamSentence): void {
    const run = this.run;
    if (!run || run.gen !== this.gen || run.finished) return;
    const captionStart = run.count ? run.caption.length + CAPTION_JOINER.length : 0;
    run.caption = run.count ? run.caption + CAPTION_JOINER + sentence.caption : sentence.caption;
    run.count++;
    run.pending++;
    const captionLength = sentence.caption.length;
    const speakable = sentence.speak.trim().length > 0;
    run.lang ??= detectLang(sentence.speak);
    const lang = run.lang;
    const load = speakable && !run.audioFailed ? this.load(sentence.speak, run.lawyerId, lang, run.signal) : null;
    load?.catch(() => {}); // the chain below reports it; this keeps an abort from surfacing as an unhandled rejection

    run.chain = run.chain.then(async () => {
      try {
        if (run.gen !== this.gen) return;
        let loaded: Loaded | null = null;
        if (load && !run.audioFailed) {
          try {
            loaded = await load;
          } catch {
            if (run.gen !== this.gen) return;
            // Earlier sentences keep playing; this one and the rest are shown without audio.
            run.audioFailed = true;
            this.aborter?.abort();
            console.warn("[speech] Fish Audio voice unavailable; showing the rest of the answer as text");
          }
        }
        if (run.gen !== this.gen) return;
        if (loaded) {
          const { startAt, end } = this.place(this.context(), run.driverGen, loaded, sentence.speak, lang, run.nextStart);
          run.scheduled.push({ startAt, end, captionStart, captionLength });
          run.nextStart = end;
        } else {
          // shown as soon as the sentences before it have been heard
          run.scheduled.push({ startAt: run.nextStart, end: run.nextStart, captionStart, captionLength });
        }
      } finally {
        run.pending--;
      }
    });
  }

  /** The answer has no more sentences; onEnd fires once the last enqueued one has been heard. */
  finish(): void {
    if (this.run && this.run.gen === this.gen) this.run.finished = true;
  }

  private settle(gen: number) {
    if (gen !== this.gen) return;
    cancelAnimationFrame(this.raf);
    this.sources = [];
    this.aborter = null;
    this.run = null;
    this.driver.stop();
  }

  stop(): void {
    this.gen++;
    cancelAnimationFrame(this.raf);
    this.aborter?.abort();
    this.aborter = null;
    this.run = null;
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
