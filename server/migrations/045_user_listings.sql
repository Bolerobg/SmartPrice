-- 045: ЧАСТНИ ОБЯВИ ОТ ПОТРЕБИТЕЛИ (платени).
--
-- Защо отделна таблица, а не `posts`: офертата е „видях тази цена“, а обявата е
-- „продавам това“. Обявата има СРОК (плаща се 2 € за 60 дни), може да се спре,
-- когато се продаде, и трябва история за дашборда. Ако смесeхме двете в
-- `posts`, всяка промяна по офертите щеше да рискува платените обяви.
--
-- ВАЖНО: всичко е с `if not exists` — урокът от миграция 042, която свали API-то.
-- ВАЖНО: не се ползват запазени думи на PostgreSQL за имена на колони
-- (`offset`, `order`, `user`, `limit`, `group`, `check`, `end`, `year`…).

create table if not exists listings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles(id) on delete cascade,
  title             text not null,
  description       text not null default '',
  -- Цената на стоката (не таксата за обявата) — може и да липсва („на запитване“).
  price_eur         numeric(10, 2),
  is_negotiable     boolean not null default false,
  is_free           boolean not null default false,
  category          text not null default 'other',
  subcategory       text,
  city              text not null default '',
  neighborhood      text,
  address           text,
  latitude          double precision,
  longitude         double precision,
  -- Състояние на стоката: new | like_new | used | for_parts
  item_condition    text not null default 'used',
  contact_phone     text,
  contact_note      text,
  -- Как се предава: pickup | shipping | both
  handover          text not null default 'pickup',
  -- Живот на обявата
  status            text not null default 'draft',
  days              integer not null default 60,
  paid_until        timestamptz,
  activated_at      timestamptz,
  paused_at         timestamptz,
  paused_days       integer not null default 0,
  sold_at           timestamptz,
  expires_at        timestamptz,
  -- Пари и брой подновявания (за прозрачност в дашборда)
  price_paid_eur    numeric(10, 2),
  renewals          integer not null default 0,
  -- Как върви обявата
  views_count       integer not null default 0,
  saves_count       integer not null default 0,
  contacts_count    integer not null default 0,
  -- Модерация
  reject_reason     text,
  -- „Издигане“ (по избор, ако някога пуснем турбо)
  boosted_until     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists listings_user_idx on listings (user_id, created_at desc);
create index if not exists listings_status_idx on listings (status, paid_until);
create index if not exists listings_city_idx on listings (city, created_at desc);
create index if not exists listings_category_idx on listings (category, created_at desc);

-- До 5 снимки на обява (по ред).
create table if not exists listing_images (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings(id) on delete cascade,
  url         text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists listing_images_listing_idx on listing_images (listing_id, position);

-- Плащанията: ЕДИН запис на всяко плащане (пускане, подновяване, издигане).
-- Пазим и сесията на Stripe, за да можем да проверим след връщане от плащане.
create table if not exists listing_payments (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references profiles(id) on delete cascade,
  listing_id                  uuid references listings(id) on delete cascade,
  amount_eur                  numeric(10, 2) not null,
  currency                    text not null default 'EUR',
  days                        integer not null default 60,
  kind                        text not null default 'publish',
  stripe_checkout_session_id  text,
  stripe_payment_intent_id    text,
  status                      text not null default 'pending',
  paid_at                     timestamptz,
  created_at                  timestamptz not null default now()
);

create unique index if not exists listing_payments_session_idx
  on listing_payments (stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create index if not exists listing_payments_user_idx on listing_payments (user_id, created_at desc);
create index if not exists listing_payments_status_idx on listing_payments (status, created_at desc);

-- Историята на обявата: пусната, платена, спряна, продадена, подновена…
-- Точно това чака дашбордът, за да показва „какво се е случвало“.
create table if not exists listing_events (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings(id) on delete cascade,
  user_id     uuid references profiles(id) on delete set null,
  action      text not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists listing_events_listing_idx on listing_events (listing_id, created_at desc);

-- Подканите: и за обявите (купувач → продавач), и за демото на пъзела.
-- Човекът трябва да може да ги ИЗКЛЮЧИ ЗАВИНАГИ — това е изрично изискване.
alter table profiles add column if not exists listing_nudge_off      boolean not null default false;
alter table profiles add column if not exists listing_nudge_until    timestamptz;
alter table profiles add column if not exists listing_nudge_seen     integer not null default 0;
alter table profiles add column if not exists puzzle_demo_nudge_off  boolean not null default false;
alter table profiles add column if not exists puzzle_demo_nudge_until timestamptz;
alter table profiles add column if not exists puzzle_demo_plays      integer not null default 0;
alter table profiles add column if not exists puzzle_demo_best_ms    integer;
