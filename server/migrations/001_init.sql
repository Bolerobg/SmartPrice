-- ============================================================================
-- SmartPrice — PostgreSQL схема (v1)
-- Самостоятелен PostgreSQL, без Supabase. Всички правила и цялостност
-- на данните живеят в базата: CHECK ограничения, външни ключове, тригери,
-- изгледи и материални броячи (posts.helped_count и т.н.).
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- 1. Профили (реална автентикация с email + парола)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id                       uuid primary key default gen_random_uuid(),
  email                    citext not null unique,
  password_hash            text   not null,
  name                     text   not null,
  handle                   citext not null unique,
  avatar_url               text,
  bio                      text   not null default '',
  city                     text   not null default 'София',
  role                     text   not null default 'user' check (role in ('user', 'moderator', 'admin')),
  is_supporter             boolean not null default false,
  supporter_tier           text check (supporter_tier in ('coffee', 'guardian', 'legend')),
  supporter_since          timestamptz,
  total_donated_bgn        numeric(10, 2) not null default 0,
  personal_saved_bgn       numeric(12, 2) not null default 0,
  reputation_points        integer not null default 50,
  last_donation_prompt_at  timestamptz,
  interactions_since_prompt integer not null default 0,
  nudge_snoozed_until      timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint profiles_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint profiles_handle_format check (handle ~ '^@?[A-Za-z0-9_.]{3,32}$')
);

