/**
 * 🎬 Социални мрежи — маршрути за админ панела (меню „Социални мрежи“).
 *
 *   GET    /api/admin/social/info              — платформи, опции, статистика
 *   POST   /api/admin/social/scan              — пуска сканиране (връща веднага)
 *   GET    /api/admin/social/last              — последното пускане (за чакане)
 *   GET    /api/admin/social/runs              — история на пусканията
 *   GET    /api/admin/social/items             — резултати с филтри
 *   GET    /api/admin/social/export            — CSV за Excel/Sheets
 *   GET    /api/admin/social/ideas             — запазени идеи за скриптове
 *   POST   /api/admin/social/ideas             — запази видео като идея
 *   DELETE /api/admin/social/ideas/:id         — махни идея
 *   POST   /api/admin/social/defaults          — настройки по подразбиране
 *   POST   /api/admin/social/instagram-cookie  — sessionid за Instagram
 *
 * Всичко иска пълен админ (requireFullAdmin за настройките и пускането, защото
 * харчи пари; четенето е достатъчно с requireAdminPanel).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requireAdminPanel, requireFullAdmin } from '../lib/admin.js';
import { runSocialAuto, socialAutoStatus, setSocialAuto } from '../lib/socialScheduler.js';
import {
  deleteIdea,
  getSocialDefaults,
  itemsToCsv,
  lastSocialRun,
  listIdeas,
  listSocialItems,
  listSocialRuns,
  saveIdea,
  setInstagramCookie,
  setSocialDefaults,
  socialInfo,
  startSocialScan,
} from '../lib/socialScrape.js';

const TARGETS = z.union([z.string().max(4000), z.array(z.string().max(300)).max(20)]);

export default async function socialRoutes(app: FastifyInstance): Promise<void> {
  /** Всичко, което панелът трябва да знае, за да се нарисува. */
  app.get('/api/admin/social/info', async (req) => {
    await requireAdminPanel(req);
    return socialInfo();
  });

  app.get('/api/admin/social/last', async (req) => {
    await requireAdminPanel(req);
    return { run: await lastSocialRun() };
  });

  app.get('/api/admin/social/runs', async (req) => {
    await requireAdminPanel(req);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query ?? {});
    return { items: await listSocialRuns(limit) };
  });

  app.get('/api/admin/social/items', async (req) => {
    await requireAdminPanel(req);
    const q = z
      .object({
        platform: z.enum(['tiktok', 'instagram']).optional(),
        run: z.string().uuid().optional(),
        q: z.string().trim().max(80).optional(),
        minViews: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
        onlyAds: z.coerce.boolean().optional(),
        onlyShop: z.coerce.boolean().optional(),
        sort: z.enum(['views', 'likes', 'comments', 'recent']).optional(),
        limit: z.coerce.number().int().min(1).max(300).default(60),
      })
      .parse(req.query ?? {});
    return {
      items: await listSocialItems({
        platform: q.platform,
        runId: q.run,
        q: q.q,
        minViews: q.minViews,
        onlyAds: q.onlyAds,
        onlyShop: q.onlyShop,
        sort: q.sort,
        limit: q.limit,
      }),
    };
  });

  /** CSV — панелът го сваля с едно натискане. */
  app.get('/api/admin/social/export', async (req, reply) => {
    await requireAdminPanel(req);
    const q = z
      .object({
        platform: z.enum(['tiktok', 'instagram']).optional(),
        run: z.string().uuid().optional(),
        minViews: z.coerce.number().int().min(0).optional(),
        sort: z.enum(['views', 'likes', 'comments', 'recent']).optional(),
        limit: z.coerce.number().int().min(1).max(300).default(300),
      })
      .parse(req.query ?? {});
    const items = await listSocialItems({ ...q, runId: q.run, limit: q.limit });
    const csv = itemsToCsv(items);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="social-${q.platform ?? 'vsi'}-${Date.now()}.csv"`)
      .send(csv);
  });

  /** ПУСКАНЕ — харчи пари, затова пълен админ. */
  app.post('/api/admin/social/scan', async (req) => {
    const admin = await requireFullAdmin(req);
    const input = z
      .object({
        platform: z.enum(['tiktok', 'instagram']),
        mode: z.string().trim().min(2).max(20),
        targets: TARGETS,
        options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      })
      .parse(req.body ?? {});

    const res = await startSocialScan(input);
    await audit({
      admin,
      action: 'social.scan',
      targetType: 'social_run',
      targetId: res.runId ?? null,
      targetLabel: `${input.platform}/${input.mode}`,
      details: { started: res.started, reason: res.reason ?? null },
      ip: req.ip,
    }).catch(() => undefined);
    return res;
  });

  app.get('/api/admin/social/ideas', async (req) => {
    await requireAdminPanel(req);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(300).default(100) }).parse(req.query ?? {});
    return { items: await listIdeas(limit) };
  });

  app.post('/api/admin/social/ideas', async (req) => {
    await requireAdminPanel(req);
    const input = z
      .object({
        itemId: z.string().uuid(),
        note: z.string().max(1000).optional(),
        hook: z.string().max(1000).optional(),
      })
      .parse(req.body ?? {});
    const res = await saveIdea(input);
    if (!res.ok) return { ok: false, reason: res.reason };
    return res;
  });

  app.delete('/api/admin/social/ideas/:id', async (req) => {
    await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params ?? {});
    await deleteIdea(id);
    return { ok: true };
  });

  app.post('/api/admin/social/defaults', async (req) => {
    await requireAdminPanel(req);
    const patch = z
      .object({
        platform: z.enum(['tiktok', 'instagram']).optional(),
        resultsPerPage: z.coerce.number().int().min(1).max(200).optional(),
        minViews: z.coerce.number().int().min(0).optional(),
        excludeAds: z.boolean().optional(),
        hashtags: z.string().max(2000).optional(),
      })
      .parse(req.body ?? {});
    const saved = await setSocialDefaults(patch);
    return { ok: true, defaults: saved };
  });

  /** Бисквитката за Instagram се пази, но НИКОГА не се връща към панела. */
  app.post('/api/admin/social/instagram-cookie', async (req) => {
    const admin = await requireFullAdmin(req);
    const { cookie } = z.object({ cookie: z.string().max(4000) }).parse(req.body ?? {});
    await setInstagramCookie(cookie);
    await audit({
      admin,
      action: 'social.instagram_cookie',
      targetType: 'setting',
      details: { empty: !cookie.trim() },
      ip: req.ip,
    }).catch(() => undefined);
    return { ok: true, hasCookie: Boolean(cookie.trim()) };
  });

  /* ------------------------------------------------ 🤖 автоматично проучване */

  app.get('/api/admin/social/auto', async (req) => {
    await requireAdminPanel(req);
    return socialAutoStatus();
  });

  app.post('/api/admin/social/auto', async (req) => {
    const admin = await requireFullAdmin(req);
    const patchInput = z
      .object({
        enabled: z.boolean().optional(),
        weekday: z.coerce.number().int().min(0).max(6).optional(),
        hour: z.coerce.number().int().min(0).max(23).optional(),
        minute: z.coerce.number().int().min(0).max(59).optional(),
        tiktok: z.boolean().optional(),
        instagram: z.boolean().optional(),
        mode: z.enum(['search', 'hashtag']).optional(),
        topics: z.string().max(3000).optional(),
        minViews: z.coerce.number().int().min(0).optional(),
        maxResults: z.coerce.number().int().min(5).max(200).optional(),
        excludeAds: z.boolean().optional(),
        runOnStart: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    await setSocialAuto(patchInput);
    await audit({
      admin,
      action: 'social.auto_settings',
      targetType: 'setting',
      details: patchInput,
      ip: req.ip,
    }).catch(() => undefined);
    return { ok: true, ...(await socialAutoStatus()) };
  });

  /** Пусни веднага — за да се види, че работи, без да чакаме неделя. */
  app.post('/api/admin/social/auto/run', async (req) => {
    const admin = await requireFullAdmin(req);
    const res = await runSocialAuto('manual');
    await audit({
      admin,
      action: 'social.auto_run',
      targetType: 'social_run',
      details: res,
      ip: req.ip,
    }).catch(() => undefined);
    return { ok: true, ...res };
  });

  /** Текущите настройки (без бисквитката — само дали я има). */
  app.get('/api/admin/social/defaults', async (req) => {
    await requireAdminPanel(req);
    return { defaults: await getSocialDefaults() };
  });
}
