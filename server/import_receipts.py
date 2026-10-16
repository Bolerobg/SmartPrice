#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Внасяне на реални касови бонове в SmartPrice наведнъж.

За какво е: методът „кошчето на касата“ — събираш шепа изхвърлени бонове,
снимаш ги/прочиташ ги и ги внасяш наведнъж, вместо да ги качваш един по един
през приложението. Така базата се пълни с РЕАЛНИ цени за един следобед.

Какво прави сам:
  • маскира лични данни (карта, IBAN, дълги номера) — и тук, и на сървъра;
  • влиза в админ панела и внася по 25 записа на заявка;
  • показва какво е минало и какво е отказано (с причина).

Какво НЕ прави: не измисля цени и не създава фалшиви потребители. Внесеното
излиза под профил „SmartPrice Редакция“ и носи етикет за източника, за да е
ясно откъде идва всяка цена.

Употреба:
    python import_receipts.py --example > receipts.json     # шаблон
    python import_receipts.py --file receipts.json          # проби (dry-run)
    python import_receipts.py --file receipts.json --commit  # внася наистина

Паролата се чете от --password или от променливата SMART_PRICE_ADMIN_PASSWORD.
"""
import argparse
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

DEFAULT_BASE = "https://smartprice.bg"
BATCH = 25

EXAMPLE = {
    "source": "receipt_basket",
    "sourceNote": "Кошче на касата, Lidl Габрово",
    "posts": [
        {
            "title": "Кашкавал „Български“ 350 г — вдигнаха грамажа надолу",
            "description": "Платих 8.40 €, но вече е 350 г вместо 400. На килограм излиза по-скъпо отпреди.",
            "merchantName": "Lidl Габрово",
            "placeName": "Lidl",
            "city": "Габрово",
            "category": "supermarket",
            "polarity": "red",
            "pricePaid": 8.40,
            "referencePrice": 7.60,
            "unitQuantity": 350,
            "unitType": "g",
            "receiptDate": "2026-10-14",
            "receiptTime": "18:42",
            "sourceNote": "Бон от кошчето на каса 3",
            "items": [
                {"name": "Кашкавал Български 350 г", "quantity": 1, "unitPrice": 8.40},
                {"name": "Хляб Добруджа", "quantity": 1, "unitPrice": 1.29},
            ],
        }
    ],
}

CARD = re.compile(r"\b(?:\d[ -]?){12,19}\b")
IBAN = re.compile(r"\bBG\d{2}[A-Z0-9]{14,20}\b", re.I)
LONGNUM = re.compile(r"\b\d{10,}\b")


def mask(value):
    """Същото като на сървъра — маха онова, което не бива да става публично."""
    if not value:
        return None
    value = IBAN.sub("••••", value)
    value = CARD.sub("••••", value)
    return LONGNUM.sub("••••", value)


def call(base, path, token=None, body=None, timeout=120):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(base.rstrip("/") + path, data=data, method="POST" if data else "GET")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(raw or "{}")
        except Exception:
            return exc.code, {"raw": raw[:400]}


def login(base, email, password):
    status, res = call(base, "/api/admin/login", body={"email": email, "password": password})
    if status != 200:
        raise SystemExit(
            "Не мога да вляза в админ панела (%s): %s" % (status, res.get("error", {}).get("message") or res)
        )
    for key in ("token", "accessToken"):
        if res.get(key):
            return res[key]
    raise SystemExit("Входът мина, но не върна токен: %s" % list(res))


def sanitize(post):
    """Личните данни се махат и тук, преди да тръгнат по мрежата."""
    out = dict(post)
    out["merchantTaxId"] = mask(out.get("merchantTaxId"))
    out["sourceNote"] = mask(out.get("sourceNote"))
    out["description"] = mask(out.get("description"))
    return out


def main():
    ap = argparse.ArgumentParser(description="Внасяне на касови бонове в SmartPrice")
    ap.add_argument("--file", help="JSON файл с боновете")
    ap.add_argument("--base", default=os.environ.get("SMART_PRICE_BASE", DEFAULT_BASE))
    ap.add_argument("--email", default=os.environ.get("SMART_PRICE_ADMIN_EMAIL", "kolyo.hristov@gmail.com"))
    ap.add_argument("--password", default=os.environ.get("SMART_PRICE_ADMIN_PASSWORD", ""))
    ap.add_argument("--commit", action="store_true", help="наистина внася (без него е само проба)")
    ap.add_argument("--example", action="store_true", help="отпечатва шаблон и излиза")
    args = ap.parse_args()

    if args.example:
        print(json.dumps(EXAMPLE, ensure_ascii=False, indent=2))
        return

    if not args.file:
        raise SystemExit("Дай --file receipts.json (или --example за шаблон)")
    with io.open(args.file, encoding="utf-8") as fh:
        payload = json.load(fh)

    posts = payload.get("posts") or []
    source = payload.get("source") or "receipt_basket"
    source_note = mask(payload.get("sourceNote"))
    if not posts:
        raise SystemExit("Файлът няма нито един бон в „posts“")

    print("Файл: %s" % args.file)
    print("Източник: %s (%s)" % (source, source_note or "—"))
    print("Записи: %d" % len(posts))

    if not args.commit:
        bad = 0
        for i, p in enumerate(posts, 1):
            missing = [k for k in ("title", "merchantName", "placeName", "city", "pricePaid") if not p.get(k)]
            if missing:
                bad += 1
                print("  ✗ #%d %s -> липсват: %s" % (i, (p.get("title") or "?")[:50], ", ".join(missing)))
            elif p.get("unitQuantity") and not p.get("unitType"):
                bad += 1
                print("  ✗ #%d %s -> има грамаж, но не и мерна единица" % (i, (p.get("title") or "?")[:50]))
        print("\nПробата мина. Готови за внасяне: %d, с проблем: %d" % (len(posts) - bad, bad))
        print("Пусни пак със --commit, за да ги внесеш наистина.")
        return

    if not args.password:
        raise SystemExit("Липсва парола: --password или SMART_PRICE_ADMIN_PASSWORD")

    token = login(args.base, args.email, args.password)
    print("Влязох в админ панела. Внасям...\n")

    total_created = 0
    all_skipped = []
    for start in range(0, len(posts), BATCH):
        chunk = [sanitize(p) for p in posts[start:start + BATCH]]
        status, res = call(
            args.base,
            "/api/admin/import/receipts",
            token=token,
            body={"source": source, "sourceNote": source_note, "posts": chunk},
        )
        if status != 200:
            print("  ✗ партида %d: HTTP %s %s" % (start // BATCH + 1, status, res))
            break
        created = int(res.get("created") or 0)
        skipped = res.get("skipped") or []
        total_created += created
        all_skipped += skipped
        print("  партида %d: внесени %d, отказани %d" % (start // BATCH + 1, created, len(skipped)))
        for s in skipped:
            print("      · %s — %s" % (str(s.get("title"))[:50], s.get("reason")))
        time.sleep(0.4)

    print("\nГотово: внесени %d от %d." % (total_created, len(posts)))
    if all_skipped:
        print("Отказани: %d (виж причините горе)." % len(all_skipped))
    print("\nПровери на %s — внесеното излиза под профил „SmartPrice Редакция“ и носи етикет за източника." % args.base)


if __name__ == "__main__":
    main()
