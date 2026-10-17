# Автоматизация на SmartPrice (продукция)

Всичко тук работи само, без човешка намеса.

| Какво | Къде живее | Кога върви |
|---|---|---|
| Деплой на код (push → продукция) | Hermes cron „SmartPrice deploy“ → `~/AppData/Local/hermes/scripts/smartprice_deploy.py` | на всеки 20 мин, ако има нов комит в `main` |
| Мониторинг и аларми в Telegram | Hermes cron „SmartPrice pazar“ → `smartprice_watchdog.py` | на всеки 30 мин, мълчи когато всичко е наред |
| Нощно резервно копие на базата | `deploy/backup.sh` (crontab на VPS-а) | всеки ден в 04:10 |
| Качване на бекъпа в Google Drive | Hermes cron „SmartPrice backup to Drive“ → `smartprice_gdrive_backup.py` | на всеки час (:40, 05–22 ч), тихо при успех |
| Обиколка на Facebook групите | crontab на VPS-а | всеки ден в 07:30 и 19:30 |
| Дневен бюджет за Apify (авто-спиране) | `server/src/lib/fbReceipts.ts` (`fb_daily_usd_limit`) | преди всяка обиколка |
| Жълти флагове преди публикуване | `queueQualityFlags()` + панел „⚠️ С предупреждения“ | при всяко зареждане на опашката |
| Изчистване на кеша на панела | в `smartprice_deploy.py` (Cloudflare API) | след всеки успешен деплой |

## Как работи деплоят
1. Сравнява `HEAD` на VPS-а с `origin/main`. Равни → мълчи.
2. Гледа `git diff --name-only` и билдва **само нужното**:
   - `server/**` → образ `smartprice-api`
   - `app/**`, `components/**`, `constants/**`, `contexts/**`, `lib/**`, `services/**`, `public/**`, `web/**`, `types/**` → образ `smartprice-web`
   - само `deploy/**` (като този файл) → без билд, само синхронизация на кода
3. Пуска `tsc` проверка преди билд. Грешка → спира и съобщава, нищо не се качва.
4. Качва образите, пази старите като `:prev`, прави `git reset --hard origin/main`, пресъздава
   контейнерите `smartprice-api` и `smart`, чака `/api/health`.
5. Ако health не е ОК → **връща `:prev`** (автоматичен rollback) и съобщава в Telegram.
6. При успех изчиства кеша на панела в Cloudflare
   (`/panel/`, `/panel/index.html`, `/panel/panel.js`, `/panel/panel.css`).

## Ръчни проверки
```bash
# последни резервни копия
ssh root@193.46.243.232 "ls -lh /root/backups/smartprice/daily | tail -5"

# деплой на ръка (същото, което прави cron-ът)
python "C:\Users\User\AppData\Local\hermes\scripts\smartprice_deploy.py"

# пазачът на ръка (празно = всичко е наред)
python "C:\Users\User\AppData\Local\hermes\scripts\smartprice_watchdog.py"

# задачите
hermes cron list
```

## Cloudflare
- Зона `smartprice.bg`, id `20c8fe8dca7aac1796b9e7a332aeef52`.
- Токенът за API е в `~/AppData/Local/hermes/scripts/cf_smartprice_token.txt` и има права
  **Zone: Cache Purge: Purge** + **Zone: Zone: Read** (+ Cache Rules: Edit).
- Nginx дава `no-store` за `/panel/`, но Cloudflare Cache Rule презаписва хедъра на 30 дни —
  затова след деплой се пуска purge и потребителите виждат новия панел веднага.

## Резервни копия в Google Drive
- Папка (по ID, не по име): `1rxUPc3LzkqJihsQ54xITtmE0wsBdNkeb` — „SmartPrice_backup“ на
  `kolyo.hristov@gmail.com` → https://drive.google.com/drive/folders/1rxUPc3LzkqJihsQ54xITtmE0wsBdNkeb
- Верига: VPS → тази машина (scp) → **Google Drive API** (директно, чрез
  `skills/productivity/google-workspace/scripts/google_api.py`). Не зависи от
  Google Drive за Desktop и от никаква друга машина.
- Токенът е в `~/AppData/Local/hermes/google_token.json` (автоматично се подновява).
  Ако бъде отменен: `setup.py --revoke` и ново съгласие през `setup.py --auth-url`.
- Пази последните **14** копия (по-старите отиват в кошчето на Drive).
- Тихо, когато няма какво да прави; съобщава само ако бекъпът на VPS-а е стар (>30 ч)
  или последното копие в Drive е над 48 ч.
- **ПИТФОЛ:** заявката към Drive трябва да е с `and trashed = false` — иначе връща и
  файловете от кошчето и скриптът решава, че бекъпът е качен (хванато на живо).

## Проверки преди публикуване и бюджет
- `queueQualityFlags()` дава жълт флаг при: кратко заглавие/описание, общо място, липсващ град,
  ниска увереност под 60%, нереален ЕИК, дата в бъдещето, цена ≥5× над медианата за категорията
  (или подозрително ниска), много подобна вече публикувана оферта (`similarity`).
- **Авто-одобрение се спира при поне един флаг** — такива записи чакат човек (в дневника пише
  „✋ N сигнала останаха за преглед“).
- Дневен бюджет: разходът от Apify (`usageTotalUsd`) и броят AI заявки се записват в
  `fb_spend_days` (30 дни). Лимитът е `fb_daily_usd_limit` (панелът → ФБ Бележки → дневен бюджет).
  Обиколка НЕ тръгва над лимита; при 80% има предупреждение в дневника на задачата.
