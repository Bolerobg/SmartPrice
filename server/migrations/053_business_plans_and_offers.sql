-- 053: 💰 Фаза 2 на „Търговец в SmartPrice“ — абонамент, оферти, статистика.
--
-- Парите идват от бизнесите, не от потребителите. Тук се добавя:
--   • плащане на абонамент (19 €/месец) през Stripe — същият webhook като даренията;
--   • оферти от търговеца (промоция с цена и срок) — показват се в НЕГОВИЯ обект,
--     НЕ в общата лента с находки (лентата е честна цена, не реклама);
--   • статистика колко души гледат обекта — аргументът да плащат.
--
-- Само се добавя, нищо по съществуващите таблици не се променя.

-- Плащания за абонамент „Проверен търговец".
create table if not exists business_payments (
  id                        bigserial primary key,
  business_id               bigint not null references business_accounts(id) on delete cascade,
  user_id                   uuid not null references profiles(id) on delete cascade,
  amount                    numeric(10, 2) not null,
  currency                  text not null default 'EUR',
  -- Колко месеца отваря едно плащане.
  months                    integer not null default 1 check (months between 1 and 12),
  stripe_checkout_session_id text unique,
  stripe_subscription_id    text,
  status                    text not null default 'pending'
                            check (status in ('pending', 'succeeded', 'failed')),
  -- Идемпотентност: едно събитие от Stripe се обработва веднъж.
  stripe_event_id           text,
  created_at                timestamptz not null default now(),
  paid_at                   timestamptz
);

create index if not exists business_payments_business_idx on business_payments (business_id, created_at desc);
create index if not exists business_payments_sub_idx on business_payments (stripe_subscription_id);

-- Оферти от търговеца (промоция в НЕГОВИЯ обект).
create table if not exists business_offers (
  id           bigserial primary key,
  business_id  bigint not null references business_accounts(id) on delete cascade,
  title        text not null check (char_length(btrim(title)) between 3 and 120),
  description  text not null default '' check (char_length(description) <= 1000),
  price        numeric(10, 2) check (price > 0 and price <= 1000000),
  -- Може и „вместо 12.90 €" — за да се вижда отстъпката.
  old_price    numeric(10, 2) check (old_price > 0 and old_price <= 1000000),
  image_url    text,
  valid_until  date,
  status       text not null default 'active' check (status in ('active', 'hidden')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists business_offers_business_idx on business_offers (business_id, created_at desc);

-- Гледания на обекта по дни (статистиката за търговеца). Обектът е слуг, не uuid —
-- така броим и обекти, които още нямат собствен търговец.
create table if not exists venue_views (
  venue_slug  text not null,
  day         date not null,
  views       integer not null default 0,
  primary key (venue_slug, day)
);

create index if not exists venue_views_day_idx on venue_views (day);
