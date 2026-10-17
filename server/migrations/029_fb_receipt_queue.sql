-- ============================================================================
-- 029_fb_receipt_queue.sql
--
-- Задачи и опашка за одобрение на касови бележки, свалени от публични Facebook
-- групи (напр. https://www.facebook.com/groups/3111975342346393).
--
-- Потокът:
--   1. Админът пуска задача с адрес на публична ФБ група (или праща постове).
--   2. Сървърът сваля постовете със снимки + текста към тях и ги минава през
--      AI Vision OCR (OpenRouter), който разчита бона и артикулите.
--   3. Всички разчетени бележки влизат тук със статус 'pending' (чака одобрение).
--   4. След одобрение от админа се създава реална публикация в posts + receipts
--      + receipt_items.
-- ============================================================================

create table if not exists fb_receipt_jobs (
  id              bigserial primary key,
  group_url       text not null,
  group_id        text,
  status          text not null default 'running'
                    check (status in ('running', 'done', 'failed', 'cancelled')),
  target_count    integer not null default 10,
  discovered      integer not null default 0,
  receipts_found  integer not null default 0,
  skipped         integer not null default 0,
  failed          integer not null default 0,
  strategy        text,
  log             jsonb not null default '[]'::jsonb,
  error           text,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index if not exists idx_fb_receipt_jobs_created
  on fb_receipt_jobs (created_at desc);

create table if not exists fb_receipt_queue (
  id                 bigserial primary key,
  job_id             bigint references fb_receipt_jobs(id) on delete set null,
  group_url          text,
  fb_post_id         text,
  fb_post_url        text not null,
  fb_author_name     text,
  fb_posted_at       text,
  fb_post_text       text not null default '',
  original_image_url text not null,
  local_image_url    text not null,
  image_sha256       text,
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected', 'not_receipt')),
  skip_reason        text,
  polarity           text not null default 'red'
                       check (polarity in ('green', 'red')),
  category           text not null default 'other',
  title              text not null default '',
  description        text not null default '',
  place_name         text not null default '',
  city               text not null default 'София',
  address            text,
  merchant_name      text not null default 'Неразчетен търговец',
  merchant_tax_id    text,
  receipt_date       text,
  receipt_time       text,
  total_amount       numeric(10, 2) not null default 0,
  original_amount    numeric(10, 2),
  original_currency  text,
  confidence         numeric(4, 3) not null default 0,
  ai_model           text,
  items              jsonb not null default '[]'::jsonb,
  post_id            uuid references posts(id) on delete set null,
  created_at         timestamptz not null default now(),
  reviewed_at        timestamptz,
  reviewed_by        uuid references profiles(id) on delete set null
);

create index if not exists idx_fb_receipt_queue_status
  on fb_receipt_queue (status, created_at desc);

create index if not exists idx_fb_receipt_queue_post_url
  on fb_receipt_queue (fb_post_url);

create index if not exists idx_fb_receipt_queue_sha256
  on fb_receipt_queue (image_sha256) where image_sha256 is not null;
