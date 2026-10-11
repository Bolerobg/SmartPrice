-- ============================================================================
-- 003 — Текстът „лв.“ в демонстрационните заглавия -> „€“
--
-- Защо е отделна миграция: 002 конвертира ЧИСЛАТА, но заглавията на вече
-- записаните демо постове съдържат сумата като ТЕКСТ (напр. „за 6.90 лв.“).
-- seed.ts вече създава правилните заглавия, но той работи само при празна
-- база, затова съществуващите редове се поправят тук.
--
-- Стойностите са конвертирани по фиксирания курс 1 EUR = 1.95583 BGN.
-- ============================================================================

update posts
   set title = replace(title, '6.90 лв.', '3.53 €')
 where title like '%6.90 лв.%';

update posts
   set title = replace(title, '15.90 лв.', '8.13 €')
 where title like '%15.90 лв.%';

update posts
   set title = replace(title, '9.80 лв.', '5.01 €')
 where title like '%9.80 лв.%';

update posts
   set title = replace(title, '30 лв.', '15.34 €')
 where title like '%30 лв.%';

update posts
   set title = replace(title, '25 лв.', '12.78 €')
 where title like '%25 лв.%';

-- Описанията на артикулите в бележките също цитират сума
update receipt_items
   set highlight_reason = replace(highlight_reason, '6.90 лв.', '3.53 €')
 where highlight_reason like '%6.90 лв.%';

-- Мерна единица в описанието на шринкфлация (ако някъде е останало „лв“)
update posts
   set description = replace(description, 'лв.', '€')
 where description like '%лв.%'
   and tags @> array['#Демо'];
