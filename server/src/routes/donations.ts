import Stripe from 'stripe';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { many, one, tx } from '../db.js';
import { env, features } from '../env.js';
import { requireUserId } from '../lib/auth.js';
import { badRequest, notFound, unavailable } from '../lib/errors.js';
import { loadFullProfile } from '../lib/profile.js';
import {
  applyBusinessPayment,
  failBusinessPayment,
  loadMyBusinesses,
  renewBusinessSubscription,
} from '../lib/business.js';
import { sendAdminAlertEmail } from '../lib/email.js';
import { ALERT_EMAIL } from '../lib/security.js';

/**
 * ВАЖНО (валута): България премина към еврото и Stripe вече отказва BGN:
 *   "The currency bgn is no longer supported. Use eur instead."
 * Затова сумите са в евро (env.STRIPE_CURRENCY=eur).
 * Колоната в базата е исторически с име amount_bgn — пазим името, за да не
 * се прави рискова миграция, но стойността е в конфигурираната валута.
 */
const TIER_AMOUNTS: Record<'coffee' | 'guardian' | 'legend', number> = {
  coffee: 2,
  guardian: 5,
  legend: 10,
};

const TIER_TITLES: Record<'coffee' | 'guardian' | 'legend', string> = {
  coffee: 'Едно кафе',
  guardian: 'Пазител на Цените',
  legend: 'Легенда на Общността',
};

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

const checkoutSchema = z.object({
  // `amount` е в конфигурираната валута (EUR). `amountBgn` се приема като
  // остарял псевдоним, за да не се чупят по-стари клиенти.
  amount: z.coerce.number().min(1, 'Минималната сума е 1 €.').max(10000).optional(),
  amountBgn: z.coerce.number().min(1).max(10000).optional(),
  tierId: z.enum(['coffee', 'guardian', 'legend']),
  isMonthly: z.boolean().default(false),
  returnScheme: z
    .string()
    .regex(/^[a-z][a-z0-9+.-]{1,30}$/, 'Невалидна схема за връщане.')
    .default('smartprice'),
});

