-- 046: ПЪЛНА СТАТИСТИКА НА ПОТРЕБИТЕЛИТЕ.
--
-- Какво липсваше досега: в `profiles` има само БРОЯЧ на входовете (login_count)
-- и последния вход. Не се знаеше КОЙ КОГА е влизал, КОЛКО ПЪТИ на ден и КЪДЕ
-- отваря в приложението. Тук добавяме точно това.
--
-- ВАЖНО: всичко е с `if not exists` — урокът от миграция 042.
-- ВАЖНО: не се ползват запазени думи на PostgreSQL за имена на колони.

-- Всеки вход, регистрация, изход и неуспешен опит. Това е ИСТОРИЯТА, не брояч.
create table if not exists auth_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete set null,
  email       text,
  -- login | register | logout | failed | refresh
  kind        text not null,
  ip          text,
  user_agent  text,
  -- windows | android | ios | mac | linux | other
  platform    text,
  -- chrome | safari | firefox | edge | app | other
  browser     text,
  created_at  timestamptz not null default now()
);

create index if not exists auth_events_user_idx on auth_events (user_id, created_at desc);
create index if not exists auth_events_time_idx on auth_events (created_at desc);
create index if not exists auth_events_kind_idx on auth_events (kind, created_at desc);

-- Къде отваря човекът: сбор за деня по екран (за графики и класации).
create table if not exists user_screen_views (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  day        date not null default current_date,
  screen     text not null,
  views      integer not null default 0,
  seconds    integer not null default 0,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  unique (user_id, day, screen)
);

create index if not exists user_screen_views_day_idx on user_screen_views (day, screen);
create index if not exists user_screen_views_user_idx on user_screen_views (user_id, day desc);

-- Хронология на посещенията (последните N отваряния — „кой къде е бил и кога“).
create table if not exists user_activity_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete cascade,
  screen      text not null,
  platform    text,
  ip          text,
  created_at  timestamptz not null default now()
);

create index if not exists user_activity_log_user_idx on user_activity_log (user_id, created_at desc);
create index if not exists user_activity_log_time_idx on user_activity_log (created_at desc);

-- Дневна активност на човек (за DAU/WAU/MAU и графиките по дни).
create table if not exists user_daily_activity (
  day       date not null,
  user_id   uuid not null references profiles(id) on delete cascade,
  sessions  integer not null default 0,
  screens   integer not null default 0,
  actions   integer not null default 0,
  primary key (day, user_id)
);

create index if not exists user_daily_activity_day_idx on user_daily_activity (day);

-- Коя причина за неуспешен вход — за да се виждат опити за влизане в чужди профили.
alter table profiles add column if not exists last_screen text;
alter table profiles add column if not exists last_platform text;
alter table profiles add column if not exists last_ip text;
alter table profiles add column if not exists sessions_count integer not null default 0;
alter table profiles add column if not exists first_seen_at timestamptz;
