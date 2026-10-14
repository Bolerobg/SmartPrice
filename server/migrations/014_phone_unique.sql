-- ============================================================================
-- 014 — Един човек = един акаунт (телефонен номер)
--
-- Защо: профилът беше само по имейл, а имейли се правят безброй безплатно.
-- Така един човек можеше да си направи 20 акаунта, да трупа точки по покани
-- и да цоца томболите. Телефонният номер е задължителен при регистрация и
-- уникален: втори профил със същия номер НЕ може да се създаде.
--
-- IP адресът НЕ се блокира твърдо — българските мобилни оператори ползват
-- CGNAT и стотици хора излизат с едно IP. Затова IP-то само вдига
-- предупреждение в админ панела (виж signups_per_ip в security.ts).
-- ============================================================================

alter table profiles add column if not exists phone text;

-- Нормализиран номер: само цифри, международен формат без „+“.
--   088 123 4567   -> 359881234567
--   +359881234567  -> 359881234567
--   00 359 88 1234567 -> 359881234567
create or replace function normalize_phone(raw text) returns text
language sql immutable as $$
  select case
    when d is null or d = '' then null
    when d like '00%' then
      case
        when substr(d, 3) like '359%'     then substr(d, 3)
        when length(substr(d, 3)) = 9     then '359' || substr(d, 3)
        else substr(d, 3)
      end
    when d like '359%' then d
    when d like '0%'   then '359' || substr(d, 2)
    when length(d) = 9 then '359' || d
    else d
  end
  from (select regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g') as d) t
$$;

-- Подсигуряване: ако случайно вече има дубликати, оставяме най-стария
-- профил с номера и нулираме номера на останалите (иначе уникалният
-- индекс не може да се създаде).
update profiles set phone = normalize_phone(phone) where phone is not null;

with ranked as (
  select id, row_number() over (partition by phone order by created_at asc, id asc) as rn
    from profiles
   where phone is not null
)
update profiles p set phone = null
  from ranked r
 where p.id = r.id and r.rn > 1;

-- Един номер = най-много един профил. Частичният индекс позволява
-- стари профили без телефон (null) да продължат да съществуват.
create unique index if not exists profiles_phone_unique
  on profiles (phone) where phone is not null;

comment on column profiles.phone is
  'Нормализиран телефонен номер (напр. 359881234567). Уникален — един човек, един акаунт.';
