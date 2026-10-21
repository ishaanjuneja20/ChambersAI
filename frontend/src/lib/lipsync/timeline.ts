// Turns (spoken text + timing + audio envelope) into a viseme timeline, and samples it at a playback time.
//
// Timing sources, best first (the active one is kept in `Timeline.source`):
//   fish-timestamps  Fish Audio's own word timestamps for the generated audio (Devanagari comes back per
//                    syllable), used as soft anchors.
//   text-estimate    no timestamps: phones placed on the audio alone, pauses at punctuation.
// In both, phones are placed on the decoded audio by a Viterbi search (vowels on loud frames, stop closures
// on quiet ones, s/sh/f on noisy ones, near typical durations). Real pauses force a neutral mouth, and
// loudness scales how far vowels open.
import { inSilence, levelAt, quietestNear, type Envelope } from "./envelope";
import { phoneClass, textToPhones, type Lang, type Phone, type PhoneClass } from "./g2p";
import { CONTACT_VISEMES, VISEMES, VOWEL_VISEMES, type Viseme } from "./visemes";

export interface Segment {
  text: string;
  start: number;
  end: number;
}

export type TimingSource = "fish-timestamps" | "text-estimate";

export interface TimedPhone {
  v: Viseme;
  k: PhoneClass;
  s: number;
  start: number;
  end: number;
}

export interface Timeline {
  phones: TimedPhone[];
  duration: number;
  env: Envelope | null;
  source: TimingSource;
}

const MATCHABLE = /[\p{L}\p{N}]/u;
const MIN_SEGMENT = 0.03;
const SNAP_RADIUS = 0.05;
const MIN_FRAMES = 2; // 20 ms, the shortest phone
const DURATION_WEIGHT = 0.35;
const ANCHOR_WEIGHT = 0.08; // per frame outside a phone's timestamp window, times the distance
const TOLERANCE = 4; // frames of slack around each window (Fish timestamps sit on an 80 ms grid)
const BAND = 25; // only search this many frames beyond a phone's window

/** Edit-distance alignment; for each char of `a`, the index of the aligned char of `b` (or -1). */
function alignChars(a: string[], b: string[]): Int32Array {
  const n = a.length;
  const m = b.length;
  const cost = new Int32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = 0; i <= n; i++) cost[at(i, 0)] = i;
  for (let j = 0; j <= m; j++) cost[at(0, j)] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = cost[at(i - 1, j - 1)] + (a[i - 1] === b[j - 1] ? 0 : 1);
      cost[at(i, j)] = Math.min(sub, cost[at(i - 1, j)] + 1, cost[at(i, j - 1)] + 1);
    }
  }
  const map = new Int32Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (cost[at(i, j)] === cost[at(i - 1, j - 1)] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      map[i - 1] = j - 1;
      i--;
      j--;
    } else if (cost[at(i, j)] === cost[at(i - 1, j)] + 1) i--;
    else j--;
  }
  return map;
}

// Expected loudness / noisiness per acoustic class (Q = pause); a frame's cost is its distance from these.
type UnitClass = PhoneClass | "Q";
const UNIT_CLASSES: UnitClass[] = ["V", "S", "F", "N", "Q"];
function frameCost(k: UnitClass, level: number, noise: number): number {
  switch (k) {
    case "V": return Math.max(0, 0.8 - level) * 2 + noise;
    case "S": return level * 1.4; // closure is (near) silent
    case "F": return Math.max(0, 0.55 - noise) * 2 + Math.abs(level - 0.5) * 0.6;
    case "Q": return level * 2;
    default: return Math.abs(level - 0.65) * 1.5 + noise * 0.8;
  }
}

/** A phone (or optional pause) to place, with its typical length and where the timestamps put it. */
interface Unit {
  phone: Phone | null; // null = optional pause between words
  cls: number; // index into UNIT_CLASSES
  exp: number; // expected length, frames
  minD: number; // shortest allowed, frames (0 = may be skipped)
  lo: number; // anchor window from the timestamps, frames (-Infinity / Infinity = none)
  hi: number;
}

function minFrames(p: Phone): number {
  const k = phoneClass(p);
  if (p.v === "PP" && k === "S") return 5; // a visible lip closure is 50-100 ms
  return k === "S" || k === "V" ? 3 : MIN_FRAMES;
}

/**
 * Places all units of a sentence on the audio in one Viterbi search over 10 ms frames: each phone's acoustic
 * class should match the frames' loudness / noisiness, its length should stay near the typical length, and
 * it should stay inside the window the TTS timestamps give it (a soft constraint, so a P/B/M can take the
 * quiet frames just before a word's timestamp). Returns false if no placement fits.
 */
