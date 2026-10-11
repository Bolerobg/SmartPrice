#!/usr/bin/env python3
"""
Слива Pull Request #1 (feat/real-backend -> main) в Bolerobg/SmartPrice.
Токенът идва от $GITHUB_TOKEN.
"""
import json
import os
import sys
import urllib.error
import urllib.request

TOKEN = os.environ.get("GITHUB_TOKEN", "")
REPO = "Bolerobg/SmartPrice"
PR = 1

COMMIT_TITLE = "Merge PR #1: реален backend (PostgreSQL + Fastify API) вместо демо симулации"

COMMIT_MESSAGE = """SmartPrice става реален продукт.

Запазени са дизайнът и структурата на приложението; сменен е източникът на данни.

- Собствен PostgreSQL 16 + Fastify/TypeScript API (server/), миграции при старт
- Реална автентикация (bcrypt + JWT), реален OCR (OpenRouter vision)
- Реален Stripe Checkout + webhook като източник на истина
- Махнати всички симулации и фалшиви твърдения
- Валута: BGN -> EUR (Stripe вече не приема BGN)
- Тестове: smoke 89/89, OCR 8/8, плащания 25/25, webhook 17/17
"""


def api(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}{path}", data=data, method=method
    )
    req.add_header("Authorization", f"token {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return exc.code, {"raw": raw}


def main():
    if not TOKEN:
        print("Липсва GITHUB_TOKEN.")
        return 1

    # 1. Състояние преди сливането
    status, pr = api("GET", f"/pulls/{PR}")
    if status != 200:
        print(f"Не намирам PR #{PR}: {status} {pr.get('message')}")
        return 1

    print("=== ПРЕДИ сливането ===")
    print(f"  заглавие:   {pr['title']}")
    print(f"  {pr['head']['ref']} -> {pr['base']['ref']}")
    print(f"  състояние:  {pr['state']} | mergeable: {pr.get('mergeable')}")
    print(f"  промени:    {pr['changed_files']} файла, +{pr['additions']} -{pr['deletions']}")
    print(f"  main @ {pr['base']['sha'][:7]}")

    if pr["state"] != "open":
        print(f"\nPR-ът не е отворен (състояние: {pr['state']}). Няма какво да се слива.")
        return 0

    if pr.get("mergeable") is False:
        print(f"\nGitHub казва, че има конфликт: {pr.get('mergeable_state')}")
        return 1

    # 2. Сливане
    print("\n=== СЛИВАНЕ ===")
    status, res = api(
        "PUT",
        f"/pulls/{PR}/merge",
        {"commit_title": COMMIT_TITLE, "commit_message": COMMIT_MESSAGE, "merge_method": "merge"},
    )
    if status not in (200, 201):
        print(f"  Грешка {status}: {res.get('message')}")
        return 1
    print(f"  {res.get('message')}")
    print(f"  merge commit: {res.get('sha', '')[:12]}")

    # 3. Проверка след сливането
    print("\n=== СЛЕД сливането (проверка) ===")
    status, pr2 = api("GET", f"/pulls/{PR}")
    print(f"  състояние:  {pr2['state']} | merged: {pr2.get('merged')}")
    print(f"  слят в:     {pr2.get('merge_commit_sha', '')[:12]}")

    status, branch = api("GET", "/branches/main")
    if status == 200:
        head = branch["commit"]
        print(f"  main сега:  {head['sha'][:12]}")
        print(f"  съобщение:  {head['commit']['message'].splitlines()[0][:90]}")
        print(f"  автор:      {head['commit']['author']['name']}")

    status, cmp = api("GET", f"/compare/{pr['base']['sha']}...main")
    if status == 200:
        print(f"  напред с:   {cmp.get('ahead_by')} комита, {cmp.get('total_commits')} общо")

    return 0


if __name__ == "__main__":
    sys.exit(main())
