"""Профилна снимка за TikTok на SmartPrice (1080x1080, квадрат).

TikTok показва профилната снимка КАТО КРЪГ, затова всичко важно стои в
безопасната зона (вписания кръг), а не до ръбовете. Иначе логото се отрязва.

Пущане:  python web/make-tiktok.py
Резултат: web/tiktok/tiktok-1-simvol.png, -2-s-logо.png, -3-s-ring.png
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SIZE = 1080                      # TikTok иска квадрат; това е препоръчителното
BG = (11, 20, 36)                # #0B1424 — тъмносиният на марката
INDIGO = (79, 70, 229)           # #4F46E5
CYAN = (6, 182, 212)             # #06B6D4
WHITE = (255, 255, 255)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tiktok")
FONT_CANDIDATES = [
    "C:/Windows/Fonts/segoeuib.ttf",   # Segoe UI Bold
    "C:/Windows/Fonts/seguisb.ttf",    # Segoe UI Semibold
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/arial.ttf",
]


def font(px: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, px)
    raise SystemExit("Няма подходящ шрифт в C:/Windows/Fonts")


def linear_gradient(size: int, c1, c2, angle_deg: float) -> Image.Image:
    """Диагонален градиент без артефакти по ъглите.

    Рисуваме на двойно по-голямо платно, въртим с expand=True и изрязваме
    средата — иначе след ротацията в ъглите остават резки диагонални ивици.
    """
    big = size * 2
    grad = Image.new("RGB", (big, big))
    d = ImageDraw.Draw(grad)
    for i in range(big * 2):
        t = i / (big * 2 - 1)
        col = tuple(int(c1[k] + (c2[k] - c1[k]) * t) for k in range(3))
        d.line([(i, 0), (0, i)], fill=col, width=2)
    if angle_deg:
        grad = grad.rotate(angle_deg, resample=Image.BICUBIC, expand=True)
    w, h = grad.size
    left, top = (w - size) // 2, (h - size) // 2
    return grad.crop([left, top, left + size, top + size])


def radial_glow(size: int, cx: float, cy: float, radius: float, color, strength: float) -> Image.Image:
    """Меко сияние — дава дълбочина на тъмния фон."""
    layer = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(layer)
    d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=255)
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.55))
    color_layer = Image.new("RGB", (size, size), color)
    out = Image.new("RGB", (size, size), (0, 0, 0))
    out.paste(color_layer, (0, 0), layer.point(lambda v: int(v * strength)))
    return out


def tag_mask(size: int, rotate: float = -18.0) -> Image.Image:
    """Етикет с дупка — марката на SmartPrice (върши работа и в кръг)."""
    s = size
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    pad = 0.10 * s
    # тяло
    d.rounded_rectangle(
        [pad + 0.10 * s, 0.30 * s, s - 0.10 * s, 0.70 * s], radius=0.065 * s, fill=255
    )
    # заострен връх вляво
    d.polygon(
        [(pad + 0.10 * s, 0.30 * s), (pad + 0.10 * s, 0.70 * s), (pad - 0.02 * s, 0.50 * s)],
        fill=255,
    )
    # дупката
    d.ellipse(
        [
            pad + 0.155 * s - 0.032 * s,
            0.50 * s - 0.032 * s,
            pad + 0.155 * s + 0.032 * s,
            0.50 * s + 0.032 * s,
        ],
        fill=0,
    )
    m = m.rotate(rotate, resample=Image.BICUBIC, expand=True)
    return m.crop(m.getbbox())


def arrow_mask(size: int, rotate: float = 18.0) -> Image.Image:
    """Стрелка надолу („намери по-ниската цена“). Завърта се обратно на етикета."""
    s = size
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    w = 0.070 * s
    shaft_top, shaft_bottom = 0.30 * s, 0.52 * s
    d.rounded_rectangle([0.5 * s - w / 2, shaft_top, 0.5 * s + w / 2, shaft_bottom], radius=w / 2, fill=255)
    head_w, head_top, head_bottom = 0.20 * s, 0.50 * s, 0.72 * s
    d.polygon(
        [
            (0.5 * s - head_w / 2, head_top),
            (0.5 * s + head_w / 2, head_top),
            (0.5 * s, head_bottom),
        ],
        fill=255,
    )
    m = m.rotate(rotate, resample=Image.BICUBIC, expand=True)
    return m.crop(m.getbbox())


def gradient_fill(mask: Image.Image, c1, c2, angle: float) -> Image.Image:
    w, h = mask.size
    grad = linear_gradient(max(w, h) * 2, c1, c2, angle).resize((w, h), Image.LANCZOS)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out


def build_background() -> Image.Image:
    """Тъмносин фон с две сияния и мек вертикален градиент (без артефакти)."""
    bg = Image.new("RGB", (SIZE, SIZE), BG)
    glow = radial_glow(SIZE, 0.5 * SIZE, 0.42 * SIZE, 0.55 * SIZE, INDIGO, 0.55)
    bg = Image.blend(bg, glow, 0.55)
    glow2 = radial_glow(SIZE, 0.74 * SIZE, 0.80 * SIZE, 0.42 * SIZE, CYAN, 0.40)
    bg = Image.blend(bg, glow2, 0.28)
    # мек вертикален градиент: горе тъмно, долу леко в синьо — дава дълбочина
    col = Image.new("RGB", (SIZE, SIZE))
    d = ImageDraw.Draw(col)
    top, bottom = (9, 16, 30), (17, 38, 62)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        d.line(
            [(0, y), (SIZE, y)],
            fill=tuple(int(top[k] + (bottom[k] - top[k]) * t) for k in range(3)),
        )
    return Image.blend(bg, col, 0.45)


def build_mark(target_w: int) -> Image.Image:
    """Марката (етикет + стрелка) — двете се въртят ЗАЕДНО, за да паснат.

    Преди въртях етикета и стрелката поотделно и стрелката се разпъваше върху
    целия етикет. Сега се рисуват на едно и също платно и се въртят с един и същ
    ъгъл, после се изрязват по ЕДНА и съща рамка.
    """
    ss = 900  # супер-семплиране за гладки ръбове
    tag = Image.new("L", (ss, ss), 0)
    d = ImageDraw.Draw(tag)
    pad = 0.10 * ss
    d.rounded_rectangle(
        [pad + 0.10 * ss, 0.30 * ss, ss - 0.10 * ss, 0.70 * ss], radius=0.065 * ss, fill=255
    )
    # Връх: започва ВЪТРЕ в тялото, иначе при заобления ъгъл остава тънка ивица.
    d.polygon(
        [
            (pad + 0.17 * ss, 0.30 * ss),
            (pad + 0.17 * ss, 0.70 * ss),
            (pad - 0.02 * ss, 0.50 * ss),
        ],
        fill=255,
    )
    d.ellipse(
        [
            pad + 0.18 * ss - 0.030 * ss,
            0.50 * ss - 0.030 * ss,
            pad + 0.18 * ss + 0.030 * ss,
            0.50 * ss + 0.030 * ss,
        ],
        fill=0,
    )

    # Стрелката: рисува се права, после се накланя ОБРАТНО на етикета (+18°), така
    # че след общата ротация (-18°) да сочи точно надолу. Иначе изглежда накриво.
    gw, gh = int(0.30 * ss), int(0.36 * ss)
    glyph = Image.new("L", (gw, gh), 0)
    dg = ImageDraw.Draw(glyph)
    cx, cy = gw / 2, gh / 2
    w = 0.24 * gw
    dg.rounded_rectangle([cx - w / 2, 0.05 * gh, cx + w / 2, 0.58 * gh], radius=w / 2, fill=255)
    hw = 0.66 * gw
    dg.polygon([(cx - hw / 2, 0.50 * gh), (cx + hw / 2, 0.50 * gh), (cx, 0.97 * gh)], fill=255)
    glyph = glyph.rotate(18.0, resample=Image.BICUBIC, expand=True)

    angle = -18.0
    acx, acy = 0.63 * ss, 0.50 * ss
    arrow = Image.new("L", (ss, ss), 0)
    arrow.paste(glyph, (int(acx - glyph.width / 2), int(acy - glyph.height / 2)), glyph)

    tag_r = tag.rotate(angle, resample=Image.BICUBIC, expand=True)
    arrow_r = arrow.rotate(angle, resample=Image.BICUBIC, expand=True)
    box = tag_r.getbbox()
    if not box:
        return Image.new("RGBA", (target_w, target_w), (0, 0, 0, 0))
    tag_r = tag_r.crop(box)
    arrow_r = arrow_r.crop(box)

    ratio = target_w / tag_r.width
    size = (target_w, max(1, int(tag_r.height * ratio)))
    tag_r = tag_r.resize(size, Image.LANCZOS)
    arrow_r = arrow_r.resize(size, Image.LANCZOS)

    mark = gradient_fill(tag_r, INDIGO, CYAN, 25)
    mark.paste(Image.new("RGBA", size, WHITE + (255,)), (0, 0), arrow_r)

    shadow = Image.new("RGBA", (mark.size[0] + 80, mark.size[1] + 80), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 135), (40, 46), mark.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    out = Image.new("RGBA", shadow.size, (0, 0, 0, 0))
    out.alpha_composite(shadow)
    out.alpha_composite(mark, (40, 40))
    return out


def draw_text(img: Image.Image, text: str, px: int, cx: int, top: int, color, tracking: int = 0) -> int:
    """Текст с опционален разред между буквите (PIL не го поддържа сам)."""
    f = font(px)
    d = ImageDraw.Draw(img)
    widths = [d.textlength(ch, font=f) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = cx - total / 2
    for ch, w in zip(text, widths):
        d.text((x, top), ch, font=f, fill=color)
        x += w + tracking
    return int(total)


def compose(with_wordmark: bool, with_ring: bool) -> Image.Image:
    img = build_background().convert("RGBA")

    if with_ring:
        d = ImageDraw.Draw(img, "RGBA")
        r = 0.455 * SIZE
        d.ellipse(
            [SIZE / 2 - r, SIZE / 2 - r, SIZE / 2 + r, SIZE / 2 + r],
            outline=CYAN + (70,),
            width=7,
        )

    # марката — винаги в безопасния кръг
    mark_w = int(0.50 * SIZE) if with_wordmark else int(0.62 * SIZE)
    mark = build_mark(mark_w)
    mx = int(SIZE / 2 - mark.width / 2)
    my = int(0.44 * SIZE - mark.height / 2) if with_wordmark else int(SIZE / 2 - mark.height / 2)
    img.alpha_composite(mark, (mx, my))

    if with_wordmark:
        draw_text(img, "SmartPrice", 116, SIZE // 2, int(0.735 * SIZE), WHITE, tracking=1)
        draw_text(img, "smartprice.bg", 54, SIZE // 2, int(0.845 * SIZE), CYAN, tracking=2)

    return img.convert("RGB")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    shots = {
        "tiktok-1-simvol.png": compose(False, False),
        "tiktok-2-s-logo.png": compose(True, False),
        "tiktok-3-s-ring.png": compose(True, True),
    }
    for name, img in shots.items():
        path = os.path.join(OUT, name)
        img.save(path, quality=95)
        print(f"{name}: {img.size[0]}x{img.size[1]}")
    print("папка:", OUT)


if __name__ == "__main__":
    main()
