import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { api } from '@/src/api/client';

/**
 * 📈 ПЪТЯТ НА ПОТРЕБИТЕЛЯ — пращане на събития (работи и БЕЗ вход).
 *
 * Защо: статистиката искаше вход, а профили има 5. Значи гостите — мнозинството —
 * бяха невидими и не можеше да се види къде отпадат хората.
 *
 * Лични данни НЕ се пращат. `visitor` е случаен низ, който стои само в браузъра на
 * човека (localStorage). Не е име, не е имейл, не проследява между сайтове.
 *
 * Никога не хвърля и не блокира екрана: статистиката не бива да чупи приложението.
 */

const VISITOR_KEY = '@smartprice_visitor_v1';
/** Кои събития вече са пращани от ТОЗИ браузър (за да не пращаме излишно). */
const SENT_KEY = '@smartprice_funnel_sent_v1';

let cachedVisitor: string | null = null;
let cachedSent: string[] | null = null;

function randomId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID().replace(/-/g, '');
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

/** Случайният идентификатор на този браузър (създава се при първото отваряне). */
export async function visitorId(): Promise<string> {
  if (cachedVisitor) return cachedVisitor;
  try {
    const existing = await AsyncStorage.getItem(VISITOR_KEY);
    if (existing) {
      cachedVisitor = existing;
      return existing;
    }
  } catch {
    /* няма хранилище — ще ползваме временен */
  }
  const id = randomId();
  cachedVisitor = id;
  try {
    await AsyncStorage.setItem(VISITOR_KEY, id);
  } catch {
    /* нищо: идентификаторът остава само в паметта за тази сесия */
  }
  return id;
}

async function sentKinds(): Promise<string[]> {
  if (cachedSent) return cachedSent;
  try {
    const raw = await AsyncStorage.getItem(SENT_KEY);
    cachedSent = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    cachedSent = [];
  }
  return cachedSent;
}

async function markSent(kind: string): Promise<void> {
  const list = await sentKinds();
  if (list.includes(kind)) return;
  list.push(kind);
  cachedSent = list;
  try {
    await AsyncStorage.setItem(SENT_KEY, JSON.stringify(list));
  } catch {
    /* нищо */
  }
}

/** Събития, които се пращат само веднъж от един браузър. */
const ONCE: readonly string[] = [
  'install',
  'first_view',
  'signup',
  'verified',
  'contribution',
  'invite_sent',
  'invite_accepted',
  'push_on',
];

/**
 * Праща събитие. Мълчи при грешка.
 * За събития от списъка ONCE праща само първия път от този браузър.
 */
export async function track(kind: string, meta?: Record<string, unknown>): Promise<void> {
  try {
    if (ONCE.includes(kind)) {
      const list = await sentKinds();
      if (list.includes(kind)) return;
    }
    const visitor = await visitorId();
    const platform = Platform.OS === 'web' ? 'web' : Platform.OS;
    const res = await api.funnelEvent({ visitor, kind, platform, meta });
    if (res?.ok) await markSent(kind);
  } catch {
    /* статистиката не бива да чупи приложението */
  }
}

/**
 * Отворено ли е като ИНСТАЛИРАНО приложение (икона на началния екран),
 * а не като страница в браузъра. На телефона това е разликата, която позволява
 * известия — затова го мерим.
 */
export function isStandalone(): boolean {
  if (Platform.OS !== 'web') return true; // вградено приложение = инсталирано
  try {
    const w = globalThis as unknown as {
      matchMedia?: (q: string) => { matches: boolean };
      navigator?: { standalone?: boolean };
    };
    if (w.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (w.navigator?.standalone) return true;
    return false;
  } catch {
    return false;
  }
}

export default { track, visitorId, isStandalone };
