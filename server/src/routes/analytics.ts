/**
 * 👥 СТАТИСТИКА НА ПОТРЕБИТЕЛИТЕ — маршрути.
 *
 * Админ (иска вход в панела):
 *   GET  /api/admin/analytics/overview        — общо: потребители, активни, входове, графики
 *   GET  /api/admin/analytics/users           — таблица с потребители (търсене, подредба)
 *   GET  /api/admin/analytics/user/:id        — всичко за един човек
 *   GET  /api/admin/analytics/screens         — класация на екраните
 *   POST /api/admin/analytics/prune           — чисти старата хронология
 *
 * Приложение:
 *   POST /api/me/activity                     — „отворих този екран“ (за статистиката)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requireAdminPanel, requireFullAdmin } from '../lib/admin.js';
import { optionalUserId, requireUserId } from '../lib/auth.js';
import {
  funnelOverview,
  funnelWithGuests,
  isFunnelKind,
  linkVisitorToUser,
  recordFunnelEvent,
} from '../lib/funnel.js';
import {
  analyticsFunnel,
  analyticsOverview,
  analyticsRetention,
  analyticsScreens,
  analyticsSources,
  analyticsUserDetail,
  analyticsUsers,
  pruneActivity,
  recordScreenView,
} from '../lib/analytics.js';

export default async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------- приложение */

  app.post('/api/me/activity', async (req) => {
    const userId = requireUserId(req);
    const body = z
      .object({
        screen: z.string().trim().min(1).max(120),
        platform: z.string().trim().max(20).optional(),
      })
      .parse(req.body ?? {});
    const res = await recordScreenView({
      userId,
      screen: body.screen,
      platformHint: body.platform ?? null,
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
    return { ok: true, counted: res.counted };
  });

  /**
   * 📈 Събитие по пътя на потребителя — БЕЗ вход.
   *
   * Защо без вход: приложението се ползва и от гости, а те са мнозинството. Ако
   * искахме вход, нямаше да виждаме никого (профили: 5). `visitor` е случаен
   * идентификатор от браузъра на човека — не е име, не е имейл.
   */
  app.post('/api/events', async (req) => {
    const body = z
      .object({
        visitor: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
        kind: z.string().trim().min(2).max(40),
        platform: z.string().trim().max(20).optional(),
        meta: z.record(z.unknown()).optional(),
      })
      .parse(req.body ?? {});

    if (!isFunnelKind(body.kind)) return { ok: false, reason: 'unknown_kind' };

    const userId = optionalUserId(req);
    const res = await recordFunnelEvent({
      visitor: body.visitor,
      kind: body.kind,
      userId,
      platform: body.platform ?? null,
      meta: body.meta ?? null,
      ip: req.ip,
    });

    // Влязъл човек → прикачаме и предишните му гостувания към профила.
    if (res.counted && userId && (body.kind === 'signup' || body.kind === 'verified')) {
      await linkVisitorToUser(body.visitor, userId);
    }

    return { ok: true, counted: res.counted };
  });

  /* ------------------------------------------------------------- админ */

  app.get('/api/admin/analytics/overview', async (req) => {
    await requireAdminPanel(req);
    return analyticsOverview();
  });

  app.get('/api/admin/analytics/users', async (req) => {
    await requireAdminPanel(req);
    const q = z
      .object({
        q: z.string().trim().max(80).optional(),
        sort: z.enum(['recent', 'logins', 'new', 'active']).optional(),
        onlyActive: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).max(20000).default(0),
      })
      .parse(req.query ?? {});
    return analyticsUsers(q);
  });

  app.get('/api/admin/analytics/user/:id', async (req) => {
    await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params ?? {});
    const detail = await analyticsUserDetail(id);
    if (!detail) return { found: false };
    return { found: true, ...detail };
  });

  app.get('/api/admin/analytics/screens', async (req) => {
    await requireAdminPanel(req);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query ?? {});
    return { items: await analyticsScreens(days) };
  });

  /** Задържане по седмици: връщат ли се хората (D1/D7/D30). */
  app.get('/api/admin/analytics/retention', async (req) => {
    await requireAdminPanel(req);
    const { weeks } = z.object({ weeks: z.coerce.number().int().min(1).max(26).default(8) }).parse(req.query ?? {});
    return { items: await analyticsRetention(weeks) };
  });

  /** Откъде идват: канал, първо докосване (utm), устройство, град. */
  app.get('/api/admin/analytics/sources', async (req) => {
    await requireAdminPanel(req);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(90) }).parse(req.query ?? {});
    return analyticsSources(days);
  });

  /**
   * Пътят на потребителя — ОТ ГОСТ до пусната обява.
   * Броят се уникални хора на всяка стъпка (вкл. гостите, които не влизат).
   */
  app.get('/api/admin/analytics/funnel', async (req) => {
    await requireAdminPanel(req);
    const days = z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .catch(30)
      .parse((req.query as { days?: unknown } | undefined)?.days ?? 30);
    const [guests, overview] = await Promise.all([funnelWithGuests(), funnelOverview(days)]);
    return { steps: guests.steps, overview };
  });

  /** Старата фуния (само влезли) — остава за съвместимост. */
  app.get('/api/admin/analytics/funnel-logged', async (req) => {
    await requireAdminPanel(req);
    return analyticsFunnel();
  });

  app.post('/api/admin/analytics/prune', async (req) => {
    const admin = await requireFullAdmin(req);
    const { keepDays } = z.object({ keepDays: z.coerce.number().int().min(30).max(3650).default(180) }).parse(req.body ?? {});
    const removed = await pruneActivity(keepDays);
    await audit({
      admin,
      action: 'analytics.prune',
      targetType: 'analytics',
      details: { keepDays, removed },
      ip: req.ip,
    }).catch(() => undefined);
    return { ok: true, removed };
  });
}
