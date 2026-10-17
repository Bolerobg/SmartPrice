#!/bin/bash
# 🔎 Откриване на нови публични Facebook групи (подобрение №9).
#
# Пуска се от Hermes cron през ssh (веднъж седмично) или ръчно:
#   bash /root/SmartPrice/fb_groups_discover_cron.sh
#
# Изход: JSON от API-то (ok, found, added, known, skippedPrivate, usd).
# Паролата на админа е в /root/.fb_admin_env (права 600), не се пише тук.
set -u
[ -f /root/.fb_admin_env ] && . /root/.fb_admin_env

BASE="https://smartprice.bg"
TOKEN=$(curl -s -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"kolyo.hristov@gmail.com\",\"password\":\"$FB_ADMIN_PASS\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))')

if [ -z "$TOKEN" ]; then
  echo "{\"ok\":false,\"reason\":\"не мога да вляза като админ\"}"
  exit 1
fi

curl -s -X POST "$BASE/api/admin/fb-receipts/groups/discover" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"maxItems\":${DISCOVER_MAX_ITEMS:-60}}"
echo
