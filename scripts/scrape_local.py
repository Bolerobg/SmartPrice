#!/usr/bin/env python
"""Обхожда магазини, които блокират сървъра, и внася продуктите в SmartPrice.

Защо локално: част от магазините (remedium.bg, sopharmacy.bg, zora.bg…) са зад
Cloudflare и връщат 403 „Just a moment…" на датацентъра, но се отварят от
обикновен потребителски IP. Затова този скрипт се пуска на домашната машина,
чете продуктите от sitemap-а на сайта и ги праща към продукцията през
`POST /api/admin/scraper/import-external`.

Употреба:
    python scripts/scrape_local.py                     # двата сайта по подразбиране, 10 продукта
    python scripts/scrape_local.py --count 20
    python scripts/scrape_local.py --site https://remedium.bg/ -v
    python scripts/scrape_local.py --dry-run           # само показва какво е намерил

Паролата за админ влизането се чете от (по ред):
    1) --password
    2) SMARTPRICE_ADMIN_PASSWORD
    3) scripts/.local-scrape.env  (файл с реда SMARTPRICE_ADMIN_PASSWORD=...)
"""

import argparse
import html as html_mod
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)
DEFAULT_SITES = ["https://remedium.bg/", "https://sopharmacy.bg/"]
CHALLENGE = re.compile(r"Just a moment|cf-browser-verification|Attention Required", re.I)
SKIP_URL = re.compile(
    r"/(category|catalog|kategorii|blog|news|pages?|content|checkout|cart|login|register|"
    r"account|search|tag|tags|brand|brands|about|contact|pravila|usloviya|politika|"
    r"compare|wishlist)(/|$|\?)"
    # Magento слага /c (категория) и /k (подкатегория) накрая — това НЕ е продукт.
    r"|/[ck](?:[?#]|$)",
    re.I,
)
# Продуктов адрес: или изричен път (/product/…), или слаг с тирета в последната част.
PRODUCT_PATH = re.compile(r"/(?:product|produkt|item|goods|tovar|p)/[^/]+/?$", re.I)
PRODUCT_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+){1,}(?:\.html?)?$", re.I)


def looks_like_product(url):
    if SKIP_URL.search(url):
        return False
    if PRODUCT_PATH.search(url):
        return True
    return bool(PRODUCT_SLUG.match(url.rstrip("/").rsplit("/", 1)[-1]))


CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
]


def chrome_path():
    """Къде е Chrome/Edge на тази машина (ако има)."""
    for candidate in CHROME_CANDIDATES:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def fetch_rendered(url, wait_ms=9000, verbose=False):
    """Чете страницата с ИСТИНСКИ браузър (headless Chrome/Edge).

    Защо: част от сайтовете (bauhaus.bg, jysk.bg, ikea.bg, mr-bricolage.bg…)
    връщат HTML без цени — те идват чак след като JavaScript-ът се изпълни.
    `--virtual-time-budget` дава на страницата време да си свърши работата.
    """
    exe = chrome_path()
    if not exe:
        log("  (няма Chrome/Edge за рендиране)", verbose)
        return None
    fd, profile = tempfile.mkstemp(prefix="sp-chrome-")
    os.close(fd)
    # ВАЖНО (проверено на живо 18.10.2026): в Chrome 132+ СТАРИЯТ headless е
    # премахнат и `--dump-dom` вече не връща нищо (и трите режима дават 0 знака).
    # Затова този път е само резерва; надеждният начин е Chrome да се управлява
    # през CDP (Playwright/Puppeteer), а не с `--dump-dom`.
    # На сървъра това вече работи — там рендирането минава през Playwright
    # (вж. server/src/lib/render.ts).
    try:
        for mode in ("--headless=old", "--headless", "--headless=new"):
            html = _run_chrome(exe, profile, url, wait_ms, mode)
            if html and len(html) > 2000 and not CHALLENGE.search(html[:4000]):
                return html
            log("  (режим %s даде %d знака)" % (mode, len(html or "")), verbose)
        log("  рендирането не върна страница", verbose)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    return None


