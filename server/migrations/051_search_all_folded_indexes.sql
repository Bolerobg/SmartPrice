-- 051: Търсенето да е ИНДЕКСИРАНО по всички полета (не само заглавие/описание).
--
-- Защо: голямата OR група в търсенето има ~20 клона за всяка дума и ако ДОРИ
-- един клон не може да ползва индекс, планировчикът избира Seq Scan за цялото
-- условие → търсенето отговаряше 7–12 секунди при 53 000 оферти.
-- Затова за всяко търсимо поле правим СЪХРАНЕНА сгъната колона (кирилица →
-- малки букви, защото базата е с C колация) + GIN триграм индекс върху нея.
--
-- ⚠️ `array_to_string` е STABLE и НЕ може в генерирана колона → за таговете
-- търсим с `exists (select 1 from unnest(p.tags) tg where sp_fold(tg) like …)`.

alter table posts add column if not exists place_name_fold text
  generated always as (sp_fold(coalesce(place_name, ''))) stored;
alter table posts add column if not exists city_fold text
  generated always as (sp_fold(coalesce(city, ''))) stored;
alter table posts add column if not exists address_fold text
  generated always as (sp_fold(coalesce(address, ''))) stored;
alter table posts add column if not exists category_fold text
  generated always as (sp_fold(coalesce(category, ''))) stored;
alter table posts add column if not exists category_synonyms_fold text
  generated always as (sp_fold(sp_category_synonyms(category))) stored;
alter table posts add column if not exists category_label_fold text
  generated always as (sp_fold(coalesce(custom_category_label, ''))) stored;
alter table posts add column if not exists platform_tag_fold text
  generated always as (sp_fold(coalesce(platform_tag, ''))) stored;
alter table posts add column if not exists platform_label_fold text
  generated always as (sp_fold(coalesce(custom_platform_label, ''))) stored;
alter table posts add column if not exists seller_note_fold text
  generated always as (sp_fold(coalesce(seller_note, ''))) stored;

create index if not exists posts_place_fold_trgm on posts using gin (place_name_fold gin_trgm_ops);
create index if not exists posts_city_fold_trgm on posts using gin (city_fold gin_trgm_ops);
create index if not exists posts_address_fold_trgm on posts using gin (address_fold gin_trgm_ops);
create index if not exists posts_category_fold_trgm on posts using gin (category_fold gin_trgm_ops);
create index if not exists posts_category_syn_fold_trgm on posts using gin (category_synonyms_fold gin_trgm_ops);
create index if not exists posts_category_label_fold_trgm on posts using gin (category_label_fold gin_trgm_ops);
create index if not exists posts_platform_tag_fold_trgm on posts using gin (platform_tag_fold gin_trgm_ops);
create index if not exists posts_platform_label_fold_trgm on posts using gin (platform_label_fold gin_trgm_ops);
create index if not exists posts_seller_note_fold_trgm on posts using gin (seller_note_fold gin_trgm_ops);

-- Свързаните таблици (касови бележки и коментари) — за да не прави EXISTS
-- Seq Scan на всяка оферта, докато търси в бележките/коментарите.
alter table receipt_items add column if not exists name_fold text
  generated always as (sp_fold(coalesce(name, ''))) stored;
alter table receipt_items add column if not exists highlight_reason_fold text
  generated always as (sp_fold(coalesce(highlight_reason, ''))) stored;
alter table comments add column if not exists body_fold text
  generated always as (sp_fold(coalesce(body, ''))) stored;
alter table receipts add column if not exists merchant_name_fold text
  generated always as (sp_fold(coalesce(merchant_name, ''))) stored;

create index if not exists receipt_items_name_fold_trgm on receipt_items using gin (name_fold gin_trgm_ops);
create index if not exists receipt_items_reason_fold_trgm on receipt_items using gin (highlight_reason_fold gin_trgm_ops);
create index if not exists comments_body_fold_trgm on comments using gin (body_fold gin_trgm_ops);
create index if not exists receipts_merchant_fold_trgm on receipts using gin (merchant_name_fold gin_trgm_ops);
