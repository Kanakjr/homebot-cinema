#!/usr/bin/env python3
"""
Renders original artwork for library_placeholder.png and calendar_placeholder.png.
Matches the design specification in docs/mascot-art.md:
  "Five illustrated vertical film posters fanned in a row: a ship on moonlit waves,
   a lighthouse, a dragon over mountains, a star map, and in the middle a glowing
   orange play button (for library) / calendar grid (for calendar)."

Renders at 4x resolution (2000x1144) with supersampling down to 500x286.
"""

import math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SCALE = 4
OUT_W, OUT_H = 500, 286
W, H = OUT_W * SCALE, OUT_H * SCALE

# Card dimensions at 4x
CARD_W = 390
CARD_H = 585
CORNER_R = 24

def make_gradient(w, h, top_color, bottom_color):
    """Creates a vertical linear gradient image."""
    base = Image.new('RGBA', (w, h))
    top = np.array(top_color, dtype=np.float32)
    bot = np.array(bottom_color, dtype=np.float32)
    y = np.linspace(0, 1, h)[:, None, None]
    grad = top * (1 - y) + bot * y
    grad = np.clip(grad, 0, 255).astype(np.uint8)
    # tile across width
    grad_img = np.tile(grad, (1, w, 1))
    return Image.fromarray(grad_img, 'RGBA')

def rounded_mask(w, h, r):
    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, w, h], radius=r, fill=255)
    return mask

def add_border(img, color=(255, 255, 255, 40), width=3, radius=CORNER_R):
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([width//2, width//2, img.width - width//2 - 1, img.height - width//2 - 1],
                           radius=radius, outline=color, width=width)

# -------------------------------------------------------------
# Poster 1: Star Map & Constellations (Leftmost, -2)
# -------------------------------------------------------------
def render_star_map_card():
    card = make_gradient(CARD_W, CARD_H, (22, 25, 48, 255), (8, 10, 24, 255))
    draw = ImageDraw.Draw(card)
    
    # Nebula glow
    nebula = Image.new('RGBA', (CARD_W, CARD_H), (0, 0, 0, 0))
    n_draw = ImageDraw.Draw(nebula)
    n_draw.ellipse([80, 120, 320, 380], fill=(70, 45, 120, 80))
    n_draw.ellipse([140, 200, 280, 450], fill=(40, 80, 130, 70))
    nebula = nebula.filter(ImageFilter.GaussianBlur(50))
    card = Image.alpha_composite(card, nebula)
    draw = ImageDraw.Draw(card)

    # Stars
    np.random.seed(42)
    for _ in range(65):
        sx = np.random.randint(20, CARD_W - 20)
        sy = np.random.randint(30, CARD_H - 30)
        size = np.random.choice([1, 2, 3], p=[0.7, 0.22, 0.08])
        alpha = np.random.randint(140, 255)
        color = (255, 255, 255, alpha) if np.random.rand() > 0.3 else (255, 220, 130, alpha)
        draw.ellipse([sx - size, sy - size, sx + size, sy + size], fill=color)

    # Moon
    mx, my, mr = 300, 130, 42
    draw.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=(255, 235, 180, 240))
    draw.ellipse([mx - mr + 16, my - mr - 8, mx + mr + 16, my + mr - 8], fill=(20, 23, 44, 255))

    # Constellation points & lines
    stars = [
        (90, 240), (140, 200), (210, 230), (270, 210),
        (250, 310), (180, 340), (120, 420), (180, 470), (240, 440)
    ]
    lines = [
        (0, 1), (1, 2), (2, 3), (2, 4), (4, 5), (5, 1), (5, 6), (6, 7), (7, 8)
    ]
    for i, j in lines:
        draw.line([stars[i], stars[j]], fill=(242, 180, 80, 120), width=2)
    for px, py in stars:
        draw.ellipse([px - 4, py - 4, px + 4, py + 4], fill=(255, 240, 200, 255))
        draw.ellipse([px - 2, py - 2, px + 2, py + 2], fill=(255, 255, 255, 255))

    # Celestial rings
    draw.arc([40, 180, 350, 490], 0, 360, fill=(242, 180, 80, 40), width=2)
    draw.arc([80, 220, 310, 450], 0, 360, fill=(242, 180, 80, 30), width=1)

    # Compass star at bottom
    cx, cy = CARD_W // 2, CARD_H - 70
    draw.line([cx - 25, cy, cx + 25, cy], fill=(255, 215, 0, 160), width=2)
    draw.line([cx, cy - 25, cx, cy + 25], fill=(255, 215, 0, 160), width=2)
    draw.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=(255, 230, 120, 240))

    # Clip to rounded card
    mask = rounded_mask(CARD_W, CARD_H, CORNER_R)
    card.putalpha(mask)
    add_border(card, (255, 215, 0, 60), width=3)
    return card

