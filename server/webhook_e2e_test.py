#!/usr/bin/env python3
"""
Пълен тест на Stripe webhook-а — БЕЗ реални пари.

Как:
  1. Създава истинска Checkout сесия (дарението остава 'pending').
  2. Конструира синтетично събитие checkout.session.completed и го подписва
     с истинската STRIPE_WEBHOOK_SECRET (същият HMAC-SHA256 алгоритъм като Stripe).
  3. Праща го на /api/donations/webhook.
  4. Проверява, че дарението е станало 'succeeded' и профилът е поддръжник.

Ако това мине, webhook-ът работи истински — Stripe ще прави същото.
"""
import hashlib
import hmac
import json
import random
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://smart.lookthis.online"
SECRET = sys.argv[2] if len(sys.argv) > 2 else ""
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

passed, failed = [], []


def check(label, condition, detail=""):
    (passed if condition else failed).append(label)
    print(f"  [{'OK  ' if condition else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def call(method, path, body=None, token=None, headers=None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "application/json, text/plain, */*")
    if data is not None:
        req.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return exc.code, {"raw": raw}


def stripe_signature(payload_str, secret, timestamp=None):
    """Същият алгоритъм като Stripe: HMAC-SHA256 на '<t>.<payload>' с тайната."""
    t = timestamp if timestamp is not None else int(time.time())
    signed = f"{t}.{payload_str}"
    digest = hmac.new(secret.encode("utf-8"), signed.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"t={t},v1={digest}"


def send_event(event, secret, timestamp=None):
    """Праща събитието с валиден подпис. Тялото трябва да е БАЙТ-ИДЕНТИЧНО с подписаното."""
    payload = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    header = stripe_signature(payload, secret, timestamp=timestamp)
    data = payload.encode("utf-8")
    req = urllib.request.Request(BASE + "/api/donations/webhook", data=data, method="POST")
    req.add_header("User-Agent", UA)
    req.add_header("Content-Type", "application/json")
    req.add_header("Stripe-Signature", header)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return exc.code, {"raw": raw}


def main():
    if not SECRET.startswith("whsec_"):
        print("Липсва STRIPE_WEBHOOK_SECRET като втори аргумент.")
        return 1

    print(f"Сървър: {BASE}\n")

    print("=== 1. Регистрация и създаване на дарение ===")
    email = f"wh.{random.randint(10000, 99999)}@smartprice.test"
    status, body = call(
        "POST",
        "/api/auth/register",
        {"email": email, "password": "TestParola123", "name": "Уебхук Тестов", "city": "София"},
    )
    check("регистрация -> 201", status == 201, f"HTTP {status}")
    if status != 201:
        return 1
    token = body["accessToken"]

    status, checkout = call(
        "POST", "/api/donations/checkout", {"amount": 2, "tierId": "coffee", "isMonthly": False}, token=token
    )
    check("Checkout сесия -> 201", status == 201, f"HTTP {status}")
    if status != 201:
        print("   ", checkout)
        return 1
    session_id = checkout["sessionId"]
    print(f"        сесия: {session_id[:26]}…")

    status, mine = call("GET", "/api/donations/mine", token=token)
    check("преди webhook: статус 'pending'", mine["items"][0]["status"] == "pending", mine["items"][0]["status"])
    check("преди webhook: НЕ е поддръжник", mine["profile"]["isSupporter"] is False)

    print("\n=== 2. Заявка БЕЗ подпис → трябва да се отхвърли ===")
    status, res = call("POST", "/api/donations/webhook", {"id": "evt_fake", "type": "checkout.session.completed"})
    check("без подпис → 400 (не 200)", status == 400, f"HTTP {status}")
    check("endpoint-ът вече не връща 503", status != 503, f"HTTP {status}")

    print("\n=== 3. Заявка с ГРЕШЕН подпис → трябва да се отхвърли ===")
    payload = json.dumps({"id": "evt_fake", "type": "checkout.session.completed"}, separators=(",", ":"))
    bad = stripe_signature(payload, "whsec_0000000000000000000000000000")
    status, res = call(
        "POST",
        "/api/donations/webhook",
        {"id": "evt_fake", "type": "checkout.session.completed"},
        headers={"Stripe-Signature": bad},
    )
    check("грешен подпис → 400", status == 400, f"HTTP {status}")

    print("\n=== 4. ИСТИНСКО събитие checkout.session.completed (валиден подпис) ===")
    event = {
        "id": f"evt_test_{random.randint(10**9, 10**10)}",
        "object": "event",
        "api_version": "2024-04-10",
        "created": int(time.time()),
        "livemode": True,
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": session_id,
                "object": "checkout.session",
                "payment_status": "paid",
                "status": "complete",
                "payment_intent": f"pi_test_{random.randint(10**9, 10**10)}",
                "subscription": None,
                "amount_total": 200,
                "currency": "eur",
            }
        },
    }
    status, res = send_event(event, SECRET)
    check("webhook приет -> 200", status == 200, f"HTTP {status} {res if status != 200 else ''}")
    check("отговорът е {received: true}", res.get("received") is True, str(res))

    print("\n=== 5. Дарението трябва да е станало 'succeeded' ===")
    status, mine = call("GET", "/api/donations/mine", token=token)
    item = mine["items"][0]
    check("статус 'succeeded'", item["status"] == "succeeded", item["status"])
    check("профилът СТАНА поддръжник", mine["profile"]["isSupporter"] is True)
    check("дарената сума е 2 €", mine["profile"]["totalDonatedBgn"] == 2, str(mine["profile"]["totalDonatedBgn"]))
    check("има отключена значка", len(mine["profile"]["badges"]) >= 1, str(len(mine["profile"]["badges"])))
    if mine["profile"]["badges"]:
        print(f"        значка: {mine['profile']['badges'][0].get('title')}")

    print("\n=== 6. Повторно събитие (idempotency) — не бива да удвоява ===")
    status, res = send_event(event, SECRET)
    check("повторно събитие -> 200", status == 200, f"HTTP {status}")
    status, mine2 = call("GET", "/api/donations/mine", token=token)
    check(
        "сумата НЕ се удвои",
        mine2["profile"]["totalDonatedBgn"] == 2,
        str(mine2["profile"]["totalDonatedBgn"]),
    )
    check("броят дарения не се удвои", len(mine2["items"]) == 1, str(len(mine2["items"])))

    print("\n=== 7. Старо събитие (replay защита по timestamp) ===")
    old_ts = int(time.time()) - 3600  # преди 1 час — извън толеранса
    status, res = send_event(event, SECRET, timestamp=old_ts)
    check("старо събитие (>5 мин) → 400", status == 400, f"HTTP {status}")

    print("\n=== РЕЗУЛТАТ ===")
    total = len(passed) + len(failed)
    print(f"  минали: {len(passed)}/{total}")
    if failed:
        print("  ПРОВАЛЕНИ:")
        for f in failed:
            print(f"    - {f}")
        return 1
    print("  всички проверки минаха")
    print("\n  Това е пълният път на webhook-а: подпис → проверка → markSucceeded →")
    print("  тригер вдига is_supporter → значка. Без реални пари.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
