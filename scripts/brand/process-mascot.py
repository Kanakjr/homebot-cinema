#!/usr/bin/env python3
"""Turn raw mascot renders into the app's system images (docs/mascot-art.md).

  python3 scripts/brand/process-mascot.py [raw_dir] [--out assets/images]

raw_dir (default assets/brand/mascot/raw) holds PNG/JPG files named after the target:
  empty, default_avatar, anonymous      character on a flat chroma background (green, #00FF00 or similar): the background is
                                        keyed out, edges despilled, the subject cropped and centred on a transparent square.
  library_placeholder, calendar_placeholder   full-bleed illustrations (no keying), fitted to 500x286.
Each output keeps the filename the app already uses, so no code changes: assets/images/<name>.png.
Needs Pillow (pip install pillow).
"""
import sys
from pathlib import Path

from PIL import Image, ImageFilter

SQUARE = {'empty': 300, 'default_avatar': 800, 'anonymous': 512}
WIDE = {'library_placeholder': (500, 286), 'calendar_placeholder': (500, 286)}
EXTS = ('.png', '.jpg', '.jpeg', '.webp')


def find(raw: Path, name: str):
    for ext in EXTS:
        p = raw / f'{name}{ext}'
        if p.exists():
            return p
    return None


def key_out(img: Image.Image, tolerance: float = 70.0, soft: float = 40.0) -> Image.Image:
    """Make the flat background transparent. The key colour is the median of the four corners."""
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    key = tuple(sorted(c[i] for c in corners)[1] for i in range(3))
    out = img.copy()
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            d = ((r - key[0]) ** 2 + (g - key[1]) ** 2 + (b - key[2]) ** 2) ** 0.5
            if d <= tolerance:
                a = 0
            elif d >= tolerance + soft:
                a = 255
            else:
                a = int(255 * (d - tolerance) / soft)
            if 0 < a < 255 or (a == 255 and d < tolerance + 2 * soft):
                # despill: pull the background hue out of edge pixels
                if key[1] > key[0] and key[1] > key[2]:
                    g = min(g, max(r, b))
                elif key[2] > key[0] and key[2] > key[1]:
                    b = min(b, max(r, g))
            op[x, y] = (r, g, b, a)
    alpha = out.getchannel('A').filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))  # trim the fringe, soften
    out.putalpha(alpha)
    return out


def fit_square(img: Image.Image, size: int, pad: float = 0.06) -> Image.Image:
    bbox = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bbox:
        raise SystemExit('nothing left after keying out the background: is the background flat?')
    sub = img.crop(bbox)
    inner = int(size * (1 - 2 * pad))
    sub.thumbnail((inner, inner), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(sub, ((size - sub.width) // 2, (size - sub.height) // 2), sub)
    return canvas


def fit_wide(img: Image.Image, size) -> Image.Image:
    img = img.convert('RGBA')
    scale = max(size[0] / img.width, size[1] / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left, top = (img.width - size[0]) // 2, (img.height - size[1]) // 2
    return img.crop((left, top, left + size[0], top + size[1]))


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    out = Path(argv[argv.index('--out') + 1]) if '--out' in argv else Path('assets/images')
    if '--out' in argv:
        args.remove(str(out))
    raw = Path(args[0]) if args else Path('assets/brand/mascot/raw')
    done = 0
    for name, size in SQUARE.items():
        src = find(raw, name)
        if src:
            fit_square(key_out(Image.open(src)), size).save(out / f'{name}.png', optimize=True)
            print(f'{src.name} -> {out / (name + ".png")} ({size}x{size})')
            done += 1
    for name, size in WIDE.items():
        src = find(raw, name)
        if src:
            fit_wide(Image.open(src), size).save(out / f'{name}.png', optimize=True)
            print(f'{src.name} -> {out / (name + ".png")} {size}')
            done += 1
    if not done:
        raise SystemExit(f'no raw images found in {raw} (expected: {", ".join(list(SQUARE) + list(WIDE))})')


if __name__ == '__main__':
    main(sys.argv[1:])