def _run_chrome(exe, profile, url, wait_ms, mode):
    try:
        proc = subprocess.run(
            [
                exe, mode, "--disable-gpu", "--no-sandbox",
                "--disable-dev-shm-usage", "--no-first-run", "--mute-audio",
                "--blink-settings=imagesEnabled=false",
                "--user-data-dir=" + profile,
                "--virtual-time-budget=%d" % wait_ms,
                "--dump-dom", url,
            ],
            capture_output=True, text=True, errors="replace", timeout=120,
        )
        return proc.stdout or ""
    except Exception as err:  # noqa: BLE001 — важно е да продължим, не да спрем
        log("  браузърът не успя: %s" % str(err)[:120], verbose)
        return ""



def log(msg, verbose=True):
    if verbose:
        print(msg, flush=True)


def fetch(url, verbose=False, max_bytes=1_500_000, tries=2):
    """Чете адрес с браузърни заглавки.

    ВАЖНО: тялото минава през временен файл (`-o`), не през тръба — на Windows
    (MSYS) curl чупи връзката с „client returned ERROR on write“, когато пише
    голяма страница към тръба.
    """
    status, final, raw = "0", url, ""
    for attempt in range(tries):
        fd, tmp = tempfile.mkstemp(suffix=".html", prefix="sp-scrape-")
        os.close(fd)
        try:
            proc = subprocess.run(
                [
                    "curl", "-sL", "--compressed", "--max-time", "45", "-A", UA,
                    "-H", "Accept-Language: bg-BG,bg;q=0.9",
                    "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "-o", tmp, "-w", "%{http_code} %{url_effective}", url,
                ],
                capture_output=True,
                text=True,
                errors="replace",
            )
            info = (proc.stdout or "").strip().split(" ")
            status = info[0] if info and info[0].isdigit() else "0"
            final = info[1] if len(info) > 1 else url
            with open(tmp, "rb") as fh:
                raw = fh.read(max_bytes).decode("utf-8", errors="replace")
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass
        if status == "200" and not CHALLENGE.search(raw[:3000]):
            return status, raw, final
        if verbose:
            log(f"    (опит {attempt + 1}: статус {status})", verbose)
        time.sleep(1.5)
    return status, raw, final


def sitemap_urls(base):
    """Намира sitemap адресите от robots.txt (или стандартните места)."""
    out = []
    status, text, _ = fetch(base.rstrip("/") + "/robots.txt")
    if status == "200":
        out = [
            m.strip()
            for m in re.findall(r"(?im)^\s*sitemap:\s*(\S+)", text)
            if m.strip().startswith("http")
        ]
    if not out:
        out = [base.rstrip("/") + "/sitemap.xml"]
    return out


def locs(xml):
    return [m.strip() for m in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml, re.I)]


def collect_product_urls(base, limit, verbose=False):
    """Събира до `limit` продуктови адреса от sitemap-а на сайта."""
    def is_product(u):
        return looks_like_product(u)

    found, seen = [], set()
    for sm in sitemap_urls(base):
        status, xml, _ = fetch(sm, verbose)
        log(f"  sitemap {sm} → {status}", verbose)
        if status != "200":
            continue
        entries = locs(xml)
        if re.search(r"<sitemapindex", xml, re.I):
            # индекс: първо продуктовите под-карти, после останалите
            children = sorted(entries, key=lambda u: 0 if re.search(r"product|goods|item", u, re.I) else 1)
        else:
            children = [sm]
            entries = [u for u in entries if is_product(u)]
        for child in children:
            if len(found) >= limit:
                break
            if child == sm:
                pool = entries
            else:
                st, sub, _ = fetch(child, verbose)
                if st != "200":
                    continue
                pool = [u for u in locs(sub) if is_product(u)]
            for u in pool:
                if len(found) >= limit:
                    break
                u = u.split("#")[0]
                if u in seen or SKIP_URL.search(u):
                    continue
                seen.add(u)
                found.append(u)
            if len(found) >= limit:
                break
        if found:
            break
    return found


