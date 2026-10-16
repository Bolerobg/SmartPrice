-- ============================================================================
-- 021_sponsor_raffles.sql
--
-- Томболи със СПОНСОР: „Събери 10 находки и вземи крем за лице от <спонсор>“.
--
-- Какво ново спрямо досегашните томболи:
--   1. Спонсор на наградата + вътрешни бележки за теб (контакт, фактура) и
--      публични правила на томболата — печалба от спонсор трябва да е описана,
--      иначе изглежда като „нашият подарък“ и никой не вярва.
--   2. Нов режим на печелене: first_to_complete — първият, който изпълни
--      условието, печели ВЕДНАГА (без пъзел за време). Старият режим
--      fastest_puzzle остава и работи както досега.
--   3. ОПАШКА от томболи: когато една бъде спечелена, тя се затваря и
--      следващата (по queue_order) се пуска автоматично — различна награда.
--   4. Данни за доставка от победителя (отделна таблица, само админ и самият
--      победител ги виждат) + статуси: чака данни → за изпращане → изпратено.
--   5. Краен срок: ако победителят не даде адрес навреме, наградата отива при
--      следващия в класирането — иначе тя увисва завинаги.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Нови полета на томболата
-- ---------------------------------------------------------------------------
alter table raffles
  -- --- спонсор и правила -------------------------------------------------
  add column if not exists sponsor_name    text,
  add column if not exists sponsor_url     text,
  add column if not exists rules_text      text not null default '',
  add column if not exists sponsored_note  text,   -- ВЪТРЕШНО: за какво сме се разбрали
  add column if not exists sponsor_contact text,   -- ВЪТРЕШНО: име/имейл/телефон на спонсора

  -- --- награда ----------------------------------------------------------
  add column if not exists prize_kind       text not null default 'product'
      check (prize_kind in ('product', 'cash', 'service', 'other')),
  add column if not exists prize_value_eur  numeric(10, 2),
  add column if not exists delivery_note    text not null default '',

  -- --- как се печели ----------------------------------------------------
  add column if not exists win_mode text not null default 'fastest_puzzle'
      check (win_mode in ('fastest_puzzle', 'first_to_complete')),

  -- --- опашка -----------------------------------------------------------
  add column if not exists queue_order        integer not null default 100,
  add column if not exists auto_activate_next boolean not null default true,
  add column if not exists claim_deadline_days integer not null default 7
      check (claim_deadline_days between 1 and 90),

  -- --- как е приключила -------------------------------------------------
  add column if not exists closed_reason text
      check (closed_reason is null or closed_reason in ('won', 'no_winner', 'cancelled', 'expired')),
  add column if not exists activated_at  timestamptz;

comment on column raffles.win_mode is
  'fastest_puzzle = най-бързото нареждане в синхронен прозорец (старото); first_to_complete = първият, който събере condition_posts находки, печели веднага';
comment on column raffles.queue_order is
  'Поредност в опашката. Когато томбола бъде спечелена и auto_activate_next е true, се пуска следващата с най-малък queue_order.';
comment on column raffles.sponsored_note is
  'ВЪТРЕШНО (не се показва на потребителите): уговорки със спонсора, кой плаща доставката и т.н.';

create index if not exists raffles_queue_idx on raffles (status, queue_order, starts_at);
create index if not exists raffles_win_mode_idx on raffles (win_mode) where status in ('active', 'running');

-- ---------------------------------------------------------------------------
-- 2. Печалби: кой е спечелил, какви данни е дал за доставка, изпратено ли е
-- ---------------------------------------------------------------------------
create table if not exists raffle_wins (
  id               uuid primary key default gen_random_uuid(),
  raffle_id        uuid not null unique references raffles(id) on delete cascade,
  user_id          uuid not null references profiles(id) on delete cascade,
  won_at           timestamptz not null default now(),
  /** Как е определен: автоматично (първи изпълнил условието) или от админ. */
  decided_by       text not null default 'auto' check (decided_by in ('auto', 'admin', 'replacement')),

  -- Данни за доставка — ЛИЧНИ. Показват се само на админа и на самия победител.
  delivery_name    text,
  delivery_phone   text,
  delivery_city    text,
  delivery_address text,
  delivery_note    text,
  claimed_at       timestamptz,

  status           text not null default 'pending_data'
                   check (status in ('pending_data', 'ready_to_ship', 'shipped', 'delivered', 'expired')),
  shipped_at       timestamptz,
  tracking_note    text,   -- номер на пратка / куриер
  admin_note       text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists raffle_wins_status_idx on raffle_wins (status, won_at desc);
create index if not exists raffle_wins_user_idx on raffle_wins (user_id, won_at desc);

comment on table raffle_wins is
  'Спечелени награди: кой, кога, с какви данни за доставка, изпратена ли е. Данните за доставка са лични — достъп само за админ панела и за самия победител.';

-- ---------------------------------------------------------------------------
-- 3. Дневник на томболата (публично прозрачен): кой какво е правил и кога
-- ---------------------------------------------------------------------------
alter table raffle_events add column if not exists is_public boolean not null default false;

comment on column raffle_events.is_public is
  'Публични събития се показват в историята на томболата — за да е видно кой е спечелил и защо.';
