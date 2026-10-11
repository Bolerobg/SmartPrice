#!/usr/bin/env bash
# Финална проверка на целия стек.
set -u
cd /c/Dockers/SmartPrice

echo "=== 1. Типове ==="
./node_modules/.bin/tsc --noEmit > /tmp/t1.txt 2>&1 && echo "  app:    0 грешки" || { echo "  app: ГРЕШКИ"; head -5 /tmp/t1.txt; }
(cd server && ./node_modules/.bin/tsc --noEmit > /tmp/t2.txt 2>&1) && echo "  server: 0 грешки" || { echo "  server: ГРЕШКИ"; head -5 /tmp/t2.txt; }

echo "=== 2. Контейнери ==="
docker compose ps --format '  {{.Name}}  {{.Status}}'

echo "=== 3. Локално ==="
curl -s -o /dev/null -w "  http://127.0.0.1:3030/          -> %{http_code}\n" http://127.0.0.1:3030/
curl -s -o /dev/null -w "  http://127.0.0.1:4000/api/health -> %{http_code}\n" http://127.0.0.1:4000/api/health

echo "=== 4. Публично ==="
curl -s -o /dev/null -w "  https://smart.lookthis.online/          -> %{http_code}\n" --max-time 25 https://smart.lookthis.online/
curl -s -o /dev/null -w "  https://smart.lookthis.online/api/posts  -> %{http_code}\n" --max-time 25 https://smart.lookthis.online/api/posts
echo -n "  функции: "; curl -s --max-time 25 https://smart.lookthis.online/api/health; echo

echo "=== 5. Кеш-контрола (index.html не се кешира) ==="
curl -s -I --max-time 25 https://smart.lookthis.online/ | grep -iE "cache-control" | head -2 | sed 's/^/  /'

echo "=== 6. Тунели ==="
echo "  cloudflared процеси: $(powershell -NoProfile -Command "(Get-Process cloudflared -ErrorAction SilentlyContinue | Measure-Object).Count" 2>/dev/null | tr -d '\r ')"
