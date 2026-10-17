-- 037: Публични данни за цени (#13) — за журналисти и медии, без лични данни.
-- Едно място с всички ценови наблюдения: редове от касови бележки (продукт + единична цена)
-- и самите оферти (заглавие + платена цена). Без автор, без снимки, без адреси.
create or replace view v_price_observations as
select
  'item'::text                              as kind,
  btrim(ri.name)                            as product,
  btrim(p.city)                             as city,
  p.category                                as category,
  p.polarity                                as polarity,
  ri.unit_price::float                      as price,
  ri.quantity::float                        as quantity,
  'бр'::text                                as unit,
  coalesce(r.receipt_date, to_char(p.created_at, 'YYYY-MM-DD')) as observed_on,
  case
    when coalesce(r.receipt_date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then least(r.receipt_date::date, p.created_at::date + 1)
    else p.created_at::date
  end                                       as observed_date,
  p.created_at                              as created_at
from receipt_items ri
join receipts r on r.id = ri.receipt_id
join posts p on p.id = r.post_id
where p.status = 'published'
union all
select
  'post'::text,
  btrim(p.title),
  btrim(p.city),
  p.category,
  p.polarity,
  p.price_paid::float,
  p.unit_quantity::float,
  coalesce(p.unit_type, 'бр'),
  to_char(p.created_at, 'YYYY-MM-DD'),
  p.created_at::date as observed_date,
  p.created_at as created_at
from posts p
where p.status = 'published';

create index if not exists idx_receipt_items_name_lower on receipt_items (lower(name));
create index if not exists idx_posts_title_lower on posts (lower(title));
