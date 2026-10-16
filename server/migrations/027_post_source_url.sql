-- ============================================================================
-- 027_post_source_url.sql
--
-- Оферта от онлайн магазин трябва да води към ПРОДУКТА, а оферта от физически
-- магазин — към ЛОКАЦИЯТА.
--
-- Досега линкът към магазина се пазеше само вътре в source_note („Онлайн магазин
-- pottery-factory.com: https://…“), тоест приложението не можеше да го отвори.
-- Затова: истинска колона + запълване на вече внесените оферти от скрапера.
-- ============================================================================

alter table posts add column if not exists source_url text;

comment on column posts.source_url is
  'Линк към продукта в онлайн магазина (за оферти от скрапера). Ако е попълнен, картата на офертата води към продукта, а не към картата с локацията.';

-- Запълваме старите оферти: линкът е бил в source_note.
update posts
   set source_url = nullif(substring(source_note from 'https?://\S+'), '')
 where source_url is null
   and source_note ~* 'https?://';

create index if not exists posts_source_url_idx on posts (source_url)
  where source_url is not null;
