"""Лого на SmartPrice за TikTok — БЕЗ адрес на сайта.

TikTok показва профилната снимка КАТО КРЪГ, затова всичко важно стои в
безопасната зона (вписания кръг). Тук няма „smartprice.bg“ — само знакът
и името на марката (по избор с кратък надпис).

Пущане:  python web/make-tiktok-logo.py
Резултат: web/tiktok/logo-1-znak.png, logo-2-ime.png, logo-3-ime-slogan.png
"""

from __future__ import annotations

import importlib.util
import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "tiktok")

# Ползваме готовите функции от make-tiktok.py (фон, знак, текст), за да няма дублиране.
_spec = importlib.util.spec_from_file_location("mkt", os.path.join(HERE, "make-tiktok.py"))
mkt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mkt)

SIZE = mkt.SIZE          # 1080
WHITE = mkt.WHITE
CYAN = mkt.CYAN
INDIGO = mkt.INDIGO


def safe_half_width(dy: float, margin: float = 0.94) -> float:
    """Колко широк може да е елемент на разстояние dy от центъра, за да не го отреже кръгът."""
    r = SIZE / 2
    if abs(dy) >= r:
        return 0.0
    return math.sqrt(r * r - dy * dy) * margin


def draw_fitted(img: Image.Image, text: str, px: int, cy: float, color, tracking: int = 0) -> None:
    """Рисува надпис, центриран хоризонтално, и намалява шрифта, ако излиза от кръга."""
    dy = cy - SIZE / 2
    limit = safe_half_width(dy) * 2
    size = px
    while size > 24:
        f = mkt.font(size)
        d = ImageDraw.Draw(img)
        total = sum(d.textlength(ch, font=f) for ch in text) + tracking * (len(text) - 1)
        if total <= limit:
            break
        size -= 2
    mkt.draw_text(img, text, size, SIZE // 2, int(cy - size * 0.62), color, tracking=tracking)


def compose(mode: str) -> Image.Image:
    """mode: 'mark' | 'name' | 'slogan'"""
    img = mkt.build_background().convert("RGBA")

    if mode == "slogan":
        d = ImageDraw.Draw(img, "RGBA")
        r = 0.470 * SIZE
        d.ellipse(
            [SIZE / 2 - r, SIZE / 2 - r, SIZE / 2 + r, SIZE / 2 + r],
            outline=CYAN + (70,),
            width=7,
        )

    if mode == "mark":
        mark = mkt.build_mark(int(0.62 * SIZE))
        img.alpha_composite(mark, (int(SIZE / 2 - mark.width / 2), int(SIZE / 2 - mark.height / 2)))
        return img.convert("RGB")

    mark = mkt.build_mark(int(0.48 * SIZE))
    my = int(0.395 * SIZE - mark.height / 2)
    img.alpha_composite(mark, (int(SIZE / 2 - mark.width / 2), my))

    draw_fitted(img, "SmartPrice", 116, 0.665 * SIZE, WHITE, tracking=1)
    if mode == "slogan":
        draw_fitted(img, "Споделяме си цените", 50, 0.790 * SIZE, CYAN, tracking=1)

    return img.convert("RGB")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    shots = {
        "logo-1-znak.png": compose("mark"),
        "logo-2-ime.png": compose("name"),
        "logo-3-ime-slogan.png": compose("slogan"),
    }
    for name, img in shots.items():
        path = os.path.join(OUT, name)
        img.save(path, quality=95)
        print(f"{name}: {img.size[0]}x{img.size[1]}")
    print("папка:", OUT)


if __name__ == "__main__":
    main()
