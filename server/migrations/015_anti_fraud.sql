-- ============================================================================
-- 015 — Защита срещу злоупотреба с томболи (фалшиви акаунти)
--
-- Проблемът: имейл се прави безплатно, значи един човек може да си направи
-- 10 акаунта, да влезе в томболата 10 пъти и да нареди една и съща дъска
-- 10 пъти, докато я научи наизуст.
--
-- Тук се слагат скалъпките, на които разчита защитата:
--   1. email_key  — „иван+1@gmail.com“ и „и.ван@gmail.com“ са ЕДИН човек.
--   2. uploads.content_sha256 — същата снимка, качена от втори акаунт, се хваща.
--   3. receipts.fingerprint   — същата касова бележка от втори акаунт се хваща.
--   4. raffles.* — новите настройки: находки от различни дни, стаж на профила
--      и СИНХРОНЕН СТАРТ на официалното нареждане.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Нормализиран имейл (един реален човек = един ключ)
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists email_key text;

create or replace function normalize_email(raw text) returns text
language sql immutable as $$
  select case
    when e is null or e = '' then null
    when domain in ('gmail.com', 'googlemail.com') then
      -- Gmail игнорира точките и всичко след „+“
      'gmail.com:' || replace(split_part(local, '+', 1), '.', '')
    else
      -- Останалите игнорират само „+етикета“ (Outlook, Proton, Yahoo…)
      domain || ':' || split_part(local, '+', 1)
  end
  from (
    select
      lower(btrim(coalesce(raw, '')))                        as e,
      lower(split_part(lower(btrim(coalesce(raw, ''))), '@', 2)) as domain,
      lower(split_part(lower(btrim(coalesce(raw, ''))), '@', 1)) as local
  ) t
$$;

update profiles set email_key = normalize_email(email) where email_key is null;

-- Подсигуряване: ако вече има два профила на един реален човек, оставяме
-- най-стария и разграничаваме останалите, иначе уникалният индекс не минава.
with ranked as (
  select id, row_number() over (partition by email_key order by created_at asc, id asc) as rn
    from profiles where email_key is not null
)
update profiles p set email_key = p.email_key || ':dup:' || p.id::text
  from ranked r
 where p.id = r.id and r.rn > 1;

create unique index if not exists profiles_email_key_unique
  on profiles (email_key) where email_key is not null;

comment on column profiles.email_key is
  'Нормализиран имейл (алиасите на Gmail и „+етикетите“ се смятат за един човек). Един реален имейл = един акаунт.';

-- ---------------------------------------------------------------------------
-- 2. Пръстов отпечатък на качената снимка
-- ---------------------------------------------------------------------------
alter table uploads add column if not exists content_sha256 text;
create index if not exists idx_uploads_sha on uploads (content_sha256) where content_sha256 is not null;

comment on column uploads.content_sha256 is
  'SHA-256 на байтовете на снимката — същата снимка от друг акаунт се хваща.';

-- ---------------------------------------------------------------------------
-- 3. Пръстов отпечатък на касовата бележка
-- ---------------------------------------------------------------------------
-- Една бележка е един физически лист хартия: щом магазин + дата + час + сума
-- съвпадат, това е СЪЩАТА бележка. Изчислява се само, не се подава от клиента.
--
-- ВАЖНО: COLLATE "bg-x-icu" е задължителен. Базата е създадена с locale=C, а в
-- C locale lower() НЕ смалява кирилица — „ТЕСТ МАГАЗИН“ и „Тест магазин“ щяха
-- да дадат различни отпечатъци и бележката нямаше да се хване.
alter table receipts add column if not exists fingerprint text
  generated always as (
    lower(regexp_replace(btrim(merchant_name), '\s+', ' ', 'g') COLLATE "bg-x-icu") || '|' ||
    coalesce(btrim(receipt_date), '') || '|' ||
    coalesce(btrim(receipt_time), '') || '|' ||
    total_amount::text
  ) stored;

create index if not exists idx_receipts_fingerprint on receipts (fingerprint);

-- ---------------------------------------------------------------------------
-- 4. Нови настройки на томболата
-- ---------------------------------------------------------------------------
alter table raffles
  -- находките трябва да са от поне N различни дни (фарменето става бавно)
  add column if not exists condition_distinct_days integer not null default 2
    check (condition_distinct_days between 1 and 30),
  -- акаунтът трябва да е на поне N дни (спира „10 акаунта ден преди томболата“)
  add column if not exists min_account_age_days integer not null default 7
    check (min_account_age_days between 0 and 365),
  -- имейлът трябва да е потвърден преди поне N дни
  add column if not exists min_verified_age_days integer not null default 3
    check (min_verified_age_days between 0 and 365),
  -- СИНХРОНЕН СТАРТ: кога се отваря официалното нареждане и колко минути трае.
  -- Всички играят едновременно → много акаунти не помагат (един чифт ръце).
  add column if not exists official_opens_at timestamptz,
  add column if not exists official_window_min integer not null default 15
    check (official_window_min between 1 and 1440);

comment on column raffles.official_opens_at is
  'Точният час, в който се отваря официалното нареждане за ВСИЧКИ (синхронен старт).';

comment on column raffles.official_window_min is
  'Колко минути след official_opens_at може да се играе официалното нареждане.';