-- ---------------------------------------------------------------------------
-- 2. Качени файлове (снимки) — собствени, не Supabase Storage
-- ---------------------------------------------------------------------------
create table if not exists uploads (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references profiles(id) on delete cascade,
  stored_name  text not null unique,
  mime_type    text not null,
  byte_size    integer not null check (byte_size > 0 and byte_size <= 12 * 1024 * 1024),
  width        integer,
  height       integer,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Постове (🟢 Топ находки / 🔴 Червени флагове)
-- ---------------------------------------------------------------------------
create table if not exists posts (
  id                        uuid primary key default gen_random_uuid(),
  author_id                 uuid not null references profiles(id) on delete cascade,
  polarity                  text not null check (polarity in ('green', 'red')),
  -- ВАЖНО: 'other' е позволена (предишната схема я забраняваше, а UI-ът я предлагаше)
  category                  text not null check (category in
                              ('restaurants', 'hotels_airbnb', 'supermarket', 'cafes_bars', 'services_tech', 'other')),
  custom_category_label     text,
  platform_tag              text not null default 'На място',
  custom_platform_label     text,
  title                     text not null check (char_length(btrim(title)) between 3 and 200),
  description               text not null default '' check (char_length(description) <= 4000),
  place_name                text not null check (char_length(btrim(place_name)) between 1 and 200),
  city                      text not null,
  address                   text,
  latitude                  double precision check (latitude between -90 and 90),
  longitude                 double precision check (longitude between -180 and 180),
  google_maps_url           text,
  location_auto_detected    boolean not null default false,
  price_paid                numeric(10, 2) not null check (price_paid > 0 and price_paid <= 1000000),
  reference_price           numeric(10, 2) check (reference_price > 0 and reference_price <= 1000000),
  currency                  text not null default 'BGN' check (currency in ('BGN', 'EUR')),
  -- Грамаж / обем и цена за единица (шринкфлация)
  unit_quantity             numeric(12, 3) check (unit_quantity > 0),
  unit_type                 text check (unit_type in ('g', 'kg', 'ml', 'l', 'pcs')),
  price_per_unit            numeric(14, 4),
  is_shrinkflation          boolean not null default false,
  is_fake_promo             boolean not null default false,
  image_url                 text not null,
  comparison_image_url      text,
  comparison_label          text,
  status                    text not null default 'published' check (status in ('published', 'hidden', 'removed')),
  verified_valid_today_count integer not null default 0,
  last_verified_at          timestamptz,
  helped_count              integer not null default 0,
  community_saved_bgn       numeric(12, 2) not null default 0,
  tags                      text[] not null default '{}',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- цената за единица трябва да съвпада с quantity/type, ако са подадени
  constraint posts_unit_consistency check (
    (unit_quantity is null and unit_type is null)
    or (unit_quantity is not null and unit_type is not null)
  )
);

create index if not exists idx_posts_feed        on posts (status, created_at desc);
create index if not exists idx_posts_polarity    on posts (polarity) where status = 'published';
create index if not exists idx_posts_category    on posts (category) where status = 'published';
create index if not exists idx_posts_city_lower  on posts (lower(city)) where status = 'published';
create index if not exists idx_posts_author      on posts (author_id);
create index if not exists idx_posts_tags        on posts using gin (tags);

-- ---------------------------------------------------------------------------
-- 4. Касови бележки (реален OCR резултат, 1:1 с пост)
-- ---------------------------------------------------------------------------
create table if not exists receipts (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null unique references posts(id) on delete cascade,
  merchant_name    text not null,
  merchant_tax_id  text,
  receipt_date     text,
  receipt_time     text,
  total_amount     numeric(10, 2) not null check (total_amount >= 0),
  currency         text not null default 'BGN',
  confidence       numeric(4, 3) not null default 0 check (confidence between 0 and 1),
  verified_by_ai   boolean not null default false,
  source           text not null default 'manual' check (source in ('manual', 'openrouter', 'openai')),
  model            text,
  image_url        text,
  raw              jsonb,
  created_at       timestamptz not null default now()
);

create table if not exists receipt_items (
  id               uuid primary key default gen_random_uuid(),
  receipt_id       uuid not null references receipts(id) on delete cascade,
  position         integer not null default 0,
  name             text not null,
  quantity         numeric(10, 3) not null default 1 check (quantity > 0),
  unit_price       numeric(10, 2) not null check (unit_price >= 0),
  total_price      numeric(10, 2) not null check (total_price >= 0),
  highlight_reason text,
  -- сумите трябва да са аритметично верни (с реалистичен толеранс за закръгляне)
  constraint receipt_items_math check (
    abs(total_price - round(quantity * unit_price, 2))
      <= greatest(0.05, 0.01 * total_price)
  )
);

create index if not exists idx_receipt_items_receipt on receipt_items (receipt_id, position);

-- ---------------------------------------------------------------------------
-- 5. Реакции
-- ---------------------------------------------------------------------------
create table if not exists post_reactions (
  post_id      uuid not null references posts(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  reaction_key text not null check (reaction_key in
                 ('topDeal', 'worthIt', 'doubt', 'pureRobbery', 'avoid', 'exaggerated')),
  created_at   timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 6. „Това ми спести пари / Спаси ме от капан“
-- ---------------------------------------------------------------------------
create table if not exists post_helped_marks (
  post_id          uuid not null references posts(id) on delete cascade,
  user_id          uuid not null references profiles(id) on delete cascade,
  saved_amount_bgn numeric(10, 2) not null check (saved_amount_bgn >= 0 and saved_amount_bgn <= 100000),
  created_at       timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 7. Коментари и харесвания на коментари
-- ---------------------------------------------------------------------------
create table if not exists comments (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null references posts(id) on delete cascade,
  author_id      uuid not null references profiles(id) on delete cascade,
  body           text not null check (char_length(btrim(body)) between 1 and 2000),
  image_url      text,
  reported_price numeric(10, 2) check (reported_price > 0),
  likes_count    integer not null default 0,
  status         text not null default 'published' check (status in ('published', 'hidden', 'removed')),
  created_at     timestamptz not null default now()
);

create index if not exists idx_comments_post on comments (post_id, created_at);

create table if not exists comment_likes (
  comment_id uuid not null references comments(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 8. Запазени постове (отметка)
-- ---------------------------------------------------------------------------
create table if not exists post_bookmarks (
  post_id    uuid not null references posts(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists idx_post_bookmarks_user on post_bookmarks (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 9. История на цените
-- ---------------------------------------------------------------------------
create table if not exists price_history (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references posts(id) on delete cascade,
  price       numeric(10, 2) not null check (price > 0),
  status      text not null check (status in ('initial', 'confirmed', 'changed')),
  reported_by uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_price_history_post on price_history (post_id, created_at);

-- ---------------------------------------------------------------------------
-- 9. Ценови аларми
-- ---------------------------------------------------------------------------
create table if not exists price_alerts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  keyword    text not null check (char_length(btrim(keyword)) between 2 and 80),
  max_price  numeric(10, 2) check (max_price > 0),
  city       text not null default 'Всички градове',
  polarity   text not null default 'any' check (polarity in ('green', 'red', 'any')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_price_alerts_user on price_alerts (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 10. Дарения (Stripe е източникът на истина — виж тригера долу)
-- ---------------------------------------------------------------------------
create table if not exists donations (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references profiles(id) on delete cascade,
  amount_bgn                numeric(10, 2) not null check (amount_bgn >= 1 and amount_bgn <= 100000),
  currency                  text not null default 'BGN',
  tier_id                   text not null default 'guardian' check (tier_id in ('coffee', 'guardian', 'legend')),
  is_monthly                boolean not null default false,
  stripe_payment_intent_id  text unique,
  stripe_checkout_session_id text unique,
  stripe_subscription_id    text,
  stripe_event_id           text,
  status                    text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  created_at                timestamptz not null default now(),
  completed_at              timestamptz
);

create index if not exists idx_donations_user on donations (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 11. Значки
-- ---------------------------------------------------------------------------
create table if not exists badges (
  id          text primary key,
  title       text not null,
  icon        text not null,
  description text not null,
  color       text not null,
  sort_order  integer not null default 0
);

create table if not exists profile_badges (
  profile_id  uuid not null references profiles(id) on delete cascade,
  badge_id    text not null references badges(id) on delete cascade,
  unlocked_at timestamptz,
  primary key (profile_id, badge_id)
);

-- ---------------------------------------------------------------------------
-- 12. Модерация (сигнали срещу постове и коментари)
-- ---------------------------------------------------------------------------
create table if not exists content_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id) on delete cascade,
  post_id     uuid references posts(id) on delete cascade,
  comment_id  uuid references comments(id) on delete cascade,
  reason      text not null check (reason in ('false_info', 'defamation', 'spam', 'personal_data', 'other')),
  details     text,
  status      text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at  timestamptz not null default now(),
  constraint content_reports_target check (
    (post_id is not null and comment_id is null) or (post_id is null and comment_id is not null)
  )
);

-- ---------------------------------------------------------------------------
-- Тригери
-- ---------------------------------------------------------------------------

-- updated_at
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated on profiles;
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

drop trigger if exists trg_posts_updated on posts;
create trigger trg_posts_updated before update on posts
  for each row execute function set_updated_at();

-- Броячи на реакциите (без тригер, за да няма двойно броене при промяна на реакция:
-- изчисляват се на заявка от post_reactions).

-- Брояч на „спести ми пари“ + общо спестени на общността
create or replace function on_helped_mark_change() returns trigger as $$
declare
  target_post uuid;
begin
  target_post := coalesce(new.post_id, old.post_id);
  update posts p
     set helped_count = (select count(*) from post_helped_marks m where m.post_id = target_post),
         community_saved_bgn = (select coalesce(sum(m.saved_amount_bgn), 0)
                                  from post_helped_marks m where m.post_id = target_post)
   where p.id = target_post;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_helped_insert on post_helped_marks;
create trigger trg_helped_insert after insert on post_helped_marks
  for each row execute function on_helped_mark_change();

drop trigger if exists trg_helped_delete on post_helped_marks;
create trigger trg_helped_delete after delete on post_helped_marks
  for each row execute function on_helped_mark_change();

-- Брояч на харесвания на коментар
create or replace function on_comment_like_change() returns trigger as $$
declare
  target_comment uuid;
begin
  target_comment := coalesce(new.comment_id, old.comment_id);
  update comments c
     set likes_count = (select count(*) from comment_likes l where l.comment_id = target_comment)
   where c.id = target_comment;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_comment_like_insert on comment_likes;
create trigger trg_comment_like_insert after insert on comment_likes
  for each row execute function on_comment_like_change();

drop trigger if exists trg_comment_like_delete on comment_likes;
create trigger trg_comment_like_delete after delete on comment_likes
  for each row execute function on_comment_like_change();

-- Дарения → статус на поддръжник.
-- ИСПРАВЕНО: старият тригер беше „after insert or update“ и при update
-- добавяше сумата ВТОРИ път. Сега се задейства само при ПРЕХОД към 'succeeded'.
create or replace function on_donation_succeeded() returns trigger as $$
begin
  if new.status = 'succeeded' and (tg_op = 'INSERT' or old.status is distinct from 'succeeded') then
    update profiles p
       set is_supporter        = true,
           supporter_since     = coalesce(p.supporter_since, now()),
           supporter_tier      = new.tier_id,
           total_donated_bgn   = coalesce((select sum(d.amount_bgn) from donations d
                                            where d.user_id = new.user_id and d.status = 'succeeded'), 0),
           reputation_points   = p.reputation_points + 100,
           updated_at          = now()
     where p.id = new.user_id;

    insert into profile_badges (profile_id, badge_id, unlocked_at)
    values (new.user_id, 'badge-supporter', now())
    on conflict (profile_id, badge_id) do update set unlocked_at = coalesce(profile_badges.unlocked_at, now());

    update donations set completed_at = coalesce(completed_at, now()) where id = new.id;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_donation_succeeded on donations;
create trigger trg_donation_succeeded after insert or update on donations
  for each row execute function on_donation_succeeded();

-- Първоначален запис в историята на цените при нов пост
create or replace function on_post_created() returns trigger as $$
begin
  insert into price_history (post_id, price, status, reported_by, created_at)
  values (new.id, new.price_paid, 'initial', new.author_id, new.created_at);
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_post_created on posts;
create trigger trg_post_created after insert on posts
  for each row execute function on_post_created();

-- ---------------------------------------------------------------------------
-- Изгледи
-- ---------------------------------------------------------------------------

-- Пълен пост с автор, агрегирани реакции и брой коментари
create or replace view v_posts_full as
select
  p.id,
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

-- Класация на защитниците (реални агрегати от базата)
create or replace view v_leaderboard as
select
  pr.id,
  pr.name,
  pr.handle,
  pr.avatar_url,
  pr.is_supporter,
  pr.personal_saved_bgn,
  pr.reputation_points,
  (select count(*) from posts p
    where p.author_id = pr.id and p.status = 'published') as posts_count,
  (select count(*) from posts p
    where p.author_id = pr.id and p.status = 'published' and p.polarity = 'green') as green_posts,
  (select count(*) from posts p
    where p.author_id = pr.id and p.status = 'published' and p.polarity = 'red') as red_flags,
  (select count(*) from posts p join receipts rc on rc.post_id = p.id
    where p.author_id = pr.id and rc.verified_by_ai) as verified_receipts,
  (select coalesce(sum(p.community_saved_bgn), 0) from posts p
    where p.author_id = pr.id and p.status = 'published') as community_saved_bgn
from profiles pr;
