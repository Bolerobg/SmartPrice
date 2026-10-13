-- ============================================================================
-- 011_raffles.sql — Томболи: условие → нареждане на пъзел → най-бърз печели
--
-- Честност (защо е устроено така):
--   • условието се ПРОВЕРЯВА от базата (N находки със снимка), не се вярва на клиента;
--   • официалното време се мери на СЪРВЪРА (run_started_at → run/finish = now() - start);
--     клиентът не подава време, значи не може да мами;
--   • дъската на пъзела е една и съща за всички (генерира се от id-то на томболата);
--   • тренировките са 3 и НЕ влизат в класацията.
-- ============================================================================

create table if not exists raffles (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null check (char_length(btrim(title)) between 3 and 160),
  description           text not null default '',
  prize_title           text not null check (char_length(btrim(prize_title)) between 2 and 200),
  prize_url             text,
  prize_image_url       text,
  prize_price           numeric(10, 2) check (prize_price is null or prize_price >= 0),
  prize_currency        text not null default 'EUR',
  condition_posts        integer not null default 3 check (condition_posts between 1 and 50),
  condition_images_only boolean not null default true,
  min_participants      integer not null default 5 check (min_participants between 1 and 100000),
  count_from_start      boolean not null default true,
  starts_at             timestamptz not null default now(),
  ends_at               timestamptz not null,
  status                text not null default 'draft'
                        check (status in ('draft', 'active', 'running', 'finished', 'cancelled')),
  cancel_reason         text,
  winner_id             uuid references profiles(id) on delete set null,
  winning_time_ms       integer,
  qualified_count       integer not null default 0,
  started_running_at    timestamptz,
  finished_at           timestamptz,
  created_by            uuid references profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint raffles_window check (ends_at > starts_at)
);

create index if not exists idx_raffles_status on raffles (status, ends_at desc);

-- Кой участва и с какво време
create table if not exists raffle_entries (
  raffle_id        uuid not null references raffles(id) on delete cascade,
  user_id          uuid not null references profiles(id) on delete cascade,
  qualified_at     timestamptz not null default now(),
  posts_count      integer not null default 0,
  practice_used    integer not null default 0,
  best_practice_ms integer,
  run_started_at   timestamptz,
  run_time_ms      integer,
  run_finished_at  timestamptz,
  official_attempts integer not null default 0,
  disqualified     boolean not null default false,
  created_at       timestamptz not null default now(),
  primary key (raffle_id, user_id)
);

create index if not exists idx_raffle_entries_raffle on raffle_entries (raffle_id, run_time_ms nulls last);

-- Одиторски дневник: какво се е случило и кога (за спорове „аз бях по-бърз“)
create table if not exists raffle_events (
  id         bigserial primary key,
  raffle_id  uuid not null references raffles(id) on delete cascade,
  user_id    uuid references profiles(id) on delete set null,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_raffle_events_raffle on raffle_events (raffle_id, created_at desc);

-- Колко пъти сме показали рекламния модал (макс. 3 на човек — не досаждаме)
create table if not exists raffle_promo_views (
  raffle_id     uuid not null references raffles(id) on delete cascade,
  user_id       uuid references profiles(id) on delete cascade,
  anon_key      text,
  views         integer not null default 0,
  last_shown_at timestamptz not null default now(),
  primary key (raffle_id, user_id)
);

-- Значки за томболи (без metric: отключват се директно от кода на томболата)
insert into badges (id, title, icon, description, color, sort_order)
values
  ('badge-raffle-play',  'Участник в томбола', 'ticket',  'Участвал в томбола и нареди пъзела', '#34D399', 140),
  ('badge-raffle-win',   'Спечелил томбола',   'trophy',  'Спечелил награда от томбола',        '#FBBF24', 141)
on conflict (id) do update
  set title = excluded.title, icon = excluded.icon, description = excluded.description,
      color = excluded.color, sort_order = excluded.sort_order;

insert into profile_badges (profile_id, badge_id)
select p.id, b.id from profiles p cross join badges b where b.id in ('badge-raffle-play','badge-raffle-win')
on conflict (profile_id, badge_id) do nothing;
