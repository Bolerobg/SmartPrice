#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🏙️ ГРАДСКИ СТРАНИЦИ ЗА GOOGLE — статични HTML файлове от реалните данни.

Защо: приложението е SPA, тоест всеки непознат адрес връща празния index.html и
Google не вижда НИЩО за индексиране. Тези страници дават на търсачката истинско
съдържание: колко оферти има в града, кои вериги, какви цени, какво са намерили хората.

ВАЖНО (честност):
  • Не пишем измислени оценки. `polarity='green'` е 124 014 срещу 49 red, тоест
    „зелено“ значи „по подразбиране“, не „честно“ — затова НЕ се ползва като оценка.
  • Колоната `city` съдържа и боклук („България“, имена на вериги) → ползва се
    БЯЛ СПИСЪК от 28-те областни града.
  • Цени под 0.50 € се изключват (има подставени стойности като 0.01 €).
  • Всяка страница казва ОТ КОГА са данните.

Ползване (от корена на репото):
    python scripts/generate_city_pages.py            # пише в public/
    python scripts/generate_city_pages.py --dry-run  # само показва какво ще стане
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import subprocess
import sys

VPS = os.environ.get("SMARTPRICE_SSH", "root@193.46.243.232")
DB_CONTAINER = "smartprice-db"
BASE = "https://smartprice.bg"
MIN_OFFERS = 50          # по-малко оферти = страница без стойност за търсачката
MIN_PRICE = 0.50         # под това има подставени цени (0.01 €)

# 28-те областни града. Всичко друго в колоната `city` е боклук от скрейпъри.
CITY_WHITELIST = [
    "София", "Пловдив", "Варна", "Бургас", "Русе", "Стара Загора", "Плевен",
    "Сливен", "Добрич", "Шумен", "Перник", "Хасково", "Ямбол", "Пазарджик",
    "Благоевград", "Велико Търново", "Враца", "Габрово", "Видин", "Кюстендил",
    "Кърджали", "Монтана", "Търговище", "Силистра", "Ловеч", "Разград", "Смолян",
    "Асеновград",
]

TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p",
    "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch",
    "ш": "sh", "щ": "sht", "ъ": "a", "ь": "y", "ю": "yu", "я": "ya", " ": "-",
}


# Официалната българска транслитерация за имената на градовете — за чисти адреси
# („София“ трябва да е /ceni/sofia.html, не /ceni/sofiya.html).
SLUG_OVERRIDE = {
    "София": "sofia", "Пловдив": "plovdiv", "Варна": "varna", "Бургас": "burgas",
    "Русе": "ruse", "Стара Загора": "stara-zagora", "Плевен": "pleven",
    "Сливен": "sliven", "Добрич": "dobrich", "Шумен": "shumen", "Перник": "pernik",
    "Хасково": "haskovo", "Ямбол": "yambol", "Пазарджик": "pazardzhik",
    "Благоевград": "blagoevgrad", "Велико Търново": "veliko-tarnovo",
    "Враца": "vratsa", "Габрово": "gabrovo", "Видин": "vidin",
    "Кюстендил": "kyustendil", "Кърджали": "kardzhali", "Монтана": "montana",
    "Търговище": "targovishte", "Силистра": "silistra", "Ловеч": "lovech",
    "Разград": "razgrad", "Смолян": "smolyan", "Асеновград": "asenovgrad",
}


def slugify(name: str) -> str:
    if name in SLUG_OVERRIDE:
        return SLUG_OVERRIDE[name]
    out = []
    for ch in name.lower():
        if ch in TRANSLIT:
            out.append(TRANSLIT[ch])
        elif ch.isalnum() and ch.isascii():
            out.append(ch)
        elif ch == " ":
            out.append("-")
    slug = "".join(out)
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-")


def psql_json(sql: str) -> list:
    """Пуска заявка през SSH и връща JSON. Пишем само на stdout — числата са истински."""
    remote = [
        "ssh", "-o", "ConnectTimeout=20", VPS,
        f'docker exec -i {DB_CONTAINER} sh -c "psql -U \\$POSTGRES_USER -d \\$POSTGRES_DB -t -A -f -"',
    ]
    r = subprocess.run(remote, input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"psql неуспешен: {(r.stderr or '').strip()[:300]}")
    raw = (r.stdout or "").strip()
    if not raw:
        return []
    return json.loads(raw)


