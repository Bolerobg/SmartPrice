/**
 * 🏪 Обекти (#11) — публични маршрути (без вход), за да може страницата на обекта
 * да се отваря и от линк, и от приложението.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadObject, searchObjects, slugForPost } from '../lib/objects.js';
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

  /** Страница на един обект: статистика, история на цените, всички сигнали. */
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
