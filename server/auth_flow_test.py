#!/usr/bin/env python3
"""
Тест на целия поток: регистрация с код от имейл, потвърждение, вход,
забравена парола, смяна на парола, ограничения.

Употреба:
  python auth_flow_test.py <base_url> [--expect-dev-codes]

С --expect-dev-codes очаква сървърът да връща кода (dev режим), за да може
потокът да се провери без достъп до пощата. Без флага проверява, че кодът
НЕ се връща (както трябва да е в продукция).
"""
import json
import random
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4001"
EXPECT_DEV = "--expect-dev-codes" in sys.argv

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

passed, failed = [], []


def check(label, condition, detail=""):
    (passed if condition else failed).append(label)
    print(f"  [{'OK  ' if condition else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


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


def section(title):
    print(f"\n=== {title} ===")


def main():
    print(f"Сървър: {BASE}")
    print(f"Режим:  {'DEV (очаквам код в отговора)' if EXPECT_DEV else 'PROD (кодът НЕ трябва да се връща)'}\n")

    email = f"flow.{random.randint(100000, 999999)}@smartprice.test"
    password = "Parola123"
    new_password = "NovaParola456"

    section("1. Регистрация")
    status, reg = call(
        "POST",
        "/api/auth/register",
        {
            "email": email,
            "password": password,
            "name": "Флоу Тестов",
            "city": "Пловдив",
            "phone": "088" + str(random.randint(1000000, 9999999)),
        },
    )
    check("регистрация → 201", status == 201, f"HTTP {status} {reg if status != 201 else ''}")
    if status != 201:
        return 1
    check("иска потвърждение", reg.get("requiresVerification") is True)
    check("НЕ връща токени преди потвърждение", "accessToken" not in reg)
    check("казва, че имейлът е изпратен", reg.get("emailSent") is True, str(reg.get("emailSent")))

    dev_code = reg.get("devCode")
    if EXPECT_DEV:
        check("кодът е върнат (dev режим)", isinstance(dev_code, str) and len(dev_code) == 6, str(dev_code))
        if not dev_code:
            print("  Без код не мога да продължа в dev режим.")
            return 1
    else:
        check("кодът НЕ се връща (продукция)", dev_code is None, str(dev_code))

    section("2. Вход преди потвърждение → отказ")
    status, res = call("POST", "/api/auth/login", {"email": email, "password": password})
    check("вход → 403", status == 403, f"HTTP {status}")
    check(
        "кодът на грешката е email_not_verified",
        res.get("error", {}).get("code") == "email_not_verified",
        str(res.get("error", {}).get("code")),
    )
    check("връща имейла, за да заведе на екрана с кода", res.get("error", {}).get("details", {}).get("email") == email)

    if not EXPECT_DEV:
        section("3. Проверки, които не искат код")
        status, res = call("POST", "/api/auth/verify-email", {"email": email, "code": "000000"})
        check("грешен код → 400", status == 400, f"HTTP {status}")
        status, res = call("POST", "/api/auth/forgot-password", {"email": email})
        check("забравена парола → 200", status == 200, f"HTTP {status}")
        check("кодът НЕ се връща и тук", res.get("devCode") is None)
        status, res = call("POST", "/api/auth/forgot-password", {"email": "nesushtestvuvasht@smartprice.test"})
        check("непознат имейл → същият отговор (без изтичане)", status == 200, f"HTTP {status}")
        print("\n=== РЕЗУЛТАТ ===")
        print(f"  минали: {len(passed)}/{len(passed) + len(failed)}")
        if failed:
            print("  ПРОВАЛЕНИ:")
            for f in failed:
                print(f"    - {f}")
            return 1
        print("  всички проверки минаха")
        return 0

    section("3. Потвърждение с ГРЕШЕН код")
    wrong = "000000" if dev_code != "000000" else "111111"
    status, res = call("POST", "/api/auth/verify-email", {"email": email, "code": wrong})
    check("грешен код → 400", status == 400, f"HTTP {status}")
    check("казва колко опита остават", "опит" in json.dumps(res, ensure_ascii=False))

    section("4. Потвърждение с ПРАВИЛНИЯ код")
    status, ver = call("POST", "/api/auth/verify-email", {"email": email, "code": dev_code})
    check("потвърждение → 200", status == 200, f"HTTP {status} {ver if status != 200 else ''}")
    check("връща токени", bool(ver.get("accessToken")), "има accessToken" if ver.get("accessToken") else "няма")
    check("профилът е върнат", bool(ver.get("profile")))
    token = ver.get("accessToken")

    section("5. Повторно използване на същия код")
    status, res = call("POST", "/api/auth/verify-email", {"email": email, "code": dev_code})
    check("кодът вече не работи → 400", status == 400, f"HTTP {status}")

    section("6. Вход след потвърждение")
    status, login = call("POST", "/api/auth/login", {"email": email, "password": password})
    check("вход → 200", status == 200, f"HTTP {status}")
    check("връща токени", bool(login.get("accessToken")))

    section("7. Забравена парола")
    status, forgot = call("POST", "/api/auth/forgot-password", {"email": email})
    check("заявка → 200", status == 200, f"HTTP {status}")
    reset_code = forgot.get("devCode")
    check("кодът е върнат (dev режим)", isinstance(reset_code, str) and len(reset_code) == 6, str(reset_code))

    status, unknown = call("POST", "/api/auth/forgot-password", {"email": "nyama.takuv@smartprice.test"})
    check("непознат имейл → същият отговор (без изтичане)", status == 200, f"HTTP {status}")
    check("за непознат имейл НЕ се дава код", unknown.get("devCode") is None)

    section("8. Смяна на паролата")
    status, res = call(
        "POST", "/api/auth/reset-password", {"email": email, "code": "000000", "newPassword": new_password}
    )
    check("грешен код → 400", status == 400, f"HTTP {status}")

    status, reset = call(
        "POST", "/api/auth/reset-password", {"email": email, "code": reset_code, "newPassword": new_password}
    )
    check("правилен код → 200", status == 200, f"HTTP {status} {reset if status != 200 else ''}")
    check("влиза директно с новата парола", bool(reset.get("accessToken")))

    section("9. Вход с новата и със старата парола")
    status, _ = call("POST", "/api/auth/login", {"email": email, "password": new_password})
    check("новата парола работи → 200", status == 200, f"HTTP {status}")
    status, _ = call("POST", "/api/auth/login", {"email": email, "password": password})
    check("старата парола вече не работи → 401", status == 401, f"HTTP {status}")

    section("10. Повторно изпращане на код")
    status, resend = call("POST", "/api/auth/resend-code", {"email": email, "purpose": "email_verify"})
    check("преизпращане → 200", status == 200, f"HTTP {status}")
    check("казва, че вече е потвърден", resend.get("alreadyVerified") is True, str(resend))

    section("11. Слаба парола се отхвърля")
    status, _ = call(
        "POST",
        "/api/auth/register",
        {
            "email": f"weak.{random.randint(1, 99999)}@smartprice.test",
            "password": "kratka",
            "name": "Слаб Тестов",
            "phone": "087" + str(random.randint(1000000, 9999999)),
        },
    )
    check("къса парола → 400", status == 400, f"HTTP {status}")

    section("12. Ограничение за честота на кодовете")
    fresh = f"rate.{random.randint(100000, 999999)}@smartprice.test"
    call(
        "POST",
        "/api/auth/register",
        {
            "email": fresh,
            "password": password,
            "name": "Рейт Тестов",
            "phone": "089" + str(random.randint(1000000, 9999999)),
        },
    )
    codes_sent, got_429 = 0, False
    for _ in range(8):
        status, res = call("POST", "/api/auth/resend-code", {"email": fresh, "purpose": "email_verify"})
        if status == 429:
            got_429 = True
            break
        if status == 200:
            codes_sent += 1
    check("след няколко кода идва 429", got_429, f"изпратени {codes_sent}, 429: {got_429}")

    section("13. Потвърденият профил има достъп")
    status, me = call("GET", "/api/auth/me", token=token)
    check("GET /api/auth/me → 200", status == 200, f"HTTP {status}")

    print("\n=== РЕЗУЛТАТ ===")
    total = len(passed) + len(failed)
    print(f"  минали: {len(passed)}/{total}")
    if failed:
        print("  ПРОВАЛЕНИ:")
        for f in failed:
            print(f"    - {f}")
        return 1
    print("  всички проверки минаха")
    return 0


if __name__ == "__main__":
    sys.exit(main())
