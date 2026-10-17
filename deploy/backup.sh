#!/usr/bin/env bash
# SmartPrice: нощно резервно копие на базата (pg_dump + gzip) с ротация.
#
# Пуска се от cron на VPS-а:
#   10 4 * * * /bin/bash /root/SmartPrice/deploy/backup.sh >> /root/backups/smartprice/backup.log 2>&1
#
# Пази: 7 дневни + 4 неделни копия. Всяко копие се проверява (gzip -t + размер),
# за да не пазим тихо счупен файл.
set -uo pipefail

DIR=/root/backups/smartprice
KEEP_DAILY=7
KEEP_WEEKLY=4
CONTAINER=smartprice-db
DB_USER=smartprice
DB_NAME=smartprice

mkdir -p "$DIR/daily" "$DIR/weekly"

STAMP=$(date +%Y-%m-%d_%H%M)
FILE="$DIR/daily/smartprice_${STAMP}.sql.gz"

if ! docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip -6 > "$FILE"; then
  echo "$(date '+%F %T') ГРЕШКА: pg_dump се провали" >&2
  rm -f "$FILE"
  exit 1
fi

SIZE=$(stat -c%s "$FILE" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 20000 ] || ! gzip -t "$FILE" 2>/dev/null; then
  echo "$(date '+%F %T') ГРЕШКА: резервното копие е невалидно ($SIZE байта)" >&2
  exit 1
fi

# Неделно копие (пази се по-дълго).
if [ "$(date +%u)" = "7" ]; then
  cp -f "$FILE" "$DIR/weekly/"
fi

# Ротация: махаме всичко над лимита (най-старите).
ls -1t "$DIR"/daily/*.sql.gz 2>/dev/null | tail -n +$((KEEP_DAILY + 1)) | xargs -r rm -f
ls -1t "$DIR"/weekly/*.sql.gz 2>/dev/null | tail -n +$((KEEP_WEEKLY + 1)) | xargs -r rm -f

echo "$(date '+%F %T') OK $FILE ($SIZE байта) | дневни: $(ls -1 "$DIR"/daily/*.sql.gz 2>/dev/null | wc -l) | неделни: $(ls -1 "$DIR"/weekly/*.sql.gz 2>/dev/null | wc -l)"
