-- 044: скрапване на TikTok и Instagram от админ панела (меню „Социални мрежи“).
--
-- Защо отделни таблици: това е ПРОУЧВАНЕ (какво работи в рекламите), не наши
-- оферти. Затова не пипаме `posts` — пазим отделно, за да можем да трием и
-- сравняваме пусканията, без да рискуваме съдържанието на приложението.
--
-- runs  = едно пускане (платформа, режим, какво търсим, колко е струвало)
-- items = отделните видеа/публикации от това пускане
-- ideas = запазени от човека видеа като идеи за наши скриптове
create table if not exists social_scrape_runs (
  id            uuid primary key default gen_random_uuid(),
  platform      text not null,
  mode          text not null,
  targets       jsonb not null default '[]'::jsonb,
  options       jsonb not null default '{}'::jsonb,
  status        text not null default 'running',
  found         integer not null default 0,
  usd           numeric(10, 4) not null default 0,
  note          text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists social_runs_started_idx on social_scrape_runs (started_at desc);

create table if not exists social_scrape_items (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references social_scrape_runs(id) on delete cascade,
  platform    text not null,
  external_id text,
  url         text,
  author      text,
  caption     text,
  views       bigint,
  likes       integer,
  comments    integer,
  shares      integer,
  duration    integer,
  hashtags    jsonb,
  posted_at   timestamptz,
  is_ad       boolean not null default false,
  has_shop    boolean not null default false,
  raw         jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists social_items_run_idx on social_scrape_items (run_id);
create index if not exists social_items_views_idx on social_scrape_items (views desc nulls last);
create index if not exists social_items_platform_idx on social_scrape_items (platform);

-- Запазени идеи за скриптове: човекът маркира видео, което иска да „препишем“.
create table if not exists social_script_ideas (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid references social_scrape_items(id) on delete set null,
  platform    text not null,
  url         text,
  author      text,
  caption     text,
  views       bigint,
  note        text,
  hook        text,
  created_at  timestamptz not null default now()
);

create index if not exists social_ideas_created_idx on social_script_ideas (created_at desc);