def q_literal(values: list[str]) -> str:
    return ", ".join("'" + v.replace("'", "''") + "'" for v in values)


def fetch() -> dict:
    cities = q_literal(CITY_WHITELIST)
    cities_sql = f"""select coalesce(json_agg(t), '[]') from (
      select city, count(*)::int as offers,
             count(distinct place_name)::int as shops
        from posts
       where status = 'published' and city in ({cities})
       group by 1 having count(*) >= {MIN_OFFERS}
       order by 2 desc) t;"""

    chains_sql = f"""select coalesce(json_agg(t), '[]') from (
      select city, place_name as name, count(*)::int as offers
        from posts
       where status = 'published' and city in ({cities})
         and coalesce(btrim(place_name), '') <> ''
         and place_name <> city
       group by 1, 2 order by 3 desc) t;"""

    cheap_sql = f"""select coalesce(json_agg(t), '[]') from (
      select city, title, place_name, price_paid::float as price, currency,
             unit_quantity, unit_type, source, image_url
        from (select p.*,
                     row_number() over (partition by city order by price_paid asc) as rn
                from posts p
               where status = 'published' and city in ({cities})
                 and price_paid >= {MIN_PRICE} and price_paid <= 500
                 and coalesce(btrim(title), '') <> '') p
       where rn <= 8) t;"""

    human_sql = f"""select coalesce(json_agg(t), '[]') from (
      select city, title, place_name, price_paid::float as price, currency,
             reference_price::float as ref, created_at::date::text as on_day
        from posts
       where status = 'published' and city in ({cities})
         and source in ('receipt_basket', 'maps-roam')
         and price_paid >= {MIN_PRICE} and price_paid <= 500
       order by created_at desc) t;"""

    fresh_sql = """select coalesce(json_agg(t), '[]') from (
      select to_char(max(updated_at), 'DD.MM.YYYY') as day,
             count(*) filter (where status = 'published')::int as published
        from posts) t;"""

    return {
        "cities": psql_json(cities_sql),
        "chains": psql_json(chains_sql),
        "cheap": psql_json(cheap_sql),
        "human": psql_json(human_sql),
        "fresh": (psql_json(fresh_sql) or [{}])[0],
    }


def num(n) -> str:
    """Число с български разделител на хилядите (не английска запетая)."""
    return f"{int(n):,}".replace(",", "\u00a0")


def esc(v) -> str:
    return html.escape("" if v is None else str(v), quote=True)


def money(price, currency) -> str:
    cur = "€" if (currency or "EUR").upper() in ("EUR", "BGN") else esc(currency)
    return f"{price:.2f} {cur}".replace(".", ",")


CSS = """
*{box-sizing:border-box}
body{margin:0;background:#0B1424;color:#F8FAFC;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;line-height:1.55}
a{color:#22D3EE}
.wrap{max-width:900px;margin:0 auto;padding:22px 16px 60px}
header{display:flex;align-items:center;gap:10px;padding:14px 0;border-bottom:1px solid #1E293B}
header b{font-size:18px}
header span{color:#94A3B8;font-size:12.5px}
h1{font-size:26px;margin:22px 0 6px}
h2{font-size:18px;margin:30px 0 10px;border-bottom:1px solid #1E293B;padding-bottom:6px}
p.sub{color:#94A3B8;font-size:14px;margin:0 0 6px}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
.stat{flex:1;min-width:140px;background:#111C31;border:1px solid #1E293B;border-radius:12px;padding:12px 14px}
.stat b{display:block;font-size:24px;color:#2DD4BF}
.stat span{color:#94A3B8;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:14px;margin-top:8px}
th{text-align:left;color:#94A3B8;font-size:12px;font-weight:600;border-bottom:1px solid #1E293B;padding:7px 6px}
td{border-bottom:1px solid #16233A;padding:8px 6px;vertical-align:top}
td.p{text-align:right;color:#2DD4BF;font-weight:700;white-space:nowrap}
.pill{display:inline-block;background:#132A3A;color:#67E8F9;border-radius:20px;padding:2px 9px;font-size:11.5px}
.note{background:#111C31;border-left:3px solid #F59E0B;border-radius:8px;padding:11px 13px;font-size:13px;color:#CBD5E1;margin:18px 0}
.cta{display:inline-block;background:#0F766E;color:#fff;text-decoration:none;font-weight:700;border-radius:12px;padding:13px 22px;margin-top:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:9px;margin-top:10px}
.grid a{display:block;background:#111C31;border:1px solid #1E293B;border-radius:10px;padding:11px 13px;text-decoration:none;color:#F8FAFC}
.grid a b{color:#2DD4BF}
.grid a span{display:block;color:#94A3B8;font-size:12px;margin-top:2px}
footer{color:#64748B;font-size:12.5px;margin-top:40px;border-top:1px solid #1E293B;padding-top:14px}
"""


