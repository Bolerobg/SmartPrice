-- 049: Триграмни индекси за бързи търсения и за Ценовия дуел.
--
-- Защо: търсенето ползва `like '%дума%'` (и `sp_fold(title) like '%дума%'`), а
-- обикновеният B-tree индекс не помага при шаблон в НАЧАЛОТО на низа. След
-- вноса на 53 000+ цени от веригите заявките сканираха цялата таблица и
-- лентата отговаряше 7–9 секунди („зарежда няколко стоки и увисва“).
--
-- pg_trgm прави GIN индекс, който ускорява точно такова търсене със стотици
-- пъти. `sp_fold()` е IMMUTABLE, затова може да се индексира директно.
create extension if not exists pg_trgm;

-- Търсене по име на продукт (и латиница, и кирилица).
create index if not exists posts_title_trgm on posts using gin (title gin_trgm_ops);
-- Същото, но сгънато (кирилица с малки/главни букви в C колация).
create index if not exists posts_title_fold_trgm on posts using gin (sp_fold(title) gin_trgm_ops);
-- Търсене по име на магазин/верига („кауфланд“, „метро“).
create index if not exists posts_place_trgm on posts using gin (place_name gin_trgm_ops);
