/**
 * 🔔 Push известия в браузъра/PWA (Web Push + VAPID).
 *
 * Работи на web (включително инсталираното PWA). На iOS/Android нативното
 * приложение иска отделна настройка (FCM/APNs) — там този модул не се ползва.
 */
import { Platform } from 'react-native';
import { API_URL, loadTokens } from '@/src/api/client';

const w: any = typeof globalThis !== 'undefined' ? (globalThis as any) : {};

export function pushSupported(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof w.navigator !== 'undefined' &&
    'serviceWorker' in w.navigator &&
    'PushManager' in w &&
    typeof w.Notification !== 'undefined'
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const clean = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  // Само на web се стига дотук (виж pushSupported), затова atob е наличен.
  const raw = atob(clean);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function authHeaders(): Promise<Record<string, string>> {
  const t = await loadTokens();
  const access = (t as any)?.accessToken ?? (t as any)?.access ?? null;
  return access ? { Authorization: 'Bearer ' + access } : {};
}

async function currentSubscription(): Promise<any | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await w.navigator.serviceWorker.getRegistration('/');
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Включени ли са известията на това устройство. */
export async function pushStatus(): Promise<'on' | 'off' | 'unsupported'> {
  if (!pushSupported()) return 'unsupported';
  if (w.Notification.permission !== 'granted') return 'off';
  const sub = await currentSubscription();
  return sub ? 'on' : 'off';
}

/** Иска разрешение, абонира браузъра и записва абонамента на сървъра. */
export async function enablePush(): Promise<{ ok: boolean; message: string }> {
  if (!pushSupported()) {
    return { ok: false, message: 'Известията в браузъра не се поддържат на това устройство.' };
  }
  const perm = await w.Notification.requestPermission();
  if (perm !== 'granted') {
    return { ok: false, message: 'Няма разрешение за известия. Разреши ги от настройките на браузъра.' };
  }
  try {
    const reg = await w.navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
    await w.navigator.serviceWorker.ready;

    const keyRes = await fetch(API_URL + '/api/push/public-key');
    const { publicKey } = (await keyRes.json()) as { publicKey: string };

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    const json = sub.toJSON();
    const res = await fetch(API_URL + '/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: json.keys,
        userAgent: String(w.navigator.userAgent || '').slice(0, 200),
      }),
    });
    if (!res.ok) return { ok: false, message: 'Сървърът не прие абонамента. Опитай пак.' };
    return { ok: true, message: 'Известията са включени — ще те търсим при по-ниска цена.' };
  } catch (e) {
    return { ok: false, message: 'Не успя да се включи: ' + (e as Error).message };
  }
}

/** Изключва известията на това устройство. */
export async function disablePush(): Promise<{ ok: boolean; message: string }> {
  const sub = await currentSubscription();
  if (!sub) return { ok: true, message: 'Известията вече са изключени.' };
  try {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => undefined);
    await fetch(API_URL + '/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ endpoint }),
    }).catch(() => undefined);
    return { ok: true, message: 'Известията са изключени.' };
  } catch (e) {
    return { ok: false, message: 'Грешка: ' + (e as Error).message };
  }
}

/** Тестово известие към моите устройства. */
export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(API_URL + '/api/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: '{}',
  });
  if (!res.ok) return { ok: false, message: 'Тестовото известие не мина.' };
  const d = (await res.json()) as { sent?: number };
  return d.sent
    ? { ok: true, message: 'Изпратено! Трябва да го видиш след секунда.' }
    : { ok: false, message: 'Няма записан абонамент за това устройство.' };
}
