-- ============================================================================
-- 021_assistant.sql
--
-- Дневник на разговорите с AI съветника („Ценко“).
--
-- Защо го пазим:
--   1. Ограничаване на злоупотребата — виждаме кой колко пита и дали някой не
--      източва API-то на поразия.
--   2. Учене от реалните въпроси — най-честите питания показват какво не е
--      ясно в приложението, т.е. къде да подобрим екраните.
--   3. Разход — всеки отговор носи токени; искаме да знаем цената.
--
-- НЕ пазим нищо чувствително: въпросът се реже до 500 знака, отговорът се
-- записва само като дължина (за статистика), не като текст.
-- ============================================================================

create table if not exists assistant_messages (
  id            bigserial primary key,
  user_id       uuid references profiles(id) on delete set null,
  ip            text,
  question      text not null,
  answer_chars  integer not null default 0,
  suggestions   jsonb not null default '[]'::jsonb,
  model         text,
  prompt_tokens integer,
  answer_tokens integer,
  latency_ms    integer,
  is_greeting   boolean not null default false,
  created_at    timestamptz not null default now()
);

comment on table assistant_messages is
  'Разговори с AI съветника: за лимити, разход и разбиране на честите въпроси.';

-- „Колко е питал този човек в последния час?“ — основната заявка за лимита.
create index if not exists assistant_messages_user_time_idx
  on assistant_messages (user_id, created_at desc);

create index if not exists assistant_messages_ip_time_idx
  on assistant_messages (ip, created_at desc)
  where user_id is null;
