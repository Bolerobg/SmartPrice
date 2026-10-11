#!/usr/bin/env bash
# Проверка на ЖИВИЯ билд: сервира ли еврото и останало ли е „лв.“
set -u
BUNDLE_URL=$(curl -s --max-time 25 https://smart.lookthis.online/ | grep -oE '/_expo/static/js/web/[a-zA-Z0-9._-]+\.js' | head -1)
echo "bundle: $BUNDLE_URL"
TMP="$LOCALAPPDATA/Temp/smartprice_bundle.js"
curl -s --max-time 60 "https://smart.lookthis.online${BUNDLE_URL}" -o "$TMP"
echo "размер: $(wc -c < "$TMP" | tr -d ' ') байта"
echo
echo "=== Трябва да ПРИСЪСТВУВА ==="
for p in "€" "Дари" "Твоята цена" "Нямаме данни за тази цена"; do
  n=$(grep -o -F "$p" "$TMP" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" -gt 0 ]; then printf '  [OK  ] %-28s x%s\n' "$p" "$n"; else printf '  [MISS] %-28s\n' "$p"; fi
done
echo
echo "=== Трябва да НЯМА (остатъци в лв.) ==="
for p in "лв." "НАЙ-ИЗГОДНА КОШНИЦА" "Kaufland:" "pricesByStore" "pi_stripe_" "обичайната цена"; do
  n=$(grep -o -F "$p" "$TMP" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" -eq 0 ]; then printf '  [OK  ] %-28s изчезнало\n' "$p"; else printf '  [FAIL] %-28s все още x%s\n' "$p" "$n"; fi
done
rm -f "$TMP"