function placeUnits(units: Unit[], f0: number, frames: number, env: Envelope, out: TimedPhone[]): boolean {
  const n = units.length;
  if (!n || frames <= 0 || f0 + frames > env.level.length) return false;
  const prefix = UNIT_CLASSES.map((k) => {
    const acc = new Float64Array(frames + 1);
    for (let f = 0; f < frames; f++) acc[f + 1] = acc[f] + frameCost(k, env.level[f0 + f], env.noise[f0 + f]);
    return acc;
  });
  const minBefore = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) minBefore[i + 1] = minBefore[i] + units[i].minD;
  if (minBefore[n] > frames) return false;
  // frames spent outside the anchor window [lo, hi), weighted by how far outside
  const outside = (a: number, b: number, lo: number, hi: number) => {
    let c = 0;
    if (a < lo) {
      const e = Math.min(b, lo);
      const k = e - a;
      c += k * lo - (a + e - 1) * k * 0.5;
    }
    if (b > hi) {
      const s0 = Math.max(a, hi);
      const k = b - s0;
      c += (s0 - hi + 1 + (b - hi)) * k * 0.5;
    }
    return c;
  };
  const INF = 1e18;
  const W = frames + 1;
  let prev = new Float64Array(W).fill(INF);
  prev[0] = 0;
  const back = new Int32Array((n + 1) * W);
  for (let i = 1; i <= n; i++) {
    const u = units[i - 1];
    const acc = prefix[u.cls];
    const maxD = Math.max(u.minD, Math.ceil(u.exp * 3) + 2);
    const cur = new Float64Array(W).fill(INF);
    let fLo = minBefore[i];
    let fHi = frames - (minBefore[n] - minBefore[i]);
    if (Number.isFinite(u.lo)) fLo = Math.max(fLo, Math.floor(u.lo) - BAND);
    if (Number.isFinite(u.hi)) fHi = Math.min(fHi, Math.ceil(u.hi) + BAND);
    for (let f = fLo; f <= fHi; f++) {
      let best = INF;
      let arg = -1;
      for (let d = u.minD; d <= Math.min(maxD, f); d++) {
        const before = prev[f - d];
        if (before >= INF) continue;
        let c = before;
        if (d > 0) {
          const r = Math.log(d / Math.max(1, u.exp));
          c += acc[f] - acc[f - d] + DURATION_WEIGHT * r * r * d;
          if (Number.isFinite(u.lo)) c += ANCHOR_WEIGHT * outside(f - d, f, u.lo, u.hi);
        }
        if (c < best) {
          best = c;
          arg = f - d;
        }
      }
      cur[f] = best;
      back[i * W + f] = arg;
    }
    prev = cur;
  }
  if (prev[frames] >= INF) return false;
  const bounds = new Int32Array(n + 1);
  bounds[n] = frames;
  for (let i = n; i > 0; i--) bounds[i - 1] = back[i * W + bounds[i]];
  units.forEach((u, i) => {
    const ph = u.phone;
    if (ph && ph.v !== "sil" && bounds[i + 1] > bounds[i]) {
      out.push({ v: ph.v, k: phoneClass(ph), s: ph.s, start: (f0 + bounds[i]) * env.hop, end: (f0 + bounds[i + 1]) * env.hop });
    }
  });
  return true;
}

function spread(phones: Phone[], from: number, to: number, out: TimedPhone[]) {
  const total = phones.reduce((sum, p) => sum + p.w, 0);
  if (!total || to <= from) return;
  let t = from;
  for (const p of phones) {
    const d = ((to - from) * p.w) / total;
    if (p.v !== "sil") out.push({ v: p.v, k: phoneClass(p), s: p.s, start: t, end: t + d });
    t += d;
  }
}

