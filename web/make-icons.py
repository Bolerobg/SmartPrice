"""
Генератор на иконата на SmartPrice.

Идеята: тъмно „нощно" синьо + марковият градиент на приложението
(indigo #6366F1 → cyan #06B6D4), а в средата — етикет за цена с
надолу-сочеща стрелка („намери по-ниската цена"). Формата е проста, за да
се чете ясно и на 48 пиксела.

Рисува се на 4× резолюция и се смалява (LANCZOS) — така ръбовете са гладки
без ръчно anti-aliasing.

Употреба: python web/make-icons.py
"""
from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT_PUBLIC = os.path.join(os.path.dirname(__file__), "..", "public")
OUT_ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")

SS = 4  # supersampling
BASE = 1024
S = BASE * SS

# Маркови цветове (от constants/theme.ts)
BG_TOP = (11, 20, 36)      # #0B1424
BG_BOTTOM = (19, 31, 56)   # #131F38
INDIGO = (99, 102, 241)    # #6366F1
CYAN = (6, 182, 212)       # #06B6D4
CYAN_BRIGHT = (34, 211, 238)  # #22D3EE
WHITE = (255, 255, 255)

TILT = -35  # наклон на етикета в градуси


# ----------------------------------------------------------------- помощни

def linear_gradient(size: int, c1, c2, angle_deg: float) -> Image.Image:
    """Диагонален линеен градиент."""
    a = math.radians(angle_deg)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    t = (xx * math.cos(a) + yy * math.sin(a))
    t = (t - t.min()) / (t.max() - t.min())
    t = t[..., None]
    arr = (np.array(c1, np.float32) * (1 - t) + np.array(c2, np.float32) * t)
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def radial_glow(size: int, cx: float, cy: float, radius: float, color, strength: float) -> Image.Image:
    """Меко радиално сияние (RGBA)."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    d = np.sqrt((xx - cx * size) ** 2 + (yy - cy * size) ** 2) / (radius * size)
    falloff = np.clip(1.0 - d, 0.0, 1.0) ** 2
    alpha = (falloff * strength * 255).astype(np.uint8)
    rgb = np.zeros((size, size, 3), np.uint8)
    rgb[..., 0], rgb[..., 1], rgb[..., 2] = color
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def tag_mask(length: float, height: float, tip_x: float, tip_y: float) -> Image.Image:
    """Маска на етикет за цена.

    Рисуваме чист полигон (правоъгълник + заострен връх), после леко го
    размазваме и „отрязваме" — така всички ъгли се заоблят равномерно и
    няма рязък шев между тялото и върха (това беше дефект в първия вариант).
    """
    poly = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(poly)
    left = tip_x + height / 2
    d.polygon([(tip_x, tip_y),
               (left, tip_y - height / 2),
               (tip_x + length, tip_y - height / 2),
               (tip_x + length, tip_y + height / 2),
               (left, tip_y + height / 2)], fill=255)
    r = height * 0.16
    m = poly.filter(ImageFilter.GaussianBlur(r * 0.55))
    m = m.point(lambda v: 255 if v >= 128 else 0)

    # дупката — „изрязваме" я
    d2 = ImageDraw.Draw(m)
    hx = tip_x + height * 0.72
    hr = height * 0.13
    d2.ellipse([hx - hr, tip_y - hr, hx + hr, tip_y + hr], fill=0)
    return m


def arrow_mask(cx: float, cy: float, height: float) -> Image.Image:
    """Маска на стрелка надолу („цената пада")."""
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    stem_w = height * 0.20
    stem_top = cy - height * 0.28
    stem_bottom = cy + height * 0.02
    d.rounded_rectangle([cx - stem_w / 2, stem_top, cx + stem_w / 2, stem_bottom],
                        radius=stem_w * 0.30, fill=255)
    hw = height * 0.28
    d.polygon([(cx - hw, cy - height * 0.04),
               (cx + hw, cy - height * 0.04),
               (cx, cy + height * 0.30)], fill=255)
    return m


def gradient_fill(mask: Image.Image, c1, c2, angle_deg: float) -> Image.Image:
    """Пълни маска с градиент → RGBA."""
    grad = linear_gradient(S, c1, c2, angle_deg).convert("RGBA")
    grad.putalpha(mask)
    return grad


def downscale(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


# ----------------------------------------------------------------- иконата

def build_background() -> Image.Image:
    bg = linear_gradient(S, BG_TOP, BG_BOTTOM, 55).convert("RGBA")
    bg.alpha_composite(radial_glow(S, 0.22, 0.16, 0.62, INDIGO, 0.42))
    bg.alpha_composite(radial_glow(S, 0.84, 0.88, 0.66, CYAN, 0.34))
    return bg


def build_mark(scale: float) -> Image.Image:
    """Етикет + стрелка, завъртян, с сянка. scale ≈ колко от ширината заема."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    length = S * scale * 0.95
    height = length * 0.62
    tip_x = S * 0.5 - length * 0.50
    tip_y = S * 0.5

    tm = tag_mask(length, height, tip_x, tip_y)
    tag = gradient_fill(tm, INDIGO, CYAN_BRIGHT, 35)

    # бяла стрелка надолу в тялото на етикета, вдясно от дупката.
    # Стрелката се рисува отделно и се завърта обратно, за да сочи ТОЧНО
    # надолу (иначе след наклона на етикета сочи диагонално и се чете по-зле).
    ax = ((tip_x + height * 0.92) + (tip_x + length)) / 2
    arrow = gradient_fill(arrow_mask(ax, tip_y, height * 0.62), WHITE, WHITE, 0)
    arrow = arrow.rotate(-TILT, resample=Image.BICUBIC, center=(ax, tip_y))

    layer.alpha_composite(tag)
    layer.alpha_composite(arrow)

    # сянка под етикета
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sm = tm.filter(ImageFilter.GaussianBlur(S * 0.018))
    shadow.putalpha(sm.point(lambda v: int(v * 0.5)))
    shadow = Image.composite(Image.new("RGBA", (S, S), (0, 0, 0, 255)), shadow, sm)

    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.alpha_composite(shadow, (0, int(S * 0.012)))
    out.alpha_composite(layer)

    # леко завъртане за динамика
    return out.rotate(TILT, resample=Image.BICUBIC, center=(S * 0.5, S * 0.5))


def make_icon(size: int, scale: float = 0.70) -> Image.Image:
    img = build_background()
    img.alpha_composite(build_mark(scale))
    return downscale(img, size).convert("RGB")


def main() -> None:
    os.makedirs(OUT_PUBLIC, exist_ok=True)
    os.makedirs(OUT_ASSETS, exist_ok=True)

    # пълна икона (iOS + Android launcher)
    icon = make_icon(1024, 0.70)
    icon.save(os.path.join(OUT_ASSETS, "icon.png"))
    icon.save(os.path.join(OUT_PUBLIC, "icon-512.png"))
    icon.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT_PUBLIC, "icon-192.png"))

    # maskable (Android adaptive): марката в безопасната зона
    make_icon(512, 0.50).save(os.path.join(OUT_PUBLIC, "icon-512-maskable.png"))

    # iOS иска точно квадрат, без прозрачност
    make_icon(180, 0.70).save(os.path.join(OUT_PUBLIC, "apple-touch-icon.png"))

    # favicon
    fav = make_icon(64, 0.82)
    fav.save(os.path.join(OUT_PUBLIC, "favicon.png"))
    fav.save(os.path.join(OUT_PUBLIC, "favicon.ico"),
             sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

    # native splash (Expo)
    splash = Image.new("RGB", (1024, 1024), BG_TOP)
    splash.paste(make_icon(1024, 0.44), (0, 0))
    splash.save(os.path.join(OUT_ASSETS, "splash.png"))

    print("готово:")
    for p in sorted(os.listdir(OUT_PUBLIC)):
        print("  public/" + p)
    for p in sorted(os.listdir(OUT_ASSETS)):
        print("  assets/" + p)


if __name__ == "__main__":
    main()
