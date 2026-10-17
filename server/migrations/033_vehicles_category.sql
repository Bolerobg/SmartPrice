-- 033: Нова категория „Авто“ (тема vehicles при скрапването).
insert into category_labels (id, title, emoji, synonyms, sort_order)
values ('vehicles', 'Авто', '🚗', 'авто коли автомобили мотоциклети части ремонт сервиз гражданска преглед', 11)
on conflict (id) do nothing;
