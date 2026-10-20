/**
 * 🏪 Обекти (#11) — една страница за всеки обект/фирма:
 *   • колко пъти хората са сигнализирали (сигнали + колко души),
 *   • история на цените (как се движи цената във времето),
 *   • всички сигнали с дата, снимка и полярност,
 *   • търговец/ЕИК, ако има касова бележка с проверен търговец.
 * Обектът се разпознава по (място + град); слугът идва от изгледа `v_objects`.
 */
import { many, one } from '../db.js';

/** Обогатени данни от Google Maps (рейтинг, отзиви, работно време, телефон). */
export interface ObjectPlace {
  rating: number | null;
  reviews_count: number | null;
  place_category: string | null;
  place_address: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  website: string | null;
  /** [{ day: 'понеделник', hours: '8:00ч. to 18:00ч.' }, …] — както ги дава Google. */
  hours: Array<{ day: string; hours: string }> | null;
  maps_url: string | null;
  updated_at: string;
}

export interface ObjectRow {
  slug: string;
  place_name: string;
  /** Онлайн магазин ли е (не се брои за обект в класациите). */
  is_shop?: boolean;
  city: string;
  signals_count: number;
  reporters_count: number;
  green_count: number;
  red_count: number;
  min_price: number | null;
  max_price: number | null;
  avg_price: number | null;
  last_seen: string;
  first_seen: string;
  helped_total: number;
  category: string | null;
  categories: string[] | null;
  cover_image: string | null;
  last_post_id: string | null;
  unit_type: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  merchant_name: string | null;
  merchant_tax_id: string | null;
  receipts_verified: number;
}

export interface ObjectSignal {
  id: string;
  /** Откъде е офертата: user | scraper | olx | receipt_basket | … */
  source: string | null;
  title: string;
  description: string;
  polarity: string;
  category: string;
  price_paid: number;
  currency: string;
  image_url: string;
  created_at: string;
  helped_count: number;
  unit_quantity: number | null;
  unit_type: string | null;
  price_per_unit: number | null;
  is_fake_promo: boolean;
  is_shrinkflation: boolean;
  verified_by_ai: boolean | null;
  merchant_name: string | null;
  merchant_tax_id: string | null;
}

export interface ObjectMonth {
  month: string;
  avg_price: number;
  min_price: number;
  max_price: number;
  posts: number;
}

export interface ObjectCategoryStat {
  category: string;
  posts: number;
  min_price: number;
  avg_price: number;
  max_price: number;
  /** 🥇 Този магазин е най-изгодният в категорията (виж cheapestShopsByCategory). */
  best_value?: boolean;
  /** С колко % е под следващия магазин в категорията. */
  saving_pct?: number;
  /** Колко магазина се сравняват в категорията. */
  shops_compared?: number;
}

/**
 * Онлайн магазин ли е това име?
 *
 * Защо е нужно: обект = място + град и е замислен за ЗАВЕДЕНИЕ, където се
 * сравнява едно и също нещо. Когато скраперът внесе цял онлайн магазин, в един
 * „обект“ влизат крушка за 0.35 € и машина за 1240 €. Такива магазини НЕ се
 * броят за обекти в класациите (черен списък / „Честно място“) — показваме ги
 * в отделен таб „Магазини“ със статистика ПО КАТЕГОРИИ.
 */
export function isShopName(placeName: string | null | undefined): boolean {
  return /^[a-z0-9][a-z0-9.-]*\.(bg|com|net|org|eu|de|gr|ro|info|shop)$/i.test(
    String(placeName ?? '').trim()
  );
}

/**
 * Името изглежда ли като домейн (онлайн магазин) — същата проверка, но в SQL.
 *
 * Един източник на истина: ако някой ден сменим списъка с домейни, тук се пипа
 * веднъж, а не на три места (иначе „Магазини“ и класацията започват да спорят).
 */
const SHOP_NAME_SQL = `place_name ~ '^[a-zA-Z0-9][a-zA-Z0-9.-]*\\.(bg|com|net|org|eu|de|gr|ro|info|shop)$'`;
const PLACE_NAME_SQL = `place_name !~ '^[a-zA-Z0-9][a-zA-Z0-9.-]*\\.(bg|com|net|org|eu|de|gr|ro|info|shop)$'`;

