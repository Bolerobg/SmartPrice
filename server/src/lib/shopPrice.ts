/**
 * Проверка на цената в магазина „в момента“ — за сверяване с нашата цена.
 *
 * Защо съществува: човек иска да види дали офертата още е валидна, преди да
 * тръгне да пазарува. Затова отваряме продуктовата страница и четем цената от
 * нея (JSON-LD → meta → селектори), точно както при скрапването.
 *
 * ЧЕСТНОСТ: ако магазинът не отговори, блокира заявката или страницата няма
 * цена — връщаме ok:false с причина. НЕ показваме измислено число.
 *
 * Резултатът се кешира 10 минути, за да не удряме магазина при всяко отваряне
 * на офертата (и за да е бързо за потребителя).
 */
import { politeFetch, parseProductPage, normalizeCurrency } from './scraper.js';

export interface ShopPriceResult {
  ok: boolean;
  priceEur?: number;
  title?: string;
  checkedAt: string;
  reason?: string;
  /** Резултатът е от кеша (по-малко от 10 минути). */
  cached?: boolean;
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: ShopPriceResult }>();

/** Чете цената на един продукт по неговия адрес. Без странични ефекти в базата. */
export async function checkShopPrice(url: string, force = false): Promise<ShopPriceResult> {
  const key = url.trim();
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL_MS) {
    return { ...hit.value, cached: true };
  }

  const checkedAt = new Date().toISOString();
  let value: ShopPriceResult;

  try {
    const res = await politeFetch(key, {
      // Това е публичната страница на продукт, който вече сме скрапнали —
      // четем я като браузър, с малка пауза и кратък таймаут, за да не
      // задържаме потребителя.
      respectRobots: false,
      delayMs: 300,
      timeoutMs: 12_000,
    });

    if (!res.ok) {
      value = { ok: false, checkedAt, reason: `Магазинът отговори с грешка (${res.status}).` };
    } else {
      const parsed = parseProductPage(res.text, res.url || key);
      const raw = parsed.price;
      if (raw === undefined || raw === null || !Number.isFinite(Number(raw))) {
        value = {
          ok: false,
          checkedAt,
          reason: 'В страницата на магазина не открих цена (възможно е да се зарежда с JavaScript).',
        };
      } else {
        const { priceEur } = normalizeCurrency(Number(raw), parsed.currency, res.text.slice(0, 4000));
        value =
          priceEur > 0 && priceEur <= 1_000_000
            ? { ok: true, priceEur: Number(priceEur.toFixed(2)), title: parsed.title, checkedAt }
            : { ok: false, checkedAt, reason: 'Цената в страницата изглежда невалидна.' };
      }
    }
  } catch (err) {
    value = {
      ok: false,
      checkedAt,
      reason:
        (err as Error)?.message?.slice(0, 160) ||
        'Магазинът не отговори (възможно е да блокира автоматични заявки).',
    };
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}
