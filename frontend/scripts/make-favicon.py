"""One-off: build the ChambersAI tab icon from public/brand/logo-mark.png (the white lawyer "A" mark).
The white mark is invisible on a light browser tab, so it sits on a rounded-square tile in the brand blue-violet gradient
(#383ffc -> #5c32fc, diagonal), centred at ~62% of the tile, no outline. Small sizes use a slightly larger mark and every size is
drawn at 8x and averaged down, so 16 px stays crisp.
Writes: public/favicon.ico (16, 32, 48), public/brand/favicon-16.png, favicon-32.png, favicon-192.png, and
public/brand/apple-touch-icon.png (180x180, a full-bleed square: iOS rounds it itself).
Usage: python3 scripts/make-favicon.py   (needs Pillow)"""
import io
import struct
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
src = Image.open(root / "public/brand/logo-mark.png").convert("RGBA")
mark = src.crop(src.split()[3].point(lambda a: 255 if a > 40 else 0).getbbox())  # tight to the mark
# pure white, original shape (alpha untouched)
mark = Image.merge("RGBA", (Image.new("L", mark.size, 255),) * 3 + (mark.split()[3],))

TOP_LEFT = (0x38, 0x3F, 0xFC)
BOTTOM_RIGHT = (0x5C, 0x32, 0xFC)
SS = 8  # supersampling


def gradient(n: int) -> Image.Image:
    """Diagonal (top-left -> bottom-right) linear gradient, n x n."""
    t = Image.linear_gradient("L").resize((n, n))  # vertical 0..255
    h = t.rotate(90, expand=True).transpose(Image.FLIP_LEFT_RIGHT)  # horizontal 0..255
    d = Image.blend(t, h, 0.5)  # average of the two = diagonal
    a = Image.new("RGB", (n, n), TOP_LEFT)
    b = Image.new("RGB", (n, n), BOTTOM_RIGHT)
    return Image.composite(b, a, d)


def tile(size: int, rounded: bool, ratio: float) -> Image.Image:
    n = size * SS
    base = gradient(n).convert("RGBA")
    if rounded:
        mask = Image.new("L", (n, n), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, n - 1, n - 1), radius=round(n * 0.22), fill=255)
        base.putalpha(mask)
    scale = n * ratio / max(mark.size)
    m = mark.resize((max(1, round(mark.width * scale)), max(1, round(mark.height * scale))), Image.LANCZOS)
    base.alpha_composite(m, ((n - m.width) // 2, (n - m.height) // 2))
    return base.resize((size, size), Image.LANCZOS)


def ratio_for(size: int) -> float:
    return 0.62 if size >= 48 else 0.68  # a little more mark on the tiny tiles, where 62% leaves it too small to read


brand = root / "public/brand"
png = {}
for size in (16, 32, 48, 192):
    png[size] = tile(size, True, ratio_for(size))
png[16].save(brand / "favicon-16.png")
png[32].save(brand / "favicon-32.png")
png[192].save(brand / "favicon-192.png")
tile(180, False, 0.62).save(brand / "apple-touch-icon.png")  # full-bleed square

# favicon.ico with one PNG-encoded image per size (so each size is the crisp one drawn above, not a resize of a single image)
entries = []
for size in (16, 32, 48):
    buf = io.BytesIO()
    png[size].save(buf, "PNG")
    entries.append((size, buf.getvalue()))
header = struct.pack("<HHH", 0, 1, len(entries))
offset = 6 + 16 * len(entries)
directory = b""
blobs = b""
for size, data in entries:
    directory += struct.pack("<BBBBHHII", size, size, 0, 0, 0, 32, len(data), offset + len(blobs))
    blobs += data
(root / "public/favicon.ico").write_bytes(header + directory + blobs)
print("wrote public/favicon.ico (16, 32, 48) and brand/favicon-16.png, favicon-32.png, favicon-192.png, apple-touch-icon.png")
