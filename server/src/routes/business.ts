/**
 * 🏢 Маршрути „Търговец в SmartPrice“ (Фаза 1 + Фаза 2).
 *
 *   POST /api/business/claim        — „това е моят обект“ (може да се одобри веднага по ЕИК)
 *   GET  /api/business/mine         — моите бизнес профили (за таблото)
 *   POST /api/business/:id/reply    — официален отговор под сигнал за своя обект
 *   GET  /api/business/replies      — публични официални отговори
 *   GET  /api/business/for-post     — кой проверен търговец отговаря за този пост
 *   GET  /api/business/for-venue    — провереният търговец на обект
 *   GET  /api/business/can-reply    — мога ли АЗ да отговоря на този сигнал
 *
 * 💰 Фаза 2:
 *   GET  /api/business/plan/config        — цената и условията на плана (публично)
 *   POST /api/business/:id/subscribe      — пуска плащане в Stripe (19 €/мес)
 *   POST /api/business/:id/paid           — проверка след връщане от Stripe
 *   GET  /api/business/:id/stats          — статистика на обекта (гледания, сигнали)
 *   GET  /api/business/:id/payments       — история на плащанията
 *   GET  /api/business/:id/offers         — офертите на търговеца (собственик)
 *   POST /api/business/:id/offers         — пуска оферта (иска активен план)
 *   POST /api/business/offers/:oid/status — скрий/пусни оферта
 *   DELETE /api/business/offers/:oid      — изтрий оферта
 *   GET  /api/business/offers?slug=       — публичните оферти на един обект
 *   POST /api/business/venue-view         — брои едно гледане на обекта (публично)
 */
import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { one } from '../db.js';
import { env, features } from '../env.js';
import { requireUserId } from '../lib/auth.js';
import { badRequest, notFound, unavailable } from '../lib/errors.js';
import { ALERT_EMAIL } from '../lib/security.js';
import { sendAdminAlertEmail } from '../lib/email.js';
import { clearCache } from '../lib/ttlCache.js';
import {
  FREE_REPLIES_PER_MONTH,
  PLAN_MONTHS,
  PLAN_PRICE_EUR,
  UUID_RE,
  addBusinessReply,
  applyBusinessPayment,
  businessForPost,
  businessForVenue,
  businessPaymentBySession,
  businessPayments,
  claimBusiness,
  createBusinessOffer,
  deleteBusinessOffer,
  listBusinessOffers,
  loadMyBusinesses,
  publicOffersForVenue,
  registerVenueView,
  repliesForPost,
  repliesForPosts,
  setBusinessOfferStatus,
  startBusinessPayment,
  venueStats,
} from '../lib/business.js';

const emailSchema = z.string().trim().email().max(200);
const slugSchema = z.string().trim().regex(/^[0-9a-f]{32}$/, 'Невалиден обект.');
const idSchema = z.string().trim().regex(/^\d+$/);

/** Адресът, на който връщаме човека след плащане (приложението се сервира оттук). */
const APP_URL = 'https://smartprice.bg';

let stripeClient: Stripe | null = null;
function stripe(): Stripe {
  if (!features.payments) {
    throw unavailable(
      'Плащанията не са конфигурирани: липсва STRIPE_SECRET_KEY. Добави ключ в .env и рестартирай API-то.'
    );
  }
  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
  }
  return stripeClient;
}

