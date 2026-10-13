-- ============================================================================
-- 010_referrals.sql — Поканален цикъл (реферален код + двойни точки)
--
-- Защо: разпространението трябва да е ВГРАДЕНО в продукта, не купено. Всеки
-- потребител получава собствен код; когато поканеният се регистрира И си
-- потвърди имейла, И ДВАМАТА получават точки:
--   • поканеният  — 100 точки (двойно спрямо обичайните 50 при старт)
--   • поканващият — 100 точки (двойно)
-- Точките са същите „точки доверие“ (reputation_points), които хранят
-- ранглистата, значките и профила. Така поканата носи реален статус.
--
-- Защо чак след потвърждение на имейла: иначе един човек може да си направи
-- 100 фалшиви профила и да натрупа точки. Потвърден имейл = реален човек.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Кодът на всеки профил + от кого е поканен
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists referral_code  text;
alter table profiles add column if not exists referred_by    uuid references profiles(id) on delete set null;
alter table profiles add column if not exists referred_at    timestamptz;
alter table profiles add column if not exists referral_points integer not null default 0;

comment on column profiles.referral_code is
  'Личен код за покана (напр. A1B2C3). Който го използва при регистрация, носи точки и на двамата.';
comment on column profiles.referred_by is
  'Кой е поканил този профил (ако е дошъл по реферален линк).';
comment on column profiles.referral_points is
  'Колко точки са дошли ИМЕННО от покани (за да се вижда приносът им отделно).';

-- Код се генерира автоматично при създаване на профил (и се проверява за
-- заетост в цикъл — при 6 hex символа вероятността за сблъсък е нищожна, но
-- не нулева, а уникалността е задължителна).
create or replace function sp_assign_referral_code() returns trigger as $$
declare
  candidate text;
begin
  if new.referral_code is null or btrim(new.referral_code) = '' then
    loop
      candidate := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
      exit when not exists (select 1 from profiles where referral_code = candidate);
    end loop;
    new.referral_code := candidate;
  else
    new.referral_code := upper(regexp_replace(btrim(new.referral_code), '[^A-Za-z0-9]', '', 'g'));
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_referral_code on profiles;
create trigger trg_profiles_referral_code before insert on profiles
  for each row execute function sp_assign_referral_code();

-- Съществуващите профили получават код веднага.
do $$
declare
  r record;
  candidate text;
begin
  for r in select id from profiles where referral_code is null loop
    loop
      candidate := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
      exit when not exists (select 1 from profiles where referral_code = candidate);
    end loop;
    update profiles set referral_code = candidate where id = r.id;
  end loop;
end;
$$;

create unique index if not exists idx_profiles_referral_code
  on profiles (referral_code) where referral_code is not null;

-- ---------------------------------------------------------------------------
-- 2. Самите покани
-- ---------------------------------------------------------------------------
create table if not exists referrals (
  id             uuid primary key default gen_random_uuid(),
  inviter_id     uuid not null references profiles(id) on delete cascade,
  invitee_id     uuid not null unique references profiles(id) on delete cascade,
  code           text not null,
  channel        text,
  status         text not null default 'pending' check (status in ('pending', 'rewarded', 'void')),
  points_inviter integer not null default 0,
  points_invitee integer not null default 0,
  created_at     timestamptz not null default now(),
  rewarded_at    timestamptz,
  constraint referrals_not_self check (inviter_id <> invitee_id)
);

comment on table referrals is
  'Покани: един ред на поканен човек. status=pending до потвърждаване на имейла, после rewarded.';
comment on column referrals.channel is
  'Откъде е дошла поканата (whatsapp, viber, link, story-card…).';

create index if not exists idx_referrals_inviter on referrals (inviter_id, created_at desc);
create index if not exists idx_referrals_status  on referrals (status, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Награждаване — двоен бонус за двамата
-- ---------------------------------------------------------------------------
create or replace function sp_award_referral(p_invitee uuid) returns void as $$
declare
  r          referrals%rowtype;
  v_inviter  integer := 100;
  v_invitee  integer := 100;
  rewarded   integer;
begin
  select * into r from referrals where invitee_id = p_invitee and status = 'pending';
  if not found then
    return;
  end if;

  update profiles
     set reputation_points = reputation_points + v_invitee,
         referral_points   = referral_points   + v_invitee
   where id = p_invitee;

  update profiles
     set reputation_points = reputation_points + v_inviter,
         referral_points   = referral_points   + v_inviter
   where id = r.inviter_id;

  update referrals
     set status = 'rewarded',
         rewarded_at = now(),
         points_inviter = v_inviter,
         points_invitee = v_invitee
   where id = r.id;

  -- Значките на поканващия се отключват веднага (без да чакаме отваряне на профила).
  select count(*) into rewarded
    from referrals where inviter_id = r.inviter_id and status = 'rewarded';

  update profile_badges pb
     set unlocked_at = now()
    from badges b
   where pb.profile_id = r.inviter_id
     and pb.badge_id = b.id
     and pb.unlocked_at is null
     and b.metric = 'referrals'
     and rewarded >= b.threshold;
end;
$$ language plpgsql;

-- Наградата се дава при потвърждаване на имейла (преход null → дата).
create or replace function sp_on_profile_verified() returns trigger as $$
begin
  if new.email_verified_at is not null and old.email_verified_at is null then
    perform sp_award_referral(new.id);
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_profile_verified on profiles;
create trigger trg_profile_verified after update on profiles
  for each row execute function sp_on_profile_verified();

-- ---------------------------------------------------------------------------
-- 4. Значки за поканващите
-- ---------------------------------------------------------------------------
insert into badges (id, title, icon, description, color, sort_order, metric, threshold)
values
  ('badge-invite-1',  'Първи приятел',          'person-add', 'Покани първия си приятел в SmartPrice',      '#34D399', 130, 'referrals',  1),
  ('badge-invite-5',  'Разпространител',        'people',     'Покани 5 приятели, които се регистрираха',   '#22D3EE', 131, 'referrals',  5),
  ('badge-invite-25', 'Посланик на SmartPrice', 'megaphone',  'Покани 25 приятели — носиш общността напред', '#FBBF24', 132, 'referrals', 25)
on conflict (id) do update
  set title = excluded.title,
      icon = excluded.icon,
      description = excluded.description,
      color = excluded.color,
      sort_order = excluded.sort_order,
      metric = excluded.metric,
      threshold = excluded.threshold;

comment on column badges.metric is
  'От какво зависи значката: price_checks | price_corrections | reputation_points | posts | receipts | red_flags | savings | supporter | referrals';

insert into profile_badges (profile_id, badge_id)
select p.id, b.id from profiles p cross join badges b where b.metric = 'referrals'
on conflict (profile_id, badge_id) do nothing;

-- Отключваме заслуженото за вече поканените (ако има такива).
with counts as (
  select inviter_id as id, count(*) as rewarded
    from referrals where status = 'rewarded' group by inviter_id
)
update profile_badges pb
   set unlocked_at = now()
  from counts c, badges b
 where pb.profile_id = c.id
   and pb.badge_id = b.id
   and pb.unlocked_at is null
   and b.metric = 'referrals'
   and c.rewarded >= b.threshold;