def _price_from(text):
    m = re.search(r"(\d{1,6}(?:[ \u00a0]\d{3})*(?:[.,]\d{1,2})?)\s*(лв\.?|BGN|€|EUR|евро)", text, re.I)
    if not m:
        return None, None
    amount = m.group(1).replace(" ", "").replace("\u00a0", "").replace(",", ".")
    try:
        value = float(amount)
    except ValueError:
        return None, None
    if value <= 0 or value > 100000:
        return None, None
    cur = "BGN" if re.match(r"лв|BGN", m.group(2), re.I) else "EUR"
    return round(value, 2), cur


def extract_product(html, url):
    """Изважда заглавие, цена, снимка и описание от продуктова страница."""
    item = {"url": url, "title": "", "price": None, "currency": None, "imageUrl": "", "description": ""}

    # 1) JSON-LD Product
    for blob in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            data = json.loads(blob.strip())
        except Exception:
            continue
        for node in data if isinstance(data, list) else [data]:
            if not isinstance(node, dict):
                continue
            if str(node.get("@type", "")).lower() != "product":
                continue
            item["title"] = item["title"] or str(node.get("name") or "").strip()
            desc = node.get("description")
            if isinstance(desc, str):
                item["description"] = item["description"] or re.sub(r"\s+", " ", desc).strip()
            img = node.get("image")
            if isinstance(img, list) and img:
                img = img[0]
            if isinstance(img, str):
                item["imageUrl"] = item["imageUrl"] or img
            offers = node.get("offers")
            for offer in offers if isinstance(offers, list) else [offers]:
                if not isinstance(offer, dict):
                    continue
                price = offer.get("price") or offer.get("lowPrice")
                cur = offer.get("priceCurrency")
                if price is not None:
                    try:
                        value = float(str(price).replace(",", "."))
                    except ValueError:
                        continue
                    if item["price"] is None or value < item["price"]:
                        item["price"], item["currency"] = round(value, 2), (cur or None)

    # 2) микро-данни и meta
    if not item["title"]:
        for pat in (
            r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)',
            r"<title[^>]*>(.*?)</title>",
        ):
            m = re.search(pat, html, re.S | re.I)
            if m:
                item["title"] = re.sub(r"\s+", " ", m.group(1)).strip()
                break
    if not item["imageUrl"]:
        m = re.search(r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\'][^>]+content=["\']([^"\']+)', html, re.I)
        if m:
            item["imageUrl"] = m.group(1)
    if not item["description"]:
        m = re.search(r'<meta[^>]+(?:property|name)=["\'](?:og:description|description)["\'][^>]+content=["\']([^"\']+)', html, re.I)
        if m:
            item["description"] = re.sub(r"\s+", " ", m.group(1)).strip()
    if item["price"] is None:
        for pat in (
            r'itemprop=["\']price["\'][^>]*content=["\']([\d.,]+)',
            r'<meta[^>]+(?:property|name)=["\']product:price:amount["\'][^>]+content=["\']([\d.,]+)',
        ):
            m = re.search(pat, html, re.I)
            if m:
                try:
                    item["price"] = round(float(m.group(1).replace(",", ".")), 2)
                    item["currency"] = "BGN" if re.search(r"лв|BGN", html[:40000], re.I) else "EUR"
                except ValueError:
                    pass
                break
    if item["price"] is None:
        value, cur = _price_from(re.sub(r"<[^>]+>", " ", html)[:60000])
        item["price"], item["currency"] = value, cur

    for key in ("title", "description", "imageUrl"):
        item[key] = re.sub(r"\s+", " ", item[key] or "").strip()
    return item


def strip_html(text):
    return re.sub(r"\s+", " ", html_mod.unescape(re.sub(r"<[^>]+>", " ", text or ""))).strip()


MAGENTO_QUERY = (
    '{products(search:"%s",pageSize:%d,sort:{relevance:DESC}){total_count items{name url_key '
    "price_range{minimum_price{final_price{value currency} regular_price{value}}} "
    "image{url} short_description{html} description{html}}}}"
)


