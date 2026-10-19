-- ============================================================================
-- 048_scrape_autopilot.sql
--
-- АВТОПИЛОТ: даваш само имената на сайтовете, системата решава всичко сама.
--
-- Защо отделна таблица (а не в scrape_schedules.options):
--   • options минава през строга схема (zod .strict()) — допълнителни ключове
--     биха чупили записа от панела;
--   • тук се пази ИСТОРИЯТА на решението за всеки сайт: какво е проверено,
--     какво е решено и защо (за да не е „черна кутия“).
--
-- Записът се обновява при всяко пускане на автопилота (upsert по domain).
-- ============================================================================

create table if not exists scrape_autopilot (
  id             uuid primary key default gen_random_uuid(),
  domain         text not null unique,
  -- Резултат от проверката: ok | local | robots | manual | error
  status         text not null,
  -- Какво направи системата: schedule | robot | skipped | failed | already
  action         text not null,
  strategy       text,
  platform       text,
  products_found integer not null default 0,
  -- Колко продукта има сайтът (научава се от пробната обиколка) и каква
  -- дневна квота е избрана, за да се обходи целият за ~14 дни.
  catalog_size   integer,
  quota          integer,
  schedule_id    uuid references scrape_schedules(id) on delete set null,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table scrape_autopilot is
  'Автопилот: какво е решено за всеки добавен сайт (статус, действие, размер на каталога, квота).';

create index if not exists scrape_autopilot_status_idx on scrape_autopilot (status, updated_at desc);
create index if not exists scrape_autopilot_schedule_idx on scrape_autopilot (schedule_id);
