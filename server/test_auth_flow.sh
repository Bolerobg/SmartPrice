#!/usr/bin/env bash
# Тества целия поток на регистрация/потвърждение/забравена парола.
# Ползва ВРЕМЕНЕН dev контейнер на порт 4001, за да не пипа продукцията.
set -u
cd /c/Dockers/SmartPrice

echo "=== 1. Спиране на стар тестов контейнер (ако има) ==="
docker rm -f sp-devtest >/dev/null 2>&1 && echo "  премахнат" || echo "  няма такъв"

echo "=== 2. Стартиране на dev контейнер на 127.0.0.1:4001 ==="
docker compose run --rm -d --name sp-devtest \
  -e NODE_ENV=development \
  -e EXPOSE_DEV_CODES=true \
  -p 127.0.0.1:4001:4000 \
  api >/dev/null 2>&1
echo "  exit=$?"

echo "=== 3. Изчакване да отговори ==="
for i in $(seq 1 25); do
  sleep 2
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:4001/api/health 2>/dev/null)
  echo "  опит $i: HTTP ${code:-none}"
  if [ "$code" = "200" ]; then break; fi
done

echo
echo "=== 4. ТЕСТ на целия поток (dev режим) ==="
python server/auth_flow_test.py http://127.0.0.1:4001 --expect-dev-codes 2>&1 | tail -70
RESULT=$?

echo
echo "=== 5. Спиране на dev контейнера ==="
docker rm -f sp-devtest >/dev/null 2>&1 && echo "  премахнат" || echo "  не е намерен"

exit $RESULT
