-- ============================================================================
-- 002 — Миграция на валутата: BGN -> EUR
--
-- Защо: България е в еврозоната и Stripe вече отказва BGN
--   ("The currency bgn is no longer supported. Use eur instead.").
-- Затова цялото приложение минава на евро.
--
-- Какво прави:
--   1. Конвертира съществуващите суми от BGN в EUR по фиксирания курс
--      1 EUR = 1.95583 BGN. Децата се конвертират, ДОКАТО родителят още носи
--      маркера 'BGN' — така всяка сума се пипа точно веднъж.
--   2. Сменя валутата по подразбиране на EUR.
--   3. Преизчислява агрегатите (community_saved_bgn) за синхрон.
--
-- Какво НЕ прави (умишлено):
--   НЕ пренаименува колоните с наставка „_bgn“ (amount_bgn, total_donated_bgn,
--   personal_saved_bgn, community_saved_bgn, saved_amount_bgn). Те са вътрешни
--   и не се виждат от потребителя, но са вградени в изгледите v_posts_full /
--   v_leaderboard, в тригерите и в десетки заявки. Пренаименуването носи реален
--   риск от счупване срещу нулева полза. Стойностите в тях СЛЕД тази миграция
--   са в евро.
--
-- Миграционният runner я прилага точно веднъж (таблица schema_migrations).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Фиксираният курс (1 EUR = 1.95583 BGN)
-- ---------------------------------------------------------------------------
create or replace function bgn_to_eur(amount numeric)
returns numeric
language sql
immutable
as $$
  select round(amount / 1.95583, 2);
$$;

comment on function bgn_to_eur(numeric) is
  'Фиксиран курс 1 EUR = 1.95583 BGN. Ползва се само при миграция 002.';

-- ---------------------------------------------------------------------------
-- 2. Децата първо (родителят още е маркиран като BGN)
-- ---------------------------------------------------------------------------
update receipt_items ri
   set unit_price  = bgn_to_eur(ri.unit_price),
       total_price = bgn_to_eur(ri.total_price)
  from receipts r
 where ri.receipt_id = r.id
   and r.currency <> 'EUR';

update price_history ph
   set price = bgn_to_eur(ph.price)
  from posts p
 where ph.post_id = p.id
   and p.currency <> 'EUR';

-- ---------------------------------------------------------------------------
-- 3. Родителите
-- ---------------------------------------------------------------------------
update posts
   set price_paid          = bgn_to_eur(price_paid),
       reference_price     = bgn_to_eur(reference_price),
       price_per_unit      = bgn_to_eur(price_per_unit),
       community_saved_bgn = bgn_to_eur(community_saved_bgn),
       currency            = 'EUR'
 where currency <> 'EUR';

update receipts
   set total_amount = bgn_to_eur(total_amount),
       currency     = 'EUR'
 where currency <> 'EUR';

-- ---------------------------------------------------------------------------
-- 4. Общност
-- ---------------------------------------------------------------------------
update post_helped_marks set saved_amount_bgn = bgn_to_eur(saved_amount_bgn);

update price_alerts set max_price      = bgn_to_eur(max_price)      where max_price is not null;
update comments     set reported_price = bgn_to_eur(reported_price) where reported_price is not null;

update profiles
   set total_donated_bgn  = bgn_to_eur(total_donated_bgn),
       personal_saved_bgn = bgn_to_eur(personal_saved_bgn);

-- ---------------------------------------------------------------------------
-- 5. Дарения
-- ---------------------------------------------------------------------------
update donations
   set amount_bgn = bgn_to_eur(amount_bgn),
       currency   = 'EUR'
 where currency <> 'EUR';

-- ---------------------------------------------------------------------------
-- 6. Агрегатите се преизчисляват, за да са в синхрон след конвертирането
-- ---------------------------------------------------------------------------
update posts p
   set community_saved_bgn = coalesce(
     (select sum(m.saved_amount_bgn) from post_helped_marks m where m.post_id = p.id),
     0
   );

-- ---------------------------------------------------------------------------
-- 7. Валута по подразбиране + документация
-- ---------------------------------------------------------------------------
alter table posts     alter column currency set default 'EUR';
alter table receipts  alter column currency set default 'EUR';
alter table donations alter column currency set default 'EUR';

comment on column posts.currency is
  'ISO код на валутата. След миграция 002 винаги EUR (България е в еврозоната). '
  'Колоните с наставка _bgn са исторически имена — стойностите в тях са в евро.';
