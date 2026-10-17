# Автоматизация на SmartPrice (продукция)

Всичко тук работи само, без човешка намеса.

| Какво | Къде живее | Кога върви |
|---|---|---|
| Деплой на код (push → продукция) | Hermes cron „SmartPrice deploy“ → `~/AppData/Local/hermes/scripts/smartprice_deploy.py` | на всеки 20 мин, ако има нов комит в `main` |
| Мониторинг и аларми в Telegram | Hermes cron „SmartPrice pazar“ → `smartprice_watchdog.py` | на всеки 30 мин, мълчи когато всичко е наред |
| Нощно резервно копие на базата | `deploy/backup.sh` (crontab на VPS-а) | всеки ден в 04:10 |
| Качване на бекъпа в Google Drive | Hermes cron „SmartPrice backup to Drive“ → `smartprice_gdrive_backup.py` | на всеки час (:40, 05–22 ч), тихо при успех |
| Обиколка на Facebook групите | crontab на VPS-а | всеки ден в 07:30 и 19:30 |
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
- Папка: `My Drive/backupdisk` на `kolyo.hristov@gmail.com`
  (`https://drive.google.com/drive/folders/1rxUPc3LzkqJihsQ54xITtmE0wsBdNkeb`).
- Верига: VPS → тази машина (scp) → Mac (`~/Library/CloudStorage/GoogleDrive-kolyo.hristov@gmail.com/My Drive/backupdisk`)
  → Drive за Desktop качва файла в облака сам.
- Пази последните **14** копия, тихо е, когато няма какво да прави; съобщава само ако
  бекъпът на VPS-а е стар или последното копие в Drive е над 48 ч.
- Ако Mac-ът спи — пропуска и пробва следващия час (затова е на всеки час, а не веднъж).
