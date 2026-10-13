-- ============================================================================
-- SmartPrice — 012: публичен код на оферта + админ панел
--
-- 1) Всяка оферта получава уникален, четим код (напр. SP-7K2M4Q), който се
--    вижда на обявата и по който може да се търси. НЕ е uuid — uuid-ът остава
--    вътрешен; кодът е за хората (диктува се по телефона, пише се в чат).
-- 2) Профили: временно спиране (с причина и срок), меко изтриване, активност.
-- 3) Одиторски дневник на админа, събития за сигурност, дневник на имейлите,
--    опити за вход (за засичане на атаки).
-- 4) Категориите стават редактируеми (етикет + синоними за търсене).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Публичен код на офертата
-- ---------------------------------------------------------------------------
create sequence if not exists post_code_seq start 1000;

-- Азбука без подвеждащи знаци: без 0/O, 1/I/L. Така кодът не се бърка при
-- преписване на ръка.
create or replace function sp_generate_post_code() returns text as $$
declare
  alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
  i int;
  attempt int := 0;
begin
  loop
    attempt := attempt + 1;
    candidate := 'SP-';
    for i in 1..5 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    if not exists (select 1 from posts where upper(public_code) = candidate) then
      return candidate;
    end if;
    if attempt >= 25 then
      -- практически недостижимо (32^5 ≈ 33 млн.), но да няма безкраен цикъл
      return 'SP-' || upper(to_hex(nextval('post_code_seq')));
    end if;
  end loop;
end;
$$ language plpgsql volatile;

alter table posts add column if not exists public_code text;

update posts set public_code = sp_generate_post_code() where public_code is null;

alter table posts alter column public_code set default sp_generate_post_code();
alter table posts alter column public_code set not null;

create unique index if not exists idx_posts_public_code on posts (upper(public_code));

comment on column posts.public_code is
  'Публичен код на офертата (SP-XXXXX). Вижда се в приложението и се търси по него.';

-- Изгледът се пресъздава, за да върне и кода (лентата чете от него).
-- ВАЖНО: сменяме го с drop + create, защото „create or replace view“ не може да
-- добави колона в средата (само в края) и гърми с „cannot change name of view
-- column“. Изгледът няма зависими обекти, затова е безопасно.
drop view if exists v_posts_full;
create view v_posts_full as
select
  p.id,
  p.public_code,
  p.author_id,
  p.polarity,
  p.category,
  p.custom_category_label,
  p.platform_tag,
  p.custom_platform_label,
  p.title,
  p.description,
  p.place_name,
  p.city,
  p.address,
  p.latitude,
  p.longitude,
  p.google_maps_url,
  p.location_auto_detected,
  p.price_paid,
  p.reference_price,
  p.currency,
  p.unit_quantity,
  p.unit_type,
  p.price_per_unit,
  p.is_shrinkflation,
  p.is_fake_promo,
  p.image_url,
  p.comparison_image_url,
  p.comparison_label,
  p.verified_valid_today_count,
  p.last_verified_at,
  p.helped_count,
  p.community_saved_bgn,
  p.tags,
  p.created_at,
  jsonb_build_object(
    'id', a.id, 'name', a.name, 'handle', a.handle,
    'avatar', a.avatar_url, 'isSupporter', a.is_supporter,
    'badgeTitle', coalesce(
      (select b.title from profile_badges pb join badges b on b.id = pb.badge_id
        where pb.profile_id = a.id and pb.unlocked_at is not null
        order by b.sort_order limit 1),
      'Нов в общността')
  ) as author,
  jsonb_build_object(
    'topDeal',     count(*) filter (where r.reaction_key = 'topDeal'),
    'worthIt',     count(*) filter (where r.reaction_key = 'worthIt'),
    'doubt',       count(*) filter (where r.reaction_key = 'doubt'),
    'pureRobbery', count(*) filter (where r.reaction_key = 'pureRobbery'),
    'avoid',       count(*) filter (where r.reaction_key = 'avoid'),
    'exaggerated', count(*) filter (where r.reaction_key = 'exaggerated')
  ) as reactions,
  (select count(*) from comments c where c.post_id = p.id and c.status = 'published') as comments_count