def try_magento(base, limit, verbose=False):
    """Пробва Magento GraphQL — най-чистият начин (име, цена, снимка, описание).

    Връща None, ако сайтът не е Magento или GraphQL е изключен (тогава се
    минава по sitemap-а).
    """
    payload = json.dumps({"query": MAGENTO_QUERY % ("", limit)}, ensure_ascii=False)
    proc = subprocess.run(
        [
            "curl", "-s", "-X", "POST", base.rstrip("/") + "/graphql",
            "-H", "Content-Type: application/json", "-A", UA,
            "-H", "Accept: application/json", "--data-binary", "@-",
        ],
        input=payload, capture_output=True, text=True, timeout=90, errors="replace",
    )
    try:
        data = json.loads(proc.stdout or "{}")
    except Exception:
        log("  Magento GraphQL: не — минавам по sitemap", verbose)
        return None
    products = (((data or {}).get("data") or {}).get("products") or {})
    rows = products.get("items")
    if not rows:
        log("  Magento GraphQL: не — минавам по sitemap", verbose)
        return None
    log(f"  Magento GraphQL: да — общо {products.get('total_count')} продукта", verbose)
    items = []
    for row in rows:
        price_range = ((row.get("price_range") or {}).get("minimum_price") or {})
        final = (price_range.get("final_price") or {})
        regular = (price_range.get("regular_price") or {})
        value = final.get("value")
        if value is None:
            continue
        url_key = (row.get("url_key") or "").strip("/")
        image = ((row.get("image") or {}).get("url") or "").strip()
        items.append(
            {
                "title": strip_html(row.get("name")),
                "url": f"{base.rstrip('/')}/{url_key}",
                "price": round(float(value), 2),
                "currency": final.get("currency") or "EUR",
                "imageUrl": image,
                "description": strip_html(
                    (row.get("short_description") or {}).get("html")
                    or (row.get("description") or {}).get("html")
                )[:600],
                "listPrice": round(float(regular["value"]), 2)
                if regular.get("value") and float(regular["value"]) > float(value)
                else None,
            }
        )
    return items


def magento_price(base, url_key, verbose=False):
    """Цена на един продукт в Magento по неговия url_key (най-надеждно)."""
    query = (
        '{products(filter:{url_key:{eq:"%s"}}){items{name '
        "price_range{minimum_price{final_price{value currency} regular_price{value}}}}}}"
        % url_key.replace('"', "")
    )
    proc = subprocess.run(
        [
            "curl", "-s", "-X", "POST", base.rstrip("/") + "/graphql",
            "-H", "Content-Type: application/json", "-A", UA,
            "--data-binary", "@-",
        ],
        input=json.dumps({"query": query}, ensure_ascii=False).encode("utf-8"),
        capture_output=True, timeout=60,
    )
    try:
        items = ((json.loads(proc.stdout.decode("utf-8", "replace")).get("data") or {}).get("products") or {}).get("items") or []
        first = items[0]
        mp = ((first.get("price_range") or {}).get("minimum_price") or {})
        final = mp.get("final_price") or {}
        regular = mp.get("regular_price") or {}
        if final.get("value") is None:
            return None
        return {
            "price": round(float(final["value"]), 2),
            "currency": final.get("currency") or "EUR",
            "listPrice": round(float(regular["value"]), 2)
            if regular.get("value") and float(regular["value"]) > float(final["value"])
            else None,
        }
    except Exception:
        return None


def to_eur(price, currency):
    """В евро (1 € = 1.95583 лв.), както е в приложението."""
    if price is None:
        return None
    if currency and re.search(r"bgn|лв", str(currency), re.I):
        return round(price / 1.95583, 2)
    return round(float(price), 2)


