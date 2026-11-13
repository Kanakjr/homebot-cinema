#!/usr/bin/env python3
"""
Generate HomeBot Cinema Icons & Favicons
Creates multi-resolution ICO, SVG, Apple Touch, and Android PWA maskable icons.
"""

import os
from PIL import Image, ImageDraw

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
FAVICONS_DIR = os.path.join(BASE_DIR, 'assets', 'favicons')
IMAGES_DIR = os.path.join(BASE_DIR, 'assets', 'images')

os.makedirs(FAVICONS_DIR, exist_ok=True)
os.makedirs(IMAGES_DIR, exist_ok=True)

def create_cinema_icon(size=1024, maskable=False, monochrome=False):
    bg_color = (13, 17, 23, 255) if maskable else (0, 0, 0, 0)
    img = Image.new('RGBA', (size, size), bg_color)
    draw = ImageDraw.Draw(img)
    scale = size / 1024.0

    fg_orange = (255, 255, 255, 255) if monochrome else (242, 122, 36, 255)
    fg_yellow = (200, 200, 200, 255) if monochrome else (255, 215, 0, 255)
    plate_border = (255, 255, 255, 255) if monochrome else (242, 122, 36, 255)
    accent_bar = (255, 255, 255, 200) if monochrome else (245, 176, 39, 230)

    if not maskable:
        # Outer rounded squircle
        draw.rounded_rectangle(
            [int(36 * scale), int(36 * scale), int(988 * scale), int(988 * scale)],
            radius=int(220 * scale),
            fill=(13, 17, 23, 255),
            outline=(48, 54, 61, 255) if not monochrome else (255, 255, 255, 180),
            width=max(2, int(18 * scale))
        )
    else:
        # Maskable safe area background plate
        draw.rounded_rectangle(
            [int(110 * scale), int(110 * scale), int(914 * scale), int(914 * scale)],
            radius=int(180 * scale),
            fill=(22, 27, 34, 255),
            outline=(48, 54, 61, 255),
            width=max(2, int(12 * scale))
        )

    # Inner Cinema Screen plate
    plate_margin = 190 if not maskable else 230
    draw.rounded_rectangle(
        [
            int(plate_margin * scale),
            int(plate_margin * scale),
            int((1024 - plate_margin) * scale),
            int((1024 - plate_margin) * scale)
        ],
        radius=int(110 * scale),
        fill=(22, 27, 34, 255) if not monochrome else (0, 0, 0, 255),
        outline=plate_border,
        width=max(2, int(20 * scale))
    )

    # Top indicator dots (Reels / Cyber nodes)
    dot_r = int(28 * scale)
    dot_y = int((plate_margin + 75) * scale)
    left_dot_x = int((plate_margin + 80) * scale)
    right_dot_x = int((1024 - plate_margin - 80) * scale)
    draw.ellipse([left_dot_x - dot_r, dot_y - dot_r, left_dot_x + dot_r, dot_y + dot_r], fill=fg_orange)
    draw.ellipse([right_dot_x - dot_r, dot_y - dot_r, right_dot_x + dot_r, dot_y + dot_r], fill=fg_orange)

    # Center Play Triangle in Radiant Cyber-Yellow
    tx1, ty1 = int(410 * scale), int(355 * scale)
    tx2, ty2 = int(685 * scale), int(512 * scale)
    tx3, ty3 = int(410 * scale), int(669 * scale)
    draw.polygon([(tx1, ty1), (tx2, ty2), (tx3, ty3)], fill=fg_yellow)

    # Bottom accent glow bar
    bar_y1 = int((1024 - plate_margin - 68) * scale)
    bar_y2 = int((1024 - plate_margin - 48) * scale)
    draw.rounded_rectangle(
        [int(410 * scale), bar_y1, int(614 * scale), bar_y2],
        radius=int(6 * scale),
        fill=accent_bar
    )

    return img

print("Generating 1024x1024 master assets...")
master_standard = create_cinema_icon(1024, maskable=False)
master_maskable = create_cinema_icon(1024, maskable=True)
master_mono = create_cinema_icon(1024, maskable=False, monochrome=True)

# 1. Favicon ICO (multi-resolution 16 to 256)
ico_path = os.path.join(FAVICONS_DIR, 'favicon.ico')
master_standard.save(ico_path, format='ICO', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"Generated: {ico_path}")

# Also write icon_256x256.ico if referenced in manifest
ico_256_path = os.path.join(FAVICONS_DIR, 'icon_256x256.ico')
master_standard.save(ico_256_path, format='ICO', sizes=[(256, 256)])

# 2. Vector SVG Favicon
svg_content = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <rect width="64" height="64" rx="16" fill="#0d1117" stroke="#30363d" stroke-width="2"/>
    <rect x="12" y="12" width="40" height="40" rx="9" fill="#161b22" stroke="#F27A24" stroke-width="2.5"/>
    <polygon points="26,23 44,32 26,41" fill="#FFD700"/>
    <circle cx="21" cy="20" r="2.5" fill="#F27A24"/>
    <circle cx="43" cy="20" r="2.5" fill="#F27A24"/>
    <rect x="25" y="44" width="14" height="2" rx="1" fill="#F5B027" opacity="0.8"/>
</svg>"""
svg_path = os.path.join(FAVICONS_DIR, 'favicon.svg')
with open(svg_path, 'w') as f:
    f.write(svg_content)
print(f"Generated: {svg_path}")

# 3. Standard PNG icons
png_targets = [
    (master_standard, os.path.join(IMAGES_DIR, 'icon_512x512.png'), (512, 512)),
    (master_standard, os.path.join(IMAGES_DIR, 'icon_196x196.png'), (196, 196)),
    (master_standard, os.path.join(IMAGES_DIR, 'icon.png'), (256, 256)),
    (master_standard, os.path.join(IMAGES_DIR, 'logo.png'), (256, 256)),
    (master_standard, os.path.join(IMAGES_DIR, 'stremio_symbol.png'), (256, 256)),
    (master_maskable, os.path.join(IMAGES_DIR, 'maskable_icon_512x512.png'), (512, 512)),
    (master_maskable, os.path.join(IMAGES_DIR, 'maskable_icon_196x196.png'), (196, 196)),
    (master_maskable, os.path.join(IMAGES_DIR, 'maskable_icon.png'), (256, 256)),
    (master_mono, os.path.join(IMAGES_DIR, 'monochrome_icon_512x512.png'), (512, 512)),
]

for src_img, out_path, (w, h) in png_targets:
    resized = src_img.resize((w, h), Image.Resampling.LANCZOS)
    resized.save(out_path, format='PNG', optimize=True)
    print(f"Generated: {out_path} ({w}x{h})")

print("\nAll HomeBot Cinema favicons and icons successfully generated!")
