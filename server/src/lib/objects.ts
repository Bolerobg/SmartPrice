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
 * 🛒 Вериги за супермаркети — внесените цени от Кауфланд, Метро, Билла…
 *
 * Опознават се по ЕТИКЕТА „Супермаркет“ (`platform_tag`), а не по име и НЕ по
 * таг: имената им са истинските („Кауфланд България“, „Метро България“, „СБА“…),
 * не домейни, затова проверката за онлайн магазин (`isShopName`) не ги хваща.
 * А поведението им трябва да е СЪЩОТО като на онлайн магазин: един обект
 * „Кауфланд“ съдържа хиляди оферти — средна цена между мляко и пералня не значи
 * нищо, а „всички цени в тази верига по категории“ е точно това, което човек
 * иска да види.
 *
 * Затова: влизат в таб „Магазини“ (kind='shop'), НЕ влизат в списъка с обекти
 * на място (kind='place') и се сравняват в „най-изгоден в категорията“.
 *
 * ⚠️ Етикетът е ЕДИНСТВЕНИЯТ маркер — не слагай таг на тези оферти (искане на
 * потребителя: внесените цени да не носят таг на приложението).
 */
export const CHAIN_PLATFORM_TAG = 'Супермаркет';
/** За заявки върху posts p — верига ли е този ред. */
const CHAIN_SQL = `platform_tag = '${CHAIN_PLATFORM_TAG}'`;
/** За заявки върху v_objects v — има ли тази (място, град) оферти от верига. */
const CHAIN_EXISTS_V = `exists (select 1 from posts _ch
       where _ch.status = 'published'
         and _ch.platform_tag = '${CHAIN_PLATFORM_TAG}'
         and _ch.place_name = v.place_name
         and _ch.city = v.city)`;

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
  /**
   * ⚡ Само тези категории — за да не се смята класацията по ЦЕЛИЯ каталог, когато
   * ни трябва за един-единствен обект (иначе страницата на обект чакаше секунди).
   */
  categories?: string[];
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
              p.place_name,
              coalesce(nullif(btrim(coalesce(p.custom_category_label, '')), ''), p.category) as category,
              p.price_paid::float as price
         from posts p
        where p.status = 'published' and p.price_paid > 0
          -- Онлайн магазини И вериги за супермаркети: сравняваме типичната цена
          -- на магазин/верига в една категория (иначе „най-изгоден“ се решаваше
          -- само между 3-4 онлайн магазина).
          and (${SHOP_NAME_SQL} or ${CHAIN_SQL})
          and ($5::text[] is null or
               coalesce(nullif(btrim(coalesce(p.custom_category_label, '')), ''), p.category) = any($5::text[]))
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
    [
      minPosts,
      minSaving,
      limit,
      minWinnerPosts,
      options?.categories && options.categories.length ? options.categories : null,
    ]
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

/**
 * ⚖️ „Разлики между веригите“ — къде е най-евтино и колко се различава.
 *
 * Как се смята (честно): за всяка категория сравняваме веригите по ТИПИЧНАТА им
 * цена в категорията (медианата на офертите), не по „най-евтината оферта“.
 * Изискване: поне 5 оферти на верига (иначе 2 артикула решават класация) и поне
 * 3 вериги за сравнение. Показваме най-евтината и най-скъпата + разликата в € и %.
 */
export interface ChainDifference {
  category: string;
  cheapest_chain: string;
  /** Колко струват ОБЩИТЕ продукти в по-евтината верига (не „медиана на категорията“). */
  cheapest_median: number;
  /** Колко ОБЩИ продукта има в двете вериги (за честност: сравняваме едно и също). */
  matched_products: number;
  priciest_chain: string;
  priciest_median: number;
  diff_eur: number;
  diff_pct: number;
  chains_compared: number;
}

