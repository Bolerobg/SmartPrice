-- ============================================================================
-- 024_scrape_schedules.sql
--
-- Разписания за скрапване: по колко продукта на ден от даден сайт, разпръснати
-- на случаен интервал, за да не заливаме магазина и да не изглежда като атака.
--
-- Защо е нужно:
--   • 200 продукта наведнъж = 200 заявки за 2 минути → сайтът ни блокира;
--   • 200 продукта за 24 часа = по 4–6 на всеки 40 минути → никой не усеща.
-- Затова квотата се разпределя сама през активните часове на деня.
-- ============================================================================

create table if not exists scrape_schedules (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid references profiles(id) on delete set null,
  domain        text not null,
  url           text not null,
  label         text,
  enabled       boolean not null default true,

  -- Колко продукта на денонощие искаме от този сайт.
  daily_quota   integer not null default 20 check (daily_quota between 1 and 2000),
  -- На колко наведнъж да ги взема (всяко пускане е едно „появяване“).
  burst_min     integer not null default 3 check (burst_min between 1 and 200),
  burst_max     integer not null default 6 check (burst_max between 1 and 200),
  -- Активни часове (в българско време) — нощем не пипаме сайта.
  hour_from     integer not null default 8 check (hour_from between 0 and 23),
  hour_to       integer not null default 22 check (hour_to between 1 and 24),
  -- Колко минути най-малко между две пускания (защита от струпване).
  min_gap_min   integer not null default 20 check (min_gap_min between 0 and 1440),

  mode          text not null default 'preview' check (mode in ('preview','import')),
  options       jsonb not null default '{}'::jsonb,

  -- Състояние на текущото денонощие
  day_key       date,
  used_today    integer not null default 0,
  runs_today    integer not null default 0,
  -- Обща статистика (не се нулира)
  total_imported integer not null default 0,
  total_crawled  integer not null default 0,
  total_jobs     integer not null default 0,

  last_run_at   timestamptz,
  next_run_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table scrape_schedules is
  'Разписание: дневна квота продукти от сайт, разпръсната на случайни интервали в активните часове.';

create index if not exists scrape_schedules_due_idx on scrape_schedules (enabled, next_run_at);
create index if not exists scrape_schedules_domain_idx on scrape_schedules (domain);

-- Връзка задача ↔ разписание + отчитане на обходените страници.
alter table scrape_jobs add column if not exists schedule_id uuid references scrape_schedules(id) on delete set null;
alter table scrape_jobs add column if not exists pages_visited integer not null default 0;
-- Колко реда са дошли от разписание (за статистиката „колко на ден“).
alter table scrape_jobs add column if not exists source_kind text not null default 'manual';
alter table scrape_jobs add column if not exists options_snapshot jsonb not null default '{}'::jsonb;

comment on column scrape_jobs.pages_visited is
  'Колко страници от сайта са отворени при тази обиколка (обходен ли е сайтът).';
comment on column scrape_jobs.source_kind is
  'manual = пуснато от човек; schedule = пуснато от разписанието.';

create index if not exists scrape_jobs_schedule_idx on scrape_jobs (schedule_id, created_at desc);
