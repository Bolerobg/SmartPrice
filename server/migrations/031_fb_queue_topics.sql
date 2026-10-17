-- 031: Теми (интереси) при скрапване от Facebook групи.
--
-- Досега опашката приемаше само касови бележки и сигнали за цена. Вече има теми:
--   deals (оферти и цени), services (услуги), masters (майстори), real_estate (имоти),
--   shops_places (обекти и магазини), private_sellers (частни продавачи).
-- Всяка тема може да се включва/изключва от панела (настройка fb_topics).
alter table fb_receipt_queue add column if not exists topic text;

-- Съществуващите записи са от времето, когато имаше само „оферти и цени“.
update fb_receipt_queue set topic = 'deals' where topic is null;

create index if not exists fb_receipt_queue_topic_idx on fb_receipt_queue (topic, status);

-- Нови категории в приложението (виждат се като етикети в офертите и във филтрите).
insert into category_labels (id, title, emoji, synonyms, sort_order)
values
  ('real_estate', 'Имоти', '🏠', 'имоти наем наеми продажба апартамент къща гараж', 8),
  ('shops_places', 'Обекти', '🏪', 'обекти магазини заведения нови затворени обслужване хигиена', 9),
  ('private_sellers', 'Частни продавачи', '🧍', 'частни лица сергия пазар обяви втора употреба', 10)
on conflict (id) do nothing;