export async function chainDifferences(options?: {
  city?: string | null;
  limit?: number;
  minPosts?: number;
}): Promise<ChainDifference[]> {
  const city = options?.city?.trim() || null;
  const limit = Math.max(1, Math.min(60, Number(options?.limit ?? 24) || 24));
  const minPosts = Math.max(2, Math.min(50, Number(options?.minPosts ?? 5) || 5));

  /**
   * ⚠️ Защо НЕ сравняваме „медианата на категорията“ между вериги: категорията е
   * широка („Хигиена и козметика“), а асортиментите се различават — Лидл продава
   * шампоан за 1.10 €, Douglas парфюм за 19.94 € и излизаше „−94%“, което е
   * безсмислица и подвежда. Затова сравняваме САМО продуктите, които ги има и в
   * двете вериги (един и същ продукт = един и същ canonical адрес), и казваме
   * колко общи продукта са.
   */
  const rows = await many<{
    category: string;
    a_chain: string;
    b_chain: string;
    matched: number;
    a_total: number;
    b_total: number;
    a_posts: number;
    b_posts: number;
    chains_compared: number;
  }>(
    `with cp as (
       select coalesce(nullif(btrim(coalesce(p.custom_category_label, '')), ''), p.category) as category,
              btrim(p.place_name) as chain,
              p.source_url as product,
              min(p.price_paid)::float as price
         from posts p
        where p.status = 'published'
          and p.price_paid > 0
          and p.platform_tag = '${CHAIN_PLATFORM_TAG}'
          and p.source_url is not null
          and ($1::text is null or lower(p.city) = lower($1))
        group by 1, 2, 3
     ),
     pairs as (
       select a.category,
              a.chain as a_chain,
              b.chain as b_chain,
              count(*)::int as matched,
              sum(a.price)::float as a_total,
              sum(b.price)::float as b_total
         from cp a
         join cp b on b.category = a.category and b.product = a.product and b.chain > a.chain
        group by 1, 2, 3
       having count(*) >= $2
     ),
     best as (
       select *, row_number() over (partition by category order by matched desc) as rn
         from pairs
     )
     select b.category, b.a_chain, b.b_chain, b.matched, b.a_total, b.b_total,
            (select count(*)::int from cp where cp.category = b.category and cp.chain = b.a_chain) as a_posts,
            (select count(*)::int from cp where cp.category = b.category and cp.chain = b.b_chain) as b_posts,
            (select count(distinct chain)::int from cp where cp.category = b.category) as chains_compared
       from best b
      where b.rn = 1
      order by abs(b.a_total - b.b_total) desc
      limit ${limit}`,
      [city, minPosts]
      );

  return rows.map((r) => {
    // По-евтината верига от двойката — тя е „най-евтино“, а другата е „най-скъпо“.
    const aCheaper = r.a_total <= r.b_total;
    const cheapChain = aCheaper ? r.a_chain : r.b_chain;
    const dearChain = aCheaper ? r.b_chain : r.a_chain;
    const cheapTotal = aCheaper ? r.a_total : r.b_total;
    const dearTotal = aCheaper ? r.b_total : r.a_total;
    return {
      category: r.category,
      cheapest_chain: cheapChain,
      cheapest_median: Number(cheapTotal.toFixed(2)),
      matched_products: Number(r.matched) || 0,
      priciest_chain: dearChain,
      priciest_median: Number(dearTotal.toFixed(2)),
      diff_eur: Number((dearTotal - cheapTotal).toFixed(2)),
      diff_pct: dearTotal > 0 ? Math.round((1 - cheapTotal / dearTotal) * 100) : 0,
      chains_compared: Number(r.chains_compared) || 0,
    };
  });
}

/**
 * ⚡ БЪРЗ вариант на изгледа `v_objects`.
 *
 * Защо: `v_objects` агрегира ЦЕЛИЯ каталог (всички публикувани оферти) и чак после
 * филтрира — при 53 000+ внесени цени заявката отговаряше 8 секунди и списъците
 * „висяха“. Тук агрегираме САМО редовете, които ни трябват (`baseFilter` влиза
 * вътре, върху `posts`), а външните условия остават същите — резултатът е един
 * и същ, само че за части от секундата.
 *
 * Стойностите са 1:1 с изгледа (иначе списъците и страницата на обект щяха да
 * показват различни числа).
 */
