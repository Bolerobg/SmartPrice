#!/usr/bin/env python3
"""
Реален end-to-end OCR тест:
1. Генерира снимка на касова бележка (PIL, кирилица).
2. Качва я през /api/uploads (публичния домейн).
3. Вика /api/ocr/receipt и отпечатва какво е разчел моделът.
Използва измислен търговец — не обвинява реален обект.
"""
import json
import os
import random
import sys
import urllib.error
import urllib.request

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sp_test_helpers import register_and_login  # noqa: E402

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://smartprice.bg"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

LINES = [
    "СУПЕРМАРКЕТ ДЕМО ЕООД",
    "ЕИК: 000000000",
    "гр. София, бул. Примерна 89",
    "ТЕЛ: 02 000 00 00",
    "-" * 34,
    "КРАВЕ МАСЛО 82%  250Г",
    "  2 x 4.49                8.98",
    "ПРЯСНО МЛЯКО 3.6%  1Л",
    "  1 x 2.39                2.39",
    "КАШКАВАЛ КРАВЕ  400Г",
    "  1 x 8.29                8.29",
    "ТОРБА ЗА ПАЗАРУВАНЕ",
    "  1 x 0.30                0.30",
    "-" * 34,
    "ОБЩО:                   19.96",
    "КАРТА                   19.96",
    "ДДС 20%                  3.33",
    "-" * 34,
    "10.10.2026  18:42:11",
    "ФИСКАЛЕН БОН 0000-1234",
]


def make_receipt(path):
    font_path = r"C:\Windows\Fonts\consola.ttf"
    if not os.path.exists(font_path):
        font_path = r"C:\Windows\Fonts\arial.ttf"
    font = ImageFont.truetype(font_path, 26)
    title_font = ImageFont.truetype(font_path, 30)

    width, line_h, pad = 620, 42, 40
    height = pad * 2 + line_h * len(LINES) + 20
    img = Image.new("RGB", (width, height), (252, 251, 246))
    draw = ImageDraw.Draw(img)

    y = pad
    for i, line in enumerate(LINES):
        f = title_font if i == 0 else font
        draw.text((pad, y), line, fill=(25, 25, 25), font=f)
        y += line_h

    # лека "снимкова" текстура, за да не е идеално чист скрийншот
    for _ in range(2200):
        x = random.randint(0, width - 1)
        yy = random.randint(0, height - 1)
        v = random.randint(200, 245)
        img.putpixel((x, yy), (v, v, v - 6))

    img.save(path, "JPEG", quality=82)
    return path


def request(method, path, token=None, body=None, raw=None, content_type=None):
    data = raw if raw is not None else (json.dumps(body, ensure_ascii=False).encode("utf-8") if body else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "application/json, text/plain, */*")
    # urllib слага application/x-www-form-urlencoded по подразбиране, което API-то
    # отхвърля с 415. Затова винаги указваме JSON, когато има тяло.
    if content_type:
        req.add_header("Content-Type", content_type)
    elif data is not None:
        req.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")


def main():
    print(f"Сървър: {BASE}\n")

    # --- 0. Функции ---
    status, body = request("GET", "/api/health/features")
    print(f"0. /api/health/features -> {status}: {body}")
    features = json.loads(body)
    if not features.get("ocr"):
        print("   OCR НЕ е включен — няма смисъл да продължавам.")
        return 1

    # --- 1. Регистрация + потвърждение по имейл ---
    email = f"ocr.{random.randint(10000, 99999)}@smartprice.test"
    status, body, token = register_and_login(
        BASE, email, "TestParola123", "ОCR Тестов"
    )
    print(f"\n1. Регистрация и потвърждение -> {status}")
    if not token:
        print("   ", body)
        return 1

    # --- 2. Генериране на бележката ---
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_test_receipt.jpg")
    make_receipt(path)
    size = os.path.getsize(path)
    print(f"\n2. Генерирана бележка: {path} ({size} байта)")

    # --- 3. Качване (multipart) ---
    boundary = "----SmartPriceBoundary" + str(random.randint(10**9, 10**10))
    with open(path, "rb") as fh:
        file_bytes = fh.read()

    parts = []
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="file"; filename="receipt.jpg"\r\n')
    parts.append(b"Content-Type: image/jpeg\r\n\r\n")
    parts.append(file_bytes)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    payload = b"".join(parts)

    status, body = request(
        "POST",
        "/api/uploads",
        token=token,
        raw=payload,
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    print(f"\n3. Качване -> {status}")
    if status != 201:
        print("   ", body)
        return 1
    uploaded = json.loads(body)
    print(f"   URL: {uploaded['url']} ({uploaded['byteSize']} байта)")

    # --- 4. Реален OCR ---
    print("\n4. Извикване на OCR (може да отнеме 10-30 сек)...")
    status, body = request(
        "POST",
        "/api/ocr/receipt",
        token=token,
        body={"imageUrl": uploaded["url"], "categoryHint": "supermarket", "polarityHint": "green"},
    )
    print(f"   -> HTTP {status}")
    if status != 200:
        print("   ", body[:600])
        return 1

    receipt = json.loads(body)["receipt"]
    print("\n=== КАКВО РАЗЧЕТЕ МОДЕЛЪТ ===")
    print(f"  Търговец:  {receipt.get('merchantName')}")
    print(f"  ЕИК:       {receipt.get('merchantTaxId')}")
    print(f"  Дата:      {receipt.get('date')} {receipt.get('time') or ''}")
    print(f"  Общо:      {receipt.get('totalAmount')} {receipt.get('currency')}")
    print(f"  Сигурност: {receipt.get('confidenceScore')}")
    print(f"  Модел:     {receipt.get('model')}")
    print("  Артикули:")
    for item in receipt.get("items", []):
        note = f"  <- {item['highlightReason']}" if item.get("highlightReason") else ""
        print(f"    - {item['name']}: {item['quantity']} x {item['unitPrice']} = {item['totalPrice']}{note}")

    # --- 5. Проверка срещу очакваното ---
    print("\n=== ПРОВЕРКИ ===")
    ok = True

    def check(label, condition, detail=""):
        nonlocal ok
        ok = ok and condition
        print(f"  [{'OK  ' if condition else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))

    total = receipt.get("totalAmount")
    check("разчете общата сума 19.96", abs(float(total) - 19.96) < 0.05, str(total))
    check("има поне 3 артикула", len(receipt.get("items", [])) >= 3, str(len(receipt.get("items", []))))
    names = " ".join(i["name"].lower() for i in receipt.get("items", []))
    check("разпозна масло", "масло" in names)
    check("разпозна мляко", "мляко" in names)
    check("разпозна кашкавал", "кашкавал" in names)
    check("намери ЕИК", bool(receipt.get("merchantTaxId")), str(receipt.get("merchantTaxId")))
    check("намери дата 10.10.2026", "10" in str(receipt.get("date", "")), str(receipt.get("date")))
    check("сумите на артикулите са верни", all(
        abs(i["totalPrice"] - round(i["quantity"] * i["unitPrice"], 2)) <= 0.05
        for i in receipt.get("items", [])
    ))

    os.remove(path)
    print("\n" + ("ВСИЧКО РАЗЧЕТЕ ПРАВИЛНО" if ok else "ИМА РАЗМИНАВАНИЯ (виж по-горе)"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
