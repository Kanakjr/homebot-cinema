#!/usr/bin/env python3
"""Turn raw mascot renders into the app's system images (docs/mascot-art.md).

  python3 scripts/brand/process-mascot.py [raw_dir] [--out assets/images] [--bg green|white] [--sticker|--no-sticker]

raw_dir (default assets/brand/mascot/raw) holds PNG/JPG/WEBP files named after the target:
  empty, default_avatar, anonymous      the character on a flat background. --bg green (default): the flat chroma colour is keyed
                                        out everywhere. --bg white: only white connected to the picture's edge is removed, plus
                                        enclosed white gaps (between an arm and a leg), so white parts of the drawing survive.
  library_placeholder, calendar_placeholder   full-bleed illustrations (no keying), fitted to 500x286.
The subject is cropped and centred on a transparent square. With --sticker (default for the three characters) it gets a white
die-cut edge (add --glow for a soft amber glow), so it reads on dark and light backgrounds. Outputs keep the filenames the app already uses.
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


def cut_flood(img: Image.Image, tol: float = 26.0, pocket_min: int = 100) -> Image.Image:
    """White-style background: flood from the border, then also drop enclosed pure-white gaps of at least pocket_min pixels."""
    from collections import deque
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()
    bg = px[2, 2][:3]
    near = lambda c: sum((c[i] - bg[i]) ** 2 for i in range(3)) ** 0.5 <= tol
    seen = bytearray(w * h)
    q = deque([(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)])
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y * w + x]:
            continue
        seen[y * w + x] = 1
        if not near(px[x, y]):
            continue
        px[x, y] = (0, 0, 0, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    white = lambda c: c[3] > 0 and min(c[:3]) >= 246
    for y0 in range(h):
        for x0 in range(w):
            if seen[y0 * w + x0] or not white(px[x0, y0]):
                continue
            comp, q = [], deque([(x0, y0)])
            seen[y0 * w + x0] = 1
            while q:
                x, y = q.popleft()
                comp.append((x, y))
                for a, b in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= a < w and 0 <= b < h and not seen[b * w + a] and white(px[a, b]):
                        seen[b * w + a] = 1
                        q.append((a, b))
            if len(comp) >= pocket_min:
                for x, y in comp:
                    px[x, y] = (0, 0, 0, 0)
    a = img.getchannel('A').filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    img.putalpha(a)
    return img


def dilate(mask: Image.Image, r: int) -> Image.Image:
    for _ in range(r):
        mask = mask.filter(ImageFilter.MaxFilter(3))
    return mask


def sticker(img: Image.Image, outline: int, glow: int, glow_rgb=(255, 184, 48), glow_alpha: float = 0.95) -> Image.Image:
    """White die-cut edge of `outline` px and a soft amber glow of `glow` px around the subject."""
    a = img.getchannel('A')
    edge = dilate(a, outline) if outline else a
    if glow:
        halo = dilate(edge, max(2, glow // 2)).filter(ImageFilter.GaussianBlur(glow / 1.6))
        out = Image.merge('RGBA', (*Image.new('RGB', img.size, glow_rgb).split(), halo.point(lambda v: int(v * glow_alpha))))
    else:
        out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.alpha_composite(Image.merge('RGBA', (*Image.new('RGB', img.size, (255, 255, 255)).split(), edge.filter(ImageFilter.GaussianBlur(0.8)))))
    out.alpha_composite(img)
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
    import argparse
    ap = argparse.ArgumentParser(description='Process raw mascot renders into assets/images.')
    ap.add_argument('raw', nargs='?', default='assets/brand/mascot/raw')
    ap.add_argument('--out', default='assets/images')
    ap.add_argument('--bg', choices=['green', 'white'], default='green')
    ap.add_argument('--sticker', dest='sticker', action='store_true', default=True)
    ap.add_argument('--no-sticker', dest='sticker', action='store_false')
    ap.add_argument('--tol', type=float, default=26.0, help='--bg white: how close to the corner colour counts as background (lower keeps pale edges)')
    ap.add_argument('--glow', action='store_true', help='also add a soft amber glow around the sticker (off by default)')
    ap.add_argument('--already-sticker', default='', help='comma list of names that already have a white edge (only the glow is added)')
    args = ap.parse_args(argv)
    raw, out = Path(args.raw), Path(args.out)
    skip_edge = {n.strip() for n in args.already_sticker.split(',') if n.strip()}
    done = 0
    for name, size in SQUARE.items():
        src = find(raw, name)
        if not src:
            continue
        cut = key_out(Image.open(src)) if args.bg == 'green' else cut_flood(Image.open(src), tol=args.tol if name not in skip_edge else min(args.tol, 14.0))
        glow = max(14, size // 12) if args.glow else 0
        edge = 0 if name in skip_edge else max(4, size // 55)
        res = fit_square(cut, size, pad=0.06 + ((edge + glow) / size if args.sticker else 0))
        if args.sticker:
            res = sticker(res, edge, glow)
        res.save(out / f'{name}.png', optimize=True)
        print(f'{src.name} -> {out / (name + ".png")} ({size}x{size}{", sticker" if args.sticker else ""})')
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
