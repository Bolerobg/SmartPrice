-- ============================================================================
-- 016 — Поправка на отпечатъка на касовата бележка (кирилица в C locale)
--
-- Какво беше сгрешено: базата е създадена с locale=C, а в C locale функцията
-- lower() НЕ смалява кирилски букви. Затова „ТЕСТ МАГАЗИН ЕООД“ и
-- „Тест магазин еоод“ даваха РАЗЛИЧНИ отпечатъци и една и съща бележка,
-- качена от втори акаунт, не се хващаше.
--
-- Решението: изрична ICU колация (bg-x-icu), която смалява кирилицата както
-- трябва, независимо от locale на базата.
-- ============================================================================

alter table receipts drop column if exists fingerprint;

alter table receipts add column fingerprint text
  generated always as (
    lower(regexp_replace(btrim(merchant_name), '\s+', ' ', 'g') COLLATE "bg-x-icu") || '|' ||
    coalesce(btrim(receipt_date), '') || '|' ||
    coalesce(btrim(receipt_time), '') || '|' ||
    total_amount::text
  ) stored;

create index if not exists idx_receipts_fingerprint on receipts (fingerprint);

comment on column receipts.fingerprint is
  'Отпечатък на бележката (магазин+дата+час+сума), смален с bg-x-icu. Една бележка = един лист хартия.';