def refresh_prices(api, token, limit, verbose=False):
    """Проверява „цената сега“ на внесените оферти ОТ ТАЗИ машина и я записва.

    Нужно е за магазините, които блокират нашия сървър (Cloudflare 403):
    сървърът не може да провери, но домашният IP може.
    """
    # ВАЖНО: приложението връща грешка за твърде голям limit (над 50) — затова
    # искаме на порции по 50 и ги събираме, докато стигнем искания брой.
    posts, offset, page_size = [], 0, 50
    while len(posts) < limit:
        proc = subprocess.run(
            ["curl", "-s", "%s/api/posts?limit=%d&offset=%d" % (api, page_size, offset), "-A", UA],
            capture_output=True, timeout=120,
        )
        try:
            chunk = json.loads(proc.stdout.decode("utf-8", "replace")).get("items") or []
        except Exception:
            print("  не успях да прочета офертите от приложението")
            break
        if not chunk:
            break
        posts.extend(chunk)
        offset += len(chunk)
        if len(chunk) < page_size:
            break
    posts = posts[:limit]

    targets = [p for p in posts if (p.get("sourceUrl") or p.get("source_url"))]
    print("  оферти с линк към магазин: %d" % len(targets))
    updates, failed = [], 0

    for post in targets:
        url = post.get("sourceUrl") or post.get("source_url")
        post_id = post.get("id")
        domain = re.sub(r"^www\.", "", url.split("//")[-1].split("/")[0])
        base = "https://" + domain
        url_key = url.rstrip("/").rsplit("/", 1)[-1]
        fresh = None

        # 1) Magento магазин (remedium.bg и подобни) — питаме GraphQL-а.
        if "/product/" not in url:
            fresh = magento_price(base, url_key, verbose)
        # 2) Всички останали — четем продуктовата страница.
        if not fresh:
            status, page, final_url = fetch(url, verbose)
            if status == "200":
                got = extract_product(page, final_url)
                if got["price"]:
                    fresh = {"price": got["price"], "currency": got["currency"], "listPrice": None}
        if not fresh:
            failed += 1
            log("  не успях: %s" % url[:90], verbose)
            continue

        price_eur = to_eur(fresh["price"], fresh["currency"])
        list_eur = to_eur(fresh["listPrice"], fresh["currency"])
        item = {"postId": post_id, "priceEur": price_eur}
        if list_eur and list_eur > price_eur:
            item["listPriceEur"] = list_eur
        updates.append(item)
        print("  ✓ %s %s → %.2f € — %s" % (fresh["price"], fresh["currency"], price_eur, (post.get("title") or "")[:45]))
        time.sleep(0.7)

    saved = 0
    if updates:
        proc = subprocess.run(
            ["curl", "-s", "-X", "POST", api + "/api/admin/posts/shop-prices",
             "-H", "Content-Type: application/json", "-H", "Authorization: Bearer " + token,
             "--data-binary", "@-"],
            input=json.dumps({"items": updates}, ensure_ascii=False).encode("utf-8"),
            capture_output=True, timeout=180,
        )
        try:
            saved = json.loads(proc.stdout.decode("utf-8", "replace")).get("saved") or 0
        except Exception:
            saved = 0
    return saved, failed


def login(api, email, password):
    body = json.dumps({"email": email, "password": password})
    out = subprocess.run(
        ["curl", "-s", "-X", "POST", f"{api}/api/admin/login",
         "-H", "Content-Type: application/json", "-d", body],
        capture_output=True, text=True, timeout=60,
    ).stdout
    try:
        return json.loads(out).get("token")
    except Exception:
        return None


def send(api, token, domain, items):
    body = json.dumps({"domain": domain, "items": items}, ensure_ascii=False)
    proc = subprocess.run(
        ["curl", "-s", "-X", "POST", f"{api}/api/admin/scraper/import-external",
         "-H", "Content-Type: application/json", "-H", f"Authorization: Bearer {token}",
         "--data-binary", "@-"],
        input=body.encode("utf-8"), capture_output=True, timeout=180,
    )
    out = proc.stdout.decode("utf-8", errors="replace")
    try:
        return json.loads(out)
    except Exception:
        return {"raw": out[:300]}


def admin_call(api, token, path, body=None, timeout=120):
    """Заявка към админ API-то (GET или POST). Връща разчетен JSON или {}."""
    cmd = ["curl", "-s", "-X", ("POST" if body is not None else "GET"),
           api.rstrip("/") + path,
           "-H", "Accept: application/json",
           "-H", "Authorization: Bearer " + (token or "")]
    kwargs = {}
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
        kwargs["input"] = json.dumps(body, ensure_ascii=False).encode("utf-8")
    proc = subprocess.run(cmd, capture_output=True, timeout=timeout, **kwargs)
    try:
        return json.loads(proc.stdout.decode("utf-8", "replace") or "{}")
    except Exception:
        return {}


