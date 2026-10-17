/**
 * 🔔 Web Push (VAPID) — известия до браузъра/PWA, алтернатива на имейла.
 *
 * Ключовете се генерират първия път и се пазят в настройките (не в кода).
 * Пращаме до всички абонаменти на човека; мъртвите (404/410) се махат сами.
 */
import { createRequire } from 'node:module';
// web-push е CommonJS — при ESM изходът не дава именуваните функции през namespace
// import, затова го взимаме през createRequire (иначе: generateVAPIDKeys is not a function).
const require = createRequire(import.meta.url);
const webpush = require('web-push') as typeof import('web-push');
import { many, one, query } from '../db.js';
import { getSetting, setSetting } from './settings.js';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

let cache: { publicKey: string; privateKey: string } | null = null;

/** Публичният ключ се дава на браузъра, за да се абонира. */
export async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (cache) return cache;
  const pub = (await getSetting('push_vapid_public', '')).trim();
  const priv = (await getSetting('push_vapid_private', '')).trim();
  if (pub && priv) {
    cache = { publicKey: pub, privateKey: priv };
    return cache;
  }
  const gen = webpush.generateVAPIDKeys();
  await setSetting('push_vapid_public', gen.publicKey);
  await setSetting('push_vapid_private', gen.privateKey);
  cache = { publicKey: gen.publicKey, privateKey: gen.privateKey };
  return cache;
}

async function configured(): Promise<boolean> {
  try {
    const keys = await getVapidKeys();
    webpush.setVapidDetails('mailto:kolyo.hristov@gmail.com', keys.publicKey, keys.privateKey);
    return true;
  } catch {
    return false;
  }
}

export interface PushSubscriptionInput {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

/** Записва (или обновява) абонамент на браузър за даден човек. */
export async function savePushSubscription(input: PushSubscriptionInput): Promise<{ ok: boolean }> {
  await query(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update
        set user_id = excluded.user_id,
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            user_agent = excluded.user_agent,
            fail_count = 0`,
    [input.userId, input.endpoint, input.p256dh, input.auth, input.userAgent ?? null]
  );
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  await query(`delete from push_subscriptions where endpoint = $1`, [endpoint]);
  return { ok: true };
}

export async function pushStats(): Promise<{ devices: number; users: number; last_ok: string | null }> {
  const row = await one<{ devices: string; users: string; last_ok: string | null }>(
    `select count(*)::text as devices,
            count(distinct user_id)::text as users,
            max(last_ok_at)::text as last_ok
       from push_subscriptions`
  );
  return {
    devices: Number(row?.devices ?? 0) || 0,
    users: Number(row?.users ?? 0) || 0,
    last_ok: row?.last_ok ?? null,
  };
}

async function deliver(
  rows: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload
): Promise<{ sent: number; gone: number; failed: number }> {
  if (!(await configured()) || rows.length === 0) return { sent: 0, gone: 0, failed: 0 };
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/',
    tag: payload.tag ?? 'smartprice',
  });

  let sent = 0;
  let gone = 0;
  let failed = 0;

  await Promise.all(
    rows.map(async (r) => {
      try {
        await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, body, {
          TTL: 60 * 60 * 12,
        });
        sent += 1;
        await query(`update push_subscriptions set last_ok_at = now(), fail_count = 0 where id = $1`, [r.id]);
      } catch (e) {
        const status = Number((e as { statusCode?: number }).statusCode ?? 0);
        if (status === 404 || status === 410) {
          gone += 1;
          await query(`delete from push_subscriptions where id = $1`, [r.id]).catch(() => undefined);
        } else {
          failed += 1;
          await query(`update push_subscriptions set fail_count = fail_count + 1 where id = $1`, [r.id]).catch(
            () => undefined
          );
        }
      }
    })
  );

  return { sent, gone, failed };
}

/** Праща известие до всички устройства на един човек. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; gone: number; failed: number }> {
  const rows = await many<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    `select id::text, endpoint, p256dh, auth from push_subscriptions where user_id = $1`,
    [userId]
  );
  return deliver(rows, payload);
}

/** Праща известие до всички абонирани (за тест и за общи съобщения). */
export async function sendPushToAll(payload: PushPayload): Promise<{ sent: number; gone: number; failed: number }> {
  const rows = await many<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    `select id::text, endpoint, p256dh, auth from push_subscriptions order by created_at desc limit 500`
  );
  return deliver(rows, payload);
}
