-- 🔎 ОТКЪДЕ ИДВАТ ПОТРЕБИТЕЛИТЕ („първо докосване“).
--
-- Какво прави:
--   • пази първия източник, от който човекът е стигнал до приложението
--     (utm_source / utm_medium / utm_campaign / referrer / landing);
--   • същите полета се записват и в auth_events — за да се вижда и по входове.
--
-- Защо: досега знаехме само рефералните покани и града. За да се разбере
-- кой канал (Google, Facebook, TikTok, директно) носи хора, трябва да се
-- запише откъде е дошъл първият посетител.
--
-- ВАЖНО: новите колони са nullable и НЕ чупят стария код. Данните започват
-- да се пълнят от момента на деплоя нататък (предишните профили нямат източник).

alter table profiles   add column if not exists signup_source   text;
alter table profiles   add column if not exists signup_medium   text;
alter table profiles   add column if not exists signup_campaign text;
alter table profiles   add column if not exists signup_referrer text;
alter table profiles   add column if not exists signup_landing  text;

alter table auth_events add column if not exists source   text;
alter table auth_events add column if not exists medium   text;
alter table auth_events add column if not exists campaign text;

-- Индекси само за записаните (иначе 95% от редовете са null).
create index if not exists idx_profiles_signup_source
  on profiles (signup_source) where signup_source is not null;
create index if not exists idx_auth_events_source
  on auth_events (source) where source is not null;
