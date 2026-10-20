// Loudness envelope of the decoded speech audio, computed once per clip. It is on the same clock as the
// audio itself, so it is used to correct the word timing (boundaries, pauses, start/end) and to scale how
// wide vowels open.
export interface Envelope {
  hop: number; // seconds per frame
  level: Float32Array; // 0..1, 0 = 40 dB below the clip's loud parts
  noise: Float32Array; // 0..1 zero-crossing rate (high for s / sh / f, low for vowels and nasals)
  onset: number; // first audible frame (s)
  offset: number; // last audible frame (s)
  silences: Array<[number, number]>; // pauses of at least MIN_PAUSE
}

const HOP = 0.01;
const RANGE_DB = 40;
const SILENT_BELOW_DB = 30; // relative to the loud reference
const MIN_PAUSE = 0.12;
const ZCR_FULL = 3000; // zero crossings per second (≈ dominant Hz) that counts as fully noisy

export function computeEnvelope(samples: Float32Array, sampleRate: number): Envelope {
  const hop = Math.max(1, Math.round(sampleRate * HOP));
  const frames = Math.max(1, Math.floor(samples.length / hop));
  const db = new Float32Array(frames);
  const noise = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    // 20 ms window centred on the frame
    const from = Math.max(0, f * hop - (hop >> 1));
    const to = Math.min(samples.length, f * hop + hop + (hop >> 1));
    let sum = 0;
    let crossings = 0;
    for (let i = from; i < to; i++) {
      sum += samples[i] * samples[i];
      if (i > from && samples[i] >= 0 !== samples[i - 1] >= 0) crossings++;
    }
    db[f] = 10 * Math.log10(sum / Math.max(1, to - from) + 1e-12);
    noise[f] = Math.min(1, (crossings * sampleRate) / Math.max(1, to - from) / 2 / ZCR_FULL);
  }
  const sorted = Float32Array.from(db).sort();
  const ref = sorted[Math.floor(sorted.length * 0.95)];
  const level = new Float32Array(frames);
  let onset = -1;
  let offset = -1;
  const silences: Array<[number, number]> = [];
  let runStart = -1;
  for (let f = 0; f < frames; f++) {
    level[f] = Math.min(1, Math.max(0, (db[f] - (ref - RANGE_DB)) / RANGE_DB));
    const silent = db[f] < ref - SILENT_BELOW_DB;
    if (!silent) {
      if (onset < 0) onset = f;
      offset = f;
      if (runStart >= 0 && (f - runStart) * HOP >= MIN_PAUSE) silences.push([runStart * HOP, f * HOP]);
      runStart = -1;
    } else if (runStart < 0) runStart = f;
  }
  if (runStart >= 0 && (frames - runStart) * HOP >= MIN_PAUSE) silences.push([runStart * HOP, frames * HOP]);
  return {
    hop: HOP,
    level,
    noise,
    onset: Math.max(0, onset) * HOP,
    offset: (offset < 0 ? frames : offset + 1) * HOP,
    silences,
  };
}

export function levelAt(env: Envelope, t: number): number {
  const x = t / env.hop;
  const i = Math.floor(x);
  if (i < 0) return env.level[0] ?? 0;
  if (i >= env.level.length - 1) return env.level[env.level.length - 1] ?? 0;
  return env.level[i] + (env.level[i + 1] - env.level[i]) * (x - i);
}

export function inSilence(env: Envelope, t: number): boolean {
  for (const [a, b] of env.silences) if (t >= a && t < b) return true;
  return false;
}

/** Time of the quietest frame within ±radius of t. */
export function quietestNear(env: Envelope, t: number, radius: number): number {
  const from = Math.max(0, Math.floor((t - radius) / env.hop));
  const to = Math.min(env.level.length - 1, Math.ceil((t + radius) / env.hop));
  let best = Math.round(t / env.hop);
  let bestLevel = Infinity;
  for (let f = from; f <= to; f++) {
    // prefer frames near t when levels tie
    const score = env.level[f] + Math.abs(f * env.hop - t) * 0.5;
    if (score < bestLevel) {
      bestLevel = score;
      best = f;
    }
  }
  return best * env.hop;
}
