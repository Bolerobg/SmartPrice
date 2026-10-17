-- 036: Изглед „обект“ — един обект (магазин, сервиз, обект, търговец) с всичките му сигнали.
-- Обектът се разпознава по (място + град). Слугът е md5, за да е стабилен и да става за адрес.
create or replace view v_objects as
select
  md5(lower(btrim(p.place_name)) || '|' || lower(btrim(p.city))) as slug,
  min(btrim(p.place_name))                       as place_name,
  min(btrim(p.city))                             as city,
  count(*)::int                                  as signals_count,
  count(distinct p.author_id)::int               as reporters_count,
  count(*) filter (where p.polarity = 'green')::int as green_count,
  count(*) filter (where p.polarity = 'red')::int   as red_count,
  min(p.price_paid)::float                       as min_price,
  max(p.price_paid)::float                       as max_price,
  avg(p.price_paid)::float                       as avg_price,
  max(p.created_at)                              as last_seen,
  min(p.created_at)                              as first_seen,
  sum(coalesce(p.helped_count, 0))::int          as helped_total,
  (array_agg(distinct p.category))[1]            as category,
  array_agg(distinct p.category)                 as categories,
  (array_agg(p.image_url order by p.created_at desc))[1] as cover_image,
  (array_agg(p.id order by p.created_at desc))[1]        as last_post_id,
  (array_agg(p.unit_type order by p.created_at desc))[1] as unit_type,
  (array_agg(p.latitude order by p.created_at desc))[1]  as latitude,
  (array_agg(p.longitude order by p.created_at desc))[1] as longitude,
  max(nullif(btrim(coalesce(p.address, '')), ''))        as address,
  max(nullif(btrim(coalesce(r.merchant_name, '')), ''))  as merchant_name,
  max(nullif(btrim(coalesce(r.merchant_tax_id, '')), '')) as merchant_tax_id,
  count(*) filter (where r.verified_by_ai)::int   as receipts_verified
from posts p
left join receipts r on r.post_id = p.id
where p.status = 'published'
group by md5(lower(btrim(p.place_name)) || '|' || lower(btrim(p.city)));

create index if not exists idx_posts_place_city
  on posts (lower(btrim(place_name)), lower(btrim(city)));
