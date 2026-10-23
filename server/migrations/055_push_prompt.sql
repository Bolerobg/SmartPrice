-- 055: 🔔 Умна покана „включи известията“ — след първа ПОЛЗА, не веднага.
--
-- Защо: push известията работеха, но абонати бяха 0 — картата стоеше в „Профил“
-- и никой не я виждаше. Покана веднага след регистрация дразни; покана СЛЕД като
-- човекът вече е видял ползата (отворил е няколко находки) е на място.
--
-- Броячът е ОТДЕЛЕН от този за даренията (`interactions_since_prompt`), за да не
-- се смесват двете покани: подкрепа с пари и включване на известия са различни неща.
--
-- Само се добавя.

alter table profiles
  add column if not exists push_prompt_count integer not null default 0,
  -- Кога за последно е била ПОКАЗАНА поканата (за пауза от 14 дни).
  add column if not exists push_prompt_at timestamptz,
  -- „Не ми показвай повече“ — уважаваме го завинаги.
  add column if not exists push_prompt_never boolean not null default false;

comment on column profiles.push_prompt_count is
  'Колко пъти човекът е показал, че ползва приложението (отваряне на оферта/поток), след като е отказал известията.';
comment on column profiles.push_prompt_at is
  'Кога за последно видя поканата за известия (пауза 14 дни, за да не досаждаме).';
comment on column profiles.push_prompt_never is
  'Човекът каза „не ми показвай повече“ поканата за известия.';
