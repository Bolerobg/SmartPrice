-- ============================================================================
-- 023_scraper.sql
--
-- Професионален скрапер за онлайн магазини.
--
-- Идеята: в админ панела се дава линк на магазин + колко продукта искаме.
-- Системата обикаля, вади снимки, цени, описания, разчита коя е категорията,
-- пише си описанието и слага продуктите в SmartPrice — с ясен етикет откъде
-- идват. Прозрачността е същата като при внесените бонове: продуктите влизат
-- под профила „SmartPrice Редакция“ и всеки носи адреса на източника си.
--
-- Защо задачите живеят в базата, а не в паметта:
--   • една обиколка на 200 продукта трае минути — не може да държи HTTP заявка;
--   • ако контейнерът се рестартира по средата, задачата се подхваща оттам;
--   • виждаме история, прогрес и причина за всеки пропуснат продукт.
-- ============================================================================

create table if not exists scrape_jobs (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid references profiles(id) on delete set null,
  url           text not null,
  domain        text not null,
  -- queued → discovering → parsing → enriching → importing → done | failed | cancelled
  status        text not null default 'queued'
                check (status in ('queued','discovering','parsing','enriching','importing','done','failed','cancelled')),
  -- preview = само показва (нищо не влиза); import = внася директно
  mode          text not null default 'preview' check (mode in ('preview','import')),
  options       jsonb not null default '{}'::jsonb,
  target_count  integer not null default 20 check (target_count between 1 and 2000),
  discovered    integer not null default 0,
  parsed        integer not null default 0,
  imported      integer not null default 0,
  skipped       integer not null default 0,
  failed        integer not null default 0,
  -- Коя стратегия проработи за този сайт: shopify | woocommerce | sitemap |
  -- listing | jsonld | opengraph | microdata | selectors | single
  strategy      text,
  log           jsonb not null default '[]'::jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  heartbeat_at  timestamptz
);

comment on table scrape_jobs is
  'Задача за скрапване на онлайн магазин. Прогресът се пише в реално време, за да го вижда панелът.';

create index if not exists scrape_jobs_status_idx on scrape_jobs (status, created_at desc);
create index if not exists scrape_jobs_created_idx on scrape_jobs (created_at desc);

-- ---------------------------------------------------------------------------
-- Всеки намерен продукт — с всичко, което сме успели да извадим от страницата.
-- Пазим и source_url: това е доказателството откъде е цената.
-- ---------------------------------------------------------------------------
create table if not exists scrape_items (
  id              bigserial primary key,
  job_id          uuid not null references scrape_jobs(id) on delete cascade,
  source_url      text not null,
  title           text,
  description     text,
  price           numeric(10, 2),
  reference_price numeric(10, 2),
  currency        text not null default 'EUR',
  image_url       text,
  -- Снимката, свалена при нас (за да не зависим от чуждия сайт)
  local_image_url text,
  category        text,
  unit_quantity   numeric(12, 3),
  unit_type       text,
  polarity        text check (polarity in ('green','red')),
  breadcrumb      text,
  tags            text[] not null default '{}',
  -- parsed → approved (одобрен за внасяне) → imported | skipped | failed
  status          text not null default 'parsed'
                  check (status in ('parsed','approved','imported','skipped','failed')),
  reason          text,
  post_id         uuid references posts(id) on delete set null,
  raw             jsonb,
  created_at      timestamptz not null default now()
);

comment on table scrape_items is
  'Извадените продукти от една задача. source_url е доказателството за произхода на цената.';

create index if not exists scrape_items_job_idx on scrape_items (job_id, id);
create index if not exists scrape_items_status_idx on scrape_items (job_id, status);

-- ---------------------------------------------------------------------------
-- Наученото за всеки сайт: коя стратегия работи и какви селектори сме подали.
-- Така вторият път за същия магазин е един клик, а не ново проучване.
-- ---------------------------------------------------------------------------
create table if not exists scrape_sites (
  domain       text primary key,
  label        text,
  strategy     text,
  -- Ръчни селектори (когато сайтът е стар/нестандартен):
  -- { "list": "a.product", "title": "h1", "price": ".price", "image": "img.main@src", ... }
  selectors    jsonb not null default '{}'::jsonb,
  -- Настройки по подразбиране за този сайт (град, категория, етикети…)
  defaults     jsonb not null default '{}'::jsonb,
  notes        text,
  runs         integer not null default 0,
  last_ok_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table scrape_sites is
  'Научено за всеки магазин: стратегия и селектори. Прави скрапера адаптивен и повтаряем.';

-- Търсене дали този продукт вече не е внасян (по адрес на източника).
create index if not exists scrape_items_source_idx on scrape_items (source_url);
create index if not exists posts_source_note_idx on posts (source_note) where source = 'scraper';
