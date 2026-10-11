#!/usr/bin/env python3
"""
Реален smoke тест на SmartPrice API-то.
Не измисля резултати: прави истински HTTP заявки и отпечатва какво е върнал сървърът.
Употреба: python smoke_test.py [base_url]
"""
from __future__ import annotations

import json
import random
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4000"

passed: list[str] = []
failed: list[str] = []


def call(method: str, path: str, body: dict | None = None, token: str | None = None):
    """Връща (status, parsed_json_or_text)."""
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    # Cloudflare блокира стандартния Python-urllib като бот (403).
    # Реалните клиенти (браузър, мобилно приложение) изпращат истински заглавки,
    # затова тестът трябва да ги emulate-ва, за да тества реалния път.
    req.add_header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    )
    req.add_header("Accept", "application/json, text/plain, */*")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        status = e.code
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError:
        return status, raw


def check(name: str, condition: bool, detail: str = "") -> None:
    (passed if condition else failed).append(name)
    mark = "OK  " if condition else "FAIL"
    print(f"  [{mark}] {name}" + (f" — {detail}" if detail else ""))


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def main() -> int:
    email = f"smoke.{random.randint(10000, 99999)}@smartprice.test"
    password = "TestParola123"
    name = "Смоук Тестов"
    city = "София"

    section("1. Здраве и функции")
    status, health = call("GET", "/api/health")
    check("GET /api/health → 200", status == 200, f"HTTP {status}")
    check("базата отговаря", health.get("database") is True)
    status, feats = call("GET", "/api/health/features")
    check("GET /api/health/features → 200", status == 200, f"HTTP {status}")
    print(f"        OCR: {feats.get('ocr')} | плащания: {feats.get('payments')}")

    section("2. Регистрация")
    status, reg = call(
        "POST",
        "/api/auth/register",
        {"email": email, "password": password, "name": name, "city": city},
    )
    check("регистрация → 201", status == 201, f"HTTP {status} {reg if status != 201 else ''}")
    token = reg.get("accessToken") if isinstance(reg, dict) else None
    check("върнат accessToken", bool(token))
    profile = reg.get("profile", {}) if isinstance(reg, dict) else {}
    check("името е запазено като UTF-8", profile.get("name") == name, repr(profile.get("name")))
    handle = profile.get("handle", "")
    check("handle е само латиница", bool(handle) and handle.isascii(), handle)
    check(
        "handle е транслитериран от името",
        handle.startswith("@smouk") or handle.startswith("@smouk_testov"),
        handle,
    )
    check("имейлът е върнат", profile.get("email") == email)
    check("нов профил не е поддръжник", profile.get("isSupporter") is False)
    check("има начални значки", len(profile.get("badges", [])) >= 4, str(len(profile.get("badges", []))))

    section("3. Защита на входа")
    status, _ = call("POST", "/api/auth/register", {"email": email, "password": password, "name": name})
    check("дубликат на имейл → 409", status == 409, f"HTTP {status}")
    status, _ = call("POST", "/api/auth/login", {"email": email, "password": "greshna123"})
    check("грешна парола → 401", status == 401, f"HTTP {status}")
    status, _ = call("GET", "/api/auth/me")
    check("без токен → 401", status == 401, f"HTTP {status}")
    status, _ = call("POST", "/api/auth/register", {"email": "bad", "password": "123", "name": "x"})
    check("невалидни данни → 422", status == 422, f"HTTP {status}")
    status, _ = call("POST", "/api/auth/register", {"email": f"weak{random.randint(1,999)}@t.bg", "password": "kratka", "name": "Тест Тестов"})
    check("слаба парола → 400", status == 400, f"HTTP {status}")

    section("4. Вход и профил")
    status, login = call("POST", "/api/auth/login", {"email": email, "password": password})
    check("вход → 200", status == 200, f"HTTP {status}")
    token = login.get("accessToken")
    check("нов accessToken", bool(token))
    status, me = call("GET", "/api/auth/me", token=token)
    check("GET /api/auth/me → 200", status == 200, f"HTTP {status}")
    check("профилът съвпада", me["profile"]["email"] == email)

    section("5. Лента и търсене")
    status, feed = call("GET", "/api/posts?limit=5")
    check("GET /api/posts → 200", status == 200, f"HTTP {status}")
    check("има демо публикации", feed["total"] >= 6, f"total={feed['total']}")
    first = feed["items"][0]
    check("постът има автор", bool(first["author"]["name"]))
    check("постът има реакции", isinstance(first["reactions"], dict))
    check(
        "датата е ISO формат",
        "T" in first["createdAt"] and first["createdAt"].endswith("Z"),
        first["createdAt"],
    )
    demo = [p for p in feed["items"] if "#Демо" in p["tags"]]
    check("демо постовете са маркирани с #Демо", len(demo) > 0, f"{len(demo)} маркирани")
    status, search = call("GET", "/api/posts?q=%D1%88%D1%80%D0%B8%D0%BD%D0%BA%D1%84%D0%BB%D0%B0%D1%86%D0%B8%D1%8F")
    check("търсене на кирилица работи", search["total"] >= 1, f"намерени {search['total']}")
    status, reds = call("GET", "/api/posts?polarity=red")
    check("филтър по полярност работи", all(p["polarity"] == "red" for p in reds["items"]))
    status, sorted_low = call("GET", "/api/posts?sort=lowest_price&limit=10")
    prices = [p["pricePaid"] for p in sorted_low["items"]]
    check("сортиране по цена работи", prices == sorted(prices), str(prices[:5]))

    section("6. Създаване на пост (категория „other“)")
    status, created = call(
        "POST",
        "/api/posts",
        {
            "polarity": "green",
            "category": "other",
            "customCategoryLabel": "Аптека",
            "platformTag": "На място",
            "title": "Смоук тест: витамин C 1000 мг за 6.90 лв.",
            "description": "Тестово създаване през API с кирилица.",
            "placeName": "Аптека „Здраве“",
            "city": "София",
            "pricePaid": 6.9,
            "referencePrice": 12.5,
            "unitQuantity": 60,
            "unitType": "pcs",
            "imageUrl": "https://example.com/x.jpg",
            "tags": ["#Тест"],
        },
        token=token,
    )
    check("създаване → 201", status == 201, f"HTTP {status} {created if status != 201 else ''}")
    post = created.get("post", {})
    post_id = post.get("id")
    check("кирилицата в заглавието е запазена", "витамин" in post.get("title", ""), post.get("title", ""))
    check("категория other е приета", post.get("category") == "other")
    # 60 бр. за 6.90 лв. → 0.115 лв. за брой (математиката е вярна)
    check(
        "цената за брой е сметната (6.90/60)",
        post.get("pricePerKgOrLiter") == 0.115,
        str(post.get("pricePerKgOrLiter")),
    )
    check("историята на цените стартира", len(post.get("priceHistory", [])) == 1)
    check("точките доверие са вдигнати", created["profile"]["reputationPoints"] > 50, str(created["profile"]["reputationPoints"]))

    section("7. Реакции")
    status, r = call("POST", f"/api/posts/{post_id}/reactions", {"reactionKey": "topDeal"}, token=token)
    check("важна реакция → 200", status == 200, f"HTTP {status}")
    check("реакцията е отчетена", r["post"]["reactions"]["topDeal"] == 1, str(r["post"]["reactions"]))
    check("моята реакция е запомнена", r["post"]["userReaction"] == "topDeal")
    status, r2 = call("POST", f"/api/posts/{post_id}/reactions", {"reactionKey": "topDeal"}, token=token)
    check("повторно натискане отменя", r2["post"]["reactions"]["topDeal"] == 0, str(r2["post"]["reactions"]))
    status, _ = call("POST", f"/api/posts/{post_id}/reactions", {"reactionKey": "pureRobbery"}, token=token)
    check("невалидна реакция за зелен пост → 400", status == 400, f"HTTP {status}")

    section("8. „Спести ми пари“ (реална сума)")
    status, h = call("POST", f"/api/posts/{post_id}/helped", token=token)
    check("маркиране → 200", status == 200, f"HTTP {status}")
    check("спестената сума е 12.50-6.90=5.60", h["savedAmount"] == 5.6, str(h["savedAmount"]))
    check("личните спестени са обновени", h["profile"]["personalSavedBgn"] == 5.6, str(h["profile"]["personalSavedBgn"]))
    check("броячът на поста е 1", h["post"]["helpedCount"] == 1, str(h["post"]["helpedCount"]))
    status, h2 = call("POST", f"/api/posts/{post_id}/helped", token=token)
    check("отмяната връща сумата", h2["profile"]["personalSavedBgn"] == 0, str(h2["profile"]["personalSavedBgn"]))
    check("броячът се нулира", h2["post"]["helpedCount"] == 0, str(h2["post"]["helpedCount"]))

    section("9. Коментари")
    status, c = call("POST", f"/api/posts/{post_id}/comments", {"text": "Тестов коментар", "reportedPrice": 7.5}, token=token)
    check("коментар → 201", status == 201, f"HTTP {status}")
    check("текстът е запазен", c["comment"]["text"] == "Тестов коментар")
    check("цената е запазена", c["comment"]["reportedPrice"] == 7.5)
    comment_id = c["comment"]["id"]
    status, like = call("POST", f"/api/comments/{comment_id}/like", token=token)
    check("харесване на коментар", like["liked"] is True and like["comment"]["likes"] == 1, str(like["comment"]["likes"]))
    status, lst = call("GET", f"/api/posts/{post_id}/comments")
    check("списъкът с коментари работи", len(lst["items"]) == 1, str(len(lst["items"])))

    section("10. Актуалност и история на цената")
    status, conf = call("POST", f"/api/posts/{post_id}/confirm", token=token)
    check("потвърждаване → 200", status == 200, f"HTTP {status}")
    check("броят потвърждения е 1", conf["post"]["verifiedValidTodayCount"] == 1, str(conf["post"]["verifiedValidTodayCount"]))
    check("добавен е запис в историята", len(conf["post"]["priceHistory"]) == 2)
    status, upd = call("POST", f"/api/posts/{post_id}/price", {"price": 8.2}, token=token)
    check("промяна на цената → 200", status == 200, f"HTTP {status}")
    check("новата цена е 8.20", upd["post"]["pricePaid"] == 8.2, str(upd["post"]["pricePaid"]))
    statuses = [x["status"] for x in upd["post"]["priceHistory"]]
    check("историята пази initial→confirmed→changed", statuses == ["initial", "confirmed", "changed"], str(statuses))

    section("11. Отметки")
    status, bm = call("POST", f"/api/posts/{post_id}/bookmark", token=token)
    check("отметка → true", bm["isBookmarked"] is True)
    status, marks = call("GET", "/api/posts/bookmarks", token=token)
    check("списъкът със запазени работи", marks["total"] == 1, str(marks["total"]))

    section("12. Ценови аларми")
    status, alert = call(
        "POST", "/api/alerts",
        {"keyword": "витамин", "maxPrice": 10, "city": "София", "polarity": "green"},
        token=token,
    )
    check("създаване на аларма → 201", status == 201, f"HTTP {status}")
    status, alerts = call("GET", "/api/alerts", token=token)
    check("списък с аларми → 200", status == 200, f"HTTP {status}")
    if status == 200:
        check("алармата е намерена", len(alerts["items"]) == 1, str(len(alerts["items"])))
        check("алармата има съвпадения", len(alerts["items"][0]["matches"]) >= 1, str(alerts["items"][0]["matches"]))
        alert_id = alerts["items"][0]["id"]
        status, off = call("PATCH", f"/api/alerts/{alert_id}", {"isActive": False}, token=token)
        check("изключване на аларма", status == 200, f"HTTP {status}")
        status, dele = call("DELETE", f"/api/alerts/{alert_id}", token=token)
        check("изтриване на аларма", status == 200, f"HTTP {status}")
    status, _ = call("POST", "/api/alerts", {"keyword": "x"}, token=token)
    check("твърде кратка дума → 422", status == 422, f"HTTP {status}")

    section("13. Общност (реални агрегати)")
    status, stats = call("GET", "/api/community/stats")
    check("статистики → 200", status == 200, f"HTTP {status}")
    check("броят постове е реален", stats["totalPosts"] >= 7, str(stats["totalPosts"]))
    check("green+red = всички", stats["greenPosts"] + stats["redPosts"] == stats["totalPosts"])
    check("потребителите са реални", stats["contributors"] >= 4, str(stats["contributors"]))
    check("събрани средства не са измислени", stats["raisedThisMonthBgn"] == 0, str(stats["raisedThisMonthBgn"]))
    status, board = call("GET", "/api/community/leaderboard")
    check("класация → 200", status == 200, f"HTTP {status}")
    check("в класацията има само хора с постове", len(board["items"]) >= 3, str(len(board["items"])))
    ranks = [u["rank"] for u in board["items"]]
    check("ранговете са последователни", ranks == list(range(1, len(ranks) + 1)), str(ranks))

    section("14. Честни грешки при липсваща конфигурация")
    # Тези проверки зависят от това дали ключовете са налични. Ако са налични,
    # проверяваме че пътят е РЕАЛЕН (а не че връща 503).
    features = call("GET", "/api/health/features")[1]
    print(f"        OCR: {features.get('ocr')} | плащания: {features.get('payments')}")

    # Проверяваме ПРЕДИ да създадем каквото и да е дарение по-долу.
    status, mine = call("GET", "/api/donations/mine", token=token)
    check("моите дарения са празни", mine["items"] == [])

    status, ocr = call("POST", "/api/ocr/receipt", {"imageUrl": "https://example.com/x.jpg"}, token=token)
    if features.get("ocr"):
        # Реален OCR: чужд URL се отхвърля (не се тегли отвън), без фалшива бележка
        check("OCR е включен → чужд URL се отхвърля (не 200)", status != 200, f"HTTP {status}")
    else:
        check("OCR без ключ → 503 (не фалшива бележка)", status == 503, f"HTTP {status}")
        check("съобщението казва какво липсва", "OPENROUTER_API_KEY" in json.dumps(ocr, ensure_ascii=False))

    status, pay = call("POST", "/api/donations/checkout", {"amount": 10, "tierId": "guardian"}, token=token)
    if features.get("payments"):
        # Реален Stripe: създава се истинска Checkout сесия
        check("плащанията са включени → създадена сесия", status == 201, f"HTTP {status}")
        check(
            "върнат е истински Stripe URL",
            json.loads(json.dumps(pay)).get("checkoutUrl", "").startswith("https://checkout.stripe.com/"),
        )
    else:
        check("плащане без Stripe → 503 (не фалшив успех)", status == 503, f"HTTP {status}")
        check("съобщението казва какво липсва", "STRIPE_SECRET_KEY" in json.dumps(pay, ensure_ascii=False))

    status, cfg = call("GET", "/api/donations/config")
    check("конфигурацията на даренията е честна", cfg["enabled"] is features.get("payments"))

    section("15. Права и 404")
    status, _ = call("GET", "/api/posts/00000000-0000-0000-0000-000000000000")
    check("несъществуващ пост → 404", status == 404, f"HTTP {status}")
    status, _ = call("PATCH", f"/api/posts/{post_id}", {"title": "Хакната"}, token=None)
    check("редакция без токен → 401", status == 401, f"HTTP {status}")
    status, other = call(
        "POST", "/api/auth/register",
        {"email": f"other.{random.randint(1000,9999)}@smartprice.test", "password": password, "name": "Друг Тестов"},
    )
    other_token = other["accessToken"]
    status, _ = call("PATCH", f"/api/posts/{post_id}", {"title": "Хакната от друг"}, token=other_token)
    check("редакция от чужд профил → 403", status == 403, f"HTTP {status}")
    status, _ = call("DELETE", f"/api/posts/{post_id}", token=other_token)
    check("изтриване от чужд профил → 403", status == 403, f"HTTP {status}")

    section("16. Сигнал за проблемно съдържание")
    status, rep = call("POST", f"/api/posts/{post_id}/report", {"reason": "false_info", "details": "Тестов сигнал"}, token=other_token)
    check("сигнал → 200", status == 200, f"HTTP {status}")
    status, _ = call("POST", f"/api/posts/{post_id}/report", {"reason": "false_info"}, token=other_token)
    check("повторен сигнал → 400", status == 400, f"HTTP {status}")

    section("17. Напомняне за дарение (сървърна логика)")
    prompts = 0
    for _ in range(4):
        status, nudge = call("POST", "/api/me/interaction", {"reasonHint": "тест"}, token=token)
        if nudge.get("shouldPrompt"):
            prompts += 1
    check("напомнянето се задейства след 3 действия", prompts == 1, f"задействано {prompts} път(и)")
    status, sn = call("POST", "/api/me/snooze", token=token)
    check("отлагане работи", sn["ok"] is True)

    section("18. Изтриване на собствен пост")
    status, d = call("DELETE", f"/api/posts/{post_id}", token=token)
    check("изтриване → 200", status == 200, f"HTTP {status}")
    status, _ = call("GET", f"/api/posts/{post_id}")
    check("изтритият пост вече не се вижда → 404", status == 404, f"HTTP {status}")

    section("РЕЗУЛТАТ")
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
