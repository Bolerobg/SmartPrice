-- ============================================================================
-- SmartPrice — 013: любими с локация + частни продавачи
--
-- 1) Частни лица: обяви от хора, които продават на определено място (напр. от
--    камион/сергия/пред блока). Получават собствена категория, тип продавач и
--    допълнителен коментар (кога и как да ги намериш) + локация.
-- 2) Любими: освен отметката, човекът може да си запише бележка и да вижда
--    GPS мястото на любимата оферта (за да отиде до там).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Частни продавачи
-- ---------------------------------------------------------------------------
alter table posts
  add column if not exists seller_type    text not null default 'business',
  add column if not exists seller_note    text,
  add column if not exists seller_contact text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_seller_type_check') then
    alter table posts add constraint posts_seller_type_check
      check (seller_type in ('business', 'private'));
  end if;
end $$;

-- Категория „Частни продавачи“ (заедно с останалите)
alter table posts drop constraint if exists posts_category_check;
alter table posts add constraint posts_category_check check (category in
  ('restaurants', 'hotels_airbnb', 'supermarket', 'cafes_bars', 'services_tech', 'other', 'private_sellers'));

insert into category_labels (id, title, emoji, synonyms, sort_order) values
  ('private_sellers', 'Частни продавачи', '🧍',
   'частни лица продавач сергия камион щанд на улицата пазар обяви втора употреба', 7)
on conflict (id) do nothing;

create index if not exists idx_posts_seller_type on posts (seller_type) where status = 'published';
create index if not exists idx_posts_geo on posts (latitude, longitude) where status = 'published';

-- ---------------------------------------------------------------------------
-- 2. Любими с бележка и локация
-- ---------------------------------------------------------------------------
alter table post_bookmarks
  add column if not exists note        text,
  add column if not exists note_lat    double precision,
  add column if not exists note_lng    double precision,
  add column if not exists remind_at   timestamptz;

create index if not exists idx_post_bookmarks_note on post_bookmarks (user_id, created_at desc);

-- Изгледът: добавяме типа продавач, коментара и контакта, за да стигат до
-- приложението (иначе частните продавачи изглеждат като обикновени обяви).
-- Пак drop + create — новите колони влизат по средата.
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
  p.seller_type,
  p.seller_note,
  p.seller_contact,
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
