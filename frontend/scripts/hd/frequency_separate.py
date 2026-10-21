"""Colour-safe merge of an AI-upscaled texture into the original, by frequency separation in linear light.

  final = lowpass(U) + highpass(U) + gain * M * (highpass(A) - highpass(U))  =  U + gain * M * (highpass(A) - highpass(U))

  U  the original, upsampled with a high-quality filter (Lanczos) to the target size
  A  the AI-upscaled image, averaged down to the target size
  M  an edge mask (brows, lashes, lip/eyelid edges, island borders): the AI only replaces fine detail where the
     original has real structure. In smooth skin M ~ 0, so the original's own grain is kept. (Measured: the AI
     smooths skin grain away, so using highpass(A) everywhere would lose detail there.)

All colour and tone come from lowpass(U) (the original); the AI only contributes zero-mean fine detail.
Usage: frequency_separate.py <original.jpg> <ai_x4.png> <out.png> [--size 2048] [--sigma 6] [--gain 1.0]
Prints per-channel mean and 5/50/95 percentile deltas over the skin region (linear light)."""
import argparse
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, uniform_filter

def to_linear(a):  # sRGB 0..1 -> linear
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)

def to_srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)

def load_linear(path):
    return to_linear(np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0)

def resize(lin, size):
    chans = [np.asarray(Image.fromarray(lin[..., c]).resize((size, size), Image.LANCZOS)) for c in range(3)]
    return np.clip(np.stack(chans, -1), 0, 1)

def block_mean(lin, size):
    f = lin.shape[0] // size
    return lin.reshape(size, f, size, f, 3).mean(axis=(1, 3))

def skin_mask(srgb):
    """Rough skin region of a head/body colour texture: warm hue, moderate saturation, not too dark or too red."""
    r, g, b = srgb[..., 0], srgb[..., 1], srgb[..., 2]
    mx, mn = srgb.max(-1), srgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    return (r > g) & (g > b) & (mx > 0.45) & (sat > 0.12) & (sat < 0.55) & ((g - b) / np.maximum(r, 1e-6) > 0.06)

def edge_mask(srgb_u, lo, hi):
    luma = 0.2126 * srgb_u[..., 0] + 0.7152 * srgb_u[..., 1] + 0.0722 * srgb_u[..., 2]  # (no matmul: avoids an Accelerate bug)
    mean = uniform_filter(luma, 7)
    std = np.sqrt(np.maximum(uniform_filter(luma * luma, 7) - mean * mean, 0))
    t = np.clip((std - lo) / (hi - lo), 0, 1)
    t = t * t * (3 - 2 * t)
    return gaussian_filter(t, 2.5)[..., None].astype(np.float32)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("original"); ap.add_argument("ai"); ap.add_argument("out")
    ap.add_argument("--size", type=int, default=2048); ap.add_argument("--sigma", type=float, default=6.0)
    ap.add_argument("--gain", type=float, default=1.0)
    ap.add_argument("--edge-lo", type=float, default=0.035); ap.add_argument("--edge-hi", type=float, default=0.09)
    ap.add_argument("--save-mask"); ap.add_argument("--save-jpeg"); ap.add_argument("--jpeg-quality", type=int, default=90)
    a = ap.parse_args()
    U = resize(load_linear(a.original), a.size)
    A = block_mean(load_linear(a.ai), a.size)
    hpU = U - gaussian_filter(U, (a.sigma, a.sigma, 0))
    hpA = A - gaussian_filter(A, (a.sigma, a.sigma, 0))
    M = edge_mask(to_srgb(U), a.edge_lo, a.edge_hi)
    final = np.clip(U + a.gain * M * (hpA - hpU), 0, 1)  # gain = how far toward the AI detail (0 = original, 1 = full)
    Image.fromarray((to_srgb(final) * 255 + 0.5).astype(np.uint8)).save(a.out)
    if a.save_jpeg: Image.open(a.out).save(a.save_jpeg, quality=a.jpeg_quality, subsampling=2, optimize=True)
    if a.save_mask: Image.fromarray((M[..., 0] * 255).astype(np.uint8)).save(a.save_mask)
    sk = skin_mask(to_srgb(U)) & (M[..., 0] < 0.05)  # skin pixels away from edges
    print(f"edge mask covers {100 * (M[..., 0] > 0.5).mean():.1f}% of the texture; skin sample = {100 * sk.mean():.1f}%")
    worst = 0
    for name, u, f in (("U (orig)", U, final),):
        for c, ch in enumerate("RGB"):
            uu, ff = u[..., c][sk], f[..., c][sk]
            row = [f"mean {100 * (ff.mean() / uu.mean() - 1):+.3f}%"]
            for p in (5, 50, 95):
                row.append(f"p{p} {100 * (np.percentile(ff, p) / np.percentile(uu, p) - 1):+.3f}%")
                worst = max(worst, abs(np.percentile(ff, p) / np.percentile(uu, p) - 1))
            worst = max(worst, abs(ff.mean() / uu.mean() - 1))
            print(f"  {ch}: " + "  ".join(row))
    print(f"worst skin-stat deviation {100 * worst:.3f}% (limit 1%)")

if __name__ == "__main__":
    main()