export function buildTimeline(
  text: string,
  lang: Lang,
  duration: number,
  segments: Segment[] | null,
  env: Envelope | null,
): Timeline {
  const out: TimedPhone[] = [];
  const speechStart = env ? env.onset : 0;
  const speechEnd = env ? env.offset : duration;
  const usable = (segments ?? []).filter((s) => s.end >= s.start && MATCHABLE.test(s.text));

  if (!usable.length) {
    const phones = textToPhones(text, lang, true);
    let placed = false;
    if (env) {
      const f0 = Math.round(speechStart / env.hop);
      const frames = Math.round(speechEnd / env.hop) - f0;
      const total = phones.reduce((sum, p) => sum + p.w, 0) || 1;
      const units: Unit[] = phones.map((p) => ({
        phone: p,
        cls: UNIT_CLASSES.indexOf(p.v === "sil" ? "Q" : phoneClass(p)),
        exp: (frames * p.w) / total,
        minD: p.v === "sil" ? 0 : minFrames(p),
        lo: -Infinity,
        hi: Infinity,
      }));
      placed = placeUnits(units, f0, frames, env, out);
    }
    if (!placed) spread(phones, speechStart, speechEnd, out);
    return { phones: out, duration, env, source: "text-estimate" };
  }

  // 1. Merge zero-length segments into a neighbour, giving timing groups.
  const groups: Array<{ start: number; end: number }> = [];
  const groupOfSeg = new Int32Array(usable.length);
  let pending: number[] = [];
  usable.forEach((seg, i) => {
    if (seg.end - seg.start < MIN_SEGMENT && i < usable.length - 1) {
      pending.push(i);
      return;
    }
    const start = Math.min(seg.start, ...pending.map((p) => usable[p].start));
    const startsAfterSpeech = env && start >= speechEnd - MIN_SEGMENT;
    if (groups.length && (seg.end - seg.start < MIN_SEGMENT || startsAfterSpeech)) {
      // trailing zero-length segment, or one the audio shows no sound for: share the previous group
      const prev = groups[groups.length - 1];
      prev.end = Math.max(prev.end, Math.min(seg.end, speechEnd + 0.03));
    } else groups.push({ start, end: Math.max(seg.end, start + MIN_SEGMENT) });
    for (const p of [...pending, i]) groupOfSeg[p] = groups.length - 1;
    pending = [];
  });

  // 2. Snap boundaries between touching groups to the quietest nearby audio frame.
  if (env) {
    for (let g = 0; g < groups.length - 1; g++) {
      const a = groups[g];
      const b = groups[g + 1];
      if (Math.abs(b.start - a.end) < 0.011) {
        const lo = a.start + MIN_SEGMENT;
        const hi = b.end - MIN_SEGMENT;
        const t = Math.min(hi, Math.max(lo, quietestNear(env, a.end, SNAP_RADIUS)));
        if (lo < hi) a.end = b.start = t;
      }
    }
    const last = groups[groups.length - 1];
    if (last.end > speechEnd + 0.05) last.end = Math.max(last.start + MIN_SEGMENT, speechEnd + 0.03);
    // Fish pins the first word to 0.00 even when the audio opens with silence (measured up to 0.12 s on
    // decoded MP3s), and pause edges sit on its 80 ms grid: start/end groups where the sound actually does.
    if (groups[0].start < env.onset && env.onset < groups[0].end - MIN_SEGMENT) groups[0].start = env.onset;
    for (const grp of groups) {
      for (const [a, b] of env.silences) {
        if (grp.start >= a - 0.005 && grp.start < b && grp.end > b + MIN_SEGMENT) grp.start = b;
        if (grp.end > a && grp.end <= b + 0.005 && grp.start < a - MIN_SEGMENT) grp.end = a;
      }
    }
  }

  // 3. Map every character of the text to a group through its aligned segment character.
  const textChars: Array<{ ch: string; ci: number }> = [];
  for (let ci = 0; ci < text.length; ci++) if (MATCHABLE.test(text[ci])) textChars.push({ ch: text[ci].toLowerCase(), ci });
  const segChars: Array<{ ch: string; g: number }> = [];
  usable.forEach((seg, i) => {
    for (const ch of seg.text) if (MATCHABLE.test(ch)) segChars.push({ ch: ch.toLowerCase(), g: groupOfSeg[i] });
  });
  const map = alignChars(textChars.map((c) => c.ch), segChars.map((c) => c.ch));
  const groupOfChar = new Int32Array(text.length).fill(-1);
  textChars.forEach((c, k) => {
    if (map[k] >= 0) groupOfChar[c.ci] = segChars[map[k]].g;
  });
  // unaligned characters (vowel signs, punctuation, letters the TTS normalised away) join their neighbour
  let last = -1;
  for (let ci = 0; ci < text.length; ci++) {
    if (groupOfChar[ci] >= 0) last = groupOfChar[ci];
    else groupOfChar[ci] = last;
  }
  let next = -1;
  for (let ci = text.length - 1; ci >= 0; ci--) {
    if (groupOfChar[ci] >= 0) next = groupOfChar[ci];
    else groupOfChar[ci] = next < 0 ? 0 : next;
  }

  // 4. Place phones: one search over the whole sentence, anchored softly to their groups' times.
  const phones = textToPhones(text, lang, false);
  const byGroup: Phone[][] = groups.map(() => []);
  let g = 0;
  for (const p of phones) {
    g = Math.max(g, groupOfChar[p.ci] ?? 0);
    byGroup[Math.min(g, groups.length - 1)].push(p);
  }
  let placed = false;
  if (env) {
    const f0 = Math.max(0, Math.floor(Math.min(groups[0].start, speechStart) / env.hop));
    const frames = Math.min(env.level.length, Math.ceil(groups[groups.length - 1].end / env.hop)) - f0;
    const units: Unit[] = [];
    byGroup.forEach((list, k) => {
      const lo = groups[k].start / env.hop - f0 - TOLERANCE;
      const hi = groups[k].end / env.hop - f0 + TOLERANCE;
      const span = (groups[k].end - groups[k].start) / env.hop;
      const total = list.reduce((sum, p) => sum + p.w, 0) || 1;
      if (k > 0) {
        // optional pause between groups, expected as long as the gap the timestamps leave
        const gap = Math.max(0, (groups[k].start - groups[k - 1].end) / env.hop);
        units.push({
          phone: null,
          cls: UNIT_CLASSES.indexOf("Q"),
          exp: Math.max(1, gap),
          minD: 0,
          lo: groups[k - 1].end / env.hop - f0 - TOLERANCE,
          hi: groups[k].start / env.hop - f0 + TOLERANCE,
        });
      }
      for (const p of list) {
        units.push({ phone: p, cls: UNIT_CLASSES.indexOf(phoneClass(p)), exp: Math.max(1, (span * p.w) / total), minD: minFrames(p), lo, hi });
      }
    });
    placed = placeUnits(units, f0, frames, env, out);
  }
  if (!placed) byGroup.forEach((list, k) => spread(list, groups[k].start, groups[k].end, out));
  return { phones: out, duration, env, source: "fish-timestamps" };
}

