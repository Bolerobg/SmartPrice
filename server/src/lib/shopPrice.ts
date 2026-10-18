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
import { politeFetch, parseProductPage, normalizeCurrency, parsePrice } from './scraper.js';
import { one, query } from '../db.js';
// Верига за проверка на цената: суров HTML → ИСТИНСКИ браузър → Apify (residential).
// Досега имаше само суровият HTML, затова на JS магазините бутонът казваше „няма цена“.
import { browserAvailable, renderHtml } from './render.js';
import { engineOn } from './engines.js';
import { apifyReady, apifyBudgetAllows, apifyRenderHtml } from './apifyBrowser.js';

export interface ShopPriceResult {
  ok: boolean;
  priceEur?: number;
  /** Редовната (зачертана) цена, когато продуктът е на промоция. */
  listPriceEur?: number;
  title?: string;
  checkedAt: string;
  reason?: string;
  /** Резултатът е от кеша (по-малко от 10 минути). */
  cached?: boolean;
  /**
   * Магазинът блокира автоматични проверки от сървъра ни (Cloudflare 403).
   * Тогава показваме `stored` — последната РЕАЛНО проверена цена.
   */
  blocked?: boolean;
  stored?: StoredShopPrice;
  /** Откъде дойде цената: суров HTML | истински браузър | Apify. */
  via?: 'http' | 'browser' | 'apify';
}

/** Последна реално проверена цена (от сървъра или от локалния робот). */
export interface StoredShopPrice {
  priceEur: number;
  listPriceEur?: number;
  checkedAt: string;
  /** 'server' | 'local' */
  checkedBy: string;
}

/** Пази проверената цена, за да има какво да покажем, ако магазинът блокира. */
export async function saveShopPrice(
  postId: string,
  url: string,
  priceEur: number,
  listPriceEur: number | undefined,
  checkedBy: 'server' | 'local'
): Promise<void> {
  try {
    await query(
      `insert into shop_price_checks (post_id, url, price_eur, list_price_eur, checked_at, checked_by)
       values ($1, $2, $3, $4, now(), $5)
       on conflict (post_id) do update
         set url = excluded.url,
             price_eur = excluded.price_eur,
             list_price_eur = excluded.list_price_eur,
             checked_at = excluded.checked_at,
             checked_by = excluded.checked_by`,
      [postId, url.slice(0, 600), priceEur, listPriceEur ?? null, checkedBy]
    );
    cache.delete(url.trim());
  } catch {
    /* пазенето не е критично — проверката пак е валидна */
  }
}

/** Последната запазена проверка за оферта. */
export async function getStoredShopPrice(postId: string): Promise<StoredShopPrice | undefined> {
  try {
    const row = await one<{
      price_eur: string;
      list_price_eur: string | null;
      checked_at: Date | string;
      checked_by: string;
    }>(
      `select price_eur::text, list_price_eur::text, checked_at, checked_by
         from shop_price_checks where post_id = $1`,
      [postId]
    );
    if (!row) return undefined;
    const price = Number(row.price_eur);
    if (!Number.isFinite(price) || price <= 0) return undefined;
    const list = row.list_price_eur === null ? undefined : Number(row.list_price_eur);
    return {
      priceEur: Number(price.toFixed(2)),
      listPriceEur: list && Number.isFinite(list) && list > price ? Number(list.toFixed(2)) : undefined,
      // ISO 8601 — иначе iOS/Safari не чете датата от Postgres формат.
      checkedAt:
        row.checked_at instanceof Date
          ? row.checked_at.toISOString()
          : String(row.checked_at).replace(' ', 'T'),
      checkedBy: row.checked_by,
    };
  } catch {
    return undefined;
  }
}

/**
 * Внася проверки, направени от локалния робот (домашен IP) — за магазините,
 * които блокират сървъра. Връща колко са записани.
 */
export async function saveLocalShopPrices(
  items: { postId: string; priceEur: number; listPriceEur?: number }[]
): Promise<number> {
  let saved = 0;
  for (const item of items) {
    const post = await one<{ source_url: string | null }>(
      'select source_url from posts where id = $1',
      [item.postId]
    );
    if (!post?.source_url) continue;
    await saveShopPrice(
      item.postId,
      post.source_url,
      item.priceEur,
      item.listPriceEur && item.listPriceEur > item.priceEur ? item.listPriceEur : undefined,
      'local'
    );
    saved += 1;
  }
  return saved;
}

