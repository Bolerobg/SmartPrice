/**
 * 🏢 Маршрути „Търговец в SmartPrice“.
 *
 *   POST /api/business/claim        — „това е моят обект“ (заявка, може да се одобри веднага по ЕИК)
 *   GET  /api/business/mine         — моите бизнес профили (за таблото)
 *   POST /api/business/:id/reply    — официален отговор под сигнал за своя обект
 *   GET  /api/business/replies      — публични официални отговори (за екрана на офертата)
 *   GET  /api/business/for-post     — кой проверен търговец отговаря за този пост (публично)
 *   GET  /api/business/for-venue    — провереният търговец на обект (публично)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one } from '../db.js';
import { requireUserId } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { ALERT_EMAIL } from '../lib/security.js';
import { sendAdminAlertEmail } from '../lib/email.js';
import {
  UUID_RE,
  addBusinessReply,
  businessForPost,
  businessForVenue,
  claimBusiness,
  loadMyBusinesses,
  repliesForPost,
  repliesForPosts,
} from '../lib/business.js';

const emailSchema = z.string().trim().email().max(200);
const slugSchema = z.string().trim().regex(/^[0-9a-f]{32}$/, 'Невалиден обект.');

export default async function businessRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------- заявка „това е моят обект“ */
  app.post('/api/business/claim', async (req) => {
    const userId = requireUserId(req);
    const input = z
      .object({
        venueSlug: slugSchema,
        legalName: z.string().trim().min(2, 'Напиши името на фирмата.').max(160),
        taxId: z.string().trim().max(30).optional(),
        contactEmail: emailSchema,
        contactPhone: z.string().trim().max(30).optional(),
        proofUrl: z.string().trim().max(500).optional(),
      })
      .parse(req.body ?? {});

    const result = await claimBusiness({
      userId,
      venueSlug: input.venueSlug,
      legalName: input.legalName,
      taxId: input.taxId,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      proofUrl: input.proofUrl,
    });

    // При заявка за преглед пращаме писмо на екипа — иначе чака тихо.
    if (!result.autoApproved) {
      const admin = await one<{ email: string }>(
        `select email from profiles where id = $1`,
        [userId]
      ).catch(() => null);
      void sendAdminAlertEmail({
        to: ALERT_EMAIL,
        title: 'Нова заявка „Това е моят бизнес“',
        severity: 'info',
        kind: 'business_claim',
        details: {
          'Обект': result.business.place_name,
          'Град': result.business.city ?? '—',
          'Фирма': result.business.legal_name,
          'ЕИК': result.business.tax_id ?? '—',
          'Профил': admin?.email ?? userId,
          'Статус': result.business.status,
        },
      }).catch(() => undefined);
    }

    return {
      business: result.business,
      autoApproved: result.autoApproved,
      message: result.autoApproved
        ? '✅ Проверено веднага — ЕИК съвпада с касова бележка от този обект. Вече си „Проверен търговец“.'
        : 'Заявката е при нас. Проверяваме я и ще ти пишем на имейла — обикновено до 1 работен ден.',
    };
  });

  /* --------------------------------------------------------- моите профили */
  app.get('/api/business/mine', async (req) => {
    const userId = requireUserId(req);
    return { items: await loadMyBusinesses(userId) };
  });

  /* ------------------------------------------------- официален отговор */
  app.post('/api/business/:id/reply', async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ id: z.string().trim().regex(/^\d+$/) }).parse(req.params);
    const input = z
      .object({ postId: z.string().trim().regex(UUID_RE, 'Невалидна оферта.'), body: z.string().trim().max(1600) })
      .parse(req.body ?? {});

    const reply = await addBusinessReply({
      userId,
      businessId: params.id,
      postId: input.postId,
      body: input.body,
    });
    return { reply };
  });

  /* ------------------------------------------------- публични отговори */
  app.get('/api/business/replies', async (req) => {
    const q = z
      .object({
        postId: z.string().trim().regex(UUID_RE).optional(),
        postIds: z.string().trim().max(400).optional(),
      })
      .parse(req.query ?? {});

    if (q.postId) return { byPost: await repliesForPost(q.postId) };

    const ids = String(q.postIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) throw badRequest('Липсва postId или postIds.');
    if (ids.length > 40) throw badRequest('Твърде много постове наведнъж.');
    return { grouped: await repliesForPosts(ids) };
  });

  /* --------------------------------------- кой търговец е собственик (публично) */
  app.get('/api/business/for-post', async (req) => {
    const q = z
      .object({ postId: z.string().trim().regex(UUID_RE) })
      .parse(req.query ?? {});
    return { business: await businessForPost(q.postId) };
  });

  app.get('/api/business/for-venue', async (req) => {
    const q = z.object({ slug: slugSchema }).parse(req.query ?? {});
    return { business: await businessForVenue(q.slug) };
  });

  /* --------------------------------------- проверка, че съм собственик (за UI) */
  app.get('/api/business/can-reply', async (req) => {
    const userId = requireUserId(req);
    const q = z
      .object({ postId: z.string().trim().regex(UUID_RE) })
      .parse(req.query ?? {});
    const mine = await loadMyBusinesses(userId);
    const biz = await businessForPost(q.postId);
    if (!biz) return { canReply: false, businessId: null, reason: 'no_business' };
    const own = mine.find((b) => b.id === biz.id);
    if (!own) return { canReply: false, businessId: null, reason: 'not_owner' };
    if (!own.can_reply) return { canReply: false, businessId: own.id, reason: 'not_verified' };
    return { canReply: true, businessId: own.id, reason: null };
  });
}