// ---------------------------------------------------------------- sampling

export interface MouthSample {
  weights: Float32Array; // per VISEMES index
  energy: number; // 0..1 loudness at this instant
  silent: boolean;
  speaking: boolean; // inside an utterance (including its pauses)
  phraseAge: number; // seconds since the current clip started
}

export const VISEME_INDEX = Object.fromEntries(VISEMES.map((v, i) => [v, i])) as Record<Viseme, number>;

export function createMouthSample(): MouthSample {
  return { weights: new Float32Array(VISEMES.length), energy: 0, silent: true, speaking: false, phraseAge: 0 };
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// cross-fade length either side of a boundary: short for lip contact, never more than half a phone
const windowFor = (p: TimedPhone) => Math.min(CONTACT_VISEMES.has(p.v) ? 0.025 : 0.06, 0.5 * (p.end - p.start));

function findPhone(phones: TimedPhone[], t: number): number {
  let lo = 0;
  let hi = phones.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (phones[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Fills `out` with viseme weights for time t (seconds from the start of the clip's audio). */
export function sampleTimeline(tl: Timeline, t: number, out: MouthSample): void {
  out.weights.fill(0);
  out.speaking = t >= 0 && t <= tl.duration;
  out.energy = tl.env ? levelAt(tl.env, t) : 0.6;
  out.silent = !out.speaking || (tl.env ? inSilence(tl.env, t) : false);
  if (out.silent) return;

  const k = findPhone(tl.phones, t);
  const cur = tl.phones[k];
  if (!cur || t >= cur.end) {
    out.silent = true; // gap between words
    return;
  }
  const prev = tl.phones[k - 1];
  const next = tl.phones[k + 1];
  const touchingPrev = prev && cur.start - prev.end < 0.02;
  const touchingNext = next && next.start - cur.end < 0.02;

  // Coarticulation: cross-fade over a window either side of each boundary (shorter for lip contact).
  const xIn = Math.min(windowFor(cur), touchingPrev ? windowFor(prev) : 1);
  const xOut = Math.min(windowFor(cur), touchingNext ? windowFor(next) : 1);
  const wPrev = touchingPrev && t < cur.start + xIn ? 0.5 * (1 - smooth((t - cur.start) / xIn)) : 0;
  const wNext = touchingNext && t > cur.end - xOut ? 0.5 * smooth((t - (cur.end - xOut)) / xOut) : 0;
  const w = out.weights;
  w[VISEME_INDEX[cur.v]] += (1 - wPrev - wNext) * cur.s;
  if (wPrev) w[VISEME_INDEX[prev.v]] += wPrev * prev.s;
  if (wNext) w[VISEME_INDEX[next.v]] += wNext * next.s;

  // Lips start rounding during the consonant before a rounded vowel ("to", "pukar").
  if (touchingNext && (next.v === "O" || next.v === "U") && !CONTACT_VISEMES.has(cur.v) && !VOWEL_VISEMES.has(cur.v)) {
    w[VISEME_INDEX[next.v]] += 0.3 * next.s;
  }
}
