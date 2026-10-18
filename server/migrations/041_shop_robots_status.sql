-- ============================================================================
-- 041_shop_robots_status.sql
--
-- Два нови статуса за намерените магазини: „robots“ и „apify“.
--
-- Защо:
--   • technopolis.bg (и други) забраняват на ботове в robots.txt. Досега такъв
--     сайт излизаше като „не става“, което е подвеждащо — работи, стига обиколката
--     да е пусната с изключен robots.txt (панелът има тази отметка).
--   • Сайтовете зад Cloudflare (ardes.bg, decathlon.bg, product страниците на
--     zora.bg…) не пускат датацентъра, но се отварят през Apify с жилищно
--     (residential) прокси. Това вече е третият начин: „става, през Apify“.
-- ============================================================================

alter table shop_candidates drop constraint if exists shop_candidates_status_check;

alter table shop_candidates
  add constraint shop_candidates_status_check
  check (status in ('new','checking','ok','local','manual','error','rejected','robots','apify'));

comment on column shop_candidates.status is
  'ok = става от сървъра · robots = само с изключен robots.txt · apify = през Apify (residential) · local = иска домашен робот · manual = нужни селектори · error · rejected';

create index if not exists shop_candidates_robots_idx on shop_candidates (status) where status in ('robots','local','apify');