def scan_site(base, count, mode, verbose=False):
    """Обхожда един сайт: Magento GraphQL, иначе sitemap → продуктови страници.

    Това е същата логика, която се ползва и при ръчно пускане — извадена е във
    функция, за да може опашката (--queue) да я ползва за всеки сайт поотделно.
    """
    items = []

    # 1) Magento GraphQL — ако сайтът го поддържа, това е най-надеждният път.
    if mode in ("auto", "magento"):
        mag = try_magento(base, count, verbose)
        if mag:
            items = mag[:count]
            for item in items:
                print(f"  \u2713 {item['price']} {item['currency']} — {item['title'][:60]}")

    # 2) Иначе: sitemap → продуктови страници.
    if not items and mode in ("auto", "sitemap"):
        # събираме 4× повече адреси — част от тях се оказват категории без цена
        urls = collect_product_urls(base, count * 4, verbose)
        print(f"  намерени продуктови адреса: {len(urls)}")
        for url in urls:
            if len(items) >= count:
                break
            status, html, final = fetch(url, verbose)
            if status != "200":
                log(f"  пропускам ({status}): {url}", verbose)
                continue
            item = extract_product(html, final.split("#")[0])
            if not item["title"] or not item["price"]:
                # Цените може да идват с JavaScript (bauhaus.bg, jysk.bg, ikea.bg…) —
                # отваряме страницата с истински браузър и четем пак.
                rendered = fetch_rendered(final, verbose=verbose)
                if rendered:
                    deeper = extract_product(rendered, final)
                    if deeper["title"] and deeper["price"]:
                        item = deeper
                        print("  (цената я има само след рендиране)")
            if not item["title"] or not item["price"]:
                log(f"  без цена/заглавие: {url}", verbose)
                continue
            print(f"  \u2713 {item['price']} {item['currency']} — {item['title'][:60]}")
            items.append(item)
            time.sleep(1.0)

    return items


def run_queue(api, token, count, mode, verbose=False, dry_run=False):
    """Работи по опашката от таб \u201eТърси магазини\u201c — сайтовете, които сървърът не може.

    Това е смисълът на целия механизъм: сървърът вижда Cloudflare и слага сайта в
    опашката, а тази машина (домашен IP) го обхожда и внася продуктите.
    """
    waiting = admin_call(api, token, "/api/admin/scraper/local-queue?limit=20").get("items") or []
    if not waiting:
        print("Опашката е празна — няма сайтове за обхождане от тази машина.")
        return 0

    print("Чакат от моя компютър: %d сайта" % len(waiting))
    for row in waiting:
        print("  \u2022 %s (до %d продукта)" % (row.get("domain"), int(row.get("count") or count)))

    domains = [r.get("domain") for r in waiting if r.get("domain")]
    admin_call(api, token, "/api/admin/scraper/local-queue/take", {"domains": domains})

    total = {"imported": 0, "skipped": 0}
    for row in waiting:
        domain = row.get("domain")
        if not domain:
            continue
        per = min(int(row.get("count") or count), 500)
        base = "https://" + domain + "/"
        print(f"\n=== {domain} (до {per} продукта)")
        try:
            items = scan_site(base, per, mode, verbose)
        except Exception as err:  # noqa: BLE001 — трябва да отчетем неуспеха, не да спрем
            print("  грешка: %s" % err)
            admin_call(api, token, "/api/admin/scraper/local-queue/finish",
                       {"domain": domain, "ok": False, "note": str(err)[:250]})
            continue

        if not items:
            print("  нищо за внасяне")
            admin_call(api, token, "/api/admin/scraper/local-queue/finish",
                       {"domain": domain, "ok": False, "note": "не намерих продукти от този IP"})
            continue
        if dry_run:
            print(f"  (проба) щеше да внесе {len(items)} продукта")
            continue

        result = send(api, token, domain, items)
        imported = int(result.get("imported") or 0)
        skipped = int(result.get("skipped") or 0)
        print(f"  внесени: {imported} | прескочени: {skipped}")
        for reason in (result.get("skippedReasons") or [])[:5]:
            print(f"    – {reason}")
        total["imported"] += imported
        total["skipped"] += skipped
        # ВАЖНО: ok е „обхождането успя“, не „внесох нови“. Иначе сайт, който вече
        # е бил обходен, остава завинаги в списъка „не става за сканиране“.
        admin_call(api, token, "/api/admin/scraper/local-queue/finish",
                   {"domain": domain, "ok": bool(items), "imported": imported,
                    "note": ("внесени %d" % imported) if imported else "обходено, няма нови продукти"})

    print(f"\nОбщо от опашката: внесени {total['imported']}, прескочени {total['skipped']}")
    return 0


