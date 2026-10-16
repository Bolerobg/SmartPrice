-- ============================================================================
-- 026_scrape_schedule_auto.sql
--
-- Разписанието да работи, докато не го спреш ИЛИ докато сайтът не свърши.
--
-- Защо:
--   • „Изчерпан сайт“ не е грешка — просто вече няма нови продукти. Без този
--     брояч разписанието продължава да обхожда сайта вечно и да хаби квота.
--   • „Макс. общо“ = твърд таван (напр. 500 продукта от този сайт и стоп).
--   • rotate: всяка обиколка влиза от РАЗЛИЧНО място в каталога, за да не
--     изглежда, че един и същ човек минава всеки ден по същия маршрут.
-- ============================================================================

alter table scrape_schedules
  add column if not exists dry_runs        integer not null default 0,
  add column if not exists max_total       integer,
  add column if not exists stop_when_done  boolean not null default true,
  add column if not exists rotate          boolean not null default true,
  add column if not exists auto_stopped_at timestamptz,
  add column if not exists last_status     text,
  add column if not exists last_message    text;

comment on column scrape_schedules.dry_runs is
  'Поредни обиколки без нови продукти. На 3 → разписанието се спира само (ако stop_when_done).';
comment on column scrape_schedules.max_total is
  'Таван на внесените продукти от този сайт. NULL = без таван.';
comment on column scrape_schedules.rotate is
  'Всяка обиколка влиза от различно място в каталога (различни продукти, различен маршрут).';

-- Бързо търсене „има ли вече разписание за този адрес“ (за добавянето на 10 сайта наведнъж).
create index if not exists scrape_schedules_url_idx on scrape_schedules (url);
