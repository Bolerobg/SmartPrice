-- 056: 🗺️ Бизнеси, добавени от панела към картата „Еврото“ (Google My Maps).
--
-- Защо отделна таблица, а не само posts:
--   • Google НЯМА API за добавяне на места в My Maps (проверено 23.10.2026 —
--     Drive приема файла, но не записва в картата). Единственият поддържан път е
--     „My Maps → Добави слой → Импортирай“ с KML/CSV файл.
--   • Затова пазим ТУК какво е добавено от панела, за да може:
--       1) веднага да влезе в приложението (пост с source='maps' → „Честни места“),
--       2) да се свали като KML само с НОВИТЕ места (без да се дублират старите 166),
--       3) да се вижда кой какво е добавил и да се трие чисто.
--
-- Само се добавя.

create table if not exists map_places (
  id            bigserial primary key,
  name          text not null check (char_length(btrim(name)) between 2 and 200),
  city          text,
  address       text,
  -- Папката в картата му („Ресторанти“, „Хранителни магазини и пазари“ …).
  folder        text not null default 'Други',
  category      text not null default 'other',
  note          text not null default '',
  price         numeric(10, 2) check (price > 0 and price <= 1000000),
  latitude      double precision check (latitude between -90 and 90),
  longitude     double precision check (longitude between -180 and 180),
  maps_url      text,
  -- Постът в приложението, който това място създаде (за да се трие заедно с него).
  post_id       uuid references posts(id) on delete set null,
  -- Дали вече е импортирано в Google My Maps (човекът си го отбелязва).
  exported_at   timestamptz,
  added_by      text,
  created_at    timestamptz not null default now()
);

create index if not exists map_places_created_idx on map_places (created_at desc);
-- Едно и също място не се добавя два пъти (по име + град, без значение от регистъра).
create unique index if not exists map_places_unique_idx
  on map_places (lower(btrim(name)), lower(btrim(coalesce(city, ''))));