# -------------------------------------------------------------
# Poster 2: Ship on Moonlit Waves (Mid-left, -1)
# -------------------------------------------------------------
def render_ship_ocean_card():
    card = make_gradient(CARD_W, CARD_H, (28, 44, 76, 255), (8, 16, 30, 255))
    draw = ImageDraw.Draw(card)

    # Giant moon
    moon_img = Image.new('RGBA', (CARD_W, CARD_H), (0, 0, 0, 0))
    m_draw = ImageDraw.Draw(moon_img)
    mx, my, mr = CARD_W // 2, 190, 75
    # Halo
    m_draw.ellipse([mx - mr - 40, my - mr - 40, mx + mr + 40, my + mr + 40], fill=(255, 220, 150, 40))
    m_draw.ellipse([mx - mr - 15, my - mr - 15, mx + mr + 15, my + mr + 15], fill=(255, 230, 180, 80))
    m_draw.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=(255, 242, 210, 240))
    moon_img = moon_img.filter(ImageFilter.GaussianBlur(3))
    card = Image.alpha_composite(card, moon_img)
    draw = ImageDraw.Draw(card)

    # Distant clouds in front of moon
    draw.ellipse([mx - 100, my + 10, mx + 60, my + 38], fill=(26, 38, 62, 200))
    draw.ellipse([mx - 40, my + 25, mx + 110, my + 50], fill=(22, 34, 56, 220))

    # Horizon line
    horizon = 330

    # Moon reflections on water
    refl = Image.new('RGBA', (CARD_W, CARD_H), (0, 0, 0, 0))
    r_draw = ImageDraw.Draw(refl)
    for y in range(horizon, CARD_H, 12):
        w_spread = (y - horizon) * 0.7 + 25
        alpha = int(max(0, 120 - (y - horizon) * 0.45))
        r_draw.ellipse([mx - w_spread, y, mx + w_spread, y + 5], fill=(255, 230, 170, alpha))
    card = Image.alpha_composite(card, refl)
    draw = ImageDraw.Draw(card)

    # Ocean Wave Layers
    wave_colors = [
        (16, 32, 58, 255),
        (12, 25, 46, 255),
        (8, 18, 34, 255),
        (5, 12, 24, 255)
    ]
    for idx, col in enumerate(wave_colors):
        wy = horizon + 35 * idx + 20
        pts = [(0, CARD_H), (0, wy)]
        for x in range(0, CARD_W + 20, 20):
            freq = 0.025 + idx * 0.005
            amp = 10 + idx * 3
            y = wy + amp * math.sin(x * freq + idx * 1.5)
            pts.append((x, y))
        pts.append((CARD_W, CARD_H))
        draw.polygon(pts, fill=col)
        # wave crest highlight
        crest_pts = pts[1:-1]
        for i in range(len(crest_pts) - 1):
            if i % 3 != 0:
                draw.line([crest_pts[i], crest_pts[i+1]], fill=(140, 180, 220, 70), width=2)

    # Sailing Ship Silhouette
    sx, sy = CARD_W // 2 - 15, horizon - 20
    # Hull
    hull = [(sx - 55, sy + 30), (sx - 45, sy + 44), (sx + 45, sy + 44), (sx + 65, sy + 28), (sx + 45, sy + 32), (sx - 45, sy + 32)]
    draw.polygon(hull, fill=(6, 12, 22, 255))
    # Masts
    draw.line([(sx - 25, sy + 32), (sx - 25, sy - 45)], fill=(6, 12, 22, 255), width=3)
    draw.line([(sx + 5, sy + 32), (sx + 5, sy - 65)], fill=(6, 12, 22, 255), width=4)
    draw.line([(sx + 35, sy + 32), (sx + 35, sy - 38)], fill=(6, 12, 22, 255), width=3)
    # Bowsprit
    draw.line([(sx + 55, sy + 30), (sx + 85, sy + 18)], fill=(6, 12, 22, 255), width=2)
    # Sails (main, fore, mizzen)
    # Main mast sails
    draw.polygon([(sx - 5, sy - 55), (sx + 20, sy - 52), (sx + 15, sy - 30), (sx - 5, sy - 30)], fill=(12, 20, 34, 255))
    draw.polygon([(sx - 8, sy - 25), (sx + 24, sy - 22), (sx + 18, sy + 5), (sx - 8, sy + 5)], fill=(12, 20, 34, 255))
    draw.polygon([(sx - 10, sy + 10), (sx + 26, sy + 12), (sx + 20, sy + 28), (sx - 10, sy + 28)], fill=(12, 20, 34, 255))
    # Foremast sails
    draw.polygon([(sx - 35, sy - 38), (sx - 15, sy - 36), (sx - 18, sy - 15), (sx - 35, sy - 15)], fill=(12, 20, 34, 255))
    draw.polygon([(sx - 38, sy - 10), (sx - 12, sy - 8), (sx - 15, sy + 15), (sx - 38, sy + 15)], fill=(12, 20, 34, 255))
    # Mizzen sail
    draw.polygon([(sx + 25, sy - 30), (sx + 45, sy - 28), (sx + 42, sy - 8), (sx + 25, sy - 8)], fill=(12, 20, 34, 255))
    # Pennant flag
    draw.polygon([(sx + 5, sy - 65), (sx - 15, sy - 60), (sx + 5, sy - 56)], fill=(242, 122, 36, 255))

    mask = rounded_mask(CARD_W, CARD_H, CORNER_R)
    card.putalpha(mask)
    add_border(card, (100, 160, 220, 60), width=3)
    return card

