#!/bin/bash
# ⏱️ Диспечер на графика за Facebook обиколки (подобрение №11).
# Пуска се от cron на VPS-а на всеки 10 минути:
#   */10 * * * * /bin/bash /root/SmartPrice/fb_plans_dispatch_cron.sh >> /var/log/fb_plans_dispatch.log 2>&1
# Пуска само групите, на които им е дошло времето (часове, паузи, тавани, бюджет).
# Паролата на админа е в /root/.fb_admin_env (права 600).
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

OUT=$(curl -s -X POST "$BASE/api/admin/fb-receipts/plans/dispatch" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"maxGroups\":${PLAN_MAX_GROUPS:-4}}")

# Пишем само когато има нещо интересно (стартирани групи или причина за спиране).
echo "$OUT" | python3 -c '
import sys, json, datetime
try:
    d = json.load(sys.stdin)
except Exception:
    print(datetime.datetime.now().strftime("%F %T"), "невалиден отговор"); raise SystemExit
started = d.get("started") or []
if started:
    names = ", ".join([s.get("groupUrl", "?").split("/groups/")[-1] for s in started])
    print(datetime.datetime.now().strftime("%F %T"), "пуснати", len(started), "групи:", names, "| днес постове:", d.get("postsToday"), "| $", round(float(d.get("usd") or 0), 4))
elif not d.get("ok"):
    print(datetime.datetime.now().strftime("%F %T"), "пропуснато:", d.get("reason"))
'
