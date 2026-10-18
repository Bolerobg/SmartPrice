/**
 * 🏷️ ЧАСТНИ ОБЯВИ ОТ ПОТРЕБИТЕЛИ — маршрути.
 *
 *   GET    /api/listings/config                 — цена, срок, колко снимки (публично)
 *   GET    /api/listings                        — активни обяви (публично)
 *   GET    /api/listings/mine                   — МОИТЕ обяви + дашборд (влизане)
 *   GET    /api/listings/:id                    — една обява
 *   POST   /api/listings                        — пуска чернова с до 5 снимки
 *   PATCH  /api/listings/:id                    — редактира
 *   POST   /api/listings/:id/checkout           — плащане 2 € за 60 дни / подновяване
 *   POST   /api/listings/payments/confirm       — потвърждаване след връщане от Stripe
 *   POST   /api/listings/:id/pause|resume|sold  — спиране / пускане / продадено
 *   GET    /api/listings/:id/history            — история + плащания
 *   GET    /api/listings/nudge                  — да показваме ли модела „и ти можеш“
 *   POST   /api/listings/nudge/seen|off         — отбелязване / изключване завинаги
 *   GET    /api/puzzle/demo/nudge               — да показваме ли демото на пъзела
 *   POST   /api/puzzle/demo/record|off          — запис на игра / изключване завинаги
 *
 * Админ:
 *   GET    /api/admin/listings/info             — приходи, активни, последни
 *   POST   /api/admin/listings/:id/take-down    — маха обява (модерация)
 *   POST   /api/admin/listings/config           — цена/срок/снимки
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requireAdminPanel, requireFullAdmin } from '../lib/admin.js';
import { requireUserId } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import {
  LISTING_CHOICES,
  adminListingsInfo,
  adminTakeDown,
  bumpListingViews,
  confirmListingPayment,
  createListing,
  getPublicListing,
  listingConfig,
  listingHistory,
  listingNudge,
  markNudgeSeen,
  myListings,
  publicListings,
  puzzleDemoNudge,
  recordPuzzleDemo,
  setListingConfig,
  setListingStatus,
  setNudgeOff,
  setPuzzleNudgeOff,
  startListingCheckout,
  updateListing,
} from '../lib/listings.js';

const IMAGES = z.array(z.string().max(600)).max(10);

const listingInput = z.object({
  title: z.string().trim().min(6).max(200),
  description: z.string().trim().max(5000).optional(),
  priceEur: z.coerce.number().min(0).max(1_000_000).nullish(),
  isNegotiable: z.boolean().optional(),
  isFree: z.boolean().optional(),
  category: z.string().trim().max(40).optional(),
  subcategory: z.string().trim().max(60).nullish(),
  city: z.string().trim().min(2).max(80),
  neighborhood: z.string().trim().max(80).nullish(),
  address: z.string().trim().max(300).nullish(),
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
  itemCondition: z.string().trim().max(20).optional(),
  contactPhone: z.string().trim().max(40).nullish(),
  contactNote: z.string().trim().max(500).nullish(),
  handover: z.string().trim().max(20).optional(),
  images: IMAGES.optional(),
});

export default async function listingRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------ публично */

  app.get('/api/listings/config', async () => {
    const cfg = await listingConfig();
    return {
      priceEur: cfg.priceEur,
      days: cfg.days,
      maxImages: cfg.maxImages,
      maxActive: cfg.maxActive,
      remindBeforeDays: cfg.remindBeforeDays,
      currency: 'EUR',
      choices: LISTING_CHOICES,
    };
  });

  app.get('/api/listings', async (req) => {
    const q = z
      .object({
        q: z.string().trim().max(80).optional(),
        city: z.string().trim().max(80).optional(),
        category: z.string().trim().max(40).optional(),
        minPrice: z.coerce.number().min(0).optional(),
        maxPrice: z.coerce.number().min(0).optional(),
        sort: z.enum(['recent', 'cheap', 'expensive']).optional(),
        limit: z.coerce.number().int().min(1).max(60).default(30),
        offset: z.coerce.number().int().min(0).max(5000).default(0),
      })
      .parse(req.query ?? {});
    return publicListings(q);
  });

  /* ------------------------------------------------------------ моите обяви */

  app.get('/api/listings/mine', async (req) => {
    const userId = requireUserId(req);
    return myListings(userId);
  });

  app.get('/api/listings/:id/history', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params ?? {});
    return listingHistory(id, userId);
  });

  app.post('/api/listings', async (req, reply) => {
    const userId = requireUserId(req);
    const input = listingInput.parse(req.body ?? {});
    const listing = await createListing(userId, input);
    return reply.status(201).send({
      listing,
      /** Какво следва — за да водим човека за ръка. */
      next: 'Плащане: 2 € за 60 дни. Обявата става видима веднага след плащането.',
    });
  });

  app.patch('/api/listings/:id', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params ?? {});
    const input = listingInput.partial().parse(req.body ?? {});
    return { listing: await updateListing(userId, id, input) };
  });

  /* ------------------------------------------------------------ плащане */

  app.post('/api/listings/:id/checkout', async (req, reply) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params ?? {});
    const body = z
      .object({
        kind: z.enum(['publish', 'renew']).default('publish'),
        returnScheme: z
          .string()
          .regex(/^[a-z][a-z0-9+.-]{1,30}$/)
          .default('smartprice'),
      })
      .parse(req.body ?? {});
    const res = await startListingCheckout(userId, id, body.kind, body.returnScheme);
    return reply.status(201).send({
      ...res,
      message: 'Отвори линка и плати в Stripe. После обявата тръгва веднага.',
    });
  });

  /** Проверява РЕАЛНО при Stripe и активира обявата. */
  app.post('/api/listings/payments/confirm', async (req) => {
    requireUserId(req);
    const { sessionId } = z.object({ sessionId: z.string().trim().min(8).max(300) }).parse(req.body ?? {});
    return confirmListingPayment(sessionId);
  });

  /* ------------------------------------------------------------ жизнен цикъл */

  for (const action of ['pause', 'resume', 'sold'] as const) {
    app.post(`/api/listings/:id/${action}`, async (req) => {
      const userId = requireUserId(req);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params ?? {});
      return { listing: await setListingStatus(userId, id, action) };
    });
  }

  app.get('/api/listings/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params ?? {});
    const listing = await getPublicListing(id);
    if (!listing) throw notFound('Обявата не е намерена или вече не е активна.');
    await bumpListingViews(id);
    return { listing };
  });

  /* ------------------------------------------------------------ подкана (купувач) */

  app.get('/api/listings/nudge', async (req) => {
    const userId = requireUserId(req);
    return listingNudge(userId);
  });

  app.post('/api/listings/nudge/seen', async (req) => {
    const userId = requireUserId(req);
    await markNudgeSeen(userId);
    return { ok: true };
  });

  app.post('/api/listings/nudge/off', async (req) => {
    const userId = requireUserId(req);
    const { off } = z.object({ off: z.boolean().default(true) }).parse(req.body ?? {});
    await setNudgeOff(userId, off);
    return { ok: true, off };
  });

  /* ------------------------------------------------------------ демо на пъзела */

  app.get('/api/puzzle/demo/nudge', async (req) => {
    // Работи и за гост — демото е отворено за всички.
    let userId: string | null = null;
    try {
      userId = requireUserId(req);
    } catch {
      userId = null;
    }
    return puzzleDemoNudge(userId);
  });

  app.post('/api/puzzle/demo/record', async (req) => {
    let userId: string | null = null;
    try {
      userId = requireUserId(req);
    } catch {
      userId = null;
    }
    const body = z
      .object({ ms: z.coerce.number().int().min(0).max(3_600_000).optional(), plays: z.coerce.number().int().min(0).optional() })
      .parse(req.body ?? {});
    return recordPuzzleDemo(userId, body);
  });

  app.post('/api/puzzle/demo/off', async (req) => {
    const userId = requireUserId(req);
    const { off } = z.object({ off: z.boolean().default(true) }).parse(req.body ?? {});
    await setPuzzleNudgeOff(userId, off);
    return { ok: true, off };
  });

  /* ------------------------------------------------------------ админ */

  app.get('/api/admin/listings/info', async (req) => {
    await requireAdminPanel(req);
    return adminListingsInfo();
  });

  app.post('/api/admin/listings/config', async (req) => {
    const admin = await requireFullAdmin(req);
    const patchInput = z
      .object({
        priceEur: z.coerce.number().min(0.5).max(100).optional(),
        days: z.coerce.number().int().min(7).max(365).optional(),
        maxImages: z.coerce.number().int().min(1).max(10).optional(),
        maxActive: z.coerce.number().int().min(1).max(100).optional(),
        remindBeforeDays: z.coerce.number().int().min(0).max(60).optional(),
      })
      .parse(req.body ?? {});
    const saved = await setListingConfig(patchInput);
    await audit({
      admin,
      action: 'listings.config',
      targetType: 'setting',
      details: patchInput,
      ip: req.ip,
    }).catch(() => undefined);
    return { ok: true, config: saved };
  });

  app.post('/api/admin/listings/:id/take-down', async (req) => {
    const admin = await requireFullAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params ?? {});
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body ?? {});
    await adminTakeDown(id, reason);
    await audit({
      admin,
      action: 'listings.take_down',
      targetType: 'listing',
      targetId: id,
      details: { reason },
      ip: req.ip,
    }).catch(() => undefined);
    return { ok: true };
  });
}
