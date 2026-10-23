-- 054: 📨 Седмичен дайджест по известия (Web Push) — двигател за задържане.
--
-- Защо: приложението имаше push инфраструктура, но НИЩО не я задействаше само.
-- Човек трябваше да влезе, за да види новите находки. Тук добавяме седмично
-- известие „най-добрите находки тази седмица“ — по ГРАД на човека, за да е
-- полезно, а не спам („3 нови находки в София“).
--
-- Само се добавя.

create table if not exists push_digest_log (
  id          bigserial primary key,
  run_at      timestamptz not null default now(),
  trigger     text not null default 'auto' check (trigger in ('auto', 'manual', 'dry')),
  window_days integer not null default 7,
  cities      integer not null default 0,   -- в колко града има находки
  findings    integer not null default 0,   -- колко находки влизат
  targeted    integer not null default 0,   -- на колко души им е изпратено
  sent        integer not null default 0,   -- успешни пратки (устройства)
  gone        integer not null default 0,   -- мъртви абонаменти (изчистени)
  failed      integer not null default 0,
  note        text
);

create index if not exists push_digest_log_run_idx on push_digest_log (run_at desc);
