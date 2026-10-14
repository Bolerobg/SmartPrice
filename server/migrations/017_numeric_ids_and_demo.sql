-- ============================================================================
-- 017 — Числови ID на офертите + демо (тестов) играч за томболите
--
-- 1) ID-то на офертата става САМО ЧИСЛА и е уникално (8 цифри).
--    Досега беше „SP-7K2M4Q“ — букви и тирета объркват хората по телефона
--    („бе“ или „би“? „осем“ или „О“?). Числата се диктуват без грешка.
--
-- 2) Демо играч: профил, който админът може да включи в томбола, за да
--    демонстрира как изглежда победа (или за тестове преди пускане).
--    Помни се в базата като демо (is_demo), за да е ЯСНО, че не е реален
--    човек — и в админ панела, и в публичните резултати, и в одитния дневник.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Числов ID на оферта
-- ---------------------------------------------------------------------------

create sequence if not exists post_code_seq;

-- 8 цифри: 10 000 000 – 99 999 999 (90 милиона варианта).
create or replace function sp_generate_post_code() returns text as $$
declare
  candidate text;
  attempt int := 0;
begin
  loop
    attempt := attempt + 1;
    candidate := (10000000 + floor(random() * 90000000)::bigint)::text;
    if not exists (select 1 from posts where public_code = candidate) then
      return candidate;
    end if;
    if attempt >= 30 then
      -- практически недостижимо, но да няма безкраен цикъл
      return lpad((100000000 + nextval('post_code_seq'))::text, 9, '0');
    end if;
  end loop;
end;
$$ language plpgsql;

comment on function sp_generate_post_code() is
  'Числов уникален ID на оферта (8 цифри). Числата се диктуват по телефона без грешка.';

-- Старите кодове (SP-XXXXX) се заменят с числови. Пренареждаме ги
-- детерминирано, за да е уникално по построение и да не се удари уникалният
-- индекс по средата на обновяването.
with numbered as (
  select id, row_number() over (order by created_at asc, id asc) as rn
    from posts
)
update posts p
   set public_code = (50000000 + n.rn)::text
  from numbered n
 where p.id = n.id;

-- ---------------------------------------------------------------------------
-- 2. Демо играч за томболите
-- ---------------------------------------------------------------------------

alter table profiles add column if not exists is_demo boolean not null default false;
alter table raffle_entries add column if not exists is_demo boolean not null default false;

create index if not exists idx_profiles_demo on profiles (is_demo) where is_demo;
create index if not exists idx_raffle_entries_demo on raffle_entries (raffle_id) where is_demo;

comment on column profiles.is_demo is
  'Демо (тестов) играч — не е реален човек. Вижда се като демо и в панела, и в резултатите.';
comment on column raffle_entries.is_demo is
  'Това участие е на демо играча: при разиграване получава случайно по-добро време.';
comment on column posts.public_code is
  'Числов уникален ID на офертата (8 цифри), уникален по upper(public_code).';
