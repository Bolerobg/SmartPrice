-- 035: График на Facebook обиколките — по група: колко поста, колко пъти на ден, в кои часове.
-- Празните настройки (fb_plan_settings) пазят глобалните правила: спиране, таван на ден,
-- нощна пауза, случайно закъснение, спиране при дълга опашка, пауза до дата.
create table if not exists fb_group_plans (
  id                 serial primary key,
  group_url          text        not null unique,
  name               text,
  enabled            boolean     not null default true,
  posts_per_run      integer     not null default 10,
  max_posts_per_day  integer     not null default 0,
  runs_per_day       integer     not null default 2,
  hours              text        not null default '07:30, 19:30',
  min_interval_min   integer     not null default 180,
  priority           integer     not null default 5,
  default_city       text,
  notes              text,
  posts_today        integer     not null default 0,
  runs_today         integer     not null default 0,
  counters_date      date,
  last_run_at        timestamptz,
  last_status        text,
  last_error         text,
  total_posts        integer     not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists fb_group_plans_enabled_idx
  on fb_group_plans (enabled, priority desc, last_run_at nulls first);
