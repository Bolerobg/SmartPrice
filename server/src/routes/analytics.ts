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
import { requireUserId } from '../lib/auth.js';
import {
  analyticsOverview,
  analyticsScreens,
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