const OBJECTS_FAST = (baseFilter: string) => `
  with base as materialized (
    select p.id, p.place_name, p.city, p.author_id, p.polarity, p.price_paid, p.created_at,
           p.helped_count, p.category, p.image_url, p.unit_type, p.latitude, p.longitude,
           p.address, r.merchant_name, r.merchant_tax_id, r.verified_by_ai
      from posts p
      left join receipts r on r.post_id = p.id
     where p.status = 'published' ${baseFilter}
  )
  select md5(lower(btrim(coalesce(place_name, '')) || '|' || lower(btrim(coalesce(city, ''))))) as slug,
         min(btrim(coalesce(place_name, ''))) as place_name,
         min(btrim(coalesce(city, ''))) as city,
         count(*)::int as signals_count,
         count(distinct author_id)::int as reporters_count,
         count(*) filter (where polarity = 'green')::int as green_count,
         count(*) filter (where polarity = 'red')::int as red_count,
         min(price_paid)::float as min_price,
         max(price_paid)::float as max_price,
         avg(price_paid)::float as avg_price,
         max(created_at)::text as last_seen,
         min(created_at)::text as first_seen,
         sum(coalesce(helped_count, 0))::int as helped_total,
         (array_agg(distinct category))[1] as category,
         array_agg(distinct category) as categories,
         (array_agg(image_url order by created_at desc))[1] as cover_image,
         (array_agg(id order by created_at desc))[1] as last_post_id,
         (array_agg(unit_type order by created_at desc))[1] as unit_type,
         (array_agg(latitude order by created_at desc))[1] as latitude,
         (array_agg(longitude order by created_at desc))[1] as longitude,
         max(nullif(btrim(coalesce(address, '')), '')) as address,
         max(nullif(btrim(coalesce(merchant_name, '')), '')) as merchant_name,
         max(nullif(btrim(coalesce(merchant_tax_id, '')), '')) as merchant_tax_id,
         count(*) filter (where verified_by_ai)::int as receipts_verified
    from base
   group by 1`;

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
    /**
     * Търсене и ПО ПРОДУКТ, не само по име на магазин.
     *
     * Защо: човекът пише „ANSMANN“ или „Wera“ — това е марка на продукт, който
     * магазинът продава. Преди търсенето хващаше само името/града и човекът
     * получаваше 0 резултата, макар офертите да са в базата.
     */
    where.push(
      `(v.place_name ilike $${args.length}
        or v.city ilike $${args.length}
        or coalesce(v.merchant_name,'') ilike $${args.length}
        or exists (
          select 1 from posts p2
           where md5(lower(btrim(coalesce(p2.place_name,'')) || '|' || lower(btrim(coalesce(p2.city,'')))))
                 = md5(lower(btrim(coalesce(v.place_name,'')) || '|' || lower(btrim(coalesce(v.city,'')))))
             and p2.status = 'published'
             and (p2.title ilike $${args.length}
                  or p2.title_fold like lower($${args.length})
                  or p2.description ilike $${args.length})
        ))`
    );
  }
  if (city) {
    args.push(city);
    where.push(`city ilike $${args.length}`);
  }
  // Онлайн магазините и обектите на място се показват в РАЗЛИЧНИ списъци:
  // в „Черен списък“/„Честни места“ няма място за каталог на магазин.
  // „Магазини“ = онлайн магазини + вериги за супермаркети (и двете са каталози,
  // не места, за които някой е гласувал).
  if (kind === 'shop') where.push(`(${SHOP_NAME_SQL} or ${CHAIN_EXISTS_V})`);
  if (kind === 'place') where.push(`(${PLACE_NAME_SQL} and not (${CHAIN_EXISTS_V}))`);
  const clause = where.length ? 'where ' + where.join(' and ') : '';

  /**
   * ⚡ За скорост: градът и „магазин/място“ се подтискат ВЪТРЕ в агрегацията.
   * Градът и името на мястото са едни и същи за целия групиран ред, затова
   * филтърът вътре дава същия резултат, но не агрегира целия каталог (преди
   * списъкът отговаряше 8 секунди при 53 000 внесени цени).
   */
  const baseFilter: string[] = [];
  // ⚠️ Градът НЕ се подава втори път като нов параметър — ползваме СЪЩИЯ
  // placeholder, който вече стои във външното условие. Иначе броячът щеше да
  // получи неизползван параметър и Postgres да върне грешка (същият капан, който
  // вече веднъж ни ухапа при търсенето).
  const cityClause = city ? where.find((w) => w.startsWith('city ilike')) : undefined;
  const cityParam = cityClause ? cityClause.slice(cityClause.indexOf('$')) : null;
  if (cityParam) baseFilter.push(`and p.city ilike ${cityParam}`);
  if (kind === 'shop') baseFilter.push(`and (${SHOP_NAME_SQL.replace(/place_name/g, 'p.place_name')})`);
  if (kind === 'place') baseFilter.push(`and (${PLACE_NAME_SQL.replace(/place_name/g, 'p.place_name')})`);
  const fast = OBJECTS_FAST(baseFilter.join(' '));

  // ⚠️ LIMIT/OFFSET като литерали — иначе планировчикът избира лош план (виж
  // бележката в lib/feed.ts: 60 ms → 4 285 ms заради `limit $n`).
  const rows = await many<ObjectRow>(
    `select * from (${fast}) v ${clause} order by ${order} limit ${limit} offset ${offset}`,
    args
  );
  const total = await one<{ n: string }>(`select count(*)::text as n from (${fast}) v ${clause}`, args);

  return {
    total: Number(total?.n ?? 0) || 0,
    items: rows.map((r) => ({
      ...r,
      // true = каталог (домейн или верига) → приложението показва цени ПО
      // КАТЕГОРИИ, вместо безсмислена „средна цена“ на целия обект.
      is_shop: isShopName(r.place_name) || kind === 'shop',
    })),
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

  // Агрегираме САМО офертите на този обект (не целия каталог) — иначе 8 сек.
  const object = await one<ObjectRow>(
    `${OBJECTS_FAST(
      `and md5(lower(btrim(coalesce(p.place_name, '')) || '|' || lower(btrim(coalesce(p.city, ''))))) = $1`
    )}`,
    [key]
  );
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
        // Категорията: ако редът носи истинската категория на продукта (така
        // идват цените от веригите на супермаркети — „Сирене“, „Зеленчуци“),
        // групираме по нея; иначе по общата категория на приложението.
        `select coalesce(nullif(btrim(coalesce(p.custom_category_label, '')), ''), p.category) as category,
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
      // Питаме само за категориите, които ТОЗИ обект има — не за целия каталог.
      const winners = await cheapestShopsByCategory({
        categories: categoriesStats.map((c) => c.category).filter(Boolean),
      });
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

/**
 * 🔎 Търсене в офертите на ЕДИН обект/магазин (с пагинация).
 *
 * Защо съществува: страницата на обект връщаше само първите 80 оферти и в
 * магазин с 200+ продукта човекът не можеше да намери нищо (нямаше търсачка).
 * Тук търсим на СЪРВЪРА по заглавие, описание и код на офертата и връщаме
 * страница по страница.
 *
 * Латиницата (марки като ANSMANN, Wera, домейни) се хваща с `ilike`, който е
 * ASCII-безопасен, а кирилицата — със `sp_fold` (в C колация `lower()` не сгъва
 * кирилица, затова са нужни двете).
 */
export async function searchObjectOffers(
  slug: string,
  params: {
    q?: string;
    /**
     * 🏷️ Само офертите в една категория („Сирене“).
     *
     * Защо: на страницата на магазин/верига статистиката „цени по категории“
     * изглежда като бутони, но досега не отваряше нищо — човекът докосва
     * „Сирене · 81 оферти“ и очаква да види точно тези 81 оферти. Сега ги вижда.
     */
    category?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ total: number; items: ObjectSignal[] }> {
  const key = String(slug ?? '').trim().slice(0, 64);
  if (!/^[0-9a-f]{32}$/.test(key)) return { total: 0, items: [] };
  const q = String(params.q ?? '').trim().slice(0, 80);
  const limit = Math.max(1, Math.min(60, Number(params.limit ?? 30) || 30));
  const offset = Math.max(0, Math.min(5000, Number(params.offset ?? 0) || 0));

  const args: unknown[] = [key];
  let search = '';
  const category = String(params.category ?? '').trim().slice(0, 80);
  if (category) {
    // Категорията на реда: истинската категория на продукта, ако я има
    // (внесените цени от веригите я носят), иначе общата категория.
    args.push(category);
    search += ` and coalesce(nullif(btrim(coalesce(p.custom_category_label, '')), ''), p.category) = $${args.length}`;
  }
  if (q) {
    args.push(`%${q}%`);
    const p = `$${args.length}`;
    search = ` and (p.title ilike ${p}
                 or p.title_fold like lower(${p})
                 or p.description ilike ${p}
                 or p.description_fold like lower(${p})
                 or upper(replace(p.public_code, '-', '')) like upper(replace(${p}, '-', '')))`;
  }
  const where = `p.status = 'published'
      and md5(lower(btrim(p.place_name)) || '|' || lower(btrim(p.city))) = $1${search}`;

  const items = await many<ObjectSignal>(
    `select p.id::text, p.source, p.title, p.description, p.polarity, p.category, p.price_paid::float,
            p.currency, p.image_url, p.created_at::text, p.helped_count,
            p.unit_quantity::float, p.unit_type, p.price_per_unit::float,
            p.is_fake_promo, p.is_shrinkflation, r.verified_by_ai,
            nullif(btrim(coalesce(r.merchant_name,'')),'') as merchant_name,
            nullif(btrim(coalesce(r.merchant_tax_id,'')),'') as merchant_tax_id
       from posts p
       left join receipts r on r.post_id = p.id
      where ${where}
      order by p.created_at desc
      limit ${limit} offset ${offset}`,
    args
  );

  const total = await one<{ n: string }>(
    `select count(*)::text as n from posts p where ${where}`,
    args
  );
  return { total: Number(total?.n ?? 0) || 0, items };
}
