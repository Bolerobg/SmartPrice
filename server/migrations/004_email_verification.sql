-- ============================================================================
-- 004 — Потвърждение на имейл и забравена парола
--
-- Добавя:
--   1. profiles.email_verified_at — кога е потвърден имейлът.
--      NULL = не е потвърден → входът се отказва.
--   2. Таблица email_verifications — еднократни 6-цифрени кодове за
--      потвърждение на регистрация и за смяна на забравена парола.
--
-- Кодовете НЕ се пазят в явен вид — само bcrypt хеш. Проверката е с
-- ограничен брой опити, за да не може да се познае код с brute force.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Статус на потвърждение в профила
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists email_verified_at timestamptz;

comment on column profiles.email_verified_at is
  'Кога е потвърден имейлът. NULL = не е потвърден (входът се отказва).';

-- Съществуващите профили (демо и тестови) се отбелязват като потвърдени,
-- за да не се заключим извън собствения си акаунт след тази миграция.
update profiles
   set email_verified_at = created_at
 where email_verified_at is null;

-- ---------------------------------------------------------------------------
-- 2. Еднократни кодове
-- ---------------------------------------------------------------------------
create table if not exists email_verifications (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null,
  purpose       text not null check (purpose in ('email_verify', 'password_reset')),
  code_hash     text not null,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  attempts      int not null default 0,
  last_sent_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),

  -- Разумни граници, за да няма безкрайни стойности при бъг
  constraint email_verifications_attempts_range check (attempts between 0 and 50)
);

-- Търсим последния активен код за даден имейл и цел
create index if not exists email_verifications_lookup_idx
  on email_verifications (email, purpose, created_at desc);

-- За ограничаване на изпращанията (колко кода са поискани наскоро)
create index if not exists email_verifications_rate_idx
  on email_verifications (email, created_at desc);

comment on table email_verifications is
  'Еднократни 6-цифрени кодове. Пази се само bcrypt хеш, не самият код. '
  'expires_at = 15 минути, attempts се вдига при всеки грешен опит.';

-- ---------------------------------------------------------------------------
-- 3. Почистване на стари кодове (пазим само последните 30 дни)
-- ---------------------------------------------------------------------------
create or replace function cleanup_email_verifications()
returns void
language sql
as $$
  delete from email_verifications where created_at < now() - interval '30 days';
$$;
