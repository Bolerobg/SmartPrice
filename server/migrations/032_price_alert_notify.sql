-- 032: Ценови аларми — кога за последно сме уведомили потребителя.
--
-- Алармите съществуват отпреди (таблица price_alerts), но нищо не ги проверяваше.
-- Сега `runPriceAlerts()` търси оферти под зададената цена и праща имейл.
alter table price_alerts add column if not exists last_notified_at timestamptz;
alter table price_alerts add column if not exists notified_post_id uuid;
alter table price_alerts add column if not exists notify_count int not null default 0;

create index if not exists idx_price_alerts_active on price_alerts (is_active, last_notified_at);

-- Дневник на изпратените известия (за панела и за да не се повтаряме).
create table if not exists price_alert_log (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references price_alerts(id) on delete cascade,
  post_id uuid,
  price numeric(10,2),
  sent_at timestamptz not null default now(),
  channel text not null default 'email'
);
create index if not exists idx_price_alert_log_alert on price_alert_log (alert_id, sent_at desc);
