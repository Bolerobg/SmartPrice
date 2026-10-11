#!/usr/bin/env python3
"""
Тест на търсенето — пази поправката, че базата е с C колация и вградената
lower() НЕ сгъва кирилица. Без sp_fold() търсене на „София“ не намираше нищо.

Употреба: python search_test.py [base_url]
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://smart.lookthis.online"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

passed: list[str] = []
failed: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    (passed if ok else failed).append(label)
    print(f"  [{'OK  ' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def search(q: str) -> tuple[int, list[str]]:
    url = f"{BASE}/api/posts?limit=50&q={urllib.parse.quote(q)}"
    req = urllib.request.Request(url)
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read().decode("utf-8"))
            return int(d.get("total", 0)), [i["title"] for i in d.get("items", [])]
    except urllib.error.HTTPError as exc:
        print(f"        HTTP {exc.code} за {q!r}")
        return -1, []
    except Exception as exc:  # noqa: BLE001
        print(f"        грешка за {q!r}: {exc}")
        return -1, []


def main() -> int:
    print(f"Сървър: {BASE}")
    print("Проверявам, че търсенето работи с кирилица (главни и малки букви).\n")

    print("=== 1. Базово търсене ===")
    n, titles = search("кафе")
    check("„кафе“ намира нещо", n > 0, f"{n} резултата")
    check("намерило е заглавие с кафе", any("каф" in t.lower() for t in titles), str(titles[:1]))

    print("\n=== 2. ГЛАВНИ букви (това се чупеше) ===")
    n_lower, _ = search("софия")
    n_upper, titles_upper = search("СОФИЯ")
    n_title, _ = search("София")
    check("„софия“ с малки намира", n_lower > 0, f"{n_lower}")
    check("„СОФИЯ“ с главни намира", n_upper > 0, f"{n_upper}")
    check("„София“ намира", n_title > 0, f"{n_title}")
    check("трите дават еднакъв брой", n_lower == n_upper == n_title, f"{n_lower}/{n_upper}/{n_title}")

    print("\n=== 3. Град с главна буква ===")
    n, _ = search("Банско")
    check("„Банско“ намира поста", n > 0, f"{n}")
    n2, _ = search("банско")
    check("„банско“ с малки също", n2 > 0, f"{n2}")

    print("\n=== 4. МНОГО думи (всяка трябва да съвпадне) ===")
    n_both, titles_both = search("вода созопол")
    check("„вода созопол“ намира поста", n_both > 0, f"{n_both}")
    check("наистина е постът с вода", any("вода" in t.lower() for t in titles_both), str(titles_both[:1]))
    n_none, _ = search("вода несъществуващадума")
    check("несъвместими думи → 0 резултата", n_none == 0, f"{n_none}")

    print("\n=== 5. Търсене по етикет на категория ===")
    for q in ["хотел", "кафе", "магазин"]:
        n, _ = search(q)
        check(f"„{q}“ намира по категория/етикет", n > 0, f"{n}")

    print("\n=== 6. Смислови синоними ===")
    n_flags, _ = search("капан")
    check("„капан“ намира червените флагове", n_flags > 0, f"{n_flags}")
    n_good, _ = search("находка")
    check("„находка“ намира зелените", n_good > 0, f"{n_good}")

    print("\n=== 7. Няма резултат не значи грешка ===")
    n, titles = search("пиле")
    check("„пиле“ (няма такъв пост) → 0, не грешка", n == 0, f"{n}")

    print("\n=== 8. Търсене по търговец от бележка ===")
    n, _ = search("КРАЙБРЕЖЕН")
    check("намира по име на търговец (главни букви)", n > 0, f"{n}")

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