def read_password(args):
    if args.password:
        return args.password
    if os.environ.get("SMARTPRICE_ADMIN_PASSWORD"):
        return os.environ["SMARTPRICE_ADMIN_PASSWORD"]
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".local-scrape.env")
    if os.path.exists(here):
        for line in open(here, encoding="utf-8"):
            if line.strip().startswith("SMARTPRICE_ADMIN_PASSWORD="):
                return line.split("=", 1)[1].strip().strip('"')
    return None


def main():
    ap = argparse.ArgumentParser(description="Локален скрапер за сайтове зад Cloudflare")
    ap.add_argument("--site", action="append", help="адрес на магазин (може няколко пъти)")
    ap.add_argument("--count", type=int, default=10, help="колко продукта на сайт (по подразбиране 10)")
    ap.add_argument("--limit", type=int, default=200, help="колко оферти да обходи при --refresh (по подразбиране 200)")
    ap.add_argument(
        "--mode",
        choices=["auto", "magento", "sitemap"],
        default="auto",
        help="auto: пробва Magento GraphQL, после sitemap (по подразбиране)",
    )
    ap.add_argument("--api", default=os.environ.get("SMARTPRICE_API", "https://smartprice.bg"))
    ap.add_argument("--email", default=os.environ.get("SMARTPRICE_ADMIN_EMAIL", "kolyo.hristov@gmail.com"))
    ap.add_argument("--password", default=None)
    ap.add_argument(
        "--queue",
        action="store_true",
        help="работи по опашката от таб „Търси магазини“ (сайтовете, които сървърът не може да обходи)",
    )
    ap.add_argument("--dry-run", action="store_true", help="само показва намереното, не внася")
    ap.add_argument(
        "--refresh",
        action="store_true",
        help="провери наново „цената сега“ на внесените оферти (за магазини, които блокират сървъра)",
    )
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    sites = args.site or DEFAULT_SITES
    token = None
    if args.refresh or not args.dry_run:
        password = read_password(args)
        if not password:
            print("Липсва админ парола. Подай --password или SMARTPRICE_ADMIN_PASSWORD "
                  "(или я запиши в scripts/.local-scrape.env).")
            return 2
        token = login(args.api, args.email, password)
        if not token:
            print("Не успях да вляза като админ — провери имейла/паролата.")
            return 2

    if args.queue:
        return run_queue(args.api, token, args.count, args.mode, args.verbose, args.dry_run)

    if args.refresh:
        print("Проверявам цените на внесените оферти от тази машина…")
        saved, failed = refresh_prices(args.api, token, args.limit or 200, args.verbose)
        print("\nОбщо: записани %d нови проверки, неуспешни %d" % (saved, failed))
        return 0

    total = {"imported": 0, "skipped": 0}
    for base in sites:
        domain = re.sub(r"^www\.", "", base.split("//")[-1].split("/")[0])
        print(f"\n=== {domain}")
        items = scan_site(base, args.count, args.mode, args.verbose)

        if not items:
            print("  нищо за внасяне")
            continue
        if args.dry_run:
            print(f"  (проба) щеше да внесе {len(items)} продукта")
            continue
        result = send(args.api, token, domain, items)
        print(f"  внесени: {result.get('imported')} | прескочени: {result.get('skipped')}")
        if result.get("skippedReasons"):
            for reason in result["skippedReasons"][:5]:
                print(f"    – {reason}")
        total["imported"] += result.get("imported", 0) or 0
        total["skipped"] += result.get("skipped", 0) or 0

    print(f"\nОбщо: внесени {total['imported']}, прескочени {total['skipped']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
