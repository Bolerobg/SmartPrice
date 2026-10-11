#!/usr/bin/env python3
"""
Реален тест на Stripe плащанията (LIVE режим).

Проверява:
  1. Конфигурацията на даренията.
  2. Еднократно дарение → създава РЕАЛНА Checkout сесия в Stripe.
  3. Месечна подкрепа → създава абонаментна Checkout сесия.
  4. Че дарението е 'pending' (НЕ 'succeeded') преди реално плащане.
  5. Че потребителят НЕ може сам да се направи поддръжник.

ВАЖНО: НЕ се извършва плащане — само се създават сесии, които изтичат сами.
"""
import json
import random
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://smart.lookthis.online"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

passed, failed = [], []


def call(method, path, body=None, token=None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "application/json, text/plain, */*")
    if data is not None:
        req.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return exc.code, {"raw": raw}


def check(label, condition, detail=""):
    (passed if condition else failed).append(label)
    print(f"  [{'OK  ' if condition else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def main():
    print(f"Сървър: {BASE}\n")

    print("=== 1. Конфигурация ===")
    status, cfg = call("GET", "/api/donations/config")
    check("GET /api/donations/config -> 200", status == 200, f"HTTP {status}")
    check("плащанията са ВКЛЮЧЕНИ", cfg.get("enabled") is True, str(cfg.get("enabled")))
    check("валута е EUR (Stripe не приема BGN)", cfg.get("currency") == "EUR", str(cfg.get("currency")))
    check("има 3 нива на дарение", len(cfg.get("tiers", [])) == 3, str(len(cfg.get("tiers", []))))
    print(f"        нива: {[(t['id'], t['amount']) for t in cfg.get('tiers', [])]}")

    print("\n=== 2. Регистрация ===")
    email = f"pay.{random.randint(10000, 99999)}@smartprice.test"
    status, body = call(
        "POST",
        "/api/auth/register",
        {"email": email, "password": "TestParola123", "name": "Платеж Тестов", "city": "София"},
    )
    check("регистрация -> 201", status == 201, f"HTTP {status}")
    if status != 201:
        print("   ", body)
        return 1
    token = body["accessToken"]
    check("нов профил НЕ е поддръжник", body["profile"]["isSupporter"] is False)

    print("\n=== 3. Еднократно дарение (реална Checkout сесия в Stripe) ===")
    status, single = call(
        "POST",
        "/api/donations/checkout",
        {"amount": 2, "tierId": "coffee", "isMonthly": False},
        token=token,
    )
    check("създаване на сесия -> 201", status == 201, f"HTTP {status} {single if status != 201 else ''}")
    if status != 201:
        return 1
    url = single.get("checkoutUrl", "")
    check("върнат е Stripe Checkout URL", url.startswith("https://checkout.stripe.com/"), url[:60])
    check("върнато е id на сесията", single.get("sessionId", "").startswith("cs_live_"), single.get("sessionId", "")[:24])
    check("сумата е 2 EUR", single.get("amount") == 2, str(single.get("amount")))
    check("валутата е EUR", single.get("currency") == "EUR", str(single.get("currency")))
    check("не е месечно", single.get("isMonthly") is False)
    single_session = single.get("sessionId")

    print("\n=== 4. Месечна подкрепа (абонаментна сесия) ===")
    status, monthly = call(
        "POST",
        "/api/donations/checkout",
        {"amount": 5, "tierId": "guardian", "isMonthly": True},
        token=token,
    )
    check("абонаментна сесия -> 201", status == 201, f"HTTP {status} {monthly if status != 201 else ''}")
    if status == 201:
        check("има URL и за абонамента", monthly.get("checkoutUrl", "").startswith("https://checkout.stripe.com/"))
        check("отбелязано като месечно", monthly.get("isMonthly") is True)

    print("\n=== 5. Дарението е 'pending', НЕ 'succeeded' (без плащане) ===")
    status, mine = call("GET", "/api/donations/mine", token=token)
    check("GET /api/donations/mine -> 200", status == 200, f"HTTP {status}")
    items = mine.get("items", [])
    check("записани са 2 дарения", len(items) == 2, str(len(items)))
    check("всички са 'pending'", all(i["status"] == "pending" for i in items), str([i["status"] for i in items]))
    check("профилът още НЕ е поддръжник", mine["profile"]["isSupporter"] is False)
    check("дарената сума е 0 (нищо не е платено)", mine["profile"]["totalDonatedBgn"] == 0, str(mine["profile"]["totalDonatedBgn"]))

    print("\n=== 6. Проверка на сесията (без плащане -> остава pending) ===")
    status, sess = call("GET", f"/api/donations/session/{single_session}", token=token)
    check("GET /api/donations/session/:id -> 200", status == 200, f"HTTP {status}")
    check("статусът е 'pending' (няма плащане)", sess.get("status") == "pending", str(sess.get("status")))

    print("\n=== 7. Сигурност: не може сам да станеш поддръжник ===")
    check(
        "няма endpoint за самоприсвояване на статус",
        call("POST", "/api/donations/confirm", {}, token=token)[0] == 404,
    )
    check(
        "не може да се пише директно в donations",
        call("POST", "/api/donations", {"status": "succeeded"}, token=token)[0] == 404,
    )
    status, _ = call("POST", "/api/donations/checkout", {"amount": 0.5, "tierId": "coffee"}, token=token)
    check("под 1 € се отхвърля", status == 422, f"HTTP {status}")

    print("\n=== РЕЗУЛТАТ ===")
    total = len(passed) + len(failed)
    print(f"  минали: {len(passed)}/{total}")
    if failed:
        print("  ПРОВАЛЕНИ:")
        for f in failed:
            print(f"    - {f}")
        return 1
    print("  всички проверки минаха")
    print("\n  Забележка: създадени са 2 РЕАЛНИ Checkout сесии в Stripe (live).")
    print("  Те не са платени и изтичат автоматично — никакви пари не са движени.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