def shell(title: str, description: str, canonical: str, body: str, jsonld: str = "") -> str:
    return f"""<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}" />
<link rel="canonical" href="{esc(canonical)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="SmartPrice" />
<meta property="og:locale" content="bg_BG" />
<meta property="og:url" content="{esc(canonical)}" />
<meta property="og:title" content="{esc(title)}" />
<meta property="og:description" content="{esc(description)}" />
<meta property="og:image" content="{BASE}/icon-512.png" />
<meta name="twitter:card" content="summary" />
<meta name="theme-color" content="#0B1424" />
<link rel="icon" href="/favicon.ico" sizes="any" />
<style>{CSS}</style>
{jsonld}
</head>
<body>
<div class="wrap">
<header><img src="/icon-192.png" width="30" height="30" alt="SmartPrice" /><b>SmartPrice</b>
<span>реални цени · честни места · без реклами</span></header>
{body}
<footer>SmartPrice — безплатно приложение за сравняване на цени в България. Без реклами и без платени места.
Данните идват от Комисията за защита на потребителите и от касови бележки, качени от потребители.</footer>
</div>
</body>
</html>
"""


def city_page(city: dict, chains: list, cheap: list, human: list, fresh: dict) -> str:
    name = city["city"]
    slug = slugify(name)
    url = f"{BASE}/ceni/{slug}.html"
    day = fresh.get("day") or dt.date.today().strftime("%d.%m.%Y")

    desc = (f"{num(city['offers'])} оферти от {num(city['shops'])} магазина в {name}. "
            f"Реални цени и находки от хора. Данни към {day}.")

    rows = "".join(
        f"<tr><td>{esc(c['title'])}<br><span class='pill'>{esc(c['place_name'])}</span></td>"
        f"<td class='p'>{money(c['price'], c['currency'])}</td></tr>"
        for c in cheap
    )
    human_rows = "".join(
        f"<tr><td>{esc(h['title'])}<br><span class='pill'>{esc(h['place_name'])} на {esc(h['on_day'])}</span></td>"
        f"<td class='p'>{money(h['price'], h['currency'])}</td></tr>"
        for h in human
    )
    chain_rows = "".join(
        f"<tr><td>{esc(x['name'])}</td><td class='p'>{x['offers']}</td></tr>" for x in chains[:14]
    )

    body = f"""
<h1>Цени и находки в {esc(name)}</h1>
<p class="sub">Колко струват нещата в {esc(name)} — от данните на КЗП и от касови бележки на хора.</p>
<div class="stats">
  <div class="stat"><b>{num(city['offers'])}</b><span>оферти в града</span></div>
  <div class="stat"><b>{num(city['shops'])}</b><span>магазина и обекта</span></div>
  <div class="stat"><b>{len(human)}</b><span>находки от хора</span></div>
</div>

<div class="note"><b>Данните са към {esc(day)}.</b> Цените се променят — проверявай
актуалната в приложението, преди да платиш.</div>

<h2>Най-ниски цени, докладвани за {esc(name)}</h2>
<table><tr><th>Оферта</th><th style="text-align:right">Цена</th></tr>{rows or '<tr><td>още няма данни</td><td></td></tr>'}</table>
<p class="sub">Това са различни продукти — за сравнение на ЕДИН И СЪЩ продукт
ползвай търсенето в приложението.</p>

{'<h2>Находки, качени от хора</h2><table><tr><th>Находка</th><th style="text-align:right">Платено</th></tr>' + human_rows + '</table>' if human else ''}

<h2>Вериги и магазини в {esc(name)}</h2>
<table><tr><th>Магазин</th><th style="text-align:right">Оферти</th></tr>{chain_rows}</table>

<h2>Провери сам</h2>
<p class="sub">Отвори приложението, напиши продукта и виж колко струва във всяка верига в {esc(name)}.</p>
<a class="cta" href="{BASE}/">Отвори SmartPrice</a>
<p class="sub" style="margin-top:10px">Всички градове: <a href="{BASE}/ceni/">{"виж списъка"}</a></p>
"""

    jsonld = json.dumps(
        {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "name": f"Най-ниски цени в {name}",
            "numberOfItems": len(cheap),
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": i + 1,
                    "name": c["title"],
                }
                for i, c in enumerate(cheap)
            ],
        },
        ensure_ascii=False,
    )
    jsonld_tag = f'<script type="application/ld+json">{jsonld}</script>'
    return shell(f"Цени в {name} — оферти, магазини и находки | SmartPrice", desc, url, body, jsonld_tag)


