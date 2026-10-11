#!/usr/bin/env python3
"""
Създава Pull Request от feat/real-backend към main в Bolerobg/SmartPrice.
Токенът идва от $GITHUB_TOKEN.
"""
import json
import os
import sys
import urllib.error
import urllib.request

TOKEN = os.environ.get("GITHUB_TOKEN", "")
REPO = "Bolerobg/SmartPrice"
HEAD = "feat/real-backend"
BASE = "main"

TITLE = "feat: реален backend (PostgreSQL + Fastify API) вместо демо симулации"

BODY = """## Какво прави този PR

Превръща SmartPrice от добре изгледана **демонстрация** в **реален продукт**.
Дизайнът и структурата на приложението са запазени — сменен е източникът на данни.

### Нов backend (`server/`)
- Собствен **PostgreSQL 16** + **Fastify/TypeScript** API, миграции при старт
- Схема: `profiles`, `posts`, `receipts`, `receipt_items`, `post_reactions`,
  `post_helped_marks`, `post_bookmarks`, `comments`, `comment_likes`,
  `price_history`, `price_alerts`, `donations`, `badges`, `profile_badges`,
  `content_reports`, `uploads` + изгледи `v_posts_full`, `v_leaderboard`
- Цялостност в базата: CHECK ограничения, външни ключове, тригери за броячите
  и за статуса на дарител (само при **преход** към `succeeded`)
- Auth: **bcrypt + JWT** (access + refresh), транслитерация кирилица → латиница
  за `@handle`
- Реален **OCR** през OpenRouter vision (връща 503 без ключ, без фалшиви бележки)
- Реален **Stripe Checkout** + webhook като източник на истина

### Приложение
- `AppContext` вече работи върху API-то (същият интерфейс за екраните)
- Нови auth екрани (вход/регистрация) и типизиран API клиент с авто-refresh
- Махнати: `supabase/`, `mockData.ts`, `stripeDonations.ts`

### Махната нечестност
| Преди | Сега |
|---|---|
| `success: true` + измислен `pi_stripe_XXXX` | реален Stripe Checkout + webhook |
| Твърдо зададени бележки с фалшиви ЕИК-та | реален vision модел |
| Измислени цени на Lidl/Kaufland/Billa | реални данни от общността |
| „Обичайна цена: зехтин 24 лв., нощувка 120 лв." | честно „нямаме данни" |
| `total × 1.65` като референтна цена | само потребителят я въвежда |
| „100% Проверени ревюта" | „0 платени ревюта" |
| „Събрани 580 от 800 лв." | реално събраното от базата |
| Измислени GPS координати и магазини | само реални |
| Демо данни, обвиняващи реални обекти | измислени имена + таг `#Демо` |

### Поправени бъгове
- Категория „Други" беше позволена в UI, забранена в базата → insert винаги падаше
- Мерната единица беше винаги `'g'` (и за течности) → реален избор г/кг/мл/л/бр.
- `personal_saved_bgn` се вдигаше с измислени 25 лв. → реална разлика, с отмяна
- Тригерът за дарения броеше сумата два пъти при update
- 500 вместо 415 при невалиден Content-Type
- Броячите в Радар не се показваха (грешен регистър на ключовете)
- Странични ефекти в React state updater-и

### Валута
Stripe вече **не приема BGN** („Use eur instead") → цялото приложение мина на **евро**.
Съществуващите суми са конвертирани по фиксирания курс 1 € = 1.95583 лв.
(миграции `002_currency_eur.sql`, `003_demo_titles_eur.sql`).

### Тестове (всичките минават)
| Тест | Резултат |
|---|---|
| `server/smoke_test.py` | **89/89** |
| `server/ocr_e2e_test.py` (реален OCR) | **8/8** |
| `server/payment_e2e_test.py` (реален Stripe) | **25/25** |
| `server/webhook_e2e_test.py` (подписан webhook) | **17/17** |
| `tsc --noEmit` (app + server) | **0 грешки** |

### Публикувано
Живее на **https://smart.lookthis.online** (nginx + отделен Cloudflare тунел).

### Какво НЕ е в този PR
- Няма `.env` и ключове (те са в `.gitignore`)
- Няма промени в `main` — това е отделен клон
"""


def main():
    if not TOKEN:
        print("Липсва GITHUB_TOKEN.")
        return 1

    payload = json.dumps(
        {"title": TITLE, "head": HEAD, "base": BASE, "body": BODY, "draft": False}
    ).encode("utf-8")

    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/pulls", data=payload, method="POST"
    )
    req.add_header("Authorization", f"token {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(f"PR създаден: #{data['number']}")
            print(f"Заглавие:    {data['title']}")
            print(f"URL:         {data['html_url']}")
            print(f"Промени:     {data['changed_files']} файла, +{data['additions']} -{data['deletions']}")
            print(f"Състояние:   {data['state']} (mergeable: {data.get('mergeable')})")
            return 0
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        print(f"Грешка {exc.code}:")
        try:
            err = json.loads(body)
            print(" ", err.get("message"))
            for e in err.get("errors", []):
                print("  -", e)
        except json.JSONDecodeError:
            print(" ", body[:400])
        return 1


if __name__ == "__main__":
    sys.exit(main())
