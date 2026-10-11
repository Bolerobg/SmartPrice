#!/usr/bin/env python3
"""
Миграция лв. -> € в потребителския интерфейс.

Пипа САМО app-side файлове (app/, components/, constants/, context/, lib/,
src/, services/, types/). Сървърът се обработва отделно (там валутата е данни).

Показва всяка промяна, за да може да се прегледа.
"""
import os
import re
import sys

ROOT = r"C:\Dockers\SmartPrice"
APP_DIRS = ["app", "components", "constants", "context", "lib", "src", "services", "types"]

# Ред на прилагане: по-специфичните първи
REPLACEMENTS = [
    ("лв./кг", "€/кг"),
    ("лв./л", "€/л"),
    ("лв./бр", "€/бр"),
    ("лв./мес", "€/мес"),
    ("лв.", "€"),
    (" лв", " €"),
    ("лв ", "€ "),
]

SKIP_EXT = {".png", ".jpg", ".jpeg", ".webp", ".ico", ".ttf", ".woff", ".woff2", ".json"}


def main():
    dry = "--apply" not in sys.argv
    print("РЕЖИМ:", "ПРЕГЛЕД (нищо не се записва)" if dry else "ПРИЛАГАНЕ")
    print()

    changed_files = 0
    changed_lines = 0

    for sub in APP_DIRS:
        base = os.path.join(ROOT, sub)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in {"node_modules", ".expo", "dist"}]
            for name in filenames:
                if os.path.splitext(name)[1].lower() in SKIP_EXT:
                    continue
                path = os.path.join(dirpath, name)
                try:
                    # newline="" → пази CRLF както е във файла (иначе целият diff
                    # изглежда променен заради сменени краища на редове)
                    with open(path, "r", encoding="utf-8", newline="") as fh:
                        original = fh.read()
                except (UnicodeDecodeError, OSError):
                    continue

                new = original
                for old, rep in REPLACEMENTS:
                    new = new.replace(old, rep)

                if new == original:
                    continue

                rel = os.path.relpath(path, ROOT)
                # Показваме само редовете, които се менят
                old_lines = original.splitlines()
                new_lines = new.splitlines()
                shown = 0
                for i, (a, b) in enumerate(zip(old_lines, new_lines)):
                    if a != b:
                        changed_lines += 1
                        if shown < 6:
                            print(f"  {rel}:{i+1}")
                            print(f"    - {a.strip()[:110]}")
                            print(f"    + {b.strip()[:110]}")
                            shown += 1
                if len(old_lines) != len(new_lines):
                    print(f"  ВНИМАНИЕ: {rel} — броят редове се промени!")
                if shown >= 6:
                    extra = sum(1 for a, b in zip(old_lines, new_lines) if a != b) - 6
                    if extra > 0:
                        print(f"    … и още {extra} реда в същия файл")
                changed_files += 1

                if not dry:
                    with open(path, "w", encoding="utf-8", newline="") as fh:
                        fh.write(new)

    print()
    print(f"Файлове: {changed_files} | редове: {changed_lines}")
    if dry:
        print("\nПусни с --apply, за да запише.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
