-- ============================================================================
-- 042_scrape_cursor_and_categories.sql
--
-- 1) КУРСОР за неповтарящо се обхождане (помним докъде сме стигнали в магазина).
-- 2) СЪОТВЕТСТВИЯ НА КАТЕГОРИИ („категория на магазина → наша категория“), за да
--    не се създават 1000 категории, а близките да влизат на едно място.
--
-- ВАЖНО: колоната се казва `cursor_offset`, НЕ `offset` — `offset` е запазена дума
-- в PostgreSQL и `create table ... offset integer` чупи с
-- „syntax error at or near offset“ (точно това свали продукцията на 18.10.2026).
-- ============================================================================

create table if not exists scrape_cursors (
  domain        text primary key,
  cursor_offset integer not null default 0,
  runs          integer not null default 0,
  last_span     integer,
  updated_at    timestamptz not null default now()
);

comment on table scrape_cursors is
  'Докъде сме стигнали в обхождането на магазин (за да не се повтарят продукти).';

create table if not exists category_map (
  source     text primary key,
  category   text not null,
  hits       integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table category_map is
  'Съответствие „категория на магазина → наша категория“ — против 1000 категории.';

create index if not exists category_map_cat_idx on category_map (category);
