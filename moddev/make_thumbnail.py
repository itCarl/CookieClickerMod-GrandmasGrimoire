"""
Generates thumbnail.png for the Grandma's Grimoire mod.

The picture is what the mod does: Force the Hand of Fate sits armed in the
book, and the golden cookie it is going to produce is already showing. The
cast has not happened yet - the outcome is readable out of the seed before
the magic is spent, which is the whole point of the mod.

All of it is the game's own art: the grimoire's background, the stone spell
tile from spellBG.png, the spell icons out of icons.png and the real golden
cookie sprite. Pixel art is scaled with NEAREST at whole multiples.

    python moddev/make_thumbnail.py
"""
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

GAME_IMG = os.environ.get(
    "CC_IMG",
    r"C:\Program Files (x86)\Steam\steamapps\common\Cookie Clicker\resources\app\src\img")

OUT_SIZE = 512
SS = 4

TILE_W, TILE_H = 60, 74     # one spellBG cell
TILE_LIT = 1                # row 1 of spellBG is the lit state

SPELL_ROW = 11              # spell icons live on row 11 of icons.png
FTHOF = 22                  # Force the Hand of Fate

TITLE = "Grandma's Grimoire"
SUBTITLE = "WIZARD TOWER"
TITLE_FONT = r"C:\Windows\Fonts\georgiab.ttf"

PURPLE = (176, 128, 226)
GOLD = (255, 214, 128)
BORDER = (150, 106, 208)


def asset(name):
    path = os.path.join(GAME_IMG, name)
    if not os.path.exists(path):
        raise SystemExit(
            "Cookie Clicker art not found: %s\n"
            "Set CC_IMG to the game's src/img folder." % path)
    return Image.open(path)


def tiled(name, size):
    src = asset(name).convert("RGB")
    out = Image.new("RGB", (size, size))
    for y in range(0, size, src.height):
        for x in range(0, size, src.width):
            out.paste(src, (x, y))
    return out


def icon(sheet, col, row, scale):
    c = sheet.crop((col * 48, row * 48, (col + 1) * 48, (row + 1) * 48))
    return c.resize((48 * scale, 48 * scale), Image.NEAREST)


def spell_tile(sheet, variant, row, scale):
    c = sheet.crop((variant * TILE_W, row * TILE_H,
                    (variant + 1) * TILE_W, (row + 1) * TILE_H))
    return c.resize((TILE_W * scale, TILE_H * scale), Image.NEAREST)


def drop_shadow(layer, offset, blur, opacity):
    a = layer.split()[3].filter(ImageFilter.GaussianBlur(blur))
    a = a.point(lambda v: int(v * opacity))
    sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    sh.putalpha(a)
    return ImageChops.offset(sh, offset[0], offset[1])


def glow(size, at, radius, colour, strength):
    g = Image.new("L", (size, size), 0)
    ImageDraw.Draw(g).ellipse(
        [at[0] - radius, at[1] - radius, at[0] + radius, at[1] + radius], fill=strength)
    g = g.filter(ImageFilter.GaussianBlur(radius * 0.55))
    layer = Image.new("RGBA", (size, size), colour + (0,))
    layer.putalpha(g)
    return layer


def sparkle(d, at, r, colour):
    x, y = at
    d.polygon([(x, y - r), (x + r * 0.24, y - r * 0.24), (x + r, y),
               (x + r * 0.24, y + r * 0.24), (x, y + r),
               (x - r * 0.24, y + r * 0.24), (x - r, y),
               (x - r * 0.24, y - r * 0.24)], fill=colour)


def foresight_arc(d, start, end, colour):
    """A dashed arc from the armed spell to the outcome it is going to give.

    Dashed rather than solid: the cast has not been paid for yet.
    """
    cx = (start[0] + end[0]) / 2.0
    cy = (start[1] + end[1]) / 2.0 - 78
    steps = 72
    pts = []
    for i in range(steps + 1):
        t = i / float(steps)
        u = 1 - t
        pts.append((u * u * start[0] + 2 * u * t * cx + t * t * end[0],
                    u * u * start[1] + 2 * u * t * cy + t * t * end[1]))
    for i in range(0, steps, 5):
        seg = pts[i:i + 4]
        if len(seg) > 1:
            d.line([(p[0] * SS, p[1] * SS) for p in seg],
                   fill=colour, width=5 * SS, joint="curve")


def font(size):
    """Georgia Bold - the face the Quant Broker tile already uses."""
    try:
        return ImageFont.truetype(TITLE_FONT, size)
    except (OSError, IOError):
        return ImageFont.load_default()


def scrim(size, top, colour, strength):
    """A soft dark band along the bottom so the caption stays readable."""
    g = Image.new("L", (1, size), 0)
    for y in range(top, size):
        t = (y - top) / float(size - top)
        g.putpixel((0, y), int(strength * (t ** 1.35)))
    layer = Image.new("RGBA", (size, size), colour + (0,))
    layer.putalpha(g.resize((size, size)))
    return layer


