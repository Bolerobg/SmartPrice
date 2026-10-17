/**
 * 📊 Публични данни за цени (#13) — отворен достъп, без вход.
 *
 * Целта е медиите и журналистите да могат да цитират реални цени от общността:
 *   GET /api/public/overview                 — обобщение (колко наблюдения, градове, продукти)
 *   GET /api/public/prices?q=домати&city=София — списък продукти със статистика
 *   GET /api/public/prices/:slug             — един продукт: по градове, по месеци, последни наблюдения
 *
 * Няма лични данни: без автори, без снимки, без адреси, без линкове към постове.
 */
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { many, one } from '../db.js';
import { notFound } from '../lib/errors.js';

/** Стабилен адрес на продукт (md5 от името с малки букви). */
function productSlug(name: string): string {
  return createHash('md5').update(name.trim().toLowerCase()).digest('hex');
}

const META = {
  source: 'SmartPrice',
  sourceUrl: 'https://smartprice.bg',
  license: 'CC BY 4.0 — свободно за ползване с позоваване на SmartPrice',
  about: 'Цени, изпратени от общността в България. Сумите са в евро. Данните са анонимни.',
};

const CACHE = 'public, max-age=300, stale-while-revalidate=3600';

export default async function publicDataRoutes(app: FastifyInstance): Promise<void> {
  /** Обобщение — „колко данни има“: за заглавна страница и за бърза справка. */
  app.get('/api/public/overview', async (req, reply) => {
    reply.header('Cache-Control', CACHE);
    const totals = await one<{
      observations: number;
      products: number;
      cities: number;
      first_seen: string | null;
      last_seen: string | null;
    }>(
      `select count(*)::int as observations,
              count(distinct lower(product))::int as products,
              count(distinct city)::int as cities,
              min(observed_date)::text as first_seen,
              max(observed_date)::text as last_seen
         from v_price_observations`
    );

    const topProducts = await many<{
      slug: string;
      product: string;
      observations: number;
      median: number;
      min: number;
      max: number;
      cities: number;
      last_seen: string;
    }>(
      `select md5(lower(product)) as slug,
              min(product) as product,
              count(*)::int as observations,
              percentile_cont(0.5) within group (order by price)::float as median,
              min(price)::float as min,
              max(price)::float as max,
              count(distinct city)::int as cities,
              max(observed_date)::text as last_seen
         from v_price_observations
        where price > 0
        group by lower(product)
        having count(*) >= 2
        order by count(*) desc, max(observed_on) desc
        limit 12`
    );

    const byCity = await many<{ city: string; observations: number; products: number }>(
      `select city, count(*)::int as observations, count(distinct lower(product))::int as products
         from v_price_observations
        group by city
        order by count(*) desc
        limit 15`
    );

    const byCategory = await many<{ category: string; observations: number; median: number }>(
      `select category, count(*)::int as observations,
              percentile_cont(0.5) within group (order by price)::float as median
         from v_price_observations
        group by category
        order by count(*) desc`
    );

    return { meta: { ...META, generatedAt: new Date().toISOString() }, totals, topProducts, byCity, byCategory };
  });

  /** Списък продукти по ключова дума + статистика (медиана, средно, от–до, колко пъти). */
  app.get('/api/public/prices', async (req, reply) => {
    reply.header('Cache-Control', CACHE);
    const q = z
      .object({
        q: z.string().trim().max(80).optional(),
        city: z.string().trim().max(80).optional(),
        days: z.coerce.number().int().min(7).max(3650).default(3650),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .parse(req.query ?? {});

    // Внимание: номерата на параметрите се строят динамично — иначе при липсваща
    // дума/град се получава липсващ параметър и заявката гърми с 500.
    const args: unknown[] = [q.days];
    const where: string[] = ['price > 0', `observed_date >= (now() - ($1::int || ' days')::interval)::date`];
    if (q.q) {
      args.push('%' + q.q + '%');
      where.push(`product ilike $${args.length}`);
    }
    if (q.city) {
      args.push(q.city);
      where.push(`city ilike $${args.length}`);
    }

    const items = await many<{
      slug: string;
      product: string;
      observations: number;
      median: number;
      avg: number;
      min: number;
      max: number;
      cities: string[];
      last_seen: string;
      last_city: string | null;
    }>(
      `select md5(lower(product)) as slug,
              min(product) as product,
              count(*)::int as observations,
              percentile_cont(0.5) within group (order by price)::float as median,
              avg(price)::float as avg,
              min(price)::float as min,
              max(price)::float as max,
              (array_agg(distinct city))[1:6] as cities,
              max(observed_date)::text as last_seen,
              (array_agg(city order by observed_date desc))[1] as last_city
         from v_price_observations
        where ${where.join(' and ')}
        group by lower(product)
        order by count(*) desc, max(observed_on) desc
        limit ${q.limit}`,
      args
    );

    return {
      meta: { ...META, generatedAt: new Date().toISOString(), query: q.q ?? '', city: q.city ?? '', days: q.days },
      count: items.length,
      items,
    };
  });

  /** Един продукт: статистика по градове, движение по месеци и последни наблюдения. */
  app.get('/api/public/prices/:slug', async (req, reply) => {
    reply.header('Cache-Control', CACHE);
    const params = z.object({ slug: z.string().trim().regex(/^[0-9a-f]{32}$/) }).parse(req.params ?? {});

    const product = await one<{ product: string }>(
      `select min(product) as product from v_price_observations where md5(lower(product)) = $1`,
      [params.slug]
    );
    if (!product) throw notFound('Няма такъв продукт.');

    const name = product.product;
    const [stats, byCity, byMonth, recent] = await Promise.all([
      one<{ observations: number; median: number; avg: number; min: number; max: number; first_seen: string; last_seen: string }>(
        `select count(*)::int as observations,
                percentile_cont(0.5) within group (order by price)::float as median,
                avg(price)::float as avg,
                min(price)::float as min,
                max(price)::float as max,
                min(observed_date)::text as first_seen,
                max(observed_date)::text as last_seen
           from v_price_observations where lower(product) = lower($1) and price > 0`,
        [name]
      ),
      many<{ city: string; observations: number; median: number; min: number; max: number; last_seen: string }>(
        `select city, count(*)::int as observations,
                percentile_cont(0.5) within group (order by price)::float as median,
                min(price)::float as min,
                max(price)::float as max,
                max(observed_date)::text as last_seen
           from v_price_observations
          where lower(product) = lower($1) and price > 0
          group by city
          order by count(*) desc`,
        [name]
      ),
      many<{ month: string; observations: number; median: number; min: number; max: number }>(
        `select to_char(date_trunc('month', observed_date), 'YYYY-MM') as month,
                count(*)::int as observations,
                percentile_cont(0.5) within group (order by price)::float as median,
                min(price)::float as min,
                max(price)::float as max
           from v_price_observations
          where lower(product) = lower($1) and price > 0
          group by 1
          order by 1`,
        [name]
      ),
      many<{ city: string; price: number; unit: string; observed_on: string; category: string; polarity: string }>(
        `select city, price, unit, observed_on, category, polarity
           from v_price_observations
          where lower(product) = lower($1) and price > 0
          order by observed_on desc
          limit 40`,
        [name]
      ),
    ]);

    return {
      meta: { ...META, generatedAt: new Date().toISOString() },
      slug: params.slug,
      product: name,
      stats,
      byCity,
      byMonth,
      recent,
    };
  });
}
