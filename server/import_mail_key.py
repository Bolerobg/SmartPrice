#!/usr/bin/env python3
"""
Внася Resend ключа и подателя за имейли от HumanDesign в SmartPrice/.env.
Стойностите НЕ се отпечатват.
"""
import os
import sys

SRC = r"C:\Users\User\HumanDesign\.env"
DST = r"C:\Dockers\SmartPrice\.env"

# Само това внасяме. Админ/контактните имейли не са нужни на SmartPrice.
WANTED = ["RESEND_API_KEY", "MAIL_FROM"]


def read_env(path):
    out = {}
    if not os.path.exists(path):
        return out
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def main():
    src = read_env(SRC)
    if not src:
        print(f"Няма {SRC}")
        return 1

    found = {}
    print("Намерени в HumanDesign/.env:")
    for key in WANTED:
        value = src.get(key, "")
        if value and not value.startswith("your"):
            found[key] = value
            # Показваме само формата, не стойността
            if key == "MAIL_FROM":
                print(f"  {key}: {value}")
            else:
                print(f"  {key}: ДА (дължина {len(value)}, начало '{value[:8]}...')")
        else:
            print(f"  {key}: не")

    if "RESEND_API_KEY" not in found:
        print("\nНяма ключ за Resend — имейлите няма да работят.")
        return 1

    lines = []
    if os.path.exists(DST):
        with open(DST, "r", encoding="utf-8") as fh:
            lines = fh.read().splitlines()

    for key, value in found.items():
        replaced = False
        for i, line in enumerate(lines):
            if line.startswith(f"{key}="):
                lines[i] = f"{key}={value}"
                replaced = True
                break
        if not replaced:
            lines.append(f"{key}={value}")

    with open(DST, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines) + "\n")

    print(f"\nЗаписани в SmartPrice/.env: {', '.join(found.keys())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
