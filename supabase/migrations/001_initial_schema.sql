-- ============================================================================
-- SmartPrice — Пълна PostgreSQL схема за Supabase
-- Включва: Профили, Категории, Постове (Зелени/Червени), Касови Бележки (AI OCR),
-- Реакции, Коментари, Спестени суми и Дарения чрез Stripe
-- ============================================================================

create extension if not exists "uuid-ossp";

-- 1. Таблица за потребителски профили
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  handle text unique not null,
  email text,
  avatar_url text,
  bio text default '',
  city text default 'София',
  is_supporter boolean default false,
  supporter_tier text check (supporter_tier in ('coffee', 'guardian', 'legend')),
  supporter_since timestamptz,
  total_donated_bgn numeric(10, 2) default 0,
  total_saved_for_community_bgn numeric(12, 2) default 0,
  personal_saved_bgn numeric(12, 2) default 0,
  reputation_points integer default 50,
  last_donation_prompt_at timestamptz,
  interactions_since_prompt integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Таблица за постове (🟢 Топ Находки и 🔴 Червени Флагове)
create table if not exists public.posts (
  id uuid primary key default uuid_generate_v4(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  polarity text not null check (polarity in ('green', 'red')),
  category text not null check (category in ('restaurants', 'hotels_airbnb', 'supermarket', 'cafes_bars', 'services_tech')),
  platform_tag text not null default 'На място',
  title text not null,
  description text not null,
  place_name text not null,
  city text not null,
  address text,
  price_paid numeric(10, 2) not null,
  reference_price numeric(10, 2),
  currency text not null default 'лв.',
  image_url text not null,
  comparison_image_url text,
  comparison_label text,
  -- Касова бележка (AI OCR метаданни)
  has_verified_receipt boolean default false,
  receipt_merchant_name text,
  receipt_tax_id text,
  receipt_date text,
  receipt_total_amount numeric(10, 2),
  receipt_confidence numeric(4, 2),
  receipt_image_url text,
  -- Статистики и реакции
  top_deal_count integer default 0,
  worth_it_count integer default 0,
  doubt_count integer default 0,
  pure_robbery_count integer default 0,
  avoid_count integer default 0,
  exaggerated_count integer default 0,
  helped_count integer default 0,
  community_saved_bgn numeric(12, 2) default 0,
  tags text[] default '{}',
  created_at timestamptz default now()
);

-- 3. Артикули от касовата бележка (извлечени чрез AI OCR)
create table if not exists public.receipt_items (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  name text not null,
  quantity numeric(8, 2) default 1,
  unit_price numeric(10, 2) not null,
  total_price numeric(10, 2) not null,
  highlight_reason text,
  created_at timestamptz default now()
);

-- 4. Гласувания / Реакции към постовете
create table if not exists public.post_reactions (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_key text not null check (reaction_key in ('topDeal', 'worthIt', 'doubt', 'pureRobbery', 'avoid', 'exaggerated')),
  created_at timestamptz default now(),
  unique (post_id, user_id)
);

-- 5. Отбелязвания „Това ми спести пари / Спаси ме от капан“
create table if not exists public.post_helped_marks (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  saved_amount_bgn numeric(10, 2) not null default 15.00,
  created_at timestamptz default now(),
  unique (post_id, user_id)
);

-- 6. Коментари
create table if not exists public.comments (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  text text not null,
  likes integer default 0,
  created_at timestamptz default now()
);

-- 7. Дарения през Stripe (Monetization & Periodic Nudge Tracking)
create table if not exists public.donations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete set null,
  amount_bgn numeric(10, 2) not null,
  currency text not null default 'BGN',
  tier_id text not null default 'guardian',
  is_monthly boolean default false,
  stripe_payment_intent_id text unique,
  status text not null default 'succeeded' check (status in ('pending', 'succeeded', 'failed')),
  created_at timestamptz default now()
);

-- Индекси за бързо търсене и филтриране
create index if not exists idx_posts_polarity on public.posts(polarity);
create index if not exists idx_posts_category on public.posts(category);
create index if not exists idx_posts_city on public.posts(city);
create index if not exists idx_posts_created_at on public.posts(created_at desc);

-- Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.post_reactions enable row level security;
alter table public.post_helped_marks enable row level security;
alter table public.comments enable row level security;
alter table public.donations enable row level security;

create policy "Public profiles are viewable by everyone"
  on public.profiles for select using (true);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Posts are viewable by everyone"
  on public.posts for select using (true);

create policy "Authenticated users can create posts"
  on public.posts for insert with check (auth.uid() = author_id);

create policy "Receipt items are viewable by everyone"
  on public.receipt_items for select using (true);

create policy "Comments are viewable by everyone"
  on public.comments for select using (true);

create policy "Authenticated users can insert comments"
  on public.comments for insert with check (auth.uid() = author_id);

-- Тригер: При успешно дарение в donations, автоматично активира статус is_supporter = true
create or replace function public.handle_successful_donation()
returns trigger as $$
begin
  if new.status = 'succeeded' and new.user_id is not null then
    update public.profiles
    set
      is_supporter = true,
      supporter_since = coalesce(supporter_since, now()),
      supporter_tier = new.tier_id,
      total_donated_bgn = coalesce(total_donated_bgn, 0) + new.amount_bgn,
      reputation_points = coalesce(reputation_points, 0) + 100,
      updated_at = now()
    where id = new.user_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_donation_succeeded on public.donations;
create trigger on_donation_succeeded
  after insert or update on public.donations
  for each row execute function public.handle_successful_donation();
