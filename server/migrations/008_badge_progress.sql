-- ============================================================================
-- 008_badge_progress.sql
--
-- Значките досега бяха декоративни: каталогът съществуваше, но нищо не ги
-- отключваше от реална активност (само seed-ът маркираше две за демо профилите).
--
-- Сега всяка значка знае ОТ КАКВО зависи (metric) и ПРИ КАКВА СТОЙНОСТ
-- (threshold), за да може:
--   • сървърът да я отключва, щом човекът я заслужи;
--   • приложението да показва „3 / 5“ за заключените, вместо голо „Заключена“.
--
-- Добавяме и стълбичката за проверки на цени — това е новата функция и е
-- редно да има за какво да се стреми човек.
-- ============================================================================

alter table badges add column if not exists metric text;
alter table badges add column if not exists threshold integer not null default 1;

comment on column badges.metric is
  'От какво зависи значката: price_checks | price_corrections | reputation_points | posts | receipts | red_flags | savings | supporter';
comment on column badges.threshold is
  'При каква стойност на metric значката се отключва.';

-- ---------------------------------------------------------------------------
-- Съществуващите значки получават своите условия
-- ---------------------------------------------------------------------------
update badges set metric = 'posts',      threshold = 1   where id = 'badge-first-post';
update badges set metric = 'receipts',   threshold = 5   where id = 'badge-receipt-master';
update badges set metric = 'red_flags',  threshold = 5   where id = 'badge-red-hunter';
update badges set metric = 'savings',    threshold = 500 where id = 'badge-saver-1k';
update badges set metric = 'supporter',  threshold = 1   where id = 'badge-supporter';

-- Описанието на „Разобличител“ казваше „над 50 души“ — условието е 5 оферти.
update badges
   set description = 'Публикувал 5 червени флага срещу спекулативни цени'
 where id = 'badge-red-hunter';

-- ---------------------------------------------------------------------------
-- Новите значки за проверки на цени (стълбичката)
-- ---------------------------------------------------------------------------
insert into badges (id, title, icon, description, color, sort_order, metric, threshold)
values
  ('badge-check-1',    'Първи поглед',        'eye',         'Провери първата си чужда цена на място',        '#06B6D4', 100, 'price_checks',      1),
  ('badge-check-5',    'Проверяващ',          'search',      'Провери 5 чужди цени на място',                 '#22D3EE', 101, 'price_checks',      5),
  ('badge-check-25',   'Детектив на цени',    'binoculars',  'Провери 25 чужди цени на място',                '#8B5CF6', 102, 'price_checks',     25),
  ('badge-check-100',  'Пазител на цените',   'shield',      'Провери 100 чужди цени на място',               '#F59E0B', 103, 'price_checks',    100),
  ('badge-correct-1',  'Поправи цена',        'create',      'Поправи първата сгрешена цена',                 '#FBBF24', 110, 'price_corrections', 1),
  ('badge-correct-10', 'Коректор',            'build',       'Поправи 10 сгрешени цени',                      '#EF4444', 111, 'price_corrections', 10),
  ('badge-points-100', 'Доверен',             'star',        'Събра 100 точки доверие',                       '#FBBF24', 120, 'reputation_points', 100),
  ('badge-points-500', 'Стожер на общността', 'ribbon',      'Събра 500 точки доверие',                       '#F59E0B', 121, 'reputation_points', 500)
on conflict (id) do update
  set title = excluded.title,
      icon = excluded.icon,
      description = excluded.description,
      color = excluded.color,
      sort_order = excluded.sort_order,
      metric = excluded.metric,
      threshold = excluded.threshold;

-- ---------------------------------------------------------------------------
-- Всеки профил трябва да „вижда“ новите значки като заключени, иначе няма
-- какво да му покажем, че го очаква.
-- ---------------------------------------------------------------------------
insert into profile_badges (profile_id, badge_id)
select p.id, b.id from profiles p cross join badges b
on conflict (profile_id, badge_id) do nothing;

-- ---------------------------------------------------------------------------
-- Отключваме заслуженото веднага (за съществуващите потребители), за да не
-- чакат до следващото си действие.
-- ---------------------------------------------------------------------------
with stats as (
  select p.id,
         p.reputation_points,
         p.is_supporter,
         (select count(*) from posts po
           where po.author_id = p.id and po.status = 'published')                    as posts,
         (select count(*) from posts po join receipts r on r.post_id = po.id
           where po.author_id = p.id and r.verified_by_ai)                           as receipts,
         (select count(*) from posts po
           where po.author_id = p.id and po.status = 'published' and po.polarity = 'red') as red_flags,
         (select coalesce(sum(po.community_saved_bgn), 0) from posts po
           where po.author_id = p.id and po.status = 'published')                    as savings,
         (select count(*) from price_history ph
           where ph.reported_by = p.id and ph.status in ('confirmed','changed'))      as price_checks,
         (select count(*) from price_history ph
           where ph.reported_by = p.id and ph.status = 'changed')                    as price_corrections
    from profiles p
)
update profile_badges pb
   set unlocked_at = now()
  from stats s, badges b
 where pb.profile_id = s.id
   and pb.badge_id = b.id
   and pb.unlocked_at is null
   and (
     (b.metric = 'posts'              and s.posts             >= b.threshold) or
     (b.metric = 'receipts'           and s.receipts          >= b.threshold) or
     (b.metric = 'red_flags'          and s.red_flags         >= b.threshold) or
     (b.metric = 'savings'            and s.savings           >= b.threshold) or
     (b.metric = 'price_checks'       and s.price_checks      >= b.threshold) or
     (b.metric = 'price_corrections'  and s.price_corrections >= b.threshold) or
     (b.metric = 'reputation_points'  and s.reputation_points >= b.threshold) or
     (b.metric = 'supporter'          and s.is_supporter)
   );