from posts p
join profiles a on a.id = p.author_id
left join post_reactions r on r.post_id = p.id
group by p.id, a.id;

-- ---------------------------------------------------------------------------
-- 2. Профили: спиране, изтриване, активност
-- ---------------------------------------------------------------------------
alter table profiles
  add column if not exists suspended_at     timestamptz,
  add column if not exists suspended_until  timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists suspended_by     uuid references profiles(id) on delete set null,
  add column if not exists deleted_at       timestamptz,
  add column if not exists deleted_reason   text,
  add column if not exists last_seen_at     timestamptz,
  add column if not exists last_login_at    timestamptz,
  add column if not exists login_count      integer not null default 0,
  add column if not exists signup_ip        text;

create index if not exists idx_profiles_suspended on profiles (suspended_at) where suspended_at is not null;
create index if not exists idx_profiles_deleted   on profiles (deleted_at)   where deleted_at is not null;
create index if not exists idx_profiles_last_seen on profiles (last_seen_at desc);

-- ---------------------------------------------------------------------------
-- 3. Админ: одит, сигурност, имейли, опити за вход
-- ---------------------------------------------------------------------------
create table if not exists admin_audit_log (
  id           bigserial primary key,
  admin_id     uuid references profiles(id) on delete set null,
  admin_email  text,
  action       text not null,
  target_type  text,
  target_id    text,
  target_label text,
  details      jsonb not null default '{}'::jsonb,
  ip           text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_admin_audit_created on admin_audit_log (created_at desc);
create index if not exists idx_admin_audit_action  on admin_audit_log (action, created_at desc);

create table if not exists security_events (
  id           bigserial primary key,
  kind         text not null,
  severity     text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  title        text not null,
  details      jsonb not null default '{}'::jsonb,
  subject_type text,
  subject_id   text,
  subject_label text,
  ip           text,
  alerted_at   timestamptz,
  resolved_at  timestamptz,
  resolved_by  uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_security_events_created on security_events (created_at desc);
create index if not exists idx_security_events_kind    on security_events (kind, created_at desc);
create index if not exists idx_security_events_open    on security_events (created_at desc) where resolved_at is null;

create table if not exists admin_email_log (
  id           bigserial primary key,
  to_email     text not null,
  subject      text not null,
  kind         text not null,
  provider_id  text,
  status       text not null default 'sent' check (status in ('sent', 'failed', 'skipped')),
  error        text,
  related_type text,
  related_id   text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_admin_email_log_created on admin_email_log (created_at desc);

create table if not exists login_attempts (
  id         bigserial primary key,
  email      citext,
  ip         text,
  ok         boolean not null,
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists idx_login_attempts_created on login_attempts (created_at desc);
create index if not exists idx_login_attempts_ip      on login_attempts (ip, created_at desc);
create index if not exists idx_login_attempts_email   on login_attempts (email, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Категории: редактируеми етикети + синоними (за търсенето)
-- ---------------------------------------------------------------------------
create table if not exists category_labels (
  id         text primary key,
  title      text not null,
  emoji      text not null default '',
  synonyms   text not null default '',
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into category_labels (id, title, emoji, synonyms, sort_order) values
  ('restaurants',   'Ресторанти',  '🍽️', 'ресторанти заведения храна обяд вечеря кръчма', 1),
  ('hotels_airbnb', 'Хотели',      '🏨', 'хотели airbnb booking нощувка настаняване', 2),
  ('supermarket',   'Магазини',    '🛒', 'магазини продукти супермаркет храна', 3),
  ('cafes_bars',    'Кафенета',    '☕', 'кафенета барове сладкарници кафе бар десерт', 4),
  ('services_tech', 'Услуги',      '🔧', 'услуги техника авто ремонт сервиз', 5),
  ('other',         'Други',       '📦', 'други стоки обекти услуги', 6)
on conflict (id) do nothing;

-- Търсенето вече взима синонимите от таблицата, за да важат промените на админа.
create or replace function sp_category_synonyms(cat text) returns text as $$
  select coalesce((select cl.synonyms from category_labels cl where cl.id = cat), '');
$$ language sql stable;
