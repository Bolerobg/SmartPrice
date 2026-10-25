-- 059: 📈 ПЪТЯТ НА ПОТРЕБИТЕЛЯ — броим и ГОСТИТЕ, не само влезлите.
--
-- Защо: статистиката досега искаше вход (POST /api/me/activity), а в базата има
-- 5 профила. Тоест почти всички хора, които отварят приложението, изобщо не се
-- виждаха — а точно те са хората, които трябва да спечелим. Без тях фунията не
-- може да покаже КЪДЕ отпадат: посетител → инсталация → първа полза → регистрация.
--
-- Без бисквитки и без лични данни: клиентът праща СВОЙ случаен идентификатор
-- (`visitor`), който стои само в неговия браузър. Не е име, не е имейл, не е
-- проследяване между сайтове. Изчисти ли браузъра си — идентификаторът изчезва.
--
-- Само се добавя.

create table if not exists funnel_events (
  id         uuid primary key default gen_random_uuid(),
  -- Случаен идентификатор от браузъра (localStorage). Един човек = един ред-ключ.
  visitor    text not null,
  -- visit | install | first_view | signup | verified | contribution
  -- | invite_sent | invite_accepted | push_on
  kind       text not null,
  -- Ако човекът вече е влязъл — свързваме събитието с профила (за анализ, не за вход).
  user_id    uuid references profiles(id) on delete set null,
  platform   text,
  meta       jsonb,
  ip         text,
  created_at timestamptz not null default now()
);

comment on table funnel_events is
  'Събития по пътя на потребителя, ВКЛЮЧИТЕЛНО гости (без вход). Един visitor = един браузър; не съдържа лични данни.';
comment on column funnel_events.kind is
  'visit | install | first_view | signup | verified | contribution | invite_sent | invite_accepted | push_on';
comment on column funnel_events.visitor is
  'Случаен идентификатор от браузъра на човека. Изчезва при изчистване на браузъра.';
comment on column funnel_events.platform is
  'ios | android | web — за да виждаме от какво устройство идват хората.';

create index if not exists funnel_events_kind_created_idx
  on funnel_events (kind, created_at desc);

create index if not exists funnel_events_visitor_kind_idx
  on funnel_events (visitor, kind);
