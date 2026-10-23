/**
 * 🔔 Push маршрути: браузърът взима публичния ключ, абонира се и после получава
 * известия (напр. ценови аларми). Абонаментът иска вход — знаем чий е.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUserId } from '../lib/auth.js';
import { one } from '../db.js';
import { notFound } from '../lib/errors.js';
import { audit, requireAdminPanel } from '../lib/admin.js';
import {
  getVapidKeys,
  pushStats,
  removePushSubscription,
  savePushSubscription,
  sendPushToAll,
  sendPushToUser,
} from '../lib/push.js';

export default async function pushRoutes(app: FastifyInstance): Promise<void> {
  /** Публичният VAPID ключ (applicationServerKey за браузъра). */
  app.get('/api/push/public-key', async () => {
    const keys = await getVapidKeys();
    return { publicKey: keys.publicKey };
  });

  /** Записва абонамента на това устройство. */
  app.post('/api/push/subscribe', async (req) => {
    const userId = await requireUserId(req);
    const input = z
      .object({
        endpoint: z.string().trim().min(10).max(2000),
        keys: z.object({ p256dh: z.string().trim().min(10).max(500), auth: z.string().trim().min(5).max(200) }),
        userAgent: z.string().trim().max(300).optional(),
      })
      .parse(req.body ?? {});
    await savePushSubscription({
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent ?? req.headers['user-agent'] ?? null,
    });
    return { ok: true };
  });

  /** Маха абонамента (изключване на известията). */
  app.post('/api/push/unsubscribe', async (req) => {
    await requireUserId(req);
    const input = z.object({ endpoint: z.string().trim().min(10).max(2000) }).parse(req.body ?? {});
    return removePushSubscription(input.endpoint);
  });

  /** Тестово известие към моите устройства. */
  app.post('/api/push/test', async (req) => {
    const userId = await requireUserId(req);
    const res = await sendPushToUser(userId, {
      title: '🔔 SmartPrice работи',
      body: 'Ако виждаш това, известията са включени. Ще те търсим, когато цена падне под твоята.',
      tag: 'smartprice-test',
    });
    return { ok: res.sent > 0, ...res };
  });

  /** Статистика за панела. */
  app.get('/api/admin/push/stats', async (req) => {
    await requireAdminPanel(req);
    const [stats, keys] = await Promise.all([pushStats(), getVapidKeys()]);
    return { ...stats, publicKey: keys.publicKey };
  });

  /** Тестово известие до всички абонирани (от панела). */
  app.post('/api/admin/push/test-all', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({ title: z.string().trim().max(120).optional(), body: z.string().trim().max(300).optional() })
      .parse(req.body ?? {});
    const res = await sendPushToAll({
      title: input.title || '🔔 SmartPrice',
      body: input.body || 'Тестово известие от панела — известията работят.',
      tag: 'smartprice-admin-test',
    });
    await audit({ admin, action: 'admin.push_test_all', details: res, ip: req.ip });
    return { ok: res.sent > 0, ...res };
  });

  /* ================= 🔔 Умна покана „включи известията“ =================
   * Защо: известията работеха, но абонати бяха 0 — картата за включване никой не
   * я виждаше. Покана ВЕДНАГА след регистрация дразни; покана СЛЕД като човекът
   * вече е отворил няколко находки е на място („искаш ли да ти пращаме находките
   * за твоя град?“). Броячът е отделен от този за даренията — различни неща са.
   */
  const PUSH_PROMPT_THRESHOLD = 5;
  const PUSH_PROMPT_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

  app.get('/api/me/push-prompt', async (req) => {
    const userId = await requireUserId(req);
    const row = await one<{
      push_prompt_count: number;
      push_prompt_at: Date | null;
      push_prompt_never: boolean;
    }>(
      `select push_prompt_count, push_prompt_at, push_prompt_never from profiles where id = $1`,
      [userId]
    );
    if (!row) throw notFound('Профилът не е намерен.');
    const subs = await one<{ n: string }>(
      `select count(*)::text as n from push_subscriptions where user_id = $1`,
      [userId]
    );
    return {
      count: row.push_prompt_count,
      muted: row.push_prompt_never,
      subscribed: Number(subs?.n ?? 0) > 0,
      shouldPrompt: false,
      threshold: PUSH_PROMPT_THRESHOLD,
    };
  });

  /**
   * Отбелязва едно „ползване“ и казва дали е време за поканата.
   *
   * НЕ питаме, ако: човекът вече е абониран, казал е „не“, или поканата е била
   * показвана преди по-малко от 14 дни (тогава push_prompt_at спира поканата).
   */
  app.post('/api/me/push-prompt', async (req) => {
    const userId = await requireUserId(req);
    const row = await one<{
      push_prompt_count: number;
      push_prompt_at: Date | null;
      push_prompt_never: boolean;
    }>(
      `select push_prompt_count, push_prompt_at, push_prompt_never from profiles where id = $1`,
      [userId]
    );
    if (!row) throw notFound('Профилът не е намерен.');

    if (row.push_prompt_never) {
      return { shouldPrompt: false, count: row.push_prompt_count, muted: true };
    }

    const subs = await one<{ n: string }>(
      `select count(*)::text as n from push_subscriptions where user_id = $1`,
      [userId]
    );
    if (Number(subs?.n ?? 0) > 0) {
      return { shouldPrompt: false, count: row.push_prompt_count, subscribed: true };
    }

    const count = Number(row.push_prompt_count ?? 0) + 1;
    const lastAt = row.push_prompt_at ? new Date(row.push_prompt_at).getTime() : 0;
    const cooldownPassed = Date.now() - lastAt >= PUSH_PROMPT_COOLDOWN_MS;
    const shouldPrompt = count >= PUSH_PROMPT_THRESHOLD && cooldownPassed;

    await one(
      `update profiles
          set push_prompt_count = $2,
              push_prompt_at = case when $3 then now() else push_prompt_at end
        where id = $1 returning id`,
      [userId, shouldPrompt ? 0 : count, shouldPrompt]
    );

    return {
      shouldPrompt,
      count: shouldPrompt ? 0 : count,
      threshold: PUSH_PROMPT_THRESHOLD,
    };
  });

  /** „Не ми показвай повече“ — уважаваме го завинаги. */
  app.post('/api/me/push-prompt/never', async (req) => {
    const userId = await requireUserId(req);
    await one(`update profiles set push_prompt_never = true where id = $1 returning id`, [userId]);
    return { ok: true };
  });
}