def tracked(d, text, centre, f, fill, tracking, shadow):
    """Letterspaced caps - PIL has no tracking, so glyphs are placed one by one."""
    widths = [d.textlength(ch, font=f) for ch in text]
    x = centre[0] - (sum(widths) + tracking * (len(text) - 1)) / 2.0
    for ch, w in zip(text, widths):
        d.text((x + shadow[0], centre[1] + shadow[1]), ch, font=f, fill=shadow[2],
               anchor="lm")
        d.text((x, centre[1]), ch, font=f, fill=fill, anchor="lm")
        x += w + tracking


def caption(base, accent, shade):
    S = base.size[0]
    base.alpha_composite(scrim(S, S - 170, shade, 236))

    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    size = 40
    f = font(size)
    while d.textlength(TITLE, font=f) > S - 88 and size > 20:
        size -= 1
        f = font(size)
    d.text((S // 2 + 2, 432), TITLE, font=f, fill=(0, 0, 0, 160), anchor="mm")
    d.text((S // 2, 430), TITLE, font=f, fill=(240, 246, 234, 255), anchor="mm")

    tracked(d, SUBTITLE, (S // 2, 470), font(15), accent + (255,), 5.0,
            (1, 1, (0, 0, 0, 150)))
    base.alpha_composite(layer)


def rounded_mask(size, radius):
    m = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, size * SS - 1, size * SS - 1], radius=radius * SS, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def outline(size, radius, colour, width):
    layer = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    inset = width * SS // 2
    ImageDraw.Draw(layer).rounded_rectangle(
        [inset, inset, size * SS - inset, size * SS - inset],
        radius=radius * SS, outline=colour + (255,), width=width * SS)
    return layer.resize((size, size), Image.LANCZOS)


def main():
    S = OUT_SIZE
    base = tiled("BGgrimoire.jpg", S).convert("RGBA")
    base.alpha_composite(Image.new("RGBA", (S, S), (26, 12, 48, 96)))

    icons = asset("icons.png").convert("RGBA")
    tiles = asset("spellBG.png").convert("RGBA")
    cookie = asset("goldCookie.png").convert("RGBA")

    # --- the armed spell --------------------------------------------------
    scale = 3
    tile = spell_tile(tiles, 1, TILE_LIT, scale)
    ic = icon(icons, FTHOF, SPELL_ROW, scale)
    card = Image.new("RGBA", tile.size, (0, 0, 0, 0))
    card.alpha_composite(tile)
    card.alpha_composite(ic, ((tile.width - ic.width) // 2, (tile.height - ic.height) // 2 - 6))

    card_at = (54, 138)
    card_mid = (card_at[0] + card.width // 2, card_at[1] + card.height // 2)
    base.alpha_composite(glow(S, card_mid, 160, PURPLE, 130))
    base.alpha_composite(drop_shadow(card, (6, 8), 6, 0.65), card_at)
    base.alpha_composite(card, card_at)

    # --- the outcome it will give ----------------------------------------
    cook = cookie.resize((cookie.width * 2, cookie.height * 2), Image.NEAREST)
    cook_mid = (S - 142, 124)
    base.alpha_composite(glow(S, cook_mid, 118, GOLD, 190))

    arc = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
    foresight_arc(ImageDraw.Draw(arc),
                  (card_mid[0] + 62, card_mid[1] - 96), (cook_mid[0] - 84, cook_mid[1] + 52),
                  GOLD + (205,))
    base.alpha_composite(arc.resize((S, S), Image.LANCZOS))

    base.alpha_composite(drop_shadow(cook, (4, 6), 5, 0.6),
                         (cook_mid[0] - cook.width // 2, cook_mid[1] - cook.height // 2))
    base.alpha_composite(cook, (cook_mid[0] - cook.width // 2, cook_mid[1] - cook.height // 2))

    tw = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    td = ImageDraw.Draw(tw)
    sparkle(td, (cook_mid[0] + 92, cook_mid[1] - 62), 19, GOLD + (255,))
    sparkle(td, (cook_mid[0] - 82, cook_mid[1] - 74), 12, GOLD + (210,))
    sparkle(td, (cook_mid[0] + 74, cook_mid[1] + 82), 10, GOLD + (185,))
    base.alpha_composite(tw.filter(ImageFilter.GaussianBlur(0.6)))

    caption(base, PURPLE, (14, 8, 24))

    borders = asset("shadedBorders.png").convert("RGBA").resize((S, S), Image.BICUBIC)
    base.alpha_composite(borders)
    base.alpha_composite(outline(S, 46, BORDER, 7))
    base.putalpha(ImageChops.multiply(base.split()[3], rounded_mask(S, 46)))

    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "mod", "thumbnail.png")
    base.save(out, "PNG", optimize=True)
    print("wrote %s (%dx%d, %d bytes)" % (out, S, S, os.path.getsize(out)))


if __name__ == "__main__":
    main()
