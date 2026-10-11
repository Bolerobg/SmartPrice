#!/usr/bin/env bash
# Реален smoke тест на SmartPrice API-то. Не измисля резултати — печата каквото върне сървърът.
set -u
BASE="http://127.0.0.1:4000"
EMAIL="smoke.$RANDOM@smartprice.test"
PASS="TestParola123"

say() { printf '\n=== %s ===\n' "$1"; }

say "1. Health"
curl -s "$BASE/api/health"; echo

say "2. Регистрация ($EMAIL)"
REG=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Смоук Тестов\",\"city\":\"София\"}")
echo "$REG" | head -c 400; echo
TOKEN=$(echo "$REG" | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
echo "accessToken дължина: ${#TOKEN}"

say "3. Дубликат на същия имейл (трябва 409)"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST "$BASE/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Дубликат\"}"

say "4. Грешна парола (трябва 401)"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"greshna\"}"

say "5. Вход"
LOGIN=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
TOKEN=$(echo "$LOGIN" | python -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
echo "токен OK: $([ ${#TOKEN} -gt 50 ] && echo да || echo НЕ)"

say "6. Без токен (трябва 401)"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' "$BASE/api/auth/me"

say "7. Моят профил"
curl -s "$BASE/api/auth/me" -H "Authorization: Bearer $TOKEN" | head -c 500; echo

say "8. Лента (демо постове)"
FEED=$(curl -s "$BASE/api/posts?limit=3")
echo "$FEED" | python -c "
import sys,json
d=json.load(sys.stdin)
print('total:',d['total'],'| върнати:',len(d['items']))
for p in d['items'][:3]:
    print(' -',p['polarity'],p['category'],'|',p['title'][:60],'|',p['pricePaid'],p['currency'],'| реакции:',p['reactions'],'| коментари:',len(p['comments']))
"

say "9. Търсене 'шринкфлация'"
curl -s "$BASE/api/posts?q=%D1%88%D1%80%D0%B8%D0%BD%D0%BA%D1%84%D0%BB%D0%B0%D1%86%D0%B8%D1%8F" | python -c "
import sys,json;d=json.load(sys.stdin);print('намерени:',d['total'])"

say "10. Създаване на пост (категория other — старата схема я отхвърляше)"
POST=$(curl -s -X POST "$BASE/api/posts" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{
 "polarity":"green","category":"other","customCategoryLabel":"Аптека","platformTag":"На място",
 "title":"Смоук тест: витамин C 1000 мг за 6.90 лв.","description":"Тестово създаване през API.",
 "placeName":"Аптека Смоук","city":"София","pricePaid":6.9,"referencePrice":12.5,
 "unitQuantity":60,"unitType":"pcs","imageUrl":"https://example.com/x.jpg","tags":["#Тест"]
}')
echo "$POST" | head -c 300; echo
PID=$(echo "$POST" | python -c "import sys,json;print(json.load(sys.stdin).get('post',{}).get('id',''))" 2>/dev/null)
echo "post id: $PID"

say "11. Реакция (зелена → topDeal)"
curl -s -X POST "$BASE/api/posts/$PID/reactions" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"reactionKey":"topDeal"}' | python -c "
import sys,json;p=json.load(sys.stdin)['post'];print('реакции:',p['reactions'],'| моята:',p['userReaction'])"

say "12. Невалидна реакция за зелен пост (трябва 400)"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST "$BASE/api/posts/$PID/reactions" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"reactionKey":"pureRobbery"}'

say "13. „Спести ми пари“ (трябва реална сума = 12.50-6.90 = 5.60)"
curl -s -X POST "$BASE/api/posts/$PID/helped" -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json;d=json.load(sys.stdin)
print('маркирано:',d['marked'],'| спестени:',d['savedAmount'],'| лични общо:',d['profile']['personalSavedBgn'])
print('пост: helpedCount=',d['post']['helpedCount'],'communitySavedBgn=',d['post']['communitySavedBgn'])"

say "14. Отмяна на helped (трябва да върне 0 назад)"
curl -s -X POST "$BASE/api/posts/$PID/helped" -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json;d=json.load(sys.stdin)
print('маркирано:',d['marked'],'| лични общо:',d['profile']['personalSavedBgn'])"

say "15. Коментар"
curl -s -X POST "$BASE/api/posts/$PID/comments" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"text":"Тестов коментар","reportedPrice":7.5}' | head -c 300; echo

say "16. Потвърди цената днес"
curl -s -X POST "$BASE/api/posts/$PID/confirm" -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json;p=json.load(sys.stdin)['post'];print('брой потвърждения:',p['verifiedValidTodayCount'],'| история:',len(p['priceHistory']))"

say "17. Промяна на цената на 8.20"
curl -s -X POST "$BASE/api/posts/$PID/price" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"price":8.2}' | python -c "
import sys,json;p=json.load(sys.stdin)['post']
print('нова цена:',p['pricePaid'],'| история:',[(h['price'],h['status']) for h in p['priceHistory']])"

say "18. Отметка"
curl -s -X POST "$BASE/api/posts/$PID/bookmark" -H "Authorization: Bearer $TOKEN"; echo
curl -s "$BASE/api/posts/bookmarks" -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json;d=json.load(sys.stdin);print('запазени:',d['total'])"

say "19. Аларма"
curl -s -X POST "$BASE/api/alerts" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"keyword":"витамин","maxPrice":10,"city":"София","polarity":"green"}'; echo
curl -s "$BASE/api/alerts" -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json;d=json.load(sys.stdin)
for a in d['items']: print(' аларма:',a['keyword'],'| съвпадения:',len(a['matches']))"

say "20. Статистики на общността (реални)"
curl -s "$BASE/api/community/stats"; echo

say "21. Класация"
curl -s "$BASE/api/community/leaderboard" | python -c "
import sys,json;d=json.load(sys.stdin)
print('участници:',len(d['items']))
for u in d['items'][:3]: print(' #%d %s | %s лв. | бележки: %d'%(u['rank'],u['name'],u['communitySavedBgn'],u['verifiedReceipts']))"

say "22. OCR без ключ (трябва честно 503, не фалшива бележка)"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST "$BASE/api/ocr/receipt" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"imageUrl":"https://example.com/x.jpg"}'

say "23. Плащане без Stripe ключ (трябва честно 503)"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST "$BASE/api/donations/checkout" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"amountBgn":10,"tierId":"guardian","isMonthly":false}'

say "24. Функции (какво е включено)"
curl -s "$BASE/api/health/features"; echo

say "25. Чужда/несъществуваща публикация (трябва 404)"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' "$BASE/api/posts/00000000-0000-0000-0000-000000000000"

say "26. Изтриване на поста (собствен)"
curl -s -X DELETE "$BASE/api/posts/$PID" -H "Authorization: Bearer $TOKEN"; echo
curl -s -o /dev/null -w 'след изтриване HTTP %{http_code}\n' "$BASE/api/posts/$PID"

say "КРАЙ"
