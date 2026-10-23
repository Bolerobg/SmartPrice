-- 052: 🏢 „Търговец в SmartPrice“ — бизнес профили, проверка и право на отговор.
--
-- Защо: досега приложението беше едностранно (само потребители внасят цени).
-- Търговецът нямаше как да каже „това е моят обект“ и да отговори на сигнал.
-- Тук се добавя втората страна — с проверка по ЕИК и официален отговор.
--
-- Нищо не се трие и не се променя по съществуващите таблици — само се добавя.

create table if not exists business_accounts (
  id             bigserial primary key,
  -- Кой профил от приложението представлява бизнеса.
  owner_user_id  bigint not null references profiles(id) on delete cascade,

  -- Обектът се разпознава по ТОЧНО съЩИЯ слуг като в v_objects:
  -- md5(lower(btrim(place_name)) || '|' || lower(btrim(city)))
  venue_slug     text not null,
  place_name     text not null,
  city           text,

  -- Правни данни на търговеца.
  legal_name     text not null,
  tax_id         text,                     -- ЕИК/Булстат (само цифри, 9–13)
  contact_email  text not null,
  contact_phone  text,
  proof_url      text,                     -- касова бележка/документ, който доказва собственост

  status         text not null default 'pending'
                 check (status in ('pending', 'verified', 'rejected')),
  tier           text not null default 'free'
                 check (tier in ('free', 'verified')),
  -- До кога е платен абонаментът „Проверен търговец“ (Фаза 2 — Stripe).
  paid_until     timestamptz,
  -- Одобрено автоматично (ЕИК от касова бележка на същия обект) ли е.
  auto_approved  boolean not null default false,
  reject_reason  text,
  reviewed_at    timestamptz,
  reviewed_by    text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Един профил може да заяви един и същ обект само веднъж.
create unique index if not exists business_accounts_owner_venue_idx
  on business_accounts (owner_user_id, venue_slug);

-- ЕДИН обект може да има само един ПРОВЕРЕН търговец (иначе двама ще говорят
-- от името на един обект). Чакащите/отхвърлените не пречат.
create unique index if not exists business_accounts_verified_venue_idx
  on business_accounts (venue_slug) where status = 'verified';

create index if not exists business_accounts_status_idx on business_accounts (status, created_at desc);
create index if not exists business_accounts_tax_id_idx on business_accounts (regexp_replace(coalesce(tax_id, ''), '\D', '', 'g'));

-- Право на отговор: официален отговор на проверения търговец под конкретен сигнал.
create table if not exists business_replies (
  id           bigserial primary key,
  business_id  bigint not null references business_accounts(id) on delete cascade,
  post_id      bigint not null references posts(id) on delete cascade,
  body         text not null,
  created_at   timestamptz not null default now()
);

-- Един официален отговор на сигнал (не спам от по 10 отговора).
create unique index if not exists business_replies_unique_idx on business_replies (business_id, post_id);
create index if not exists business_replies_post_idx on business_replies (post_id, created_at desc);
