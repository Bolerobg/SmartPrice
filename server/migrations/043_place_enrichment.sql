-- 043: обогатяване на обектите през Google Maps (Apify).
--
-- Защо: страниците на обекти (магазин, сервиз, майстор) показват само това,
-- което потребителите са написали. Google Maps дава рейтинг, отзиви, работно
-- време, телефон, сайт, точни координати и категория — с едно обръщение.
--
-- Връзката е по `slug` — същият слуг, който ползва v_objects
-- (md5(lower(place_name) || '|' || lower(city))), затова няма нужда от външен ключ.
create table if not exists place_enrichment (
  slug            text primary key,
  place_name      text not null,
  city            text not null,
  address         text,
  neighborhood    text,
  latitude        double precision,
  longitude       double precision,
  rating          numeric(3,2),
  reviews_count   integer,
  category        text,
  phone           text,
  website         text,
  hours           jsonb,
  maps_url        text,
  image_url       text,
  source          text not null default 'google-maps',
  updated_at      timestamptz not null default now()
);

create index if not exists place_enrichment_updated_idx on place_enrichment (updated_at desc);
