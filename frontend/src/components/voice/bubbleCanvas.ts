// Draws the living inside of the voice bubble onto a 2D canvas, every frame, from a continuously
// increasing time value. Never static, never visibly loops: every blob/ribbon mixes several
// incommensurate sine frequencies with a slow value-noise term, so the combined phase doesn't
// repeat on any human-noticeable timescale.

// ---- tiny deterministic value noise (no dependency) ----
function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453123;
  return s - Math.floor(s);
}
function noise1D(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

export type BubbleMode = "listening" | "processing";

export interface BubbleFrameInput {
  width: number;
  height: number;
  t: number; // seconds, always increasing
  level: number; // 0..1, smoothed voice level
  bands: { low: number; mid: number; high: number }; // 0..1 each
  mode: BubbleMode;
}

interface Blob {
  seed: number;
  color: string;
  baseR: number;
  band: "low" | "mid" | "high";
}

const BLOBS: Blob[] = [
  { seed: 1.3, color: "255,255,255", baseR: 0.34, band: "low" }, // soft white
  { seed: 7.1, color: "56,63,252", baseR: 0.3, band: "mid" }, // blue
  { seed: 4.6, color: "92,50,252", baseR: 0.28, band: "high" }, // violet
  { seed: 11.9, color: "173,19,251", baseR: 0.2, band: "mid" }, // magenta
];

interface Ribbon {
  seed: number;
  freqA: number;
  freqB: number;
  speedA: number;
  speedB: number;
  dir: number;
  phase: number;
  hue: string;
  band: "low" | "mid" | "high";
}

const RIBBONS: Ribbon[] = [
  { seed: 0.4, freqA: 1.6, freqB: 2.9, speedA: 0.6, speedB: -0.35, dir: 1, phase: 0, hue: "255,255,255", band: "low" }, // soft white
  { seed: 3.2, freqA: 2.3, freqB: 1.1, speedA: -0.45, speedB: 0.5, dir: -1, phase: 1.4, hue: "56,63,252", band: "mid" }, // blue
  { seed: 6.7, freqA: 1.1, freqB: 2.6, speedA: 0.3, speedB: 0.7, dir: 1, phase: 2.6, hue: "92,50,252", band: "high" }, // violet
  { seed: 9.1, freqA: 2.8, freqB: 1.4, speedA: -0.55, speedB: -0.2, dir: -1, phase: 4.1, hue: "173,19,251", band: "mid" }, // magenta
];

export function drawBubbleFrame(ctx: CanvasRenderingContext2D, input: BubbleFrameInput): void {
  const { width: w, height: h, t, level, bands, mode } = input;
  ctx.clearRect(0, 0, w, h);

  const swirl = mode === "processing" ? t * 0.8 : 0;
  const energy = mode === "processing" ? 0.35 + 0.15 * Math.sin(t * 1.3) : level;

  // ---- Layer 1: drifting blobs ----
  ctx.globalCompositeOperation = "lighter";
  for (const blob of BLOBS) {
    const bandLevel = mode === "processing" ? energy : bands[blob.band];
    const n = noise1D(t * 0.07 + blob.seed * 10);
    const angle = t * (0.18 + 0.05 * blob.seed * 0.1) + blob.seed * 2 + swirl;
    const radiusDrift = 0.14 + 0.08 * Math.sin(t * 0.23 + blob.seed);
    const cx = w / 2 + Math.cos(angle) * w * radiusDrift * (1 + 0.3 * n);
    const cy = h / 2 + Math.sin(angle * 1.3 + blob.seed) * h * radiusDrift * (1 - 0.2 * n);
    const r = w * (blob.baseR + 0.08 * Math.sin(t * 0.5 + blob.seed * 3) + bandLevel * 0.16) * (0.85 + 0.3 * n);
    const stretch = 1 + 0.25 * Math.sin(t * 0.4 + blob.seed * 5);

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, r));
    const alpha = 0.22 + bandLevel * 0.3;
    gradient.addColorStop(0, `rgba(${blob.color},${alpha})`);
    gradient.addColorStop(1, `rgba(${blob.color},0)`);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(stretch, 1 / stretch);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- Layer 2: flowing ribbons ----
  const samples = 80;
  for (const ribbon of RIBBONS) {
    const bandLevel = mode === "processing" ? energy : bands[ribbon.band];
    const ampNoise = 0.6 + 0.4 * noise1D(t * 0.1 + ribbon.seed * 5);
    const freqNoise = 1 + 0.15 * noise1D(t * 0.06 + ribbon.seed * 9 + 50) + bandLevel * 0.1;
    const baseAmp = h * (0.07 + bandLevel * 0.12) * ampNoise;
    const centerY = h * (0.3 + 0.1 * ((ribbon.seed * 13) % 1)) + h * 0.2;

    const topPts: { x: number; y: number }[] = [];
    const bottomPts: { x: number; y: number }[] = [];

    for (let i = 0; i <= samples; i++) {
      const px = (i / samples) * w;
      const u = i / samples;
      const wave =
        Math.sin(u * Math.PI * ribbon.freqA * freqNoise + t * ribbon.speedA * ribbon.dir + ribbon.phase) * 0.6 +
        Math.sin(u * Math.PI * ribbon.freqB * freqNoise - t * ribbon.speedB * ribbon.dir + ribbon.phase * 1.7) * 0.4;
      const y = centerY + wave * baseAmp;
      // thin at the ends, fuller in the middle, slow breathing
      const thickness = (h * 0.035 + h * 0.025 * Math.sin(t * 0.3 + ribbon.seed)) * Math.sin(u * Math.PI) + 0.5;
      topPts.push({ x: px, y: y - thickness });
      bottomPts.push({ x: px, y: y + thickness });
    }

    ctx.beginPath();
    ctx.moveTo(topPts[0].x, topPts[0].y);
    for (let i = 1; i < topPts.length - 1; i++) {
      const mx = (topPts[i].x + topPts[i + 1].x) / 2;
      const my = (topPts[i].y + topPts[i + 1].y) / 2;
      ctx.quadraticCurveTo(topPts[i].x, topPts[i].y, mx, my);
    }
    for (let i = bottomPts.length - 1; i > 0; i--) {
      const mx = (bottomPts[i].x + bottomPts[i - 1].x) / 2;
      const my = (bottomPts[i].y + bottomPts[i - 1].y) / 2;
      ctx.quadraticCurveTo(bottomPts[i].x, bottomPts[i].y, mx, my);
    }
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, 0, w, h);
    const alpha = 0.16 + bandLevel * 0.24;
    grad.addColorStop(0, `rgba(${ribbon.hue},0)`);
    grad.addColorStop(0.5, `rgba(${ribbon.hue},${alpha})`);
    grad.addColorStop(1, `rgba(${ribbon.hue},0)`);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  ctx.globalCompositeOperation = "source-over";
}

