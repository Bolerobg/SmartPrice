-- 039: Push известия (Web Push / VAPID) — абонаменти на браузъра/PWA.
-- Всяко устройство/браузър има свой endpoint; пращаме до всички абонаменти на човека.
create table if not exists push_subscriptions (
  id         bigserial primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  fail_count integer not null default 0
);
create index if not exists idx_push_subs_user on push_subscriptions (user_id);
create index if not exists idx_push_subs_ok on push_subscriptions (last_ok_at desc nulls last);
