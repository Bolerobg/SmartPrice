import json
import subprocess

API = "https://smartprice.bg/api/assistant/chat"
QUESTIONS = [
    "как се търси по ID на оферта",
    "как се участва в томбола и какво трябва да направя",
    "как работи целият процес в приложението от начало до край",
    "защо на някои продукти пише че магазинът не позволява проверка на цената",
    "как се печели томболата с пъзела и кога започва",
]


def ask(question):
    body = json.dumps({"messages": [{"role": "user", "content": question}]}, ensure_ascii=False)
    out = subprocess.run(
        ["curl", "-s", "-X", "POST", API, "-H", "Content-Type: application/json",
         "--data-binary", "@-"],
        input=body.encode("utf-8"), capture_output=True, timeout=120,
    ).stdout.decode("utf-8", "replace")
    try:
        data = json.loads(out)
    except Exception:
        return {"raw": out[:300]}
    return data


for q in QUESTIONS:
    print("=" * 78)
    print("ВЪПРОС:", q)
    r = ask(q)
    if "raw" in r:
        print("  грешка:", r["raw"])
        continue
    reply = r.get("reply") or r.get("answer") or ""
    print("ОТГОВОР:", reply[:700])
    if r.get("steps"):
        for i, s in enumerate(r["steps"], 1):
            print(f"   {i}. {s}")
    if r.get("suggestions"):
        print("   бутони:", ", ".join(x.get("label", "") for x in r["suggestions"]))
