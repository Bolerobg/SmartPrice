-- 034: Открити нови публични Facebook групи (тема №9) — чакат одобрение в панела.
-- Одобрената група влиза в app_settings.fb_groups и се обхожда при следващата обиколка.
create table if not exists fb_group_candidates (
  id            serial primary key,
  group_url     text        not null unique,
  group_id      text,
  name          text,
  member_count  integer,
  privacy       text,
  description   text,
  query         text,
  score         integer     not null default 0,
  status        text        not null default 'pending',
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz
);

create index if not exists fb_group_candidates_status_idx
  on fb_group_candidates (status, score desc, member_count desc nulls last);
