-- 050: Сгънати (кирилица, малки букви) колони за БЪРЗО търсене.
--
-- Защо: базата е с C колация, затова вграденото `lower()` не сгъва кирилица и
-- търсенето минава през `sp_fold(title/description)`. Обаче `sp_fold()` е SQL
-- функция и планировчикът я РАЗГЪВА — тогава индекс, направен върху
-- `sp_fold(description)`, НЕ се хваща и заявката прави Seq Scan:
--   `select count(*) from posts where sp_fold(description) like '%сирене%'`
--   → 3 483 ms (Seq Scan, 54 175 реда отхвърлени).
-- Затова търсенето в приложението отговаряше 10–12 секунди при 53 000+ оферти.
--
-- Решение: СЪХРАНЕНИ генерирани колони (стойността се пази в таблицата, не се
-- смята на всяко четене) + GIN триграм индекси върху самите колони. Индексът
-- вече е върху КОЛОНА, а не върху функция, и се използва за `like '%дума%'`.
alter table posts
  add column if not exists title_fold text generated always as (sp_fold(title)) stored;
alter table posts
  add column if not exists description_fold text generated always as
    (sp_fold(coalesce(description, ''::text))) stored;

create index if not exists posts_title_fold_trgm on posts using gin (title_fold gin_trgm_ops);
create index if not exists posts_description_fold_trgm on posts using gin (description_fold gin_trgm_ops);
