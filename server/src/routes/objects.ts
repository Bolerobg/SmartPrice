/**
 * 🏪 Обекти (#11) — публични маршрути (без вход), за да може страницата на обекта
 * да се отваря и от линк, и от приложението.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  cheapestShopsByCategory,
  loadObject,
  searchObjectOffers,
  searchObjects,
  slugForPost,
} from '../lib/objects.js';
import { notFound } from '../lib/errors.js';

export default async function objectRoutes(app: FastifyInstance): Promise<void> {
  /** Списък/търсене на обекти: колко сигнала, колко души, средна цена. */
  app.get('/api/objects', async (req) => {
    const input = z
      .object({
        q: z.string().trim().max(80).optional(),
        city: z.string().trim().max(80).optional(),
        sort: z.enum(['signals', 'recent', 'price']).optional(),
        // 'shop' = онлайн магазини (таб „Магазини“), 'place' = обекти на място.
        kind: z.enum(['shop', 'place']).optional(),
        limit: z.coerce.number().int().min(1).max(60).default(20),
        offset: z.coerce.number().int().min(0).max(5000).default(0),
      })
      .parse(req.query ?? {});
    const res = await searchObjects(input);
    return {
      ...res,
      query: input.q ?? '',
      city: input.city ?? '',
      sort: input.sort ?? 'signals',
      kind: input.kind ?? 'place',
    };
  });

  /**
   * 🥇 Кой магазин е най-изгоден в коя категория.
   *
   * ⚠️ ТРЯБВА да е ПРЕДИ `/api/objects/:slug`, иначе заявката влиза в маршрута с
   * параметър и „best-value“ се търси като слуг (404).
   *
   * Значката се дава само при честни условия (виж `cheapestShopsByCategory`):
   * ≥3 оферти с цена в категорията, поне 2 магазина за сравнение и поне 5 %
   * по-ниска ТИПИЧНА (медианна) цена от следващия магазин.
   */
  app.get('/api/objects/best-value', async () => {
    const items = await cheapestShopsByCategory();
    return {
      items,
      /** Как се смята — показва се в приложението, за да не е загадка. */
      rule: {
        min_posts: 3,
        min_winner_posts: 5,
        min_shops_compared: 2,
        min_saving_pct: 5,
        metric: 'median_price',
      },
    };
  });

  /** Страница на един обект: статистика, история на цените, всички сигнали. */
  /**
   * 🔎 Офертите на един обект/магазин — с търсене и страници.
   * Публичен, защото е част от разглеждането (същото като страницата на обекта).
   */
  app.get('/api/objects/:slug/offers', async (req) => {
    const params = z
      .object({
        slug: z.string().trim().min(8).max(64),
      })
      .parse(req.params ?? {});
    const input = z
      .object({
        q: z.string().trim().max(80).optional(),
        /** 🏷️ Само офертите в една категория (докосване на категория на обекта). */
        category: z.string().trim().max(80).optional(),
        limit: z.coerce.number().int().min(1).max(60).default(30),
        offset: z.coerce.number().int().min(0).max(5000).default(0),
      })
      .parse(req.query ?? {});
    return searchObjectOffers(params.slug, input);
  });

  app.get('/api/objects/:slug', async (req) => {
    const params = z.object({ slug: z.string().trim().min(8).max(64) }).parse(req.params ?? {});
    const data = await loadObject(params.slug);
    if (!data) throw notFound('Няма такъв обект.');
    return data;
  });

  /** Обектът, към който принадлежи дадена оферта (за бутона „Виж обекта“). */
  app.get('/api/objects/by-post/:postId', async (req) => {
    const params = z.object({ postId: z.string().uuid() }).parse(req.params ?? {});
    const slug = await slugForPost(params.postId);
    if (!slug) throw notFound('Няма такъв обект.');
    const data = await loadObject(slug);
    if (!data) throw notFound('Няма такъв обект.');
    return data;
  });
}
