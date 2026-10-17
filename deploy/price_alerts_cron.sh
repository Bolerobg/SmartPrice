#!/bin/bash
# Ценови аларми: търси оферти под зададената от потребителя цена и праща писмата.
#
# Пуска се от cron на VPS-а (два пъти дневно):
#   0 9,18 * * * /bin/bash /root/SmartPrice/price_alerts_cron.sh >> /var/log/price_alerts_cron.log 2>&1
#
# Паролата на админа е в /root/.fb_admin_env (права 600), не се пише в този файл.
set -u
[ -f /root/.fb_admin_env ] && . /root/.fb_admin_env

BASE="https://smartprice.bg"
TOKEN=$(curl -s -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"kolyo.hristov@gmail.com\",\"password\":\"$FB_ADMIN_PASS\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))')

if [ -z "$TOKEN" ]; then
  echo "$(date '+%F %T') ГРЕШКА: не мога да вляза като админ"
  exit 1
fi

OUT=$(curl -s -X POST "$BASE/api/admin/price-alerts/run" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}')

echo "$(date '+%F %T') $OUT" | head -c 1200
echo
