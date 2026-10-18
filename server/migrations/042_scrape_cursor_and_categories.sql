-- ============================================================================
-- 042_scrape_cursor_and_categories.sql
--
-- 1) КУРСОР за неповтарящо се обхождане.
--    До сега разписанията влизаха от случаен адрес в листинга — значи с течение
--    на времето пак се връщаха същите продукти. Сега помним ДОКЪДЕ сме стигнали
--    в този магазин и следващата обиколка продължава оттам (с малко разсейване,
--    за да не изглежда механично).
--
-- 2) СЪОТВЕТСТВИЯ НА КАТЕГОРИИ.
--    Магазините имат стотици свои категории („Прахосмукачки“, „Микровълнови
--    фурни“…), а приложението има фиксиран набор. Тази таблица помни
--    „категория на магазина → наша категория“, така че втората среща със същата
--    (или подобна) категория да влезе в СЪЩАТА наша категория, вместо да се
--    създават 1000 нови.
-- ============================================================================

create table if not exists scrape_cursors (
  domain     text primary key,
  -- Колко продукта сме „отместили“ — следващата обиколка започва оттук.
  offset     integer not null default 0,
  runs       integer not null default 0,
  last_span  integer,
  updated_at timestamptz not null default now()
);

comment on table scrape_cursors is
  'Докъде сме стигнали в обхождането на магазин (за да не се повтарят продукти).';

create table if not exists category_map (
  -- Нормализирано име на ЧУЖДАТА категория (малки букви, без пунктуация).
  source     text primary key,
  -- Нашата категория (от фиксирания набор на приложението).
  category   text not null,
  hits       integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table category_map is
  'Съответствие „категория на магазина → наша категория“ — против 1000 категории.';

create index if not exists category_map_cat_idx on category_map (category);