/**
 * 🥇 Магазин, който е НАЙ-ИЗГОДЕН в дадена категория.
 *
 * Как се смята (и защо така): сравняваме магазините в ЕДНА категория по
 * ТИПИЧНАТА им цена (медианата на офертите), не по „най-евтината оферта“ —
 * иначе един евтин артикул прави целия магазин „най-изгоден“.
 *
 * Изисквания, за да има значка (честност):
 *   • всеки магазин има поне `minPosts` оферти с цена в категорията (иначе 2
 *     артикула решават класация на каталог от 500);
 *   • ПОБЕДИТЕЛЯТ има поне `minWinnerPosts` оферти — с 3 артикула медианата е
 *     случайна (проверено на живо: iskambg.com „печелеше“ с 3 оферти пред
 *     каталог от 45);
 *   • в категорията има поне 2 магазина за сравнение (сам в категорията не е
 *     „най-изгоден“ — просто няма с кого да се сравни);
 *   • медианата му е поне `minSavingPct` % под медианата на СЛЕДВАЩИЯ магазин
 *     (разлика от 1 стотинка не е „най-изгоден“).
 */
export interface BestValueCategory {
  category: string;
  slug: string;
  place_name: string;
  /** Колко оферти с цена има този магазин в категорията. */
  posts: number;
  min_price: number;
  max_price: number;
  avg_price: number;
  median_price: number;
  /** Колко магазина се сравняват в тази категория. */
  shops_compared: number;
  /** С колко % типичната му цена е под следващия магазин. */
  saving_pct: number;
  /** Кой е следващият магазин (за да е ясно спрямо кого е разликата). */
  next_place_name: string | null;
  next_median: number | null;
}

export async function cheapestShopsByCategory(options?: {
  minPosts?: number;
  minWinnerPosts?: number;
  minSavingPct?: number;
  limit?: number;
}): Promise<BestValueCategory[]> {
  const minPosts = Math.max(2, Math.min(50, Number(options?.minPosts ?? 3) || 3));
  const minWinnerPosts = Math.max(
    minPosts,
    Math.min(100, Number(options?.minWinnerPosts ?? 5) || 5)
  );
  const minSaving = Math.max(1, Math.min(50, Number(options?.minSavingPct ?? 5) || 5));
  const limit = Math.max(1, Math.min(200, Number(options?.limit ?? 60) || 60));

  const rows = await many<{
    category: string;
    slug: string;
    place_name: string;
    posts: number;
    min_price: number;
    max_price: number;
    avg_price: number;
    median_price: number;
    shops_compared: number;
    next_median: number | null;
    next_place_name: string | null;
  }>(
    `with shop_posts as (
       select md5(lower(btrim(p.place_name)) || '|' || lower(btrim(p.city))) as slug,
              p.place_name, p.category, p.price_paid::float as price
         from posts p
        where p.status = 'published' and p.price_paid > 0
          and ${SHOP_NAME_SQL}
     ),
     per_shop as (
       select slug, max(place_name) as place_name, category,
              count(*)::int as posts,
              min(price)::float as min_price,
              max(price)::float as max_price,
              avg(price)::float as avg_price,
              percentile_cont(0.5) within group (order by price)::float as median_price
         from shop_posts
        group by slug, category
       having count(*) >= $1
     ),
     ranked as (
       select *,
              count(*) over (partition by category)::int as shops_compared,
              row_number() over (partition by category order by median_price asc, avg_price asc) as rn,
              lead(median_price) over (partition by category order by median_price asc, avg_price asc) as next_median,
              lead(place_name) over (partition by category order by median_price asc, avg_price asc) as next_place_name
         from per_shop
     )
     select category, slug, place_name, posts, min_price, max_price, avg_price,
            median_price, shops_compared, next_median, next_place_name
       from ranked
      where rn = 1
        and shops_compared >= 2
        and median_price > 0
        and posts >= $4
        and (next_median is null or median_price <= next_median * (1 - $2::float / 100.0))
      order by shops_compared desc, category asc
      limit $3`,
    [minPosts, minSaving, limit, minWinnerPosts]
  );

  return rows.map((r) => ({
    category: r.category,
    slug: r.slug,
    place_name: r.place_name,
    posts: r.posts,
    min_price: r.min_price,
    max_price: r.max_price,
    avg_price: r.avg_price,
    median_price: r.median_price,
    shops_compared: r.shops_compared,
    next_place_name: r.next_place_name ?? null,
    next_median: r.next_median ?? null,
    saving_pct:
      r.next_median && r.next_median > 0
        ? Math.round((1 - r.median_price / r.next_median) * 100)
        : 0,
  }));
}

