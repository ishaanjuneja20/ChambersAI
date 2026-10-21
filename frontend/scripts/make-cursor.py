"""One-off: build the ChambersAI "A" mouse-cursor images from public/brand/logo-mark.png.
Writes public/brand/cursor-a.png (24x24) and public/brand/cursor-a@2x.png (48x48): the white mark, unchanged
in shape, with a very thin dark outline so it stays visible on light backgrounds. The mark is centred, so the
cursor hotspot is the middle of the image (12,12 at 1x).
Usage: python3 scripts/make-cursor.py   (needs Pillow)"""
from pathlib import Path
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parent.parent
src = Image.open(root / "public/brand/logo-mark.png").convert("RGBA")
mark = src.crop(src.split()[3].point(lambda a: 255 if a > 40 else 0).getbbox())  # tight to the mark


def make(size: int, outline: int, pad: int) -> Image.Image:
    inner = size - 2 * (pad + outline)  # room for the mark itself
    scale = inner / max(mark.size)
    m = mark.resize((max(1, round(mark.width * scale)), max(1, round(mark.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x, y = (size - m.width) // 2, (size - m.height) // 2
    alpha = Image.new("L", (size, size), 0)
    alpha.paste(m.split()[3], (x, y))
    grown = alpha.filter(ImageFilter.MaxFilter(2 * outline + 1))  # grow the silhouette by `outline` px
    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ring.putalpha(grown.point(lambda a: round(a * 0.55)))  # rgba(0,0,0,0.55)
    canvas.alpha_composite(ring)
    canvas.alpha_composite(Image.merge("RGBA", (Image.new("L", m.size, 255),) * 3 + (m.split()[3],)), (x, y))  # pure white mark
    return canvas


for name, size, outline, pad in [("cursor-a.png", 24, 1, 2), ("cursor-a@2x.png", 48, 2, 3)]:
    make(size, outline, pad).save(root / "public/brand" / name)
    print("wrote", name, size)
