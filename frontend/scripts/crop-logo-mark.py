"""One-off: crop the advocate-neckband "A" out of public/brand/logo-white.png into public/brand/logo-mark.png.
Usage: python3 scripts/crop-logo-mark.py   (needs Pillow; does not modify logo-white.png)"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
src = root / "public/brand/logo-white.png"
out = root / "public/brand/logo-mark.png"
SIZE = 256
PAD = 0.12  # padding on each side, as a fraction of the output size
# The "A" sits between the "s" (ends x=1699) and the "I" (starts x=2017) in the 2172x724 original.
X0, X1 = 1700, 2000

im = Image.open(src).convert("RGBA")
region = im.crop((X0, 0, X1, im.height))
box = region.split()[3].point(lambda a: 255 if a > 40 else 0).getbbox()  # tight bounds of the mark only
mark = region.crop(box)

inner = round(SIZE * (1 - 2 * PAD))
scale = inner / max(mark.size)
mark = mark.resize((max(1, round(mark.width * scale)), max(1, round(mark.height * scale))), Image.LANCZOS)
canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
canvas.paste(mark, ((SIZE - mark.width) // 2, (SIZE - mark.height) // 2), mark)
canvas.save(out)
print(f"wrote {out.relative_to(root)} (mark bbox in source: {box[0] + X0},{box[1]} to {box[2] + X0},{box[3]})")
