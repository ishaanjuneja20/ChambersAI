// Shared between the speech player (writes) and the 3D avatar's render loop (reads every frame). Plain
// object, no React state, so lip-sync never re-renders the page.
//
// Every utterance gets a generation number; clips from an older generation are ignored, so a stopped or
// interrupted answer can never move the mouth of the next one.
import { textToPhones, type Lang } from "./g2p";
import { createMouthSample, sampleTimeline, VISEME_INDEX, type MouthSample, type Timeline, type TimedPhone } from "./timeline";
import { phoneClass } from "./g2p";

export type LipSyncMethod =
  | "fish-timestamps" // Fish Audio word timestamps + audio placement (best)
  | "text-estimate" // Fish audio without timestamps: phones placed on the audio envelope
  | "speech-synthesis-boundaries" // browser voice: per-word start events, phone durations estimated
  | "synthetic" // browser voice without word events: rhythm only, not tied to the sounds
  | "idle";

interface Clip {
  startAt: number; // on the driver's clock
  timeline: Timeline;
}

// Visual lead that compensates the animator's smoothing lag (≈ its attack time constant), so a shape
// reaches its peak when the sound does. Not a perceptual offset: change only after testing with real audio.
export const SMOOTHING_LEAD = 0.03;
const BROWSER_SECONDS_PER_WEIGHT = 0.085;

export class LipSyncDriver {
  method: LipSyncMethod = "idle";
  private clips: Clip[] = [];
  private clock: () => number = () => performance.now() / 1000;
  private generation = 0;
  private synthetic = false;
  private syntheticStart = 0;
  private readonly out: MouthSample = createMouthSample();
  private listeners = new Set<(method: LipSyncMethod) => void>();

  /** Starts a new utterance timed by `clock` (seconds); returns its generation. */
  begin(clock: () => number, method: LipSyncMethod): number {
    this.clips = [];
    this.clock = clock;
    this.synthetic = false;
    this.setMethod(method);
    return ++this.generation;
  }

  addClip(generation: number, startAt: number, timeline: Timeline): void {
    if (generation !== this.generation) return;
    const now = this.clock();
    this.clips = this.clips.filter((c) => c.startAt + c.timeline.duration > now - 1);
    this.clips.push({ startAt, timeline });
    this.clips.sort((a, b) => a.startAt - b.startAt);
    this.setMethod(timeline.source);
  }

  /** Browser voice: a word has just started. Its phones are spread over an estimated duration. */
  addWord(generation: number, word: string, lang: Lang, rate = 1): void {
    if (generation !== this.generation) return;
    const phones = textToPhones(word, lang, false);
    if (!phones.length) return;
    const total = phones.reduce((s, p) => s + p.w, 0);
    const duration = (total * BROWSER_SECONDS_PER_WEIGHT) / rate;
    let t = 0;
    const timed: TimedPhone[] = phones.map((p) => {
      const d = (duration * p.w) / total;
      const tp = { v: p.v, k: phoneClass(p), s: p.s, start: t, end: t + d };
      t += d;
      return tp;
    });
    this.synthetic = false;
    this.clips = [{ startAt: this.clock(), timeline: { phones: timed, duration, env: null, source: "text-estimate" } }];
    this.setMethod("speech-synthesis-boundaries");
  }

  /** Browser voice without word events: keep a talking rhythm going (clearly labelled as not synced). */
  setSynthetic(generation: number, on: boolean): void {
    if (generation !== this.generation) return;
    this.synthetic = on;
    this.syntheticStart = this.clock();
    if (on && !this.clips.length) this.setMethod("synthetic");
  }

  stop(): void {
    this.generation++;
    this.clips = [];
    this.synthetic = false;
    this.setMethod("idle");
  }

  onMethodChange(fn: (method: LipSyncMethod) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Mouth state for this instant, or null when nothing is being spoken. */
  sample(): MouthSample | null {
    if (!this.clips.length && !this.synthetic) return null;
    const now = this.clock() + SMOOTHING_LEAD;
    const out = this.out;
    let clip: Clip | undefined;
    for (const c of this.clips) if (c.startAt <= now) clip = c;
    if (clip) {
      const t = now - clip.startAt;
      sampleTimeline(clip.timeline, t, out);
      out.phraseAge = t;
      const later = this.clips[this.clips.length - 1].startAt > clip.startAt;
      if (t > clip.timeline.duration) out.speaking = later; // between sentences of one answer
      return out;
    }
    if (this.synthetic) {
      const t = now - this.syntheticStart;
      out.weights.fill(0);
      const syllable = Math.floor(t * 4.2);
      const v = (["aa", "E", "O", "I"] as const)[syllable % 4];
      out.weights[VISEME_INDEX[v]] = 0.35 + 0.25 * Math.sin((t * 4.2 - syllable) * Math.PI);
      out.energy = 0.6;
      out.silent = false;
      out.speaking = true;
      out.phraseAge = t;
      return out;
    }
    // first clip not reached yet (audio scheduled slightly ahead)
    out.weights.fill(0);
    out.silent = true;
    out.speaking = true;
    out.phraseAge = 0;
    return out;
  }

  private setMethod(method: LipSyncMethod) {
    if (method === this.method) return;
    this.method = method;
    for (const fn of this.listeners) fn(method);
  }
}
