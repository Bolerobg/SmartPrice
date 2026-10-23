-- 057: 🧭 ОБИКОЛКИ — обекти, които НЕ са в приложението, за да им се предложи включване.
--
-- Идеята (искане на собственика): да може да ходи по обекти, които още не са
-- включени, и да им предлага „Проверен търговец“. Затова трябва работен списък:
--   • кои обекти около мен НЕ са в приложението (намират се през Google Maps),
--   • с телефон/адрес/линк, за да се стигне до тях,
--   • и статус на посещението (нов → посетен → интересува се → отказал → включен),
--   • за да не се ходи два пъти при един и същ човек и да се вижда резултатът.
--
-- Генерична (без град/категория по подразбиране) — собственикът търси каквото му трябва.
-- Само се добавя.

create table if not exists leads (
  id             bigserial primary key,
  name           text not null check (char_length(btrim(name)) between 2 and 200),
  city           text,
  address        text,
  phone          text,
  website        text,
  category       text,
  /** С кой термин от Google Maps е намерен („аптека в Пловдив“). */
  search_term    text,
  latitude       double precision check (latitude between -90 and 90),
  longitude      double precision check (longitude between -180 and 180),
  rating         numeric(2, 1),
  reviews_count  integer,
  maps_url       text,
  /** Слугът, под който го познаваме в `place_enrichment` (ако е обогатяван). */
  slug           text,
  /** Има ли вече сигнал/обект в приложението (за да не се предлага пак). */
  in_app         boolean not null default false,
  /** Статус на обиколката. */
  status         text not null default 'new'
                 check (status in ('new', 'contacted', 'interested', 'refused', 'joined')),
  note           text not null default '',
  /** Кога за последно е говорено с човека (за да не се досажда). */
  contacted_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Един и същ обект не се появява два пъти (по име + град, без регистър).
create unique index if not exists leads_unique_idx
  on leads (lower(btrim(name)), lower(btrim(coalesce(city, ''))));
create index if not exists leads_status_idx on leads (status, created_at desc);
create index if not exists leads_city_idx on leads (lower(btrim(coalesce(city, ''))));
-- Теренната работа търси хората С телефон — индекс за „има ли кой да вдигне“.
create index if not exists leads_phone_idx on leads ((phone is not null and btrim(phone) <> ''));

-- 🔎 История на търсенията в Google Maps (всяко харчи пари в Apify — да се вижда).
create table if not exists leads_search_runs (
  id           bigserial primary key,
  city         text not null,
  term         text not null,
  limit_count  integer not null check (limit_count between 1 and 120),
  /** Оценка в долари, показана на човека ПРЕДИ да натисне. */
  est_usd      numeric(8, 4),
  /** Колко е изхарчено наистина (от Apify, ако върне). */
  real_usd     numeric(8, 4),
  status       text not null default 'running'
               check (status in ('running', 'done', 'failed')),
  found        integer not null default 0,
  added        integer not null default 0,
  note         text not null default '',
  requested_by text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index if not exists leads_runs_started_idx on leads_search_runs (started_at desc);

comment on table leads is
  'Работен списък за обиколки: обекти извън приложението + статус на посещението.';
comment on column leads.in_app is
  'Вече има ли сигнал/обект в SmartPrice — такива се пропускат при обиколка.';