const OBJECT_COLUMNS = `
  slug, place_name, city, signals_count, reporters_count, green_count, red_count,
  min_price, max_price, avg_price, last_seen::text, first_seen::text, helped_total,
  category, categories, cover_image, last_post_id, unit_type, latitude, longitude,
  address, merchant_name, merchant_tax_id, receipts_verified`;

/** Търсене на обекти по име/град (за екрана „Обекти“). */
export async function searchObjects(params: {
  q?: string;
  city?: string;
  sort?: 'signals' | 'recent' | 'price';
  /** 'shop' = само онлайн магазини, 'place' = само обекти на място. */
  kind?: 'shop' | 'place';
  limit?: number;
  offset?: number;
}): Promise<{ total: number; items: ObjectRow[] }> {
  const q = String(params.q ?? '').trim().slice(0, 80);
  const city = String(params.city ?? '').trim().slice(0, 80);
  const limit = Math.max(1, Math.min(60, Number(params.limit ?? 20) || 20));
  const offset = Math.max(0, Math.min(5000, Number(params.offset ?? 0) || 0));
  const sort = params.sort === 'recent' ? 'recent' : params.sort === 'price' ? 'price' : 'signals';
  const kind = params.kind === 'shop' || params.kind === 'place' ? params.kind : undefined;
  const order =
    sort === 'recent'
      ? 'last_seen desc'
      : sort === 'price'
        ? 'avg_price asc nulls last'
        : 'signals_count desc, last_seen desc';

  const where: string[] = [];
  const args: unknown[] = [];
  if (q) {
    args.push('%' + q + '%');
    where.push(`(place_name ilike $${args.length} or city ilike $${args.length} or coalesce(merchant_name,'') ilike $${args.length})`);
  }
  if (city) {
    args.push(city);
    where.push(`city ilike $${args.length}`);
  }
  // Онлайн магазините и обектите на място се показват в РАЗЛИЧНИ списъци:
  // в „Черен списък“/„Честни места“ няма място за каталог на магазин.
  if (kind === 'shop') where.push(SHOP_NAME_SQL);
  if (kind === 'place') where.push(PLACE_NAME_SQL);
  const clause = where.length ? 'where ' + where.join(' and ') : '';

  const rows = await many<ObjectRow>(
    `select ${OBJECT_COLUMNS} from v_objects ${clause} order by ${order} limit ${limit} offset ${offset}`,
    args
  );
  const total = await one<{ n: string }>(
    `select count(*)::text as n from v_objects ${clause}`,
    args
  );
  return {
    total: Number(total?.n ?? 0) || 0,
    items: rows.map((r) => ({ ...r, is_shop: isShopName(r.place_name) })),
  };
}

