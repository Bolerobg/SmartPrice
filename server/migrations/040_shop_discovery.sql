-- ============================================================================
-- 040_shop_discovery.sql
--
-- 🔎 Таб „Търси магазини“ в секцията Скрапер.
--
-- Идеята: човекът пише ключова дума („био козметика“, „кафе на зърна“), а
-- системата намира магазините в мрежата, ПРОВЕРЯВА всеки дали наистина може да
-- се сканира (пробва Shopify/WooCommerce API, sitemap, карти в листинга) и
-- показва само тези, които стават — с доказателство (примерни продукти).
--
-- Защо пазим и „нестават“:
--   • за да не се проверяват пак всеки път (проверката прави заявки към чужди сайтове);
--   • за да вижда човекът какво вече е отхвърлено и защо;
--   • за да може сайт, който е бил зад Cloudflare, да влезе в опашката за
--     домашния робот (scripts/scrape_local.py) — от домашен IP се отваря.
-- ============================================================================

create table if not exists shop_candidates (
  -- Домейнът е ключът: един магазин = един ред, независимо от колко търсения го намериха.
  domain        text primary key,
  url           text not null,
  title         text,
  -- Откъде е намерен: search (търсачка) | ai (моделът предложи) | manual (човек го даде)
  found_via     text not null default 'search',
  query         text,
  -- Разпозната платформа: shopify | woocommerce | prestashop | magento | opencart | wordpress | other
  platform      text,
  strategy      text,
  -- Може ли да се сканира ОТ СЪРВЪРА (датацентър)
  scrapable     boolean not null default false,
  -- ok     = става от сървъра
  -- local  = сайтът отговаря, но ни пуска само от домашен IP (Cloudflare/бот-защита)
  -- manual = отговаря, но не намерих продукти автоматично (трябват селектори / SPA)
  -- error  = сайтът не отговаря / грешка
  status        text not null default 'new'
                check (status in ('new','checking','ok','local','manual','error','rejected')),
  reason        text,
  http_status   integer,
  products_found integer not null default 0,
  pages_probed  integer not null default 0,
  -- Примерните продукти: [{title, price, imageUrl, url}] — доказателството пред очите.
  sample        jsonb not null default '[]'::jsonb,
  -- Ако човекът вече е пуснал обиколка от този таб:
  last_job_id   uuid,
  rejected_at   timestamptz,
  checked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table shop_candidates is
  'Намерени магазини + дали могат да се сканират. Проверката е доказана с примерни продукти.';

create index if not exists shop_candidates_status_idx on shop_candidates (status, scrapable, updated_at desc);
create index if not exists shop_candidates_query_idx on shop_candidates (query);

-- ---------------------------------------------------------------------------
-- Опашка за ДОМАШНИЯ робот.
--
-- За магазините зад Cloudflare сървърът вижда само „Just a moment…“. Те се
-- отварят от обикновен потребителски IP, затова табът слага заявка тук, а
-- `scripts/scrape_local.py --queue` (на домашната машина) ги взима, обхожда ги
-- и внася продуктите през /api/admin/scraper/import-external.
--
-- Така „не може да се сканира“ става „може“ — просто от другата машина.
-- ---------------------------------------------------------------------------
create table if not exists local_scan_queue (
  id          bigserial primary key,
  domain      text not null,
  url         text not null,
  count       integer not null default 10 check (count between 1 and 500),
  status      text not null default 'pending'
              check (status in ('pending','taken','done','failed')),
  requested_by uuid references profiles(id) on delete set null,
  note        text,
  imported    integer not null default 0,
  taken_at    timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now()
);

comment on table local_scan_queue is
  'Магазини, които сървърът не може да обходи (Cloudflare) — чакат домашния робот.';

create index if not exists local_scan_queue_status_idx on local_scan_queue (status, created_at asc);

-- Само една чакаща заявка на домейн (иначе роботът обхожда един и същ сайт 5 пъти).
create unique index if not exists local_scan_queue_pending_idx
  on local_scan_queue (domain) where status in ('pending','taken');
