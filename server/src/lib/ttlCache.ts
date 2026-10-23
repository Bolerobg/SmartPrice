/**
 * ⚡ Малък кеш в паметта за ТЕЖКИ, но рядко променящи се заявки.
 *
 * Защо съществува (23.10.2026): заявката „кой магазин е най-изгоден“ брои
 * percentile върху всички публикувани магазински цени. Върви ~1.5-2 секунди и се
 * вика при ВСЯКО отваряне на екрана „Онлайн магазини“. При няколко души наведнъж
 * тези заявки задръстваха връзките към базата и част от заявките падаха с 500
 * („timeout exceeded when trying to connect“).
 *
 * Две неща в едно:
 *   1. ПАЗИ резултата за TTL — еднаква заявка не се смята пак.
 *   2. СЛИВА едновременните — ако 10 души поискат същото в един момент, базата
 *      се пита ВЕДНЪЖ (пази се обещанието, не само готовият резултат). Точно това
 *      спира лавината при натоварване.
 *
 * ⚠️ Ползвай само за ЧЕТЕНЕ и за данни, които не изискват моментна точност
 *    (агрегати, класации). Не за неща, които човек току-що е променил и очаква
 *    да види веднага (напр. значката на търговеца).
 */

interface Entry {
  at: number;
  p: Promise<unknown>;
}

const store = new Map<string, Entry>();

export function cached<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>;

  const p = work().catch((err) => {
    // Грешка НЕ се пази — иначе едно сриване щеше да „лепне“ за целия TTL.
    store.delete(key);
    throw err;
  });
  store.set(key, { at: Date.now(), p });

  // Да не расте безкрайно (различни филтри раждат различни ключове).
  if (store.size > 400) {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now - v.at > ttlMs * 4) store.delete(k);
    }
    if (store.size > 400) {
      // Все още много — махаме най-старите 100.
      const keys = [...store.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
      for (const [k] of keys) store.delete(k);
    }
  }
  return p as Promise<T>;
}

/** Изчисти кеша (при нужда от прясно — напр. след голям внос на цени). */
export function clearCache(prefix?: string): number {
  if (!prefix) {
    const n = store.size;
    store.clear();
    return n;
  }
  let n = 0;
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) {
      store.delete(k);
      n += 1;
    }
  }
  return n;
}

export function cacheSize(): number {
  return store.size;
}