// ---------------------------------------------------------------------------------------------------------------------
// The same living palette and noise, laid out for a WIDE bar (the input bar while listening): soft colour blobs spread along
// the width plus flowing ribbons, all driven by the live mic level. Drawn sharp here; the host blurs the canvas with CSS.
// ---------------------------------------------------------------------------------------------------------------------

const BAR_BLOBS: { color: string; x: number; seed: number; band: "low" | "mid" | "high" }[] = [
  { color: "56,63,252", x: 0.08, seed: 2.1, band: "low" }, // blue
  { color: "92,50,252", x: 0.28, seed: 5.7, band: "mid" }, // violet
  { color: "255,255,255", x: 0.5, seed: 1.3, band: "low" }, // soft white core
  { color: "173,19,251", x: 0.72, seed: 8.4, band: "high" }, // magenta
  { color: "56,63,252", x: 0.92, seed: 11.2, band: "mid" }, // blue
];

export function drawWaveBarFrame(ctx: CanvasRenderingContext2D, input: BubbleFrameInput): void {
  const { width: w, height: h, t, level, bands, mode } = input;
  ctx.clearRect(0, 0, w, h);
  const calm = mode === "processing";
  const energy = calm ? 0.22 + 0.1 * Math.sin(t * 1.1) : level;
  const band = (b: "low" | "mid" | "high") => (calm ? energy : bands[b]);

  ctx.globalCompositeOperation = "lighter";

  // Layer 1: colour blobs drifting along the bar, swelling with their frequency band.
  for (const blob of BAR_BLOBS) {
    const n = noise1D(t * 0.12 + blob.seed * 7);
    const lvl = band(blob.band);
    const cx = w * (blob.x + 0.05 * Math.sin(t * 0.35 + blob.seed) * (1 + n));
    const cy = h / 2 + Math.sin(t * 0.5 + blob.seed * 2) * h * 0.12;
    const r = h * (0.85 + 0.25 * Math.sin(t * 0.4 + blob.seed * 3) + lvl * 1.3) * (0.85 + 0.3 * n);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, r));
    const alpha = (blob.color === "255,255,255" ? 0.16 : 0.26) + lvl * 0.4;
    gradient.addColorStop(0, `rgba(${blob.color},${alpha})`);
    gradient.addColorStop(1, `rgba(${blob.color},0)`);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(2.4, 1); // stretch each blob along the bar
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Layer 2: flowing ribbons across the full width, thin at the ends.
  const samples = 120;
  for (const ribbon of RIBBONS) {
    const lvl = band(ribbon.band);
    const ampNoise = 0.6 + 0.4 * noise1D(t * 0.1 + ribbon.seed * 5);
    const freqNoise = 1 + 0.15 * noise1D(t * 0.06 + ribbon.seed * 9 + 50) + lvl * 0.1;
    const amp = h * (0.1 + lvl * 0.34) * ampNoise;
    const centerY = h / 2;
    const top: { x: number; y: number }[] = [];
    const bottom: { x: number; y: number }[] = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      const wave =
        Math.sin(u * Math.PI * 2 * ribbon.freqA * freqNoise + t * ribbon.speedA * 2.2 * ribbon.dir + ribbon.phase) * 0.6 +
        Math.sin(u * Math.PI * 2 * ribbon.freqB * freqNoise - t * ribbon.speedB * 2.2 * ribbon.dir + ribbon.phase * 1.7) * 0.4;
      const y = centerY + wave * amp * Math.sin(u * Math.PI); // pinned to the centre line at both ends
      const thickness = (h * 0.05 + h * 0.03 * Math.sin(t * 0.3 + ribbon.seed)) * Math.sin(u * Math.PI) + 0.6;
      top.push({ x: u * w, y: y - thickness });
      bottom.push({ x: u * w, y: y + thickness });
    }
    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    for (let i = 1; i < top.length - 1; i++) ctx.quadraticCurveTo(top[i].x, top[i].y, (top[i].x + top[i + 1].x) / 2, (top[i].y + top[i + 1].y) / 2);
    for (let i = bottom.length - 1; i > 0; i--) ctx.quadraticCurveTo(bottom[i].x, bottom[i].y, (bottom[i].x + bottom[i - 1].x) / 2, (bottom[i].y + bottom[i - 1].y) / 2);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    const alpha = 0.28 + lvl * 0.5;
    grad.addColorStop(0, `rgba(${ribbon.hue},0)`);
    grad.addColorStop(0.5, `rgba(${ribbon.hue},${alpha})`);
    grad.addColorStop(1, `rgba(${ribbon.hue},0)`);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  ctx.globalCompositeOperation = "source-over";
}