export default async function businessRoutes(app: FastifyInstance): Promise<void> {
  /**
   * ⚡ Промяна по офертите на търговеца → изчистваме кеша на публичните оферти,
   * за да се види новата промоция веднага (кешът иначе пази до 60 s).
   */
  app.addHook('onResponse', async (req) => {
    if (req.method !== 'GET' && req.url.includes('/offers')) {
      clearCache('offers:');
    }
  });
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
      const profile = await one<{ email: string }>(
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
          'Профил': profile?.email ?? userId,
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
    const params = z.object({ id: idSchema }).parse(req.params);
    const input = z
      .object({
        postId: z.string().trim().regex(UUID_RE, 'Невалидна оферта.'),
        body: z.string().trim().max(1600),
      })
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
    const q = z.object({ postId: z.string().trim().regex(UUID_RE) }).parse(req.query ?? {});
    return { business: await businessForPost(q.postId) };
  });

  app.get('/api/business/for-venue', async (req) => {
    const q = z.object({ slug: slugSchema }).parse(req.query ?? {});
    return { business: await businessForVenue(q.slug) };
  });

  /* --------------------------------------- проверка, че съм собственик (за UI) */
  app.get('/api/business/can-reply', async (req) => {
    const userId = requireUserId(req);
    const q = z.object({ postId: z.string().trim().regex(UUID_RE) }).parse(req.query ?? {});
    const mine = await loadMyBusinesses(userId);
    const biz = await businessForPost(q.postId);
    if (!biz) return { canReply: false, businessId: null, reason: 'no_business' };
    const own = mine.find((b) => b.id === biz.id);
    if (!own) return { canReply: false, businessId: null, reason: 'not_owner' };
    if (!own.can_reply) return { canReply: false, businessId: own.id, reason: 'not_verified' };
    return { canReply: true, businessId: own.id, reason: null };
  });

  /* ==================== 💰 План „Проверен търговец“ (Фаза 2) ==================== */

  /** Цената и условията — идват от сървъра, за да не се хардкодват в приложението. */
  app.get('/api/business/plan/config', async () => ({
    enabled: features.payments,
    priceEur: PLAN_PRICE_EUR,
    months: PLAN_MONTHS,
    currency: env.STRIPE_CURRENCY.toUpperCase(),
    freeRepliesPerMonth: FREE_REPLIES_PER_MONTH,
    includes: [
      'Неограничени официални отговори под сигналите за твоя обект',
      'Оферти и промоции в твоя обект (виждат ги всички, които го отварят)',
      'Статистика: колко души гледат обекта, колко сигнала има, оценка',
      'Значка „✅ Проверен търговец“ — винаги',
    ],
  }));

  /** Пуска плащане за абонамента. Истината идва от Stripe webhook-а. */
  app.post('/api/business/:id/subscribe', async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ id: idSchema }).parse(req.params);
    const input = z
      .object({ months: z.coerce.number().int().min(1).max(12).default(PLAN_MONTHS) })
      .parse(req.body ?? {});

    const business = await one<{ id: string; place_name: string; owner_user_id: string }>(
      `select id, place_name, owner_user_id from business_accounts where id = $1 and owner_user_id = $2`,
      [params.id, userId]
    );
    if (!business) throw notFound('Бизнес профилът не е намерен.');

    const profile = await one<{ email: string }>('select email from profiles where id = $1', [userId]);
    if (!profile) throw notFound('Профилът не е намерен.');

    const client = stripe();
    const currency = env.STRIPE_CURRENCY.toLowerCase();
    const months = input.months;

    const session = await client.checkout.sessions.create({
      mode: 'subscription',
      customer_email: profile.email,
      client_reference_id: userId,
      metadata: {
        app: 'SmartPriceBusiness',
        businessId: business.id,
        userId,
        place: business.place_name,
        months: String(months),
      },
      success_url: `${APP_URL}/business/dashboard?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/business/dashboard?paid=0`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: Math.round(PLAN_PRICE_EUR * 100),
            recurring: { interval: 'month' },
            product_data: {
              name: 'SmartPrice — Проверен търговец (месечно)',
              description:
                `Официални отговори, оферти и статистика за „${business.place_name}“. ` +
                'Подновява се месечно, може да се спре по всяко време.',
            },
          },
        },
      ],
    });

    await startBusinessPayment({
      businessId: business.id,
      userId,
      sessionId: session.id,
      months,
      amount: PLAN_PRICE_EUR * months,
    });

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      amount: PLAN_PRICE_EUR * months,
      currency: currency.toUpperCase(),
      months,
      message: 'Отвори линка, за да платиш в Stripe. Абонаментът се активира веднага след плащането.',
    };
  });

  /** Проверка след връщане от Stripe (ако webhook-ът още не е пристигнал). */
  app.post('/api/business/:id/paid', async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ id: idSchema }).parse(req.params);
    const input = z.object({ sessionId: z.string().trim().min(5).max(200) }).parse(req.body ?? {});

    const pay = await businessPaymentBySession(input.sessionId);
    if (!pay || pay.user_id !== userId || String(pay.business_id) !== params.id) {
      throw notFound('Плащането не е намерено.');
    }

    // Ако webhook-ът се бави, питаме Stripe директно — човекът не бива да чака.
    if (pay.status === 'pending' && features.payments) {
      const session = await stripe().checkout.sessions.retrieve(input.sessionId);
      if (session.payment_status === 'paid' || session.status === 'complete') {
        await applyBusinessPayment({
          sessionId: input.sessionId,
          subscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
          eventId: 'manual-check',
        });
      }
    }

    const items = await loadMyBusinesses(userId);
    return { business: items.find((b) => b.id === params.id) ?? null };
  });

  app.get('/api/business/:id/stats', async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ id: idSchema }).parse(req.params);
    const mine = await one<{ id: string }>(
      `select id from business_accounts where id = $1 and owner_user_id = $2`,
      [params.id, userId]
    );
    if (!mine) throw notFound('Бизнес профилът не е намерен.');
    return { stats: await venueStats(params.id) };
  });

  app.get('/api/business/:id/payments', async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ id: idSchema }).parse(req.params);
    const mine = await one<{ id: string }>(
      `select id from business_accounts where id = $1 and owner_user_id = $2`,
      [params.id, userId]
    );
    if (!mine) throw notFound('Бизнес профилът не е намерен.');
    return { items: await businessPayments(params.id) };
  });

  /* ======================== 🏷️ Оферти от търговеца ======================== */

  app.get('/api/business/:id/offers', async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ id: idSchema }).parse(req.params);
    const mine = await one<{ id: string }>(
      `select id from business_accounts where id = $1 and owner_user_id = $2`,
      [params.id, userId]
    );
    if (!mine) throw notFound('Бизнес профилът не е намерен.');
    return { items: await listBusinessOffers(params.id) };
  });

  app.post('/api/business/:id/offers', async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ id: idSchema }).parse(req.params);
    const input = z
      .object({
        title: z.string().trim().min(3).max(120),
        description: z.string().trim().max(1000).optional(),
        price: z.coerce.number().positive().max(1_000_000).optional(),
        oldPrice: z.coerce.number().positive().max(1_000_000).optional(),
        imageUrl: z.string().trim().max(500).optional(),
        /** Дата „валидна до“ (YYYY-MM-DD). Не може в миналото. */
        validUntil: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Датата е във формат ГГГГ-ММ-ДД.')
          .optional(),
      })
      .parse(req.body ?? {});

    if (input.validUntil && input.validUntil < new Date().toISOString().slice(0, 10)) {
      throw badRequest('„Валидна до“ не може да е в миналото.');
    }

    const offer = await createBusinessOffer({
      userId,
      businessId: params.id,
      title: input.title,
      description: input.description,
      price: input.price ?? null,
      oldPrice: input.oldPrice ?? null,
      imageUrl: input.imageUrl ?? null,
      validUntil: input.validUntil ?? null,
    });
    return { offer };
  });

  app.post('/api/business/offers/:oid/status', async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ oid: idSchema }).parse(req.params);
    const input = z.object({ status: z.enum(['active', 'hidden']) }).parse(req.body ?? {});
    await setBusinessOfferStatus({ userId, offerId: params.oid, status: input.status });
    return { ok: true };
  });

  app.delete('/api/business/offers/:oid', async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ oid: idSchema }).parse(req.params);
    await deleteBusinessOffer({ userId, offerId: params.oid });
    return { ok: true };
  });

  /** Публично: офертите на един обект (за страницата на обекта). */
  app.get('/api/business/offers', async (req) => {
    const q = z
      .object({ slug: slugSchema, limit: z.coerce.number().int().min(1).max(20).default(5) })
      .parse(req.query ?? {});
    return { items: await publicOffersForVenue(q.slug, q.limit) };
  });

  /** Публично: брои едно отваряне на обекта (статистиката за търговеца). */
  app.post('/api/business/venue-view', async (req) => {
    const input = z.object({ slug: slugSchema }).parse(req.body ?? {});
    await registerVenueView(input.slug).catch(() => undefined);
    return { ok: true };
  });
}
