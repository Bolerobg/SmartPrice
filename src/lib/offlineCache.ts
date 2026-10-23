/**
 * 📶 Офлайн кеш — приложението да не е „мъртво“, когато няма сигнал.
 *
 * Защо съществува: най-нужното време да видиш цена е В МАГАЗИНА, а точно там
 * (мазетата на Кауфланд, Метро, Била) сигналът често е нула. Досега екранът
 * показваше само „Няма връзка“ и човекът оставаше без нищо.
 *
 * Правилото, което спазваме, за да не лъжем: показваме запазеното ЯСНО
 * обозначено с КОГА е запазено („от 13:20“), защото цените се променят.
 * Никога не представяме стар кеш като „актуална цена“.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@smartprice_cache_v1:';

export interface Cached<T> {
  data: T;
  /** Кога е запазено (ISO) — показва се на човека. */
  at: string;
}

/** Записва успешно заредени данни, за да има какво да покажем офлайн. */
export async function saveCache<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PREFIX + key,
      JSON.stringify({ data, at: new Date().toISOString() } satisfies Cached<T>)
    );
  } catch {
    // кешът не е критичен — приложение без кеш пак работи онлайн
  }
}

/** Чете запазеното. null, ако няма нищо (или е повредено). */
export async function loadCache<T>(key: string): Promise<Cached<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached<T>;
    if (!parsed || typeof parsed.at !== 'string' || parsed.data == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Колко стар е кешът, с човешки думи: „преди 5 мин“, „днес в 13:20“, „вчера“. */
export function cacheAge(at: string): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return '';
  const diffMin = Math.round((Date.now() - when.getTime()) / 60000);
  const time = when.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  if (diffMin < 1) return 'току-що';
  if (diffMin < 60) return `преди ${diffMin} мин`;
  const sameDay = new Date().toDateString() === when.toDateString();
  if (sameDay) return `днес в ${time}`;
  const yesterday = new Date(Date.now() - 86400000).toDateString() === when.toDateString();
  if (yesterday) return `вчера в ${time}`;
  return `${when.toLocaleDateString('bg-BG')} в ${time}`;
}

/** Офлайн ли е грешката (няма връзка със сървъра, а не отказ от сървъра). */
export function isOfflineError(err: unknown): boolean {
  const e = err as { status?: number; isNetworkError?: boolean; code?: string };
  if (!e) return false;
  if (e.isNetworkError === true) return true;
  if (e.status === 0) return true;
  return e.code === 'network_error';
}
