"""
Generates thumbnail.png for Grandma's Grimoire.

The mod's thesis in one picture: the next cast is already decided. A spell
circle with the coming result showing inside it, and behind it the queue of
rolls after that - some good, some not - already legible rather than hidden.

Drawn at 4x and downsampled for antialiasing, in the Grimoire's own palette.

    python moddev/make_thumbnail.py
"""
import math
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT_SIZE = 512
SS = 4
S = OUT_SIZE * SS
C = S / 2

# The Wizard tower's palette, matching the mod's panel.
BG_DEEP   = (18, 12, 30)
BG_GLOW   = (52, 33, 84)
PURPLE    = (141, 95, 211)
PURPLE_LT = (192, 160, 240)
WIN       = (125, 220, 106)
WIN_HOT   = (186, 245, 172)
FAIL      = (255, 107, 107)
MUTED     = (86, 68, 118)


def ring(d, r, colour, width, dash=None):
    box = [C - r, C - r, C + r, C + r]
    if dash is None:
        d.ellipse(box, outline=colour, width=width)
        return
    step, gap = dash
    a = 0.0
    while a < 360:
        d.arc(box, a, a + step, fill=colour, width=width)
        a += step + gap


# --- background: a glow behind the circle --------------------------------
img = Image.new('RGB', (S, S), BG_DEEP)
glow = Image.new('RGB', (S, S), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([C - S * 0.34, C - S * 0.34, C + S * 0.34, C + S * 0.34], fill=BG_GLOW)
glow = glow.filter(ImageFilter.GaussianBlur(S * 0.09))
img = ImageChops.add(img, glow)
d = ImageDraw.Draw(img)

# --- the spell circle -----------------------------------------------------
R = S * 0.30
ring(d, R, PURPLE, max(2, int(SS * 2.2)))
ring(d, R * 0.88, PURPLE, max(1, int(SS * 1.0)))
ring(d, R * 1.10, MUTED, max(1, int(SS * 1.4)), dash=(7, 5))

# Tick marks around the inner ring, the way a sigil is drawn.
for i in range(12):
    a = math.radians(i * 30)
    r0, r1 = R * 0.90, R * 0.99
    d.line([C + math.cos(a) * r0, C + math.sin(a) * r0,
            C + math.cos(a) * r1, C + math.sin(a) * r1],
           fill=PURPLE_LT, width=max(1, int(SS * 1.2)))

# A six-point star inside, drawn as two triangles - geometry rather than
# decoration, so it survives being shrunk to a tile.
for rot in (0, 60):
    pts = []
    for i in range(3):
        a = math.radians(rot + i * 120 - 90)
        pts.append((C + math.cos(a) * R * 0.62, C + math.sin(a) * R * 0.62))
    d.line(pts + [pts[0]], fill=MUTED, width=max(1, int(SS * 1.3)), joint='curve')

# --- the outcome, already showing ----------------------------------------
# A bold tick. Not a word: the image has to work at 64 pixels.
tick = [
    (C - R * 0.34, C + R * 0.02),
    (C - R * 0.10, C + R * 0.27),
    (C + R * 0.37, C - R * 0.30),
]
tickGlow = Image.new('RGB', (S, S), (0, 0, 0))
tg = ImageDraw.Draw(tickGlow)
tg.line(tick, fill=(40, 80, 32), width=int(SS * 22), joint='curve')
tickGlow = tickGlow.filter(ImageFilter.GaussianBlur(S * 0.02))
img = ImageChops.add(img, tickGlow)
d = ImageDraw.Draw(img)
d.line(tick, fill=WIN, width=int(SS * 11), joint='curve')
d.line([tick[0], tick[1]], fill=WIN_HOT, width=int(SS * 4))

# --- the queue of rolls after this one ------------------------------------
# Five pips along the bottom: the one about to happen is lit, the rest are
# readable but quiet, and one of them is a backfire - which is the point, since
# knowing that is what lets the assistant wait.
PIPS = [WIN, MUTED, FAIL, MUTED, MUTED]
pw = S * 0.072
gap = S * 0.028
total = len(PIPS) * pw + (len(PIPS) - 1) * gap
x = C - total / 2
y = C + R * 1.36
for i, col in enumerate(PIPS):
    box = [x, y, x + pw, y + pw * 0.46]
    d.rounded_rectangle(box, radius=pw * 0.16, fill=col)
    if i == 0:
        d.rounded_rectangle([box[0] - SS * 3, box[1] - SS * 3,
                             box[2] + SS * 3, box[3] + SS * 3],
                            radius=pw * 0.22, outline=WIN_HOT,
                            width=max(1, int(SS * 1.4)))
    x += pw + gap

img = img.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', 'mod', 'thumbnail.png')
img.save(out, optimize=True)
print('wrote', os.path.normpath(out), img.size,
      str(os.path.getsize(out) // 1024) + ' KB')