# -------------------------------------------------------------
# Poster 3: Lighthouse on Cliffs (Mid-right, +1)
# -------------------------------------------------------------
def render_lighthouse_card():
    card = make_gradient(CARD_W, CARD_H, (42, 24, 64, 255), (14, 10, 26, 255))
    draw = ImageDraw.Draw(card)

    # Twilight sky with stars
    np.random.seed(99)
    for _ in range(40):
        sx = np.random.randint(15, CARD_W - 15)
        sy = np.random.randint(15, 260)
        draw.ellipse([sx, sy, sx + 2, sy + 2], fill=(255, 255, 255, np.random.randint(120, 240)))

    # Distant ocean
    horizon = 320
    draw.rectangle([0, horizon, CARD_W, CARD_H], fill=(16, 14, 30, 255))

    # Lighthouse coordinates
    lx, ly = 130, 160

    # Sweeping Golden Light Beams (semi-transparent polygons)
    beam_img = Image.new('RGBA', (CARD_W, CARD_H), (0, 0, 0, 0))
    b_draw = ImageDraw.Draw(beam_img)
    # Right beam
    beam1 = [(lx + 5, ly + 25), (CARD_W + 50, ly - 40), (CARD_W + 50, ly + 90)]
    b_draw.polygon(beam1, fill=(255, 215, 0, 95))
    # Left short beam
    beam2 = [(lx - 5, ly + 25), (-50, ly + 10), (-50, ly + 70)]
    b_draw.polygon(beam2, fill=(255, 215, 0, 45))
    # Lantern glow
    b_draw.ellipse([lx - 35, ly, lx + 35, ly + 50], fill=(255, 230, 120, 160))
    beam_img = beam_img.filter(ImageFilter.GaussianBlur(14))
    card = Image.alpha_composite(card, beam_img)
    draw = ImageDraw.Draw(card)

    # Ocean reflections under beam
    refl = Image.new('RGBA', (CARD_W, CARD_H), (0, 0, 0, 0))
    r_draw = ImageDraw.Draw(refl)
    for y in range(horizon, CARD_H, 10):
        rx = lx + (y - horizon) * 2.2
        r_draw.ellipse([rx - 40, y, rx + 40, y + 4], fill=(255, 220, 140, max(0, 100 - (y-horizon)//2)))
    card = Image.alpha_composite(card, refl)
    draw = ImageDraw.Draw(card)

    # Rocky Cliff on Left
    cliff_pts = [
        (0, CARD_H), (0, ly + 100),
        (40, ly + 105), (70, ly + 95), (100, ly + 100), (160, ly + 98),
        (185, ly + 140), (170, ly + 190), (220, ly + 250), (190, ly + 310),
        (230, ly + 380), (170, CARD_H)
    ]
    draw.polygon(cliff_pts, fill=(10, 8, 18, 255))
    # Cliff highlights
    draw.line([(0, ly + 100), (70, ly + 95), (160, ly + 98)], fill=(60, 45, 80, 200), width=3)

    # Lighthouse Tower
    # Base
    draw.polygon([(lx - 24, ly + 100), (lx + 24, ly + 100), (lx + 16, ly + 35), (lx - 16, ly + 35)], fill=(240, 235, 245, 255))
    # Red/Orange stripes
    draw.polygon([(lx - 22, ly + 80), (lx + 22, ly + 80), (lx + 19, ly + 60), (lx - 19, ly + 60)], fill=(225, 75, 45, 255))
    # Walkway & Lantern room
    draw.rectangle([lx - 22, ly + 32, lx + 22, ly + 36], fill=(30, 25, 40, 255))
    draw.rectangle([lx - 14, ly + 15, lx + 14, ly + 32], fill=(255, 245, 180, 255))
    # Window panes
    draw.line([(lx, ly + 15), (lx, ly + 32)], fill=(40, 30, 50, 255), width=2)
    # Dome roof
    draw.chord([lx - 16, ly - 5, lx + 16, ly + 25], 180, 360, fill=(35, 28, 48, 255))
    draw.line([(lx, ly - 5), (lx, ly - 14)], fill=(35, 28, 48, 255), width=2)

    mask = rounded_mask(CARD_W, CARD_H, CORNER_R)
    card.putalpha(mask)
    add_border(card, (200, 140, 220, 60), width=3)
    return card

# -------------------------------------------------------------
# Poster 4: Dragon over Mountains (Rightmost, +2)
# -------------------------------------------------------------
def render_dragon_mountains_card():
    card = make_gradient(CARD_W, CARD_H, (22, 54, 52, 255), (8, 18, 20, 255))
    draw = ImageDraw.Draw(card)

    # Celestial Moon behind mountains
    mx, my, mr = CARD_W // 2 + 30, 210, 60
    moon_img = Image.new('RGBA', (CARD_W, CARD_H), (0, 0, 0, 0))
    m_draw = ImageDraw.Draw(moon_img)
    m_draw.ellipse([mx - mr - 25, my - mr - 25, mx + mr + 25, my + mr + 25], fill=(255, 215, 120, 45))
    m_draw.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=(255, 235, 170, 220))
    moon_img = moon_img.filter(ImageFilter.GaussianBlur(4))
    card = Image.alpha_composite(card, moon_img)
    draw = ImageDraw.Draw(card)

    # Distant Mountain Layer (light teal silhouette)
    pts1 = [(0, CARD_H), (0, 310), (60, 260), (130, 300), (220, 210), (290, 280), (340, 240), (CARD_W, 310), (CARD_W, CARD_H)]
    draw.polygon(pts1, fill=(24, 58, 56, 255))

    # Mid Mountain Layer (deeper teal)
    pts2 = [(0, CARD_H), (0, 380), (80, 310), (170, 370), (260, 290), (330, 350), (CARD_W, 320), (CARD_W, CARD_H)]
    draw.polygon(pts2, fill=(16, 40, 40, 255))

    # Mist layer between mountains
    mist = Image.new('RGBA', (CARD_W, CARD_H), (0, 0, 0, 0))
    mst_draw = ImageDraw.Draw(mist)
    mst_draw.ellipse([-50, 330, CARD_W + 50, 420], fill=(120, 180, 170, 40))
    mist = mist.filter(ImageFilter.GaussianBlur(16))
    card = Image.alpha_composite(card, mist)
    draw = ImageDraw.Draw(card)

    # Near Mountain Ridge (darkest)
    pts3 = [(0, CARD_H), (0, 460), (90, 390), (180, 470), (280, 410), (360, 480), (CARD_W, 430), (CARD_W, CARD_H)]
    draw.polygon(pts3, fill=(8, 22, 22, 255))

    # Pine trees on foreground ridge
    for tx in range(10, CARD_W - 10, 25):
        ty = 460 + int(math.sin(tx * 0.05) * 30)
        draw.polygon([(tx, ty - 22), (tx - 7, ty), (tx + 7, ty)], fill=(6, 16, 16, 255))
        draw.polygon([(tx, ty - 32), (tx - 5, ty - 12), (tx + 5, ty - 12)], fill=(6, 16, 16, 255))

    # Soaring Dragon Silhouette (majestic wings in flight)
    dx, dy = 160, 150
    # Body & Neck
    body = [(dx - 35, dy + 5), (dx - 20, dy), (dx, dy - 2), (dx + 25, dy - 12), (dx + 35, dy - 18),
            (dx + 42, dy - 16), (dx + 34, dy - 8), (dx + 15, dy + 2), (dx - 15, dy + 8), (dx - 35, dy + 18)]
    draw.polygon(body, fill=(6, 16, 16, 255))
    # Head & Horns
    draw.polygon([(dx + 38, dy - 18), (dx + 48, dy - 22), (dx + 52, dy - 17), (dx + 44, dy - 13)], fill=(6, 16, 16, 255))
    draw.line([(dx + 42, dy - 20), (dx + 46, dy - 28)], fill=(6, 16, 16, 255), width=2)
    # Long serpentine tail
    draw.line([(dx - 35, dy + 12), (dx - 65, dy + 26), (dx - 85, dy + 20), (dx - 105, dy + 32)], fill=(6, 16, 16, 255), width=3)
    # Wings
    # Left (far) wing
    wing_far = [(dx - 5, dy - 2), (dx + 10, dy - 55), (dx - 5, dy - 50), (dx - 20, dy - 35), (dx - 25, dy - 5)]
    draw.polygon(wing_far, fill=(8, 22, 22, 255))
    # Right (near) majestic open wing
    wing_near = [(dx + 5, dy), (dx + 25, dy - 70), (dx + 5, dy - 60), (dx - 15, dy - 65), (dx - 30, dy - 45), (dx - 45, dy - 30), (dx - 20, dy + 5)]
    draw.polygon(wing_near, fill=(5, 14, 14, 255))

    mask = rounded_mask(CARD_W, CARD_H, CORNER_R)
    card.putalpha(mask)
    add_border(card, (100, 200, 180, 60), width=3)
    return card

# -------------------------------------------------------------
# Poster 0: Center Card (Library - Glowing Play Button)
# -------------------------------------------------------------
def render_center_library_card():
    card = make_gradient(CARD_W, CARD_H, (24, 28, 44, 255), (10, 12, 20, 255))
    draw = ImageDraw.Draw(card)

    cx, cy = CARD_W // 2, CARD_H // 2

    # Radial golden/orange glow behind play emblem
    glow = Image.new('RGBA', (CARD_W, CARD_H), (0, 0, 0, 0))
    g_draw = ImageDraw.Draw(glow)
    g_draw.ellipse([cx - 160, cy - 160, cx + 160, cy + 160], fill=(242, 122, 36, 130))
    g_draw.ellipse([cx - 100, cy - 100, cx + 100, cy + 100], fill=(255, 215, 0, 180))
    glow = glow.filter(ImageFilter.GaussianBlur(38))
    card = Image.alpha_composite(card, glow)
    draw = ImageDraw.Draw(card)

    # Decorative geometric cinema rays
    for angle in range(0, 360, 20):
        rad = math.radians(angle)
        x2 = cx + 240 * math.cos(rad)
        y2 = cy + 240 * math.sin(rad)
        draw.line([(cx, cy), (x2, y2)], fill=(255, 215, 0, 16), width=1)

    # Double circular emblem frame
    draw.ellipse([cx - 120, cy - 120, cx + 120, cy + 120], outline=(255, 215, 0, 80), width=2)
    draw.ellipse([cx - 110, cy - 110, cx + 110, cy + 110], outline=(242, 122, 36, 160), width=4)
    # Dark badge disc
    draw.ellipse([cx - 100, cy - 100, cx + 100, cy + 100], fill=(16, 18, 28, 255), outline=(255, 215, 0, 220), width=3)

    # Glowing Play Triangle in center
    # Equilateral triangle pointing right
    tri_r = 50
    p1 = (cx - 24, cy - int(tri_r * 0.95))
    p2 = (cx - 24, cy + int(tri_r * 0.95))
    p3 = (cx + 42, cy)
    # Shadow
    draw.polygon([(p1[0]+3, p1[1]+4), (p2[0]+3, p2[1]+4), (p3[0]+3, p3[1]+4)], fill=(0, 0, 0, 180))
    # Gradient play button
    draw.polygon([p1, p2, p3], fill=(242, 122, 36, 255))
    # Inner gold highlight
    p1_in = (cx - 20, cy - int(tri_r * 0.8))
    p2_in = (cx - 20, cy + int(tri_r * 0.8))
    p3_in = (cx + 34, cy)
    draw.polygon([p1_in, p2_in, p3_in], fill=(255, 215, 0, 255))

    # Top brand emblem (subtle film reel / crown)
    draw.ellipse([cx - 16, 75, cx + 16, 107], outline=(255, 215, 0, 180), width=2)
    for a in range(0, 360, 60):
        ar = math.radians(a)
        draw.ellipse([cx + 9*math.cos(ar) - 2, 91 + 9*math.sin(ar) - 2,
                      cx + 9*math.cos(ar) + 2, 91 + 9*math.sin(ar) + 2], fill=(255, 215, 0, 220))

    # Decorative bottom accent bar
    draw.line([cx - 50, CARD_H - 85, cx + 50, CARD_H - 85], fill=(242, 122, 36, 180), width=3)
    draw.line([cx - 30, CARD_H - 77, cx + 30, CARD_H - 77], fill=(255, 215, 0, 140), width=2)

    mask = rounded_mask(CARD_W, CARD_H, CORNER_R)
    card.putalpha(mask)
    add_border(card, (255, 180, 50, 180), width=4)
    return card

# -------------------------------------------------------------
# Poster 0: Center Card (Calendar - Glowing Calendar Grid)
# -------------------------------------------------------------
def render_center_calendar_card():
    card = make_gradient(CARD_W, CARD_H, (24, 28, 44, 255), (10, 12, 20, 255))
    draw = ImageDraw.Draw(card)

    cx, cy = CARD_W // 2, CARD_H // 2

    # Radial golden/orange glow
    glow = Image.new('RGBA', (CARD_W, CARD_H), (0, 0, 0, 0))
    g_draw = ImageDraw.Draw(glow)
    g_draw.ellipse([cx - 160, cy - 160, cx + 160, cy + 160], fill=(242, 122, 36, 130))
    g_draw.ellipse([cx - 100, cy - 100, cx + 100, cy + 100], fill=(255, 215, 0, 180))
    glow = glow.filter(ImageFilter.GaussianBlur(38))
    card = Image.alpha_composite(card, glow)
    draw = ImageDraw.Draw(card)

    # Double circular emblem frame
    draw.ellipse([cx - 120, cy - 120, cx + 120, cy + 120], outline=(255, 215, 0, 80), width=2)
    draw.ellipse([cx - 110, cy - 110, cx + 110, cy + 110], outline=(242, 122, 36, 160), width=4)
    # Dark badge disc
    draw.ellipse([cx - 100, cy - 100, cx + 100, cy + 100], fill=(16, 18, 28, 255), outline=(255, 215, 0, 220), width=3)

    # Calendar Sheet Icon inside disc
    cal_w, cal_h = 100, 108
    cal_x = cx - cal_w // 2
    cal_y = cy - cal_h // 2 + 2

    # Drop shadow
    draw.rounded_rectangle([cal_x + 3, cal_y + 4, cal_x + cal_w + 3, cal_y + cal_h + 4], radius=10, fill=(0, 0, 0, 160))
    # Calendar body
    draw.rounded_rectangle([cal_x, cal_y, cal_x + cal_w, cal_y + cal_h], radius=10, fill=(240, 242, 248, 255))
    # Orange header
    draw.rounded_rectangle([cal_x, cal_y, cal_x + cal_w, cal_y + 32], radius=10, fill=(242, 122, 36, 255))
    draw.rectangle([cal_x, cal_y + 20, cal_x + cal_w, cal_y + 32], fill=(242, 122, 36, 255))

    # Calendar spiral rings/hangers
    for hx in [cal_x + 24, cal_x + cal_w - 24]:
        draw.rounded_rectangle([hx - 4, cal_y - 8, hx + 4, cal_y + 6], radius=3, fill=(255, 215, 0, 255))

    # Grid of dates (4 columns x 3 rows)
    grid_start_y = cal_y + 42
    cols, rows = 4, 3
    cw = 14
    ch = 12
    gap_x = 7
    gap_y = 7
    total_gw = cols * cw + (cols - 1) * gap_x
    start_x = cx - total_gw // 2

    for r in range(rows):
        for c in range(cols):
            gx = start_x + c * (cw + gap_x)
            gy = grid_start_y + r * (ch + gap_y)
            # Highlight one special date with golden star/play
            if r == 1 and c == 2:
                draw.rounded_rectangle([gx - 2, gy - 2, gx + cw + 2, gy + ch + 2], radius=4, fill=(255, 215, 0, 255))
                draw.rounded_rectangle([gx, gy, gx + cw, gy + ch], radius=3, fill=(242, 122, 36, 255))
            elif (r == 0 and c < 2) or (r == 2 and c > 2):
                draw.rounded_rectangle([gx, gy, gx + cw, gy + ch], radius=3, fill=(190, 195, 210, 200))
            else:
                draw.rounded_rectangle([gx, gy, gx + cw, gy + ch], radius=3, fill=(80, 90, 115, 230))

    # Top brand emblem
    draw.ellipse([cx - 16, 75, cx + 16, 107], outline=(255, 215, 0, 180), width=2)
    for a in range(0, 360, 60):
        ar = math.radians(a)
        draw.ellipse([cx + 9*math.cos(ar) - 2, 91 + 9*math.sin(ar) - 2,
                      cx + 9*math.cos(ar) + 2, 91 + 9*math.sin(ar) + 2], fill=(255, 215, 0, 220))

    # Decorative bottom accent bar
    draw.line([cx - 50, CARD_H - 85, cx + 50, CARD_H - 85], fill=(242, 122, 36, 180), width=3)
    draw.line([cx - 30, CARD_H - 77, cx + 30, CARD_H - 77], fill=(255, 215, 0, 140), width=2)

    mask = rounded_mask(CARD_W, CARD_H, CORNER_R)
    card.putalpha(mask)
    add_border(card, (255, 180, 50, 180), width=4)
    return card

# -------------------------------------------------------------
# Fanned Assembly
# -------------------------------------------------------------
def assemble_fanned(center_card):
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    p1 = render_star_map_card()
    p2 = render_ship_ocean_card()
    p0 = center_card
    p3 = render_lighthouse_card()
    p4 = render_dragon_mountains_card()

    # Cards configuration: (card, center_x, center_y, angle, scale, dim)
    cy_base = H // 2 + 10
    fan = [
        (p1, W // 2 - 540, cy_base + 32, 14, 0.88, 0.85),
        (p4, W // 2 + 540, cy_base + 32, -14, 0.88, 0.85),
        (p2, W // 2 - 275, cy_base + 12, 7, 0.96, 0.93),
        (p3, W // 2 + 275, cy_base + 12, -7, 0.96, 0.93),
        (p0, W // 2, cy_base - 10, 0, 1.05, 1.0),
    ]

    for card, cx, cy, angle, scale, brightness in fan:
        # Scale
        cur_w = int(CARD_W * scale)
        cur_h = int(CARD_H * scale)
        scaled = card.resize((cur_w, cur_h), Image.Resampling.LANCZOS)

        # Apply slight brightness/dimming for depth
        if brightness < 1.0:
            arr = np.array(scaled, dtype=np.float32)
            arr[..., :3] *= brightness
            scaled = Image.fromarray(arr.astype(np.uint8), 'RGBA')

        # Drop shadow
        # Create shadow mask
        shadow_margin = 80
        sh_img = Image.new('RGBA', (cur_w + shadow_margin * 2, cur_h + shadow_margin * 2), (0, 0, 0, 0))
        sh_draw = ImageDraw.Draw(sh_img)
        sh_draw.rounded_rectangle([shadow_margin, shadow_margin, cur_w + shadow_margin, cur_h + shadow_margin],
                                  radius=int(CORNER_R * scale), fill=(0, 0, 0, int(150 * brightness)))
        sh_img = sh_img.filter(ImageFilter.GaussianBlur(18 * scale))

        # Rotate card and shadow
        rotated_sh = sh_img.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
        rotated_card = scaled.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)

        # Paste shadow
        sx = cx - rotated_sh.width // 2
        sy = cy - rotated_sh.height // 2 + int(14 * scale)
        canvas.alpha_composite(rotated_sh, (sx, sy))

        # Paste card
        px = cx - rotated_card.width // 2
        py = cy - rotated_card.height // 2
        canvas.alpha_composite(rotated_card, (px, py))

    # Downsample to 500x286
    final = canvas.resize((OUT_W, OUT_H), Image.Resampling.LANCZOS)
    return final

def main():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out_dir = os.path.join(root, 'assets', 'images')
    os.makedirs(out_dir, exist_ok=True)

    print("Rendering original library_placeholder.png...")
    lib_img = assemble_fanned(render_center_library_card())
    lib_path = os.path.join(out_dir, 'library_placeholder.png')
    lib_img.save(lib_path, 'PNG', optimize=True)
    print(f"Saved {lib_path} ({lib_img.size[0]}x{lib_img.size[1]})")

    print("Rendering original calendar_placeholder.png...")
    cal_img = assemble_fanned(render_center_calendar_card())
    cal_path = os.path.join(out_dir, 'calendar_placeholder.png')
    cal_img.save(cal_path, 'PNG', optimize=True)
    print(f"Saved {cal_path} ({cal_img.size[0]}x{cal_img.size[1]})")

if __name__ == '__main__':
    main()