/**
 * Редовната цена от страницата — зачертаната „беше“ цена при промоция.
 *
 * Взимаме я, за да НЕ изглежда голяма разлика като наша грешка: ако магазинът
 * вече е спрял промоцията, казваме „сега е редовната цена X €, а ние сме я
 * видели за Y € (промо)“.
 */
function extractListPrice(html: string): { price: number; currency?: string } | undefined {
  const blobs: string[] = [];
  // 1. Зачертани тагове: <del>, <s>, <strike>
  for (const m of html.matchAll(/<(?:del|s|strike)\b[^>]*>([\s\S]{0,80}?)<\/(?:del|s|strike)>/gi)) {
    blobs.push(m[1] ?? '');
  }
  // 2. Класове, които почти винаги носят старата цена (WooCommerce, OpenCart, Shopify).
  for (const m of html.matchAll(
    /class="[^"]*(?:old-price|regular-price|price-old|list-price|price_old|was-price|compare-at|price-before)[^"]*"[^>]*>([\s\S]{0,80}?)</gi
  )) {
    blobs.push(m[1] ?? '');
  }
  // 3. Структурирани данни за най-високата цена (Magento/JSON-LD).
  for (const m of html.matchAll(/"highPrice"\s*:\s*"?([\d.,]+)/gi)) {
    blobs.push(m[1] ?? '');
  }
  for (const blob of blobs) {
    const p = parsePrice(blob);
    if (p && p > 0 && p <= 1_000_000) {
      const cur = /лв|bgn/i.test(blob) ? 'BGN' : /€|eur/i.test(blob) ? 'EUR' : undefined;
      return { price: p, currency: cur };
    }
  }
  return undefined;
}

/** Има ли смислена цена (за да не приемаме 0/NaN за успех)? */
function hasUsablePrice(p: { price?: number | null } | null | undefined): boolean {
  const n = Number(p?.price);
  return Number.isFinite(n) && n > 0 && n <= 1_000_000;
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: ShopPriceResult }>();

/** Страницата на Cloudflare „Just a moment…“ — знак, че ни блокират. */
function isChallenge(html: string): boolean {
  const head = (html ?? '').slice(0, 3000);
  return /Just a moment|cf-browser-verification|Attention Required|cf_chl_/i.test(head);
}

/** Чете цената на един продукт по неговия адрес. Без странични ефекти в базата. */
export async function checkShopPrice(
  url: string,
  force = false,
  postId?: string
): Promise<ShopPriceResult> {
  const key = url.trim();
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL_MS) {
    return { ...hit.value, cached: true };
  }

  const checkedAt = new Date().toISOString();
  let value: ShopPriceResult;
  /** При неуспех показваме последната реално проверена цена (ако има). */
  const withStored = async (v: ShopPriceResult): Promise<ShopPriceResult> => {
    if (!postId) return v;
    const stored = await getStoredShopPrice(postId);
    return stored ? { ...v, stored } : v;
  };

  try {
    const res = await politeFetch(key, {
      // Това е публичната страница на продукт, който вече сме скрапнали —
      // четем я като браузър, с малка пауза и кратък таймаут, за да не
      // задържаме потребителя.
      respectRobots: false,
      delayMs: 300,
      timeoutMs: 12_000,
    });

    let blocked =
      !res.ok && (res.status === 403 || res.status === 401 || res.status === 429 || res.status >= 500);
    let html = res.ok && !isChallenge(res.text) ? res.text : '';
    if (res.ok && isChallenge(res.text)) blocked = true;
    let parsed = html ? parseProductPage(html, res.url || key) : null;
    let via: 'http' | 'browser' | 'apify' = 'http';

    // 1) Истински браузър в контейнера (безплатен). Тук се четат цените на
    //    сайтовете, които ги показват само след JavaScript (jysk, praktis,
    //    technomarket…). Точно този път липсваше — затова бутонът казваше
    //    „не открих цена“ на много магазини.
    if (!hasUsablePrice(parsed) && browserAvailable() && (await engineOn('price_check_server_browser'))) {
      // 15 сек стигат за domcontentloaded + кратка пауза за заявките с цената.
      // (Преди бяха 20 сек + 6 сек „мрежата утихна“ + 2.5 сек пауза = ~25 сек,
      // а приложението прекъсваше на 20 сек → бутонът изглеждаше счупен.)
      const r = await renderHtml(key, { timeoutMs: 15_000, waitMs: 1_200, idleMs: 3_500 }).catch(
        () => null
      );
      if (r && r.html) {
        const p2 = parseProductPage(r.html, r.url || key);
        if (hasUsablePrice(p2)) {
          html = r.html;
          parsed = p2;
          via = 'browser';
          blocked = false;
        }
      }
    }

    // 2) Apify с residential прокси — САМО ако сайтът наистина блокира и има
    //    дневен бюджет (едно отваряне ≈ $0.0026). Последна инстанция.
    if (
      !hasUsablePrice(parsed) &&
      blocked &&
      (await engineOn('price_check_apify')) &&
      (await apifyReady().catch(() => false))
    ) {
      const budget = await apifyBudgetAllows(0.02).catch(() => ({ allowed: false, today: 0, limit: 0 }));
      if (budget.allowed) {
        const a = await apifyRenderHtml([key], { resident: true, timeoutMs: 30_000 }).catch(() => null);
        const page = a && a.ok ? a.pages.find((x) => x.html) : undefined;
        if (page && page.html) {
          const p3 = parseProductPage(page.html, key);
          if (hasUsablePrice(p3)) {
            html = page.html;
            parsed = p3;
            via = 'apify';
            blocked = false;
          }
        }
      }
    }

    if (parsed && hasUsablePrice(parsed)) {
      const { priceEur } = normalizeCurrency(Number(parsed.price), parsed.currency, html.slice(0, 4000));
      // Редовната цена, ако продуктът е на промоция — за да обясним разликата
      // с думи („промоцията е свършила, сега е редовната цена“).
      const listRaw = extractListPrice(html);
      const listEur = listRaw
        ? normalizeCurrency(listRaw.price, listRaw.currency, html.slice(0, 4000)).priceEur
        : undefined;
      const listPriceEur =
        listEur && listEur > priceEur + 0.001 && listEur <= 1_000_000
          ? Number(listEur.toFixed(2))
          : undefined;
      value =
        priceEur > 0 && priceEur <= 1_000_000
          ? {
              ok: true,
              priceEur: Number(priceEur.toFixed(2)),
              listPriceEur,
              title: parsed.title,
              checkedAt,
              via,
            }
          : await withStored({ ok: false, checkedAt, blocked, reason: 'Цената в страницата изглежда невалидна.' });
      // Запомняме реално проверената цена — за да има какво да покажем, ако
      // магазинът започне да блокира сървъра.
      if (value.ok && postId && value.priceEur) {
        await saveShopPrice(postId, key, value.priceEur, value.listPriceEur, 'server');
      }
    } else if (blocked) {
      value = await withStored({
        ok: false,
        checkedAt,
        blocked: true,
        reason: `Този магазин не позволява автоматична проверка от нашия сървър (защитен е${
          res.ok ? ' срещу роботи' : `, отговаря с ${res.status}`
        }).`,
      });
    } else if (!res.ok) {
      value = await withStored({
        ok: false,
        checkedAt,
        reason: `Магазинът отговори с грешка (${res.status}).`,
      });
    } else {
      value = await withStored({
        ok: false,
        checkedAt,
        reason:
          'В страницата на магазина не открих цена — нито в HTML, нито след отваряне с истински браузър.',
      });
    }
  } catch (err) {
    const msg = (err as Error)?.message ?? '';
    value = await withStored({
      ok: false,
      checkedAt,
      blocked: /403|forbidden|challenge/i.test(msg),
      reason:
        msg.slice(0, 160) ||
        'Магазинът не отговори (възможно е да блокира автоматични заявки).',
    });
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}