export default async function donationRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ Настройки
  app.get('/api/donations/config', async () => ({
    enabled: features.payments,
    currency: env.STRIPE_CURRENCY.toUpperCase(),
    tiers: (Object.keys(TIER_AMOUNTS) as Array<keyof typeof TIER_AMOUNTS>).map((id) => ({
      id,
      title: TIER_TITLES[id],
      amount: TIER_AMOUNTS[id],
    })),
  }));

  // ------------------------------------------------------------------ Стартиране на плащане
  app.post('/api/donations/checkout', async (req, reply) => {
    const userId = requireUserId(req);
    const input = checkoutSchema.parse(req.body);
    const client = stripe();

    // Сумата идва от клиента, иначе от стойността на избраното ниво.
    const amount = input.amount ?? input.amountBgn ?? TIER_AMOUNTS[input.tierId];
    if (!Number.isFinite(amount) || amount < 1) {
      throw badRequest('Минималната сума за дарение е 1 €.');
    }

    const currency = env.STRIPE_CURRENCY.toLowerCase();

    const profile = await one<{ email: string }>('select email from profiles where id = $1', [userId]);
    if (!profile) throw notFound('Профилът не е намерен.');

    const amountMinor = Math.round(amount * 100);
    const returnBase = `${input.returnScheme}://donation/result`;

    const session = await client.checkout.sessions.create({
      mode: input.isMonthly ? 'subscription' : 'payment',
      customer_email: profile.email,
      client_reference_id: userId,
      metadata: {
        app: 'SmartPrice',
        userId,
        tierId: input.tierId,
        isMonthly: String(input.isMonthly),
        amount: String(amount),
        currency,
      },
      success_url: `${returnBase}?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnBase}?status=cancelled`,
      line_items: [
        input.isMonthly
          ? {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: amountMinor,
                recurring: { interval: 'month' },
                product_data: {
                  name: `SmartPrice — ${TIER_TITLES[input.tierId]} (месечно)`,
                  description: 'Месечна подкрепа за независимата общност на SmartPrice.',
                },
              },
            }
          : {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: amountMinor,
                product_data: {
                  name: `SmartPrice — ${TIER_TITLES[input.tierId]}`,
                  description: 'Еднократно дарение за поддръжка на SmartPrice.',
                },
              },
            },
      ],
    });

    // Записваме дарението като „pending“ — истината идва от webhook-а.
    const donation = await one<{ id: string }>(
      `insert into donations (user_id, amount_bgn, currency, tier_id, is_monthly,
                              stripe_checkout_session_id, status)
       values ($1,$2,$3,$4,$5,$6,'pending') returning id`,
      [userId, amount, currency.toUpperCase(), input.tierId, input.isMonthly, session.id]
    );

    return reply.status(201).send({
      donationId: donation!.id,
      checkoutUrl: session.url,
      sessionId: session.id,
      amount,
      currency: currency.toUpperCase(),
      isMonthly: input.isMonthly,
      message: 'Отвори линка, за да довършиш плащането в Stripe.',
    });
  });

  // ------------------------------------------------------------------ Моите дарения
  app.get('/api/donations/mine', async (req) => {
    const userId = requireUserId(req);
    const rows = await many<{
      id: string;
      amount_bgn: number;
      tier_id: string;
      is_monthly: boolean;
      status: string;
      created_at: Date;
    }>(
      `select id, amount_bgn, tier_id, is_monthly, status, created_at
         from donations where user_id = $1 order by created_at desc limit 100`,
      [userId]
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        amountBgn: r.amount_bgn,
        tierId: r.tier_id,
        tierName: TIER_TITLES[r.tier_id as keyof typeof TIER_TITLES] ?? r.tier_id,
        isMonthly: r.is_monthly,
        status: r.status,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      })),
      profile: await loadFullProfile(userId),
    };
  });

  // ------------------------------------------------------------------ Проверка след връщане от Stripe
  app.get('/api/donations/session/:sessionId', async (req) => {
    const userId = requireUserId(req);
    const { sessionId } = z.object({ sessionId: z.string().min(5).max(200) }).parse(req.params);

    const donation = await one<{ id: string; status: string; user_id: string }>(
      'select id, status, user_id from donations where stripe_checkout_session_id = $1',
      [sessionId]
    );
    if (!donation || donation.user_id !== userId) throw notFound('Плащането не е намерено.');

    // Ако webhook-ът още не е пристигнал (локална разработка), питаме Stripe директно.
    if (donation.status === 'pending' && features.payments) {
      const session = await stripe().checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid' || session.status === 'complete') {
        await tx(async (client) => {
          await client.query(
            `update donations
                set status = 'succeeded',
                    stripe_payment_intent_id = coalesce(stripe_payment_intent_id, $2),
                    stripe_subscription_id = coalesce(stripe_subscription_id, $3)
              where id = $1`,
            [
              donation.id,
              typeof session.payment_intent === 'string' ? session.payment_intent : null,
              typeof session.subscription === 'string' ? session.subscription : null,
            ]
          );
        });
      }
    }

    const fresh = await one<{ status: string }>('select status from donations where id = $1', [
      donation.id,
    ]);

    return {
      status: fresh?.status ?? 'pending',
      profile: await loadFullProfile(userId),
    };
  });

  // ------------------------------------------------------------------ Webhook (източник на истина)
  app.post('/api/donations/webhook', async (req: FastifyRequest, reply) => {
    if (!features.payments || !env.STRIPE_WEBHOOK_SECRET) {
      throw unavailable('Webhook-ът не е конфигуриран (липсва STRIPE_WEBHOOK_SECRET).');
    }

    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') throw badRequest('Липсва Stripe подпис.');

    const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (!raw) throw badRequest('Липсва сурово тяло на заявката.');

    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(raw, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      throw badRequest(`Невалиден Stripe подпис: ${(err as Error).message}`);
    }

    const markSucceeded = async (params: {
      sessionId?: string | null;
      paymentIntentId?: string | null;
      subscriptionId?: string | null;
      eventId: string;
    }) => {
      await tx(async (client) => {
        const where = params.sessionId
          ? 'stripe_checkout_session_id = $1'
          : 'stripe_payment_intent_id = $1';
        const key = params.sessionId ?? params.paymentIntentId;
        if (!key) return;

        await client.query(
          `update donations
              set status = 'succeeded',
                  stripe_payment_intent_id = coalesce($2, stripe_payment_intent_id),
                  stripe_subscription_id  = coalesce($3, stripe_subscription_id),
                  stripe_event_id = $4
            where ${where} and status <> 'succeeded'`,
          [key, params.paymentIntentId ?? null, params.subscriptionId ?? null, params.eventId]
        );
      });
    };

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await markSucceeded({
          sessionId: session.id,
          paymentIntentId:
            typeof session.payment_intent === 'string' ? session.payment_intent : null,
          subscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
          eventId: event.id,
        });
        // 💰 Бизнес абонамент („Проверен търговец“) — същият webhook, друг вид плащане.
        // `applyBusinessPayment` връща null, ако това не е бизнес плащане (дарение),
        // затова редът е безопасен и за двата случая.
        const businessApplied = await applyBusinessPayment({
          sessionId: session.id,
          subscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
          eventId: event.id,
        }).catch(() => null);
        if (businessApplied) {
          const owner = typeof session.client_reference_id === 'string' ? session.client_reference_id : '';
          const mine = owner ? await loadMyBusinesses(owner).catch(() => []) : [];
          const biz = mine.find((b) => b.id === businessApplied.businessId);
          void sendAdminAlertEmail({
            to: ALERT_EMAIL,
            title: '💰 Платен абонамент „Проверен търговец“',
            severity: 'info',
            kind: 'business_subscription',
            details: {
              'Обект': biz?.place_name ?? businessApplied.businessId,
              'Фирма': biz?.legal_name ?? '—',
              'Платено до': businessApplied.paidUntil ?? '—',
              'Месеци': businessApplied.months,
              'Профил': owner || '—',
            },
          }).catch(() => undefined);
        }
        break;
      }
      case 'payment_intent.succeeded': {
        const intent = event.data.object as Stripe.PaymentIntent;
        await markSucceeded({ paymentIntentId: intent.id, eventId: event.id });
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId =
          typeof (invoice as unknown as { subscription?: string }).subscription === 'string'
            ? (invoice as unknown as { subscription: string }).subscription
            : null;
        if (subscriptionId) {
          await one(
            `update donations set status = 'succeeded', stripe_event_id = $2
              where stripe_subscription_id = $1 and status = 'pending' returning id`,
            [subscriptionId, event.id]
          );
          // Подновяване на бизнес абонамент (връща null за дарения).
          await renewBusinessSubscription({ subscriptionId, eventId: event.id }).catch(() => null);
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const intent = event.data.object as Stripe.PaymentIntent;
        await one(
          `update donations set status = 'failed', stripe_event_id = $2
            where stripe_payment_intent_id = $1 and status = 'pending' returning id`,
          [intent.id, event.id]
        );
        break;
      }
      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session;
        await failBusinessPayment({ sessionId: session.id, eventId: event.id }).catch(() => undefined);
        break;
      }
      default:
        break;
    }

    return reply.send({ received: true });
  });
}