def index_page(cities: list, fresh: dict) -> str:
    day = fresh.get("day") or dt.date.today().strftime("%d.%m.%Y")
    total = sum(c["offers"] for c in cities)
    cards = "".join(
        f"<a href=\"/ceni/{slugify(c['city'])}.html\"><b>{esc(c['city'])}</b>"
        f"<span>{num(c['offers'])} оферти · {num(c['shops'])} магазина</span></a>"
        for c in cities
    )
    body = f"""
<h1>Цени по градове в България</h1>
<p class="sub">{num(total)} оферти от {len(cities)} града. Данни към {esc(day)}.</p>
<div class="grid">{cards}</div>
<div class="note">Влизаш в град и виждаш кои вериги са там, какви цени са докладвани и
какво са намерили хората. Приложението сравнява един и същ продукт между магазините.</div>
<a class="cta" href="{BASE}/">Отвори SmartPrice</a>
"""
    return shell(
        "Цени по градове в България — SmartPrice",
        f"Реални цени от {total:,} оферти в {len(cities)} български града. Плюс находки, качени от хора.",
        f"{BASE}/ceni/",
        body,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", default="public")
    args = ap.parse_args()

    data = fetch()
    cities = data["cities"]
    if not cities:
        print("Няма градове с достатъчно оферти — нищо не се пише.")
        return 1

    by_city_chains: dict[str, list] = {}
    for c in data["chains"]:
        by_city_chains.setdefault(c["city"], []).append(c)
    by_city_cheap: dict[str, list] = {}
    for c in data["cheap"]:
        by_city_cheap.setdefault(c["city"], []).append(c)
    by_city_human: dict[str, list] = {}
    for c in data["human"]:
        by_city_human.setdefault(c["city"], []).append(c)

    out_ceni = os.path.join(args.out, "ceni")
    written = []
    for c in cities:
        name = c["city"]
        slug = slugify(name)
        page = city_page(
            c,
            by_city_chains.get(name, []),
            by_city_cheap.get(name, []),
            by_city_human.get(name, [])[:5],
            data["fresh"],
        )
        written.append((os.path.join(out_ceni, f"{slug}.html"), page))
        # Същото и като папка — така работи и адресът /ceni/<slug>/ без ".html".
        written.append((os.path.join(out_ceni, slug, "index.html"), page))

    written.append((os.path.join(out_ceni, "index.html"), index_page(cities, data["fresh"])))

    urls = [f"{BASE}/ceni/"] + [f"{BASE}/ceni/{slugify(c['city'])}.html" for c in cities]
    sitemap = ('<?xml version="1.0" encoding="UTF-8"?>\n'
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
               + "\n".join(f"  <url><loc>{u}</loc></url>" for u in urls) + "\n</urlset>\n")
    written.append((os.path.join(args.out, "sitemap.xml"), sitemap))
    written.append((os.path.join(args.out, "robots.txt"),
                    "User-agent: *\nAllow: /\n\nSitemap: " + BASE + "/sitemap.xml\n"))

    if args.dry_run:
        for path, page in written:
            print(f"ще запиша: {path} ({len(page)} знака)")
        print(f"градове: {len(cities)} · файлове: {len(written)}")
        return 0

    for path, page in written:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(page)

    print(f"Готово: {len(cities)} града, {len(written)} файла, общо "
          f"{sum(len(p) for _, p in written) // 1024} KB")
    print("градове: " + ", ".join(c["city"] for c in cities))
    return 0


if __name__ == "__main__":
    sys.exit(main())
