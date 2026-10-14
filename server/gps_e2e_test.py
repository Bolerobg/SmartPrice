"""Проверка на GPS координатите end-to-end през публичния домейн."""
import json, sys, urllib.request, urllib.error, random, time

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3030"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

def call(method, path, body=None, token=None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", UA)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return e.code, {"_raw": e.read().decode("utf-8", "replace")}

def check(name, ok, detail=""):
    print(("  [OK  ] " if ok else "  [FAIL] ") + name + (f" — {detail}" if detail else ""))
    return ok

rnd = random.randint(100000, 999999)
ok = True

print("Сървър:", BASE, "\n")
s, r = call("GET", "/api/health")
print(f"0. /api/health -> {s}")
ok &= check("здравето е 200", s == 200)

s, r = call("POST", "/api/auth/register", {
    "email": f"gps{rnd}@example.com", "password": "Test12345!", "displayName": f"GPS Тест {rnd}",
    "phone": "088" + str(rnd % 10000000).zfill(7),
})
print(f"\n1. Регистрация -> {s}")
token = r.get("token") or (r.get("data") or {}).get("token")
if not token and s == 200:
    print("   отговор:", json.dumps(r, ensure_ascii=False)[:200])
ok &= check("получихме токен", bool(token))

lat, lng = 42.6977, 23.3219  # София, НДК
s, r = call("POST", "/api/posts", {
    "polarity": "good", "category": "groceries", "title": f"GPS тест {rnd}",
    "description": "Проверка на координати", "placeName": "Супермаркет Тест",
    "city": "София", "latitude": lat, "longitude": lng,
    "locationAutoDetected": True, "pricePaid": 9.99, "currency": "BGN", "unitType": "piece",
}, token=token)
print(f"\n2. Създаване на пост с координати -> {s}")
post = r.get("post") or r.get("data") or r
pid = post.get("id")
if not pid:
    print("   отговор:", json.dumps(r, ensure_ascii=False)[:300])
ok &= check("постът е създаден", bool(pid))
ok &= check("върнатите координати съвпадат", post.get("latitude") == lat and post.get("longitude") == lng,
            f"lat={post.get('latitude')} lng={post.get('longitude')}")

time.sleep(1)
s, r = call("GET", f"/api/posts/{pid}")
print(f"\n3. Четене обратно -> {s}")
p2 = r.get("post") or r.get("data") or r
ok &= check("lat съвпада при четене", p2.get("latitude") == lat, str(p2.get("latitude")))
ok &= check("lng съвпада при четене", p2.get("longitude") == lng, str(p2.get("longitude")))

# Пост БЕЗ координати — трябва да върне null/undefined (не фалшиви стойности)
s, r = call("POST", "/api/posts", {
    "polarity": "good", "category": "groceries", "title": f"Без GPS {rnd}",
    "description": "Без координати", "placeName": "Магазин без GPS",
    "city": "Пловдив", "pricePaid": 5.00, "currency": "BGN", "unitType": "piece",
}, token=token)
p3 = r.get("post") or r.get("data") or r
print(f"\n4. Пост без координати -> {s}")
ok &= check("няма измислени координати", p3.get("latitude") in (None, 0) or p3.get("latitude") is None,
            f"lat={p3.get('latitude')}")

print("\n" + ("ВСИЧКИ ПРОВЕРКИ МИНАХА" if ok else "ИМА ПРОБЛЕМИ"))
sys.exit(0 if ok else 1)
