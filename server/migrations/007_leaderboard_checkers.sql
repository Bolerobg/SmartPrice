-- ============================================================================
-- 007_leaderboard_checkers.sql
--
-- Ранглистата досега подреждаше само по „спестени пари“ — тоест колкото
-- по-скъпа оферта си качил, толкова по-нагоре. Това не показва най-важното,
-- което един потребител прави за другите: да отиде на място и да каже, че
-- цената още е вярна (или че се е променила).
--
-- Затова добавяме към изгледа броя проверки на цени от price_history:
--   • price_checks       — всички проверки (потвърдена + поправена)
--   • price_corrections  — само реалните поправки (status = 'changed')
--   • checks_last_7d     — проверките през последните 7 дни (за седмичната класация)
--
-- Изгледът се пресъздава, за да не пипаме 001_init.sql (миграциите се прилагат
-- веднъж и никога назад).
-- ============================================================================

create or replace view v_leaderboard as
select
  pr.id,
  pr.name,
  pr.handle,
  pr.avatar_url,
  pr.is_supporter,
  pr.personal_saved_bgn,
  pr.reputation_points,
  (select count(*) from posts p
    where p.author_id = pr.id and p.status = 'published') as posts_count,
  (select count(*) from posts p
    where p.author_id = pr.id and p.status = 'published' and p.polarity = 'green') as green_posts,
  (select count(*) from posts p
    where p.author_id = pr.id and p.status = 'published' and p.polarity = 'red') as red_flags,
  (select count(*) from posts p join receipts rc on rc.post_id = p.id
    where p.author_id = pr.id and rc.verified_by_ai) as verified_receipts,
  (select coalesce(sum(p.community_saved_bgn), 0) from posts p
    where p.author_id = pr.id and p.status = 'published') as community_saved_bgn,
  (select count(*) from price_history ph
    where ph.reported_by = pr.id and ph.status in ('confirmed', 'changed')) as price_checks,
  (select count(*) from price_history ph
    where ph.reported_by = pr.id and ph.status = 'changed') as price_corrections,
  (select count(*) from price_history ph
    where ph.reported_by = pr.id
      and ph.status in ('confirmed', 'changed')
      and ph.created_at > now() - interval '7 days') as checks_last_7d
from profiles pr;

comment on view v_leaderboard is
  'Ранглиста: спестени пари, проверки на цени (price_checks) и поправки (price_corrections).';

-- Индексът помага на заявките „кой е проверил най-много“ — филтрираме по
-- reported_by, а съществуващият индекс е по (post_id, created_at).
create index if not exists idx_price_history_reporter
  on price_history (reported_by, created_at desc);
