#!/bin/bash
# 🔎 Откриване на нови публични Facebook групи (подобрение №9).
#
# Пуска се от Hermes cron през ssh (всеки понеделник) или ръчно:
#   bash /root/SmartPrice/fb_groups_discover_cron.sh
#   DISCOVER_MAX_ITEMS=30 bash /root/SmartPrice/fb_groups_discover_cron.sh
#
# Търсенето върви ФОНОВО в API-то (заявката през Cloudflare се реже след ~100 сек.),
# затова тук стартираме и после чакаме статуса. Накрая се печата JSON с резултата:
#   {"ok":true,"found":..,"added":..,"known":..,"skippedPrivate":..,"usd":..}
set -u
[ -f /root/.fb_admin_env ] && . /root/.fb_admin_env

BASE="https://smartprice.bg"
MAX="${DISCOVER_MAX_ITEMS:-60}"

TOKEN=$(curl -s -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"kolyo.hristov@gmail.com\",\"password\":\"$FB_ADMIN_PASS\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))')

if [ -z "$TOKEN" ]; then
  echo '{"ok":false,"reason":"не мога да вляза като админ"}'
  exit 1
fi

START=$(curl -s -X POST "$BASE/api/admin/fb-receipts/groups/discover" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"maxItems\":$MAX}")

case "$START" in
  *'"started":true'*) : ;;
  *) echo "$START"; exit 0 ;;
esac

for _ in $(seq 1 40); do
  sleep 10
  ST=$(curl -s "$BASE/api/admin/fb-receipts/groups/discover/status" -H "Authorization: Bearer $TOKEN")
  RUN=$(echo "$ST" | python3 -c 'import sys,json;print(str(json.load(sys.stdin).get("running")))' 2>/dev/null)
  if [ "$RUN" = "False" ] || [ "$RUN" = "false" ]; then
    echo "$ST" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(json.dumps(d.get("last") or {},ensure_ascii=False))'
    exit 0
  fi
done

echo '{"ok":false,"reason":"търсенето не завърши за 400 секунди"}'
