#!/usr/bin/env python
"""Наръчникът на Ценко: файл → база (генерира SQL, който се пуска в базата).

Защо така: знанието на AI съветника живее в таблицата `assistant_knowledge`, за
да се променя без нов билд. Големият файл `server/knowledge/cenko-narachnik.md`
е източникът на истината; този скрипт го превръща в SQL — така не са нужни
никакви библиотеки, работи с psql отвсякъде.

Употреба (от твоята машина, SQL-ът отива право в базата на сървъра):
    python server/sync_assistant_knowledge.py                      # показва списъка с теми
    python server/sync_assistant_knowledge.py --sql | ssh root@193.46.243.232 \\
        'docker exec -i smartprice-db psql -U $POSTGRES_USER -d $POSTGRES_DB'
    python server/sync_assistant_knowledge.py --file друг.md --sql

Поведение (идемпотентно — може да се пуска колкото искаш):
    • тема от файла → изтрива старата версия със същото заглавие (source='file') и я вмъква наново;
    • тема, която вече не е във файла → ИЗКЛЮЧВА се (is_active = false), не се трие;
    • теми, написани от админ панела (source='admin'), НЕ се пипат.
"""

import argparse
import os
import re
import sys

DEFAULT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "knowledge", "cenko-narachnik.md")
CATEGORIES = {"basics", "points", "receipts", "raffles", "safety", "news"}


def parse_manual(path):
    """Разчита файла на теми: заглавие, ключови думи, категория, приоритет, тяло."""
    with open(path, encoding="utf-8") as fh:
        text = fh.read()

    # Махаме оградените с ``` блокове (примерния формат в началото на файла),
    # иначе редът "## Заглавие" от примера се чете като истинска тема.
    text = re.sub(r"```.*?```", "", text, flags=re.S)

    topics = []
    # Тема = ред "## Заглавие", после метаданни, после "---", после тялото до следващия "## ".
    for block in re.split(r"(?m)^##\s+", text)[1:]:
        lines = block.splitlines()
        title = lines[0].strip()
        body_lines, keywords, category, priority, seen_sep = [], [], "basics", 5, False
        for line in lines[1:]:
            low = line.strip()
            if not seen_sep:
                if low.startswith("Ключови думи:"):
                    keywords = [w.strip().lower() for w in low.split(":", 1)[1].split(",") if w.strip()]
                    continue
                if low.startswith("Категория:"):
                    value = low.split(":", 1)[1].strip().lower()
                    category = value if value in CATEGORIES else "basics"
                    continue
                if low.startswith("Приоритет:"):
                    digits = re.sub(r"\D", "", low.split(":", 1)[1])
                    priority = max(1, min(10, int(digits))) if digits else 5
                    continue
                if low == "---":
                    seen_sep = True
                    continue
            body_lines.append(line)

        body = re.sub(r"\n{3,}", "\n\n", "\n".join(body_lines).strip())
        if not title or len(body) < 20:
            continue
        topics.append(
            {
                "title": title[:200],
                "body": body[:4000],
                "keywords": keywords[:30],
                "category": category,
                "priority": priority,
            }
        )
    return topics


def q(text):
    """SQL низ в единични кавички ('' за вътрешна кавичка)."""
    return "'" + str(text).replace("'", "''") + "'"


def sql_for(topics):
    titles = [t["title"] for t in topics]
    out = [
        "-- Наръчник на Ценко: зареждане от server/knowledge/cenko-narachnik.md",
        "-- Идемпотентно: старите версии на темите се заменят, липсващите се изключват.",
        "begin;",
    ]
    for t in topics:
        arr = "array[" + ", ".join(q(k) for k in t["keywords"]) + "]::text[]"
        out.append(
            "delete from assistant_knowledge where source = 'file' and lower(title) = lower(%s);" % q(t["title"])
        )
        out.append(
            "insert into assistant_knowledge (title, body, keywords, category, priority, is_active, source)\n"
            "values (%s, %s, %s, %s, %d, true, 'file');"
            % (q(t["title"]), q(t["body"]), arr, q(t["category"]), t["priority"])
        )
    listed = ", ".join(q(x) for x in titles)
    # Старите теми от началната миграция (source='seed') се изключват — оттук
    # нататък ЕДИН източник на истината: този файл. (Ръчно написаните от панела
    # теми — source='admin' — не се пипат.)
    out.append(
        "update assistant_knowledge set is_active = false, updated_at = now()\n"
        " where source = 'seed' and is_active;"
    )
    out.append(
        "update assistant_knowledge set is_active = false, updated_at = now()\n"
        " where source = 'file' and is_active and not (title = any(array[%s]::text[]));" % listed
    )
    out.append(
        "select count(*) as aktivni_temi, count(*) filter (where source = 'file') as ot_fayla "
        "from assistant_knowledge where is_active;"
    )
    out.append("commit;")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="Наръчникът на Ценко: файл → SQL за базата")
    ap.add_argument("--file", default=DEFAULT_FILE)
    ap.add_argument("--sql", action="store_true", help="изведи SQL (за пускане в базата)")
    args = ap.parse_args()

    if not os.path.exists(args.file):
        print("Няма такъв файл: %s" % args.file)
        return 2

    topics = parse_manual(args.file)
    if args.sql:
        print(sql_for(topics))
        return 0

    print("Във файла: %d теми (%s)" % (len(topics), os.path.basename(args.file)))
    for t in topics:
        print("  • [%d] %-8s %s (%d знака, %d ключови думи)" % (t["priority"], t["category"], t["title"], len(t["body"]), len(t["keywords"])))
    print("\nЗа да ги качиш в приложението:\n  python server/sync_assistant_knowledge.py --sql | ssh root@193.46.243.232 \\\n    'docker exec -i smartprice-db psql -U $POSTGRES_USER -d $POSTGRES_DB'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
