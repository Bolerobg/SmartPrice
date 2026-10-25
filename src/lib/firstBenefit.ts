import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 🎯 ПЪРВА ПОЛЗА — човекът е отворил оферта и е видял истинска цена.
 *
 * Защо съществува: поканата „Добави на началния екран“ питаше 8 секунди след
 * влизане, тоест ПРЕДИ човекът да е видял какво печели от приложението. Затова
 * се отказваше. На iPhone пък push известия има САМО в добавено приложение —
 * значи без икона няма известия и няма връщане.
 *
 * Затова поканата вече чака първата полза: отваряне на оферта (`/post/...`).
 * Събитието се пази в хранилището, за да не се губи при презареждане.
 */

const FIRST_BENEFIT_KEY = '@smartprice_first_benefit_v1';

let cached: boolean | null = null;
let announced = false;
const listeners = new Set<() => void>();

/** Случвало ли се е първата полза в този браузър? */
export async function hasFirstBenefit(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    cached = (await AsyncStorage.getItem(FIRST_BENEFIT_KEY)) === '1';
  } catch {
    cached = false;
  }
  return cached;
}

/**
 * Отбелязва първата полза и събужда чакащите. Безопасно е да се вика при всяко
 * отваряне на оферта — вторият път не прави нищо и не дразни никого.
 */
export async function markFirstBenefit(): Promise<void> {
  if (announced) return;
  announced = true;
  cached = true;
  try {
    await AsyncStorage.setItem(FIRST_BENEFIT_KEY, '1');
  } catch {
    /* без хранилище: ползата важи само за тази сесия */
  }
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* един счупен слушател не бива да спира другите */
    }
  }
}

/** Абонира се за момента на първата полза. Връща функция за отписване. */
export function onFirstBenefit(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}
