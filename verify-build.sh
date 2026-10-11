#!/usr/bin/env bash
# Проверка какво реално е влязло в уеб билда.
set -u
BUNDLE=$(ls dist-web/_expo/static/js/web/*.js | head -1)
echo "bundle: $BUNDLE"
echo
echo "=== Трябва да ПРИСЪСТВАТ (нови, реални endpoints) ==="
for p in "192.168.1.171:4000" "/api/auth/login" "/api/auth/register" "/api/posts" "/api/uploads" "/api/ocr/receipt" "/api/donations/checkout" "/api/alerts" "/api/me/interaction" "checkoutUrl" "OPENROUTER_API_KEY" "STRIPE_SECRET_KEY"; do
  n=$(grep -o -F "$p" "$BUNDLE" | wc -l | tr -d ' ')
  if [ "$n" -gt 0 ]; then printf '  [OK  ] %-28s x%s\n' "$p" "$n"; else printf '  [MISS] %-28s\n' "$p"; fi
done
echo
echo "=== Трябва да НЯМА (махнати фалшиви неща) ==="
for p in "pricesByStore" "pi_stripe_" "pi_smartprice_" "Kaufland: " "@supabase/supabase-js" "analyzeReceiptImage({ imageBase64"; do
  n=$(grep -o -F "$p" "$BUNDLE" | wc -l | tr -d ' ')
  if [ "$n" -eq 0 ]; then printf '  [OK  ] %-30s изчезнало\n' "$p"; else printf '  [FAIL] %-30s все още го има x%s\n' "$p" "$n"; fi
done
echo
echo "=== Размер ==="
ls -lh "$BUNDLE" | awk '{print "  " $5}'
