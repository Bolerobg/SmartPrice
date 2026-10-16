-- 028: Последна проверена цена в онлайн магазина за дадена оферта.
--
-- Защо: проверката „нашата цена ↔ цената в магазина сега“ се прави, като
-- сървърът прочете страницата на продукта. Някои магазини (remedium.bg,
-- sopharmacy.bg, zora.bg…) обаче са зад Cloudflare и връщат 403 на сървъра,
-- докато от домашен IP се отварят. За да не показваме грешка и да не
-- измисляме число, пазим последната РЕАЛНО проверена цена заедно с това
-- кой я е проверил (сървърът или локалният робот от домашен IP).
create table if not exists shop_price_checks (
  post_id uuid primary key references posts(id) on delete cascade,
  url text not null,
  price_eur numeric(10, 2) not null,
  list_price_eur numeric(10, 2),
  checked_at timestamptz not null default now(),
  -- 'server' = проверил е сървърът; 'local' = проверил е локалният робот
  -- (scripts/scrape_local.py --refresh) от домашен IP.
  checked_by text not null default 'server'
);

create index if not exists shop_price_checks_checked_at_idx
  on shop_price_checks (checked_at desc);
