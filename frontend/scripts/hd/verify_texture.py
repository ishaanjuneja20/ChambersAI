"""Verifies an HD head texture against its original: per-channel mean and 5/50/95 percentile of the WHOLE skin region
(including pixels the AI touched), in linear light, must match within 1%; also reports how much of the texture
changed and writes an amplified change map. Usage: verify_texture.py <original.jpg> <hd.png> <change_map.png>"""
import sys
import numpy as np
from PIL import Image
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from frequency_separate import load_linear, resize, skin_mask, to_linear, to_srgb

orig, hd, out = sys.argv[1:4]
U = resize(load_linear(orig), 2048)
# Compare like with like: the HD texture is stored as 8-bit sRGB, so quantise the reference the same way.
U = to_linear(np.round(to_srgb(U) * 255) / 255).astype(np.float32)
F = load_linear(hd)
from scipy.ndimage import uniform_filter
sU = to_srgb(U)
luma_u = 0.2126 * sU[..., 0] + 0.7152 * sU[..., 1] + 0.0722 * sU[..., 2]
std31 = np.sqrt(np.maximum(uniform_filter(luma_u * luma_u, 31) - uniform_filter(luma_u, 31) ** 2, 0))
# Skin = warm, moderately saturated, and smooth at the 31 px scale: this excludes painted hair, brows, lashes and eye
# detail (high local contrast), which are checked separately by eye. The AI-touched edge pixels of real skin stay IN.
sk = skin_mask(sU) & (std31 < 0.03)
def stats(mask):
    worst, rows = 0.0, []
    for c, ch in enumerate("RGB"):
        u, f = U[..., c][mask], F[..., c][mask]
        d = [f.mean() / u.mean() - 1] + [np.percentile(f, p) / np.percentile(u, p) - 1 for p in (5, 50, 95)]
        worst = max(worst, max(abs(x) for x in d)); rows.append(f"{ch}: mean {100*d[0]:+.3f}% p5 {100*d[1]:+.3f}% p50 {100*d[2]:+.3f}% p95 {100*d[3]:+.3f}%")
    return worst, rows
# The RPM head atlas has the same UV layout on every avatar: face + ears in the centre, neck/chest below, painted scalp
# hair at the sides and top. Skin region = that layout, intersected with warm, bright, skin-coloured pixels. This keeps
# every AI-touched skin pixel (brow/eyelid/lip edges) and excludes the painted hair.
H, W_ = luma_u.shape
yy, xx = np.mgrid[0:H, 0:W_]; xx = xx / W_; yy = yy / H
layout = ((xx > 0.37) & (xx < 0.69) & (yy > 0.16) & (yy < 0.62)) | ((yy > 0.68) & (xx > 0.04) & (xx < 0.96))
wide = layout & skin_mask(sU) & (luma_u > 0.38)
worst, rows = stats(sk)
worst_w, rows_w = stats(wide)
lum = lambda a: 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
srgbU, srgbF = np.asarray(Image.fromarray((to_srgb(U) * 255 + .5).astype(np.uint8))).astype(np.float32), np.asarray(Image.fromarray((to_srgb(F) * 255 + .5).astype(np.uint8))).astype(np.float32)
diff = np.abs(srgbF - srgbU).max(-1)
# lips: strongly red, saturated pixels
r, g, b = (to_srgb(U)[..., i] for i in range(3))
lips = (r > 0.45) & (r > 1.5 * g) & (r > 1.5 * b)
print(f"smooth skin   ({100*sk.mean():.1f}% of texture): worst deviation {100*worst:.3f}% -> {'PASS' if worst < 0.01 else 'FAIL'}  | " + " | ".join(rows))
print(f"wide skin     ({100*wide.mean():.1f}% of texture, includes AI-touched pixels): worst deviation {100*worst_w:.3f}% -> {'PASS' if worst_w < 0.01 else 'FAIL'}  | " + " | ".join(rows_w))
print(f"changed >4 levels: {100*(diff>4).mean():.2f}% of texture; max change {diff.max():.0f}/255 | lips region ({100*lips.mean():.2f}%): mean change {diff[lips].mean() if lips.any() else 0:.2f} levels, mean colour shift {[round(float(100*(F[...,i][lips].mean()/U[...,i][lips].mean()-1)),3) for i in range(3)] if lips.any() else 'n/a'} %")
Image.fromarray(np.clip(diff * 8, 0, 255).astype(np.uint8)).resize((768, 768)).save(out)