/** Пълен профил на един обект: статистика, история на цените и всички сигнали. */
export async function loadObject(slug: string): Promise<{
  object: ObjectRow;
  signals: ObjectSignal[];
  history: Array<{ id: string; price: number; title: string; created_at: string; polarity: string; image_url: string }>;
  months: ObjectMonth[];
  /** Онлайн магазин ли е (тогава статистиката за цени няма смисъл). */
  is_shop: boolean;
  /** Статистика ПО КАТЕГОРИИ — смислената статистика за онлайн магазин. */
  categories_stats: ObjectCategoryStat[];
  /** Google Maps: рейтинг, отзиви, работно време. null, ако още не е обогатен. */
  place: ObjectPlace | null;
} | null> {
  const key = String(slug ?? '').trim().slice(0, 64);
  if (!/^[0-9a-f]{32}$/.test(key)) return null;

  const object = await one<ObjectRow>(`select ${OBJECT_COLUMNS} from v_objects where slug = $1`, [key]);
  if (!object) return null;

  const [signals, history, months] = await Promise.all([
    many<ObjectSignal>(
      `select p.id::text, p.source, p.title, p.description, p.polarity, p.category, p.price_paid::float,
              p.currency, p.image_url, p.created_at::text, p.helped_count,
              p.unit_quantity::float, p.unit_type, p.price_per_unit::float,
              p.is_fake_promo, p.is_shrinkflation, r.verified_by_ai,
              nullif(btrim(coalesce(r.merchant_name,'')),'') as merchant_name,
              nullif(btrim(coalesce(r.merchant_tax_id,'')),'') as merchant_tax_id
         from posts p
         left join receipts r on r.post_id = p.id
        where p.status = 'published'
          and md5(lower(btrim(p.place_name)) || '|' || lower(btrim(p.city))) = $1
        order by p.created_at desc
        limit 80`,
      [key]
    ),
    many<{ id: string; price: number; title: string; created_at: string; polarity: string; image_url: string }>(
      `select p.id::text, p.price_paid::float as price, p.title, p.created_at::text, p.polarity, p.image_url
         from posts p
        where p.status = 'published'
          and md5(lower(btrim(p.place_name)) || '|' || lower(btrim(p.city))) = $1
        order by p.created_at asc
        limit 200`,
      [key]
    ),
    many<ObjectMonth>(
      `select to_char(date_trunc('month', p.created_at), 'YYYY-MM') as month,
              avg(p.price_paid)::float as avg_price,
              min(p.price_paid)::float as min_price,
              max(p.price_paid)::float as max_price,
              count(*)::int as posts
         from posts p
        where p.status = 'published'
          and md5(lower(btrim(p.place_name)) || '|' || lower(btrim(p.city))) = $1
        group by 1
        order by 1 asc`,
      [key]
    ),
  ]);

  // Обогатените данни от Google Maps са по СЪЩИЯ слуг (md5(място|град)) — едно
  // обръщение, без външен ключ. Липсват → place: null (страницата пак работи).
  const place = await one<ObjectPlace>(
    `select rating::float as rating, reviews_count, category as place_category,
            address as place_address, neighborhood, latitude, longitude,
            phone, website, hours, maps_url, updated_at::text as updated_at
       from place_enrichment where slug = $1`,
    [key]
  );

  /**
   * 🏬 Онлайн магазин ли е този „обект“?
   *
   * Защо е важно: обект = място + град и е замислен за ЗАВЕДЕНИЕ или магазин,
   * където човек сравнява едно и също нещо (кафе, хляб). Когато обектът е онлайн
   * магазин (нашият скрапер е внесъл целия каталог: praktis.bg, sopharmacy.bg),
   * в „най-ниска/най-висока цена“ влизат крушка за 0.35 € и гроздомелачка за
   * 1240 € — числата са ВЕРНИ, но нямат никакъв смисъл и плашат хората
   * („защо ми показва 1240 € в червено?“).
   *
   * Затова: за онлайн магазин app-ът НЕ показва средна/най-ниска/най-висока
   * цена и графика на цените — показва офертите (те сами носят цените си).
   * Разпознаваме го по името (домейн: нещо.бг / нещо.com) или по това, че
   * офертите идват от скрапера.
   */
  const isShop =
    isShopName(object.place_name) ||
    (signals.length > 0 && signals.every((s) => s.source === 'scraper'));

  /**
   * За онлайн магазин „средна цена 41.86 €“ е безсмислица (крушка + машина).
   * Смисленото е ПО КАТЕГОРИИ: „Инструменти: 12 оферти, 8–140 €“.
   */
  const categoriesStats = isShop
    ? await many<ObjectCategoryStat>(
        `select p.category,
                count(*)::int as posts,
                min(p.price_paid)::float as min_price,
                avg(p.price_paid)::float as avg_price,
                max(p.price_paid)::float as max_price
           from posts p
          where p.status = 'published'
            and p.price_paid > 0
            and md5(lower(btrim(p.place_name)) || '|' || lower(btrim(p.city))) = $1
          group by 1
          order by 2 desc
          limit 12`,
        [key]
      )
    : [];

  /**
   * 🥇 „Най-изгодни цени“ — значката до категория.
   *
   * Смята се на едно място (`cheapestShopsByCategory`) и за списъка „Магазини“, и
   * тук, за да не може екранът и списъкът да показват различни победители.
   * Ако заявката се провали, страницата пак работи — просто без значка.
   */
  let categoriesWithBadges = categoriesStats;
  if (isShop && categoriesStats.length > 0) {
    try {
      const winners = await cheapestShopsByCategory();
      const mine = new Map(winners.filter((w) => w.slug === key).map((w) => [w.category, w]));
      categoriesWithBadges = categoriesStats.map((c) => {
        const w = mine.get(c.category);
        return w
          ? { ...c, best_value: true, saving_pct: w.saving_pct, shops_compared: w.shops_compared }
          : c;
      });
    } catch {
      categoriesWithBadges = categoriesStats;
    }
  }

  return {
    object,
    signals,
    history,
    months,
    is_shop: isShop,
    categories_stats: categoriesWithBadges,
    place: place ?? null,
  };
}

/** Слугът на обекта, към който принадлежи даден пост (за бутона в офертата). */
export async function slugForPost(postId: string): Promise<string | null> {
  const row = await one<{ slug: string }>(
    `select md5(lower(btrim(place_name)) || '|' || lower(btrim(city))) as slug
       from posts where id = $1`,
    [postId]
  );
  return row?.slug ?? null;
}
