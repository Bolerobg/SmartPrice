#!/usr/bin/env python3
"""
Общи помощни функции за тестовете на SmartPrice.

Защо съществува: след като регистрацията започна да иска потвърждение по имейл,
всеки тест трябва да мине през: регистрация → код → потвърждение → токен.
Тук е на едно място, за да не се повтаря.
"""
from __future__ import annotations

import json
import os
import random
import subprocess
import urllib.error
import urllib.request

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Cloudflare блокира „Python-urllib“ като бот → представяме се като браузър
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def api(base: str, method: str, path: str, body=None, token: str | None = None):
    """Една HTTP заявка към API-то. Връща (статус, разчетено тяло)."""
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
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


def mark_verified_in_db(email: str) -> None:
    """
    ТЕСТОВО удобство: отбелязва имейла като потвърден директно в базата.

    Нужно е срещу продукцията — там кодът е само в пощата и тестът не може да
    го прочете. НЕ е продуктова логика.
    """
    subprocess.run(
        [
            "docker", "compose", "exec", "-T", "db",
            "psql", "-U", "smartprice", "-d", "smartprice", "-c",
            f"update profiles set email_verified_at = now() where email = '{email}'",
        ],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
    )


def register_and_login(
    base: str, email: str, password: str, name: str, city: str = "София"
):
    """
    Регистрира и потвърждава профил, връщайки токен.

    Връща (статус_на_крайната_стъпка, тяло, токен_или_None).
    """
    status, reg = api(
        base,
        "POST",
        "/api/auth/register",
        {
            "email": email,
            "password": password,
            "name": name,
            "city": city,
            # Телефонът е задължителен и уникален (един човек = един акаунт).
            "phone": "088" + str(random.randint(1000000, 9999999)),
        },
    )
    if status != 201:
        return status, reg, None

    code = reg.get("devCode")
    if code:
        # Dev режим: кодът идва в отговора
        status, ver = api(base, "POST", "/api/auth/verify-email", {"email": email, "code": code})
    else:
        # Продукция: отбелязваме потвърждението в базата и влизаме
        mark_verified_in_db(email)
        status, ver = api(base, "POST", "/api/auth/login", {"email": email, "password": password})

    return status, ver, ver.get("accessToken")
