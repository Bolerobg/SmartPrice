/**
 * 🏪 Обекти (#11) — една страница за всеки обект/фирма:
 *   • колко пъти хората са сигнализирали (сигнали + колко души),
 *   • история на цените (как се движи цената във времето),
 *   • всички сигнали с дата, снимка и полярност,
 *   • търговец/ЕИК, ако има касова бележка с проверен търговец.
 * Обектът се разпознава по (място + град); слугът идва от изгледа `v_objects`.
 */
import { many, one } from '../db.js';

export interface ObjectRow {
  slug: string;
  place_name: string;
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
  limit?: number;
  offset?: number;
}): Promise<{ total: number; items: ObjectRow[] }> {
  const q = String(params.q ?? '').trim().slice(0, 80);
  const city = String(params.city ?? '').trim().slice(0, 80);
  const limit = Math.max(1, Math.min(60, Number(params.limit ?? 20) || 20));
  const offset = Math.max(0, Math.min(5000, Number(params.offset ?? 0) || 0));
  const sort = params.sort === 'recent' ? 'recent' : params.sort === 'price' ? 'price' : 'signals';
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
  const clause = where.length ? 'where ' + where.join(' and ') : '';

  const rows = await many<ObjectRow>(
    `select ${OBJECT_COLUMNS} from v_objects ${clause} order by ${order} limit ${limit} offset ${offset}`,
    args
  );
  const total = await one<{ n: string }>(
    `select count(*)::text as n from v_objects ${clause}`,
    args
  );
  return { total: Number(total?.n ?? 0) || 0, items: rows };
}

/** Пълен профил на един обект: статистика, история на цените и всички сигнали. */
export async function loadObject(slug: string): Promise<{
  object: ObjectRow;
  signals: ObjectSignal[];
  history: Array<{ id: string; price: number; title: string; created_at: string; polarity: string; image_url: string }>;
  months: ObjectMonth[];
} | null> {
  const key = String(slug ?? '').trim().slice(0, 64);
  if (!/^[0-9a-f]{32}$/.test(key)) return null;

  const object = await one<ObjectRow>(`select ${OBJECT_COLUMNS} from v_objects where slug = $1`, [key]);
  if (!object) return null;

  const [signals, history, months] = await Promise.all([
    many<ObjectSignal>(
      `select p.id::text, p.title, p.description, p.polarity, p.category, p.price_paid::float,
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

  return { object, signals, history, months };
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
