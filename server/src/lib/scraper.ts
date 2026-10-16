import { randomUUID } from 'node:crypto';
import { many, one, query, tx } from '../db.js';
import { env, features } from '../env.js';
import { putImage, publicUrl } from './storage.js';

/**
 * Професионален скрапер за онлайн магазини.
 *
 * Философията: един магазин не е друг магазин. Затова не разчитаме на един
 * начин на четене, а на ВЕРИГА ОТ СТРАТЕГИИ — от най-точната към най-общата:
 *
 *   1. Shopify JSON        /products.json            — целият каталог наведнъж
 *   2. WooCommerce Store   /wp-json/wc/store/v1/...  — целият каталог наведнъж
 *   3. Sitemap             /sitemap.xml → продуктови URL-та → JSON-LD на всяка
 *   4. JSON-LD (schema.org Product)  — има го в повечето модерни магазини
 *   5. OpenGraph (og:title / og:image / product:price:amount)
 *   6. Microdata (itemprop="price" …)
 *   7. Ръчни CSS селектори от профила на сайта (за стари/нестандартни сайтове)
 *   8. Евристики (h1, първа голяма снимка, цена по шаблон в текста)
 *
 * Две неща правят скрапера „професионален“, а не скрипт:
 *   • Учтивост — идентифицираме се, спазваме robots.txt, слагаме пауза между
 *     заявките към един домейн и не удряме на поразия.
 *   • Адаптивност — наученото за сайта (стратегия + селектори) се записва в
 *     scrape_sites, така че вторият път е един клик.
 *
 * Прозрачност пред потребителите (както при внесените бонове): всичко влиза
 * под профила „SmartPrice Редакция“ с source='scraper' и бележка с адреса на
 * източника, а в приложението носи етикет „ОТ МАГАЗИН“.
 */

/* ============================================================ настройки */

export interface ScrapeOptions {
  /** Колко продукта най-много да влязат (таванът е и за обиколката). */
  count?: number;
  mode?: 'preview' | 'import';
  /** AI: чисти заглавието, избира категория, пише българско описание, вади грамажа. */
  useAi?: boolean;
  /** Сваляме снимките при нас, вместо да сочим към чуждия сайт. */
  downloadImages?: boolean;
  maxImageMb?: number;
  /** green (оферта) | compare (сравни с вече наличното) | trap (червен флаг). */
  polarityMode?: 'offer' | 'compare' | 'trap';
  /** ai | breadcrumb | fixed */
  categoryMode?: 'ai' | 'breadcrumb' | 'fixed';
  fixedCategory?: string;
  city?: string;
  /** Пауза между заявките към един домейн (ms). По-голямо = по-учтиво. */
  delayMs?: number;
  respectRobots?: boolean;
  /** Колко страници да обходи, ако сайтът е „листинг с пагинация“. */
  maxPages?: number;
  minPrice?: number;
  maxPrice?: number;
  skipWithoutImage?: boolean;
  /** url | title | off */
  dedupe?: 'url' | 'title' | 'off';
  addShopTag?: boolean;
  /** Ръчни селектори (за трудни сайтове). */
  selectors?: Record<string, string>;
  /** Запомни наученото за този домейн. */
  saveProfile?: boolean;
  /** За тестове: позволява и вътрешни адреси (по подразбиране забранено). */
  allowPrivate?: boolean;
}

const DEFAULTS: Required<Pick<ScrapeOptions,
  'count' | 'useAi' | 'downloadImages' | 'maxImageMb' | 'polarityMode' | 'categoryMode' |
  'delayMs' | 'respectRobots' | 'maxPages' | 'skipWithoutImage' | 'dedupe' | 'addShopTag' | 'saveProfile'>> = {
  count: 20,
  useAi: true,
  downloadImages: true,
  maxImageMb: 8,
  polarityMode: 'compare',
  categoryMode: 'ai',
  delayMs: 350,
  respectRobots: true,
  maxPages: 12,
  skipWithoutImage: true,
  dedupe: 'url',
  addShopTag: true,
  saveProfile: true,
};

export const SCRAPE_CATEGORIES = [
  'restaurants', 'hotels_airbnb', 'supermarket', 'cafes_bars', 'services_tech', 'other',
] as const;

// ВАЖНО: HTTP заглавията приемат само ASCII. Кирилица тук чупи всяка заявка
// с „Cannot convert argument to a ByteString“ — затова низът е само латиница.
const UA =
  'Mozilla/5.0 (compatible; SmartPriceBot/1.0; +https://smartprice.bg; product-prices)';

/**
 * Какво приемаме по подразбиране — само страници.
 *
 * ВАЖНО: тук НЕ бива да има „application/json“. Магазини с AJAX модули
 * (PrestaShop) връщат JSON-парче вместо цялата страница, ако клиентът каже,
 * че приема JSON — видяно на живо на iskambg.com. Затова JSON се иска
 * изрично, само там, където наистина чакаме JSON.
 */
const DEFAULT_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8';

/* ================================================================ мрежа */

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^0\./.test(h)) return true;
  const m = /^172\.(\d{1,3})\./.exec(h);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

export function normalizeStartUrl(raw: string): URL {
  const url = new URL(raw.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Позволени са само http/https адреси.');
  }
  return url;
}

const lastHitPerHost = new Map<string, number>();
const robotsCache = new Map<string, { at: number; disallow: string[]; allow: string[] }>();

/**
 * Настройки на заявките, общи за всички части на скрапера.
 *
 * `jobId` не е „настройка“ — с него отчитаме колко страници е отворила дадена
 * задача, за да може панелът да показва честно „обходен ли е сайтът“.
 */
export interface FetchOpts {
  delayMs?: number;
  respectRobots?: boolean;
  allowPrivate?: boolean;
  jobId?: string;
  maxPages?: number;
  maxSitemaps?: number;
  accept?: string;
  timeoutMs?: number;
}

/** Колко заявки е направила задачата (само страници, не снимки). */
const fetchCounters = new Map<string, number>();

function countVisit(jobId: string | undefined) {
  if (!jobId) return;
  fetchCounters.set(jobId, (fetchCounters.get(jobId) ?? 0) + 1);
}

export function visitedCount(jobId: string): number {
  return fetchCounters.get(jobId) ?? 0;
}

async function sleep(ms: number) {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/** Пауза, за да не заливаме един и същ домейн. */
async function politeDelay(host: string, delayMs: number) {
  const last = lastHitPerHost.get(host) ?? 0;
  const wait = delayMs - (Date.now() - last);
  await sleep(wait > 0 ? wait : 0);
  lastHitPerHost.set(host, Date.now());
}

async function loadRobots(origin: string, respect: boolean): Promise<{ disallow: string[]; allow: string[] }> {
  if (!respect) return { disallow: [], allow: [] };
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached;

  const empty = { at: Date.now(), disallow: [], allow: [] };
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      robotsCache.set(origin, empty);
      return empty;
    }
    const text = (await res.text()).slice(0, 200_000);
    const disallow: string[] = [];
    const allow: string[] = [];
    let applies = false;
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (/^user-agent:/i.test(t)) {
        const agent = t.split(':').slice(1).join(':').trim().toLowerCase();
        applies = agent === '*' || agent.includes('smartprice');
        continue;
      }
      if (!applies) continue;
      if (/^disallow:/i.test(t)) {
        const p = t.split(':').slice(1).join(':').trim();
        if (p) disallow.push(p);
      } else if (/^allow:/i.test(t)) {
        const p = t.split(':').slice(1).join(':').trim();
        if (p) allow.push(p);
      }
    }
    const entry = { at: Date.now(), disallow, allow };
    robotsCache.set(origin, entry);
    return entry;
  } catch {
    robotsCache.set(origin, empty);
    return empty;
  }
}

export async function robotsAllows(url: string, respect: boolean): Promise<boolean> {
  if (!respect) return true;
  const u = new URL(url);
  const { disallow, allow } = await loadRobots(u.origin, respect);
  const path = u.pathname + (u.search || '');
  // Allow винаги печели, ако е по-специфичен от Disallow.
  for (const a of allow) if (a !== '/' && path.startsWith(a)) return true;
  for (const d of disallow) if (d === '/' || path.startsWith(d)) return false;
  return true;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  text: string;
}

/** Учтива заявка: идентифицираме се, чакаме, не преследваме вътрешни адреси. */
export async function politeFetch(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
  const url0 = normalizeStartUrl(url);
  if (!opts.allowPrivate && isPrivateHost(url0.hostname)) {
    throw new Error(`Адресът сочи към вътрешна мрежа (${url0.hostname}) — отказано.`);
  }
  const respect = opts.respectRobots ?? true;
  if (!(await robotsAllows(url0.toString(), respect))) {
    throw new Error('robots.txt на сайта забранява обхождането на този адрес.');
  }

  await politeDelay(url0.host, Math.max(0, Math.min(5000, opts.delayMs ?? DEFAULTS.delayMs)));

  let lastErr: unknown = null;
  // Ако не сме искали JSON изрично, а сървърът върне JSON, опитваме пак само с
  // HTML. Иначе PrestaShop и подобни връщат AJAX-парче вместо страницата —
  // точно заради „application/json“ в Accept (видяно на iskambg.com).
  let htmlOnly = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    countVisit(opts.jobId);
    try {
      const res = await fetch(url0.toString(), {
        headers: {
          'User-Agent': UA,
          Accept: opts.accept ?? (htmlOnly ? 'text/html,application/xhtml+xml' : DEFAULT_ACCEPT),
          'Accept-Language': 'bg,en;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
      });
      const contentType = res.headers.get('content-type') ?? '';
      const isText = /json|html|xml|text/i.test(contentType);
      const text = isText ? (await res.text()).slice(0, 1_500_000) : '';

      if (!opts.accept && /json/i.test(contentType) && !htmlOnly) {
        htmlOnly = true;
        await sleep(200);
        continue;
      }
      return { ok: res.ok, status: res.status, url: res.url || url0.toString(), contentType, text };
    } catch (err) {
      lastErr = err;
      await sleep(600);
    }
  }
  throw new Error(`Не успях да отворя ${url0.host}: ${(lastErr as Error)?.message ?? 'неизвестна грешка'}`);
}

/* ==================================================== извличане на данни */

export interface RawProduct {
  sourceUrl: string;
  title?: string;
  description?: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  breadcrumb?: string;
  brand?: string;
  availability?: string;
  /** Откъде сме го взели — за диагностика в панела. */
  via: string;
}

/** Обръща HTML елементи в текст: маха скриптове/стилове, декодира основните знаци. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** „1 234,56 €“ / „1,234.56“ / „12.50“ → 1234.56 */
export function parsePrice(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  let s = String(raw).replace(/[^\d.,\-]/g, ' ').trim();
  const m = /(\d[\d\s.,]*)/.exec(s);
  if (!m) return undefined;
  s = m[1]!.replace(/\s/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Последният разделител е десетичният.
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasComma) {
    const frac = s.split(',').pop()!.length;
    s = frac === 3 && s.split(',').length === 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : undefined;
}

/** Разпознава валута и връща цената в евро (приложението работи само в €). */
export function normalizeCurrency(price: number, currencyRaw?: string, blob?: string): { priceEur: number; currency: 'EUR' } {
  const hay = `${currencyRaw ?? ''} ${blob ?? ''}`.toLowerCase();
  const isBgn = /bgn|лв|lv\b|лева/.test(hay) && !/eur|€/.test(hay);
  if (isBgn) return { priceEur: Number((price / 1.95583).toFixed(2)), currency: 'EUR' };
  const isGbp = /gbp|£/.test(hay);
  const isUsd = /usd|\$/.test(hay);
  if (isGbp) return { priceEur: Number((price * 1.17).toFixed(2)), currency: 'EUR' };
  if (isUsd) return { priceEur: Number((price * 0.92).toFixed(2)), currency: 'EUR' };
  return { priceEur: Number(price.toFixed(2)), currency: 'EUR' };
}

const UNIT_MAP: Record<string, 'g' | 'kg' | 'ml' | 'l' | 'pcs'> = {
  'кг': 'kg', kg: 'kg', 'килограм': 'kg',
  'г': 'g', 'гр': 'g', g: 'g', gram: 'g', грама: 'g',
  'мл': 'ml', ml: 'ml', 'милилитър': 'ml',
  'л': 'l', 'литър': 'l', l: 'l', lit: 'l',
  'бр': 'pcs', 'брой': 'pcs', 'броя': 'pcs', pcs: 'pcs', pc: 'pcs', x: 'pcs',
};

/** „Олио 1 л“ → { quantity: 1, unit: 'l' }; „Сирене 400 г“ → { 400, 'g' } */
export function parseUnit(text: string | undefined | null): { quantity?: number; unit?: 'g' | 'kg' | 'ml' | 'l' | 'pcs' } {
  if (!text) return {};
  const m = /(\d+(?:[.,]\d+)?)\s*(кг|килограм|гр|грам[а]?|г|kg|gram|g|мл|милилитър|ml|л|литър|l|бр\.?|брой|броя|pcs|pc)\b/i.exec(text);
  if (!m) return {};
  const qty = Number(String(m[1]).replace(',', '.'));
  const raw = m[2]!.toLowerCase().replace(/\.$/, '');
  const unit = UNIT_MAP[raw];
  if (!unit || !Number.isFinite(qty) || qty <= 0) return {};
  return { quantity: qty, unit };
}

/* --------------------------------------------------------- JSON-LD / OG */

interface JsonLdProduct {
  name?: string;
  description?: string;
  image?: unknown;
  offers?: unknown;
  category?: string;
  breadcrumb?: string;
}

function firstImage(image: unknown): string | undefined {
  if (!image) return undefined;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) return firstImage(image[0]);
  if (typeof image === 'object') {
    const o = image as Record<string, unknown>;
    return firstImage(o.url ?? o.contentUrl ?? o['@id']);
  }
  return undefined;
}

function fromOffers(offers: unknown): { price?: number; currency?: string } {
  const arr = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const o of arr) {
    if (!o || typeof o !== 'object') continue;
    const rec = o as Record<string, unknown>;
    const priceRaw = rec.price ?? rec.lowPrice ?? (rec.priceSpecification as Record<string, unknown> | undefined)?.price;
    const price = typeof priceRaw === 'number' ? priceRaw : parsePrice(String(priceRaw ?? ''));
    const currency = typeof rec.priceCurrency === 'string' ? rec.priceCurrency : undefined;
    if (price) return { price, currency };
  }
  return {};
}

export function extractJsonLd(html: string): JsonLdProduct[] {
  const out: JsonLdProduct[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const body = m[1]!.trim();
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      try {
        parsed = JSON.parse(body.replace(/,\s*([}\]])/g, '$1'));
      } catch {
        continue;
      }
    }
    const nodes: unknown[] = Array.isArray(parsed)
      ? parsed
      : (parsed as Record<string, unknown>)['@graph']
        ? ((parsed as Record<string, unknown>)['@graph'] as unknown[])
        : [parsed];

    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const rec = node as Record<string, unknown>;
      const types = ([] as string[]).concat(
        (Array.isArray(rec['@type']) ? rec['@type'] : [rec['@type']]) as string[]
      ).filter(Boolean);
      const isProduct = types.some((t) => /product/i.test(t));
      const isBreadcrumb = types.some((t) => /breadcrumblist/i.test(t));
      if (isBreadcrumb) {
        const items = (rec.itemListElement as Array<Record<string, unknown>> | undefined) ?? [];
        const names = items
          .map((i) => {
            const item = i.item as Record<string, unknown> | undefined;
            return String(i.name ?? item?.name ?? '');
          })
          .filter(Boolean);
        if (names.length) out.push({ breadcrumb: names.join(' › ') });
        continue;
      }
      if (!isProduct) continue;
      const { price, currency } = fromOffers(rec.offers);
      out.push({
        name: typeof rec.name === 'string' ? rec.name : undefined,
        description: typeof rec.description === 'string' ? rec.description : undefined,
        image: rec.image,
        category: typeof rec.category === 'string' ? rec.category : undefined,
        offers: price ? [{ price, priceCurrency: currency }] : rec.offers,
        breadcrumb: undefined,
      });
    }
  }
  return out;
}

export function extractMeta(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<(?:meta|link)[^>]+>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0]!;
    const prop = /(?:property|name|itemprop)=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content=["']([^"']*)["']/i.exec(tag)?.[1];
    const rel = /rel=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const href = /href=["']([^"']*)["']/i.exec(tag)?.[1];
    if (rel === 'canonical' && href) out.canonical = href;
    if (prop && content !== undefined) out[prop] = content;
  }
  return out;
}

export function extractMicrodata(html: string): Partial<RawProduct> {
  const grab = (itemprop: string): string | undefined => {
    const re = new RegExp(`<[^>]+itemprop=["']${itemprop}["'][^>]*>`, 'i');
    const tag = re.exec(html)?.[0];
    if (!tag) return undefined;
    const content = /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return content;
    const after = html.slice(html.indexOf(tag) + tag.length, html.indexOf(tag) + tag.length + 400);
    return htmlToText(after.split('<')[0] ?? '') || undefined;
  };
  const price = parsePrice(grab('price'));
  const image = grab('image');
  const name = grab('name');
  return {
    title: name,
    price,
    imageUrl: image && /^https?:/i.test(image) ? image : undefined,
  };
}

/** Опростен CSS селектор: `h1`, `.price`, `#main .price`, `img.hero@src`, `.price@text`.
 *  Поддържа: име на таг, .класа, #id, [attr=стойност] и извличане на конкретен
 *  атрибут след „@“ (или `@text` за текста вътре). Стига за 95% от магазините,
 *  а не тежи колкото цяла библиотека за HTML. */
export function selectFirst(html: string, selector: string): string | undefined {
  if (!selector) return undefined;
  const [selRaw, attrRaw] = selector.split('@');
  const parts = String(selRaw).trim().split(/\s+/);
  const sel = parts[parts.length - 1]!;
  const tag = /^[a-zA-Z][\w-]*/.exec(sel)?.[0] ?? 'div';
  const cls = /\.([\w-]+)/.exec(sel)?.[1];
  const id = /#([\w-]+)/.exec(sel)?.[1];
  const attrEq = /\[([\w-]+)\s*(\*=|=)\s*["']?([^\]"']+)["']?\]/.exec(sel);

  const tagRe = new RegExp(`<(${tag})([^>]*)>([\\s\\S]*?)<\\/\\1>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const attrs = m[2] ?? '';
    const inner = m[3] ?? '';
    if (id && !new RegExp(`id=["']${id}["']`, 'i').test(attrs)) continue;
    if (cls && !new RegExp(`class=["'][^"']*\\b${cls}\\b`, 'i').test(attrs)) continue;
    if (attrEq) {
      const [, attrName, op, val] = attrEq;
      const re = op === '*='
        ? new RegExp(`${attrName}=["'][^"']*${val}`, 'i')
        : new RegExp(`${attrName}=["']${val}["']`, 'i');
      if (!re.test(attrs)) continue;
    }

    if (attrRaw) {
      const want = new RegExp(`${attrRaw}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs);
      if (want) return want[1];
      continue; // атрибутът липсва тук — търсим следващия съвпадащ елемент
    }
    return htmlToText(inner);
  }
  return undefined;
}

/** Пътища, които никога не са продукт (количка, вход, блог, търсене…). */
const NOT_A_PRODUCT =
  /(cart|checkout|login|logowanie|my-account|account|contact|kontakt|wishlist|compare|register|password|order|basket|koshnitsa|koshnic|favorites|loyalty|blog|news|prices-drop|new-products|best-sales|sitemap|manufacturer|supplier|search|404|gdpr|cookie|privacy|terms|delivery|payment)/i;

/** PrestaShop-стил продуктов адрес: `/12345-ime-na-produkt.html`. */
const PRODUCT_HTML = /\/\d+[-a-zа-я0-9_]*\.html?$/i;
/** PrestaShop/други: `?id_product=123`. */
const PRODUCT_QUERY = /[?&](id_product|product_id|pid)=\d+/i;
/** Думи, които почти винаги значат „това е продукт“. */
const PRODUCT_WORD =
  /\/(product|produkt|produkti|продукт|p|item|art|tovar|stoka|shop|catalog|katalog)\//i;

const IMG_EXT = /\.(jpg|jpeg|png|webp|gif|svg|pdf|zip|css|js)$/i;

function hrefLooksLikeProduct(href: string, inner: string): boolean {
  if (!href || IMG_EXT.test(href)) return false;
  if (/^(javascript:|mailto:|tel:|#)/i.test(href)) return false;
  let path: string;
  try {
    const u = new URL(href, 'https://x.local');
    path = u.pathname + u.search;
  } catch {
    return false;
  }
  if (NOT_A_PRODUCT.test(path)) return false;
  if (PRODUCT_WORD.test(path) || PRODUCT_HTML.test(path) || PRODUCT_QUERY.test(path)) return true;
  // Последна надежда: връзка със снимка вътре и число в адреса (много магазини
  // слагат ID-то в адреса, без да е в „/product/“).
  return /<img/i.test(inner) && /\d/.test(path);
}

/**
 * Всички връзки към продукти от листинг страница.
 *
 * Първо връща СИГУРНИТЕ продуктови адреси (PrestaShop `.html` с ID, `/product/`,
 * `?id_product=`), а ако те са малко — и по-хлабавите. Така при голям листинг не
 * хабим лимита по категории и страници.
 */
export function extractProductLinks(html: string, baseUrl: string, listSelector?: string): string[] {
  const links = new Set<string>();
  const base = new URL(baseUrl);

  if (listSelector) {
    const attr = /@([\w-]+)$/.exec(listSelector)?.[1] ?? 'href';
    const sel = listSelector.split('@')[0]!;
    const tag = /^[a-zA-Z][\w-]*/.exec(sel.trim())?.[0] ?? 'a';
    const re = new RegExp(`<(${tag})([^>]*)>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const href = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i').exec(m[2] ?? '')?.[1];
      if (href) {
        try {
          links.add(new URL(href, base).toString());
        } catch { /* ignore */ }
      }
    }
    return [...links];
  }

  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,600}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1]!;
    const inner = m[2] ?? '';
    if (!hrefLooksLikeProduct(href, inner)) continue;
    try {
      const u = new URL(href, base);
      if (u.host !== base.host) continue;
      u.hash = '';
      links.add(u.toString());
    } catch { /* ignore */ }
  }

  const all = [...links];
  const strong = all.filter((l) => {
    const path = new URL(l).pathname;
    return PRODUCT_HTML.test(path) || PRODUCT_WORD.test(path) || PRODUCT_QUERY.test(l);
  });
  return strong.length >= 3 ? [...strong, ...all.filter((l) => !strong.includes(l))] : all;
}

/**
 * Вади продуктите НАПРАВО от картите в листинга — без да отваря всяка страница.
 *
 * Защо е важно: PrestaShop и половината магазини нямат нито sitemap, нито API.
 * Но листингът им съдържа всичко нужно — снимка, име и цена до всяка връзка.
 * Една заявка вместо тридесет, а и сайтовете ни харесват повече така.
 */
export function extractListingProducts(html: string, pageUrl: string): RawProduct[] {
  const links = extractProductLinks(html, pageUrl);
  if (!links.length) return [];

  const out: RawProduct[] = [];
  for (const link of links) {
    const idx = html.indexOf(link.replace(/^https?:\/\/[^/]+/, ''));
    const bare = link.split('?')[0]!.split('/').pop() ?? '';
    const at = idx >= 0 ? idx : bare ? html.indexOf(bare) : -1;
    if (at < 0) continue;
    const window = html.slice(Math.max(0, at - 1200), at + 2600);

    const imgTag = /<img\b([^>]*)>/i.exec(window)?.[1] ?? '';
    const alt = /alt=["']([^"']{3,})["']/i.exec(imgTag)?.[1];
    const titleAttr =
      /title=["']([^"']{3,})["']/i.exec(window)?.[1] ?? /aria-label=["']([^"']{3,})["']/i.exec(window)?.[1];
    const { price, currency } = extractGenericPrice(window);
    const image = extractGenericImage(window, pageUrl);

    const title = htmlToText(alt || titleAttr || '');
    if (!title || title.length < 3) continue;
    if (!price) continue;
    if (!image) continue;

    out.push({
      sourceUrl: link,
      title,
      description: undefined,
      price,
      currency,
      imageUrl: image,
      via: 'listing-cards',
    });
  }
  // Махаме повторенията: по адрес И по (име + цена). Магазините често показват
  // един продукт няколко пъти (различни разфасовки/цветове на същата карта) —
  // за приложението това е един и същ продукт и не бива да влиза два пъти.
  const seenUrl = new Set<string>();
  const seenName = new Set<string>();
  return out.filter((p) => {
    const nameKey = `${(p.title ?? '').toLowerCase().replace(/\s+/g, ' ').trim()}|${p.price}`;
    if (seenUrl.has(p.sourceUrl) || seenName.has(nameKey)) return false;
    seenUrl.add(p.sourceUrl);
    seenName.add(nameKey);
    return true;
  });
}

/** Безплатен, но често най-точен начин: продуктовият адрес по sitemap. */
export async function collectFromSitemap(
  startUrl: string,
  limit: number,
  opts: FetchOpts
): Promise<{ urls: string[]; usedSitemap?: string }> {
  const u = new URL(startUrl);
  // Първо питаме robots.txt — там доста сайтове обявяват нестандартен sitemap.
  const fromRobots: string[] = [];
  try {
    const rb = await politeFetch(`${u.origin}/robots.txt`, { ...opts, accept: 'text/plain' });
    if (rb.ok && rb.text) {
      for (const line of rb.text.split('\n')) {
        const m = /^\s*sitemap:\s*(\S+)/i.exec(line);
        if (m) fromRobots.push(m[1].trim());
        if (fromRobots.length >= 6) break;
      }
    }
  } catch {
    // няма robots.txt — не е проблем
  }

  const candidates = /sitemap/i.test(u.pathname)
    ? [u.toString()]
    : [
        ...fromRobots,
        `${u.origin}/sitemap.xml`,
        `${u.origin}/sitemap_index.xml`,
        `${u.origin}/sitemap-index.xml`,
        `${u.origin}/wp-sitemap.xml`,
        `${u.origin}/product-sitemap.xml`,
        `${u.origin}/sitemap_products_1.xml`,
        `${u.origin}/sitemap-products.xml`,
        `${u.origin}/sitemap/sitemap.xml`,
      ];

  const seenSitemaps = new Set<string>();
  const productUrls = new Set<string>();
  const visited: string[] = [];
  const maxSitemaps = opts.maxSitemaps ?? 8;

  async function walk(sitemapUrl: string, depth: number): Promise<void> {
    if (productUrls.size >= limit) return;
    if (seenSitemaps.size >= maxSitemaps) return;
    if (seenSitemaps.has(sitemapUrl) || depth > 2) return;
    seenSitemaps.add(sitemapUrl);

    let res: FetchResult;
    try {
      res = await politeFetch(sitemapUrl, {
        delayMs: opts.delayMs,
        respectRobots: opts.respectRobots,
        allowPrivate: opts.allowPrivate,
        accept: 'application/xml,text/xml,*/*',
      });
    } catch {
      return;
    }
    if (!res.ok || !res.text) return;
    visited.push(sitemapUrl);

    const locs = [...res.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((mm) => mm[1]!);
    const isIndex = /<sitemapindex/i.test(res.text);
    if (isIndex) {
      const children = locs.filter((l) => /\.xml/i.test(l)).slice(0, maxSitemaps);
      // Продуктовите sitemap-и първи.
      children.sort((a, b) => Number(/product|produkt|tovar/i.test(b)) - Number(/product|produkt|tovar/i.test(a)));
      for (const child of children) await walk(child, depth + 1);
      return;
    }
    for (const loc of locs) {
      if (/\.(jpg|jpeg|png|webp|gif|pdf)$/i.test(loc)) continue;
      productUrls.add(loc);
      if (productUrls.size >= limit * 3) return;
    }
  }

  for (const c of candidates) {
    if (productUrls.size >= limit * 3) break;
    await walk(c, 0);
  }
  return { urls: [...productUrls], usedSitemap: visited[0] };
}

/* ------------------------------------------------------- Shopify / Woo */

/** Фиксираният курс — на бележките още пише лв., а приложението работи в евро. */
const BGN_PER_EUR = 1.95583;

/** Декодира основните XML/HTML знаци в текст от фийд. */
function feedDecode(value: string): string {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .trim();
}

/** Прави относителен адрес от фийд в абсолютен. */
function feedAbs(value: string, baseUrl: string): string | undefined {
  const v = value.trim();
  if (!v || /^(javascript:|#|mailto:)/i.test(v)) return undefined;
  try {
    return new URL(v, baseUrl).toString();
  } catch {
    return undefined;
  }
}

/**
 * Цена от фийд: „12.50 BGN“, „12,50 лв.“, „12.50 EUR“ или само число.
 * Ако пише лв./BGN — превалутираме в евро (приложението работи в евро).
 */
function feedPrice(raw?: string): { price?: number; currency?: string } {
  if (!raw) return {};
  const isBgn = /лв|bgn/i.test(raw);
  const m = /(\d+(?:[.,]\d+)?)/.exec(raw.replace(/\u00a0/g, ' '));
  if (!m) return {};
  const value = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return {};
  return {
    price: isBgn ? Number((value / BGN_PER_EUR).toFixed(2)) : value,
    currency: 'EUR',
  };
}

/** Кои фийдове да пробваме — Google Merchant, RSS и Atom ги има на всякакви платформи. */
const FEED_PATHS = [
  '/feed/google.xml',
  '/googlemerchant.xml',
  '/feed/googlemerchant.xml',
  '/products.xml',
  '/catalog.xml',
  '/feed/products.xml',
  '/feed.xml',
  '/rss.xml',
  '/products.atom',
  '/feed/?post_type=product',
];

/** Чете магазинни XML фийдове: <item> (RSS / Google Merchant) или <entry> (Atom). */
export function parseFeedItems(xml: string, baseUrl: string): RawProduct[] {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  const out: RawProduct[] = [];
  for (const block of blocks) {
    const pick = (...names: string[]): string | undefined => {
      for (const name of names) {
        const tag = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block);
        if (tag) {
          const v = feedDecode(tag[1]);
          if (v) return v;
        }
        const attr = new RegExp(`<${name}[^>]*href=["']([^"']+)["']`, 'i').exec(block);
        if (attr) return attr[1];
      }
      return undefined;
    };

    const title = pick('title', 'g:title');
    if (!title) continue;
    const link = pick('link', 'g:link');
    const money = feedPrice(pick('g:price', 'g:sale_price', 'price', 'sale_price'));
    const image = pick('g:image_link', 'image', 'g:additional_image_link');

    out.push({
      sourceUrl: (link && feedAbs(link, baseUrl)) || baseUrl,
      title,
      price: money.price,
      currency: money.currency,
      imageUrl: image ? feedAbs(image, baseUrl) : undefined,
      brand: pick('g:brand', 'brand'),
      availability: pick('g:availability', 'availability'),
      via: 'feed',
    });
  }
  return out;
}

/** Пробва магазинните фийдове — често единственият начин при нестандартен магазин. */
export async function tryProductFeed(
  origin: string,
  limit: number,
  opts: FetchOpts
): Promise<RawProduct[] | null> {
  for (const path of FEED_PATHS) {
    try {
      const res = await politeFetch(`${origin}${path}`, opts);
      if (!res.ok || !res.text) continue;
      if (!/<(item|entry)[\s>]/i.test(res.text)) continue;
      const items = parseFeedItems(res.text, res.url || origin);
      if (items.length >= 3) return items.slice(0, limit);
    } catch {
      // следващ фийд
    }
  }
  return null;
}

/**
 * Magento / Adobe Commerce: GraphQL чете продукти без ключ.
 * Достатъчно е да върне няколко продукта — после ги внасяме като останалите.
 */
export async function tryMagento(
  origin: string,
  limit: number,
  opts: FetchOpts
): Promise<RawProduct[] | null> {
  const query =
    `{ products(pageSize: ${Math.min(100, Math.max(1, limit))}) { items { name url_key url_suffix ` +
    `small_image { url } price_range { minimum_price { final_price { value currency } } } } } }`;
  let res: Response;
  try {
    res = await fetch(`${origin}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'SmartPriceBot/1.0 (+https://smartprice.bg)',
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const payload = (await res.json().catch(() => null)) as {
    data?: { products?: { items?: Array<Record<string, unknown>> } };
  } | null;
  const items = payload?.data?.products?.items;
  if (!Array.isArray(items) || items.length === 0) return null;

  const out: RawProduct[] = [];
  for (const raw of items) {
    const item = raw as {
      name?: string;
      url_key?: string;
      url_suffix?: string;
      small_image?: { url?: string };
      price_range?: { minimum_price?: { final_price?: { value?: number; currency?: string } } };
    };
    const final = item.price_range?.minimum_price?.final_price;
    const value = Number(final?.value);
    const currency = String(final?.currency ?? 'EUR').toUpperCase();
    const suffix = item.url_suffix ? `.${String(item.url_suffix).replace(/^\./, '')}` : '';
    out.push({
      sourceUrl: item.url_key ? `${origin}/${String(item.url_key)}${suffix}` : origin,
      title: item.name ? feedDecode(item.name) : undefined,
      price:
        Number.isFinite(value) && value > 0
          ? currency === 'BGN'
            ? Number((value / BGN_PER_EUR).toFixed(2))
            : value
          : undefined,
      currency: 'EUR',
      imageUrl: item.small_image?.url ? String(item.small_image.url) : undefined,
      via: 'magento',
    });
  }
  return out.length ? out : null;
}

/** Връзки, които изглеждат като категории (магазини без sitemap и без продукти на началната). */
export function extractCategoryLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = feedAbs(m[1], baseUrl);
    if (!href || seen.has(href)) continue;
    if (!/(categor|kategor|katalog|catalog|produkt|product|shop|magazin|store|\/c\/|\/cat\/|\/k\/)/i.test(href)) continue;
    if (/\.(pdf|jpg|jpeg|png|webp|zip|xml)$/i.test(href)) continue;
    if (href === baseUrl) continue;
    seen.add(href);
    out.push(href);
    if (out.length >= 8) break;
  }
  return out;
}

/** Обикаля категориите и събира продуктите от картите в тях. */
export async function collectFromCategories(
  html: string,
  baseUrl: string,
  limit: number,
  opts: FetchOpts
): Promise<RawProduct[]> {
  const categories = extractCategoryLinks(html, baseUrl);
  const products: RawProduct[] = [];
  const seen = new Set<string>();
  for (const category of categories) {
    if (products.length >= limit) break;
    try {
      const res = await politeFetch(category, opts);
      if (!res.ok || !res.text) continue;
      for (const product of extractListingProducts(res.text, res.url)) {
        const key = `${(product.title ?? '').toLowerCase()}|${product.price ?? ''}`;
        if (!product.title || seen.has(key)) continue;
        seen.add(key);
        products.push(product);
        if (products.length >= limit) break;
      }
    } catch {
      // някоя категория може да не отговори — продължаваме
    }
  }
  return products;
}

export async function tryShopify(
  origin: string,
  limit: number,
  opts: FetchOpts
): Promise<RawProduct[] | null> {
  const url = `${origin}/products.json?limit=${Math.min(250, Math.max(1, limit))}`;
  let res: FetchResult;
  try {
    res = await politeFetch(url, { ...opts, accept: 'application/json' });
  } catch {
    return null;
  }
  if (!res.ok || !res.text.trim().startsWith('{')) return null;
  let data: { products?: Array<Record<string, unknown>> };
  try {
    data = JSON.parse(res.text) as typeof data;
  } catch {
    return null;
  }
  if (!Array.isArray(data.products) || data.products.length === 0) return null;

  const out: RawProduct[] = [];
  for (const p of data.products) {
    const handle = String(p.handle ?? '');
    const variants = (p.variants as Array<Record<string, unknown>> | undefined) ?? [];
    const priceRaw = variants[0]?.price;
    const images = (p.images as Array<Record<string, unknown>> | undefined) ?? [];
    out.push({
      sourceUrl: handle ? `${origin}/products/${handle}` : origin,
      title: typeof p.title === 'string' ? p.title : undefined,
      description: typeof p.body_html === 'string' ? htmlToText(p.body_html) : undefined,
      price: parsePrice(String(priceRaw ?? '')),
      currency: 'EUR',
      imageUrl: typeof images[0]?.src === 'string' ? (images[0].src as string) : undefined,
      breadcrumb: typeof p.product_type === 'string' && p.product_type ? String(p.product_type) : undefined,
      brand: typeof p.vendor === 'string' ? p.vendor : undefined,
      availability:
        variants[0]?.available === true ? 'instock' : variants[0]?.available === false ? 'outofstock' : undefined,
      via: 'shopify-json',
    });
    if (out.length >= limit) break;
  }
  return out.length ? out : null;
}

export async function tryWooCommerce(
  origin: string,
  limit: number,
  opts: FetchOpts
): Promise<RawProduct[] | null> {
  const perPage = Math.min(100, Math.max(1, limit));
  const maxPages = Math.min(opts.maxPages ?? 4, Math.ceil(limit / perPage));
  const out: RawProduct[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `${origin}/wp-json/wc/store/v1/products?per_page=${perPage}&page=${page}&orderby=date&order=desc`;
    let res: FetchResult;
    try {
      res = await politeFetch(url, { ...opts, accept: 'application/json' });
    } catch {
      break;
    }
    if (!res.ok || !res.text.trim().startsWith('[')) break;
    let arr: Array<Record<string, unknown>>;
    try {
      arr = JSON.parse(res.text) as typeof arr;
    } catch {
      break;
    }
    if (!Array.isArray(arr) || arr.length === 0) break;

    for (const p of arr) {
      const prices = p.prices as Record<string, unknown> | undefined;
      const minor = Number(prices?.price ?? prices?.regular_price ?? 0);
      const minorUnit = Number(prices?.currency_minor_unit ?? 2);
      const price = minor > 0 ? Number((minor / Math.pow(10, minorUnit)).toFixed(2)) : undefined;
      const images = (p.images as Array<Record<string, unknown>> | undefined) ?? [];
      const cats = (p.categories as Array<Record<string, unknown>> | undefined) ?? [];
      out.push({
        sourceUrl: String(p.permalink ?? origin),
        title: typeof p.name === 'string' ? p.name : undefined,
        description:
          typeof p.short_description === 'string' && p.short_description
            ? htmlToText(p.short_description)
            : typeof p.description === 'string'
              ? htmlToText(p.description)
              : undefined,
        price,
        currency: typeof prices?.currency_code === 'string' ? (prices.currency_code as string) : 'EUR',
        imageUrl: typeof images[0]?.src === 'string' ? (images[0].src as string) : undefined,
        breadcrumb: cats.map((c) => String(c.name)).filter(Boolean).join(' › ') || undefined,
        availability: p.is_in_stock === false ? 'outofstock' : 'instock',
        via: 'woocommerce-store-api',
      });
      if (out.length >= limit) break;
    }
    if (out.length >= limit || arr.length < perPage) break;
  }
  return out.length ? out : null;
}

/** Прави относителен адрес на снимка в абсолютен. */
export function resolveUrl(src: string | undefined, base: string): string | undefined {
  if (!src) return undefined;
  const s = src.trim();
  if (!s || s.startsWith('data:') || s.startsWith('blob:')) return undefined;
  try {
    return new URL(s.startsWith('//') ? `https:${s}` : s, base).toString();
  } catch {
    return undefined;
  }
}

const BAD_IMAGE = /logo|icon|sprite|placeholder|blank|pixel|spacer|loading|\.svg$|flag|payment|badge/i;

/**
 * Обща евристика за снимка — за магазини без OpenGraph.
 *
 * Реалните магазини слагат снимката по три начина: в `src`, лениво в
 * `data-src`/`srcset`, или в контейнер с клас „image/product/gallery“. Затова
 * гледаме и трите и подреждаме кандидатите по вероятност.
 */
export function extractGenericImage(html: string, pageUrl: string): string | undefined {
  const candidates: Array<{ url: string; score: number }> = [];
  const imgRe = /<img\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const attrs = m[1] ?? '';
    const srcset = /srcset=["']([^"']+)["']/i.exec(attrs)?.[1];
    const raw =
      /data-zoom-image=["']([^"']+)["']/i.exec(attrs)?.[1] ??
      /data-large_image=["']([^"']+)["']/i.exec(attrs)?.[1] ??
      /data-original=["']([^"']+)["']/i.exec(attrs)?.[1] ??
      /data-lazy-src=["']([^"']+)["']/i.exec(attrs)?.[1] ??
      /data-src=["']([^"']+)["']/i.exec(attrs)?.[1] ??
      /src=["']([^"']+)["']/i.exec(attrs)?.[1];
    // От srcset взимаме последния (най-големия) вариант.
    const fromSrcset = srcset
      ? srcset
          .split(',')
          .map((p) => p.trim().split(/\s+/)[0])
          .filter(Boolean)
          .pop()
      : undefined;

    const url = resolveUrl(fromSrcset ?? raw, pageUrl);
    if (!url || BAD_IMAGE.test(url)) continue;

    const cls = /class=["']([^"']*)["']/i.exec(attrs)?.[1] ?? '';
    const alt = /alt=["']([^"']*)["']/i.exec(attrs)?.[1] ?? '';
    const width = Number(/width=["']?(\d+)/i.exec(attrs)?.[1] ?? 0);
    let score = 0;
    if (/product|gallery|main|hero|zoom|large|image_container|wp-post-image/i.test(cls)) score += 5;
    if (/product|article|book|item/i.test(alt)) score += 2;
    if (width >= 400) score += 2;
    else if (width >= 200) score += 1;
    // Първото голямо изображение в страницата обикновено е продуктовото.
    candidates.push({ url, score: score - candidates.length * 0.01 });
  }
  if (!candidates.length) return undefined;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!.url;
}

const MONEY_CONTEXT = /(?:class|id|itemprop)=["'][^"']*(?:price|amount|cost|sum|цена)[^"']*["'][^>]*>([\s\S]{0,80}?)</i;

/**
 * Обща евристика за цена — търси както „€12,50“, така и „12,50 €“,
 * като първо гледа елементи с клас/атрибут за цена (там е истинската цена,
 * а не например цена на доставка).
 */
export function extractGenericPrice(html: string): { price?: number; currency?: string } {
  // 1) Елемент, който изглежда като цена (най-надеждно).
  const ctx = MONEY_CONTEXT.exec(html);
  if (ctx) {
    const text = htmlToText(ctx[1] ?? '');
    const first = /(?:£|€|\$|лв\.?|EUR|BGN)?\s*(\d[\d\s.,]*)\s*(?:£|€|\$|лв\.?|EUR|BGN)?/i.exec(text);
    if (first) {
      const price = parsePrice(first[1]);
      if (price) return { price, currency: /£/.test(text) ? 'GBP' : /лв/i.test(text) ? 'BGN' : /€|EUR/i.test(text) ? 'EUR' : undefined };
    }
  }

  // 2) Всяка цена в текста — символът може да е отпред или отзад.
  const text = htmlToText(html).slice(0, 60_000);
  const patterns: Array<[RegExp, string]> = [
    [/(?:€|EUR)\s*(\d[\d\s.,]*)/i, 'EUR'],
    [/(?:лв\.?|BGN)\s*(\d[\d\s.,]*)/i, 'BGN'],
    [/(?:£)\s*(\d[\d\s.,]*)/, 'GBP'],
    [/(?:\$)\s*(\d[\d\s.,]*)/, 'USD'],
    [/(\d[\d\s.,]*)\s*(?:€|EUR)\b/i, 'EUR'],
    [/(\d[\d\s.,]*)\s*(?:лв\.?|BGN)\b/i, 'BGN'],
    [/(\d[\d\s.,]*)\s*(?:£)/, 'GBP'],
  ];
  for (const [re, currency] of patterns) {
    const hit = re.exec(text);
    if (!hit) continue;
    const price = parsePrice(hit[1]);
    if (price && price > 0 && price < 1_000_000) return { price, currency };
  }
  return {};
}

/** Обща евристика за описание — мета описанието е най-често добро. */
export function extractGenericDescription(html: string): string | undefined {
  const meta = extractMeta(html);
  const short = meta.description ?? meta['og:description'];
  if (short && short.length > 40) return short;
  const firstP = /<p\b[^>]*>([\s\S]{80,900}?)<\/p>/i.exec(html);
  return firstP ? htmlToText(firstP[1]!) : undefined;
}

/* ------------------------------------------------------ страница продукт */

export function parseProductPage(html: string, pageUrl: string, selectors: Record<string, string> = {}): RawProduct {
  const jsonld = extractJsonLd(html);
  const product = jsonld.find((j) => j.name);
  const meta = extractMeta(html);
  const micro = selectFirst(html, 'h1') ? extractMicrodata(html) : {};
  const canonical = meta.canonical && /^https?:/i.test(meta.canonical) ? meta.canonical : pageUrl;

  const fromSel = (key: string) => (selectors[key] ? selectFirst(html, selectors[key]!) : undefined);

  const title =
    fromSel('title') ??
    product?.name ??
    meta['og:title'] ??
    selectFirst(html, 'h1') ??
    (meta.title ? htmlToText(meta.title) : undefined) ??
    micro.title;

  const rawDesc =
    fromSel('description') ??
    product?.description ??
    meta['og:description'] ??
    meta.description ??
    extractGenericDescription(html) ??
    micro.title;

  const imageFromSel = resolveUrl(fromSel('image'), pageUrl);
  const image =
    imageFromSel ??
    resolveUrl(firstImage(product?.image), pageUrl) ??
    resolveUrl(meta['og:image:secure_url'] ?? meta['og:image'] ?? meta['twitter:image'], pageUrl) ??
    resolveUrl(micro.imageUrl, pageUrl) ??
    // Последна надежда — първата голяма снимка в страницата (и lazy-load вариантите).
    extractGenericImage(html, pageUrl);

  const offersPrice = fromOffers(product?.offers);
  const priceFromSel = parsePrice(fromSel('price'));
  const priceFromMeta = parsePrice(meta['product:price:amount'] ?? meta['og:price:amount']);
  const priceFromMicro = micro.price;
  let price = priceFromSel ?? offersPrice.price ?? priceFromMeta ?? priceFromMicro;

  let currency = offersPrice.currency ?? meta['product:price:currency'] ?? meta['og:price:currency'];

  // Класове, които почти винаги носят истинската цена (WooCommerce, Shopify теми,
  // стари магазини). Редът е от най-специфичния към най-общия.
  if (price === undefined) {
    for (const sel of ['.price_color', '.product-price', '.woocommerce-Price-amount', '.price', '[class*=price]@text']) {
      const p = parsePrice(selectFirst(html, sel));
      if (p) {
        price = p;
        break;
      }
    }
  }
  if (price === undefined) {
    const generic = extractGenericPrice(html);
    price = generic.price;
    currency = currency ?? generic.currency;
  }
  if (price === undefined) {
    // Последна надежда: цена в текста до валутен знак.
    const text = htmlToText(html).slice(0, 40_000);
    const m = /(\d[\d\s.,]*)\s*(€|лв\.?|EUR|BGN|£|\$)/i.exec(text);
    if (m) {
      price = parsePrice(m[1]);
      currency = m[2];
    }
  }

  const breadcrumbFromSel = fromSel('breadcrumb');
  const breadcrumbFromLd = jsonld.find((j) => j.breadcrumb)?.breadcrumb;

  const via = fromSel('title')
    ? 'selectors'
    : product?.name
      ? 'jsonld'
      : meta['og:title']
        ? 'opengraph'
        : micro.title
          ? 'microdata'
          : 'heuristics';

  return {
    sourceUrl: canonical,
    title: title ? htmlToText(title).slice(0, 200) : undefined,
    description: rawDesc ? htmlToText(rawDesc).slice(0, 3000) : undefined,
    price,
    currency,
    imageUrl: image && /^https?:/i.test(image) ? image : undefined,
    breadcrumb: breadcrumbFromSel ?? breadcrumbFromLd ?? product?.category ?? undefined,
    brand: undefined,
    via,
  };
}

/* ======================================================= AI обогатяване */

export interface EnrichedItem {
  index: number;
  category?: string;
  title?: string;
  description?: string;
  unitQuantity?: number;
  unitType?: string;
  tags?: string[];
  /** Ако продуктът не е за приложението (услуга, липсва цена…). */
  skip?: boolean;
  skipReason?: string;
}

const AI_SYSTEM = `Ти подготвяш продукти от онлайн магазин за българското приложение SmartPrice.

За ВСЕКИ продукт връщаш:
• category — точно една от: restaurants | hotels_airbnb | supermarket | cafes_bars | services_tech | other
  (магазин/продукти за вкъщи = supermarket; кафе/бар/сладкарница = cafes_bars; хотел/Airbnb = hotels_airbnb;
   ресторант/доставка на храна = restaurants; услуги, техника, авто = services_tech; всичко друго = other)
• title — кратко и ясно заглавие на БЪЛГАРСКИ (до 90 знака). Ако оригиналното е на друг език — преведи го.
  Махай маркетингови глупости („ТОП ЦЕНА!!!“), запази марката, модела, грамажа, разфасовката.
• description — 2–3 изречения на БЪЛГАРСКИ, спокойно и честно. Само факти от подаденото: какво е продуктът,
  за какво служи, какво съдържа. НЕ измисляй числа, отзиви, „най-евтиното“, „гаранция“. Ако не знаеш — не пишеш.
• unitQuantity + unitType — само ако от заглавието/описанието ясно личи грамаж/обем/брой. Типове: g | kg | ml | l | pcs.
  Примери: „Кафе 1 кг“ → 1 + kg; „Вода 500 мл“ → 500 + ml; „Яйца 10 бр“ → 10 + pcs. Ако не личи — не връщай полетата.
• tags — до 3 кратки етикета на български без „#“ (напр. „кафе“, „промоция“, „кухня“).
• skip + skipReason — true САМО ако не е реален продукт (услуга без цена, липсва цена, страница за контакти, блог).

Желязно правило: не измисляй. По-добре по-малко, но вярно.

Отговаряй САМО с валиден JSON, точно:
{"items":[{"index":0,"category":"supermarket","title":"…","description":"…","unitQuantity":1,"unitType":"kg","tags":["…"],"skip":false,"skipReason":null}]}
Полета, които не важат, може да липсват. Броят и редът на items трябва да съвпада с подадените.`;

export async function enrichWithAi(
  items: Array<{ title?: string; description?: string; price?: number; breadcrumb?: string; sourceUrl: string }>,
  shopLabel: string
): Promise<EnrichedItem[]> {
  if (!features.assistant || items.length === 0) return [];

  const payload = items.map((it, index) => ({
    index,
    originalTitle: (it.title ?? '').slice(0, 200),
    originalDescription: (it.description ?? '').slice(0, 600),
    breadcrumb: it.breadcrumb ?? null,
    price: it.price ?? null,
    shop: shopLabel,
  }));

  try {
    const res = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.ASSISTANT_MODEL,
        effort: 'low',
        max_tokens: 4000,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: AI_SYSTEM },
          { role: 'user', content: JSON.stringify({ items: payload }) },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()) as {
      items?: EnrichedItem[];
    };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

/* ======================================================= внасяне в базата */

const CATEGORY_FROM_TEXT: Array<[RegExp, (typeof SCRAPE_CATEGORIES)[number]]> = [
  [/кафе|бар|сладкар|десерт|кафен|чай|напитк/i, 'cafes_bars'],
  [/хотел|нощувк|airbnb|апартамент|стая|booking/i, 'hotels_airbnb'],
  [/ресторант|пицер|меню|обяд|доставка на храна|бургер|суши/i, 'restaurants'],
  [/магазин|продукт|храна|мляко|сирене|месо|олио|брашно|захар|вода|сок|био|плод|зеленчук|кафе на зърна/i, 'supermarket'],
  [/техник|телефон|лаптоп|авто|сервиз|ремонт|майстор|инструмент|почистващ|козметик/i, 'services_tech'],
];

export function guessCategory(blob: string): (typeof SCRAPE_CATEGORIES)[number] {
  for (const [re, cat] of CATEGORY_FROM_TEXT) if (re.test(blob)) return cat;
  return 'other';
}

export async function officialProfileId(): Promise<string> {
  const existing = await one<{ id: string }>(
    `select id from profiles where is_official order by created_at asc limit 1`
  );
  if (existing) return existing.id;
  const row = await one<{ id: string }>(
    `insert into profiles (email, password_hash, name, handle, bio, city,
                           reputation_points, is_official, email_verified_at)
     values ('redakcia@smartprice.bg', 'x', 'SmartPrice Редакция', 'smartprice_bg',
             'Не сме потребител — казваме го честно. Внасяме реални цени от магазини и касови бонове.',
             'София', 50, true, now())
     returning id`
  );
  return row!.id;
}

function safeStoredName(contentType: string): string {
  const ext = /png/i.test(contentType)
    ? 'png'
    : /webp/i.test(contentType)
      ? 'webp'
      : /gif/i.test(contentType)
        ? 'gif'
        : 'jpg';
  return `${randomUUID()}.${ext}`;
}

/** Сваля снимката при нас, за да не зависим от чуждия сайт. */
export async function downloadImage(
  imageUrl: string,
  maxMb: number,
  opts: FetchOpts
): Promise<string | null> {
  try {
    const u = new URL(imageUrl);
    if (!opts.allowPrivate && isPrivateHost(u.hostname)) return null;
    const res = await fetch(u.toString(), {
      headers: { 'User-Agent': UA, Accept: 'image/*' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!/^image\//i.test(contentType)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > maxMb * 1024 * 1024) return null;
    const name = safeStoredName(contentType);
    await putImage(name, buf, contentType);
    return publicUrl(name);
  } catch {
    return null;
  }
}

export interface ImportResult {
  postId?: string;
  skipped?: string;
}

/** Внася един продукт като оферта под профила „Редакция“. */
export async function importProduct(params: {
  jobId: string;
  itemId: string;
  title: string;
  description: string;
  price: number;
  referencePrice: number | null;
  category: string;
  polarity: 'green' | 'red';
  city: string;
  placeName: string;
  imageUrl: string;
  unitQuantity: number | null;
  unitType: string | null;
  tags: string[];
  sourceUrl: string;
  domain: string;
}): Promise<ImportResult> {
  const authorId = await officialProfileId();
  const perUnit =
    params.unitQuantity && params.unitType
      ? Number(
          (
            (params.price / params.unitQuantity) *
            (params.unitType === 'kg' || params.unitType === 'l' ? 1000 : 1)
          ).toFixed(4)
        )
      : null;

  return tx(async (client) => {
    const res = await client.query<{ id: string }>(
      `insert into posts (
         author_id, polarity, category, platform_tag, title, description,
         place_name, city, price_paid, reference_price, currency,
         unit_quantity, unit_type, price_per_unit, image_url, tags,
         seller_type, source, source_note
       ) values (
         $1,$2,$3,'Онлайн магазин',$4,$5,$6,$7,$8,$9,'EUR',$10,$11,$12,$13,$14,
         'business','scraper',$15
       ) returning id`,
      [
        authorId,
        params.polarity,
        params.category,
        params.title.slice(0, 200),
        params.description.slice(0, 4000),
        params.placeName.slice(0, 200),
        params.city.slice(0, 80),
        params.price,
        params.referencePrice,
        params.unitQuantity,
        params.unitType,
        perUnit,
        params.imageUrl,
        params.tags.slice(0, 8),
        `Онлайн магазин ${params.domain}: ${params.sourceUrl}`.slice(0, 300),
      ]
    );
    const postId = res.rows[0]!.id;
    await client.query(
      `insert into price_history (post_id, price, status, reported_by) values ($1,$2,'initial',$3)`,
      [postId, params.price, authorId]
    );
    return { postId };
  });
}

/** Има ли вече внесен същият продукт (по адрес на източника или по заглавие). */
export async function alreadyImported(params: {
  sourceUrl: string;
  title: string;
  dedupe: 'url' | 'title' | 'off';
}): Promise<boolean> {
  if (params.dedupe === 'off') return false;
  if (params.dedupe === 'url') {
    const row = await one<{ n: number }>(
      `select count(*)::int as n from posts
        where source = 'scraper' and source_note like '%' || $1 || '%'`,
      [params.sourceUrl]
    );
    if (Number(row?.n ?? 0) > 0) return true;
  }
  const row2 = await one<{ n: number }>(
    `select count(*)::int as n from posts
      where source = 'scraper' and lower(btrim(title)) = lower(btrim($1))`,
    [params.title]
  );
  return Number(row2?.n ?? 0) > 0;
}

/** Търси по-скъпа/по-евтина цена на подобен продукт — за честно сравнение. */
export async function findComparablePrice(
  title: string,
  price: number
): Promise<{ reference: number | null; polarity: 'green' | 'red' }> {
  const key = title
    .toLowerCase()
    .replace(/[^a-zа-я0-9 ]+/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 3)
    .join(' ');
  if (!key) return { reference: null, polarity: 'green' };

  const row = await one<{ avg: string | null; n: number }>(
    `select round(avg(price_paid))::text as avg, count(*)::int as n
       from posts
      where status = 'published'
        and source <> 'scraper'
        and lower(title) like '%' || $1 || '%'
        and created_at > now() - interval '180 days'`,
    [key.split(' ')[0] ?? key]
  );
  const n = Number(row?.n ?? 0);
  if (n === 0 || !row?.avg) return { reference: null, polarity: 'green' };
  const ref = Number(row.avg);
  if (!Number.isFinite(ref) || ref <= 0) return { reference: null, polarity: 'green' };
  if (price <= ref * 0.92) return { reference: ref, polarity: 'green' };
  if (price >= ref * 1.15) return { reference: ref, polarity: 'red' };
  return { reference: null, polarity: 'green' };
}

/* ================================================== разписания (дневна квота) */

/**
 * Разписанието решава един реален проблем: ако дръпнем 200 продукта наведнъж,
 * сайтът ни вижда 200 заявки за две минути и ни блокира. Затова квотата за
 * денонощието (напр. 20 продукта) се разпределя на малки пускания (по 3–6)
 * през активните часове, на СЛУЧАЕН интервал — изглежда като обикновен трафик.
 */
export interface ScheduleRow {
  id: string;
  domain: string;
  url: string;
  label: string | null;
  enabled: boolean;
  daily_quota: number;
  burst_min: number;
  burst_max: number;
  hour_from: number;
  hour_to: number;
  min_gap_min: number;
  mode: string;
  options: Record<string, unknown> | null;
  day_key: string | null;
  used_today: number;
  runs_today: number;
  total_imported: number;
  total_crawled: number;
  total_jobs: number;
  last_run_at: string | null;
  next_run_at: string | null;
}

/** Час и дата в българско време (смята и лятното време само). */
export function sofiaParts(now = new Date()): { hour: number; minute: number; dateKey: string } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sofia',
    hour: '2-digit',
    minute: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    hour: Number(parts.hour ?? 0),
    minute: Number(parts.minute ?? 0),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function rand(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.random() * (max - min);
}

/**
 * Кога да е следващото пускане.
 *
 * Логиката: колкото по-малко остават за днес, толкова по-нарядко пускаме, така
 * че квотата да стигне до края на прозореца — и винаги със случаен разбърк.
 */
export function planNextRun(s: ScheduleRow, now = new Date()): Date {
  const { hour, minute } = sofiaParts(now);
  const nowMin = hour * 60 + minute;
  const fromMin = s.hour_from * 60;
  const toMin = (s.hour_to >= 24 ? 24 * 60 : s.hour_to * 60);
  const gap = Math.max(0, s.min_gap_min);
  const wraps = fromMin > toMin;
  const inWindow = wraps ? nowMin >= fromMin || nowMin < toMin : nowMin >= fromMin && nowMin < toMin;

  const remaining = Math.max(0, s.daily_quota - s.used_today);
  const avgBurst = Math.max(1, (s.burst_min + s.burst_max) / 2);

  if (!inWindow || remaining <= 0) {
    // Извън активните часове (или квотата е изчерпана) — чакаме следващия прозорец.
    const untilStart = nowMin < fromMin ? fromMin - nowMin : 24 * 60 - nowMin + fromMin;
    return new Date(now.getTime() + Math.round(untilStart + rand(0, 25)) * 60_000);
  }

  const runsLeft = Math.max(1, Math.ceil(remaining / avgBurst));
  const minutesLeft = Math.max(8, toMin - nowMin);
  const slot = Math.max(gap, Math.floor(minutesLeft / runsLeft));
  const wait = Math.max(gap, rand(Math.min(gap, slot * 0.4), slot));
  return new Date(now.getTime() + Math.round(wait) * 60_000);
}

/** Нулира дневните броячи и пуска закъснелите разписания. Връща колко задачи е създала. */
export async function tickSchedules(): Promise<number> {
  const { dateKey } = sofiaParts();

  await query(
    `update scrape_schedules
        set used_today = 0, runs_today = 0, day_key = $1, updated_at = now()
      where day_key is distinct from $1 and enabled`,
    [dateKey]
  );

  const due = await many<ScheduleRow>(
    `select * from scrape_schedules
      where enabled and daily_quota > 0
        and (next_run_at is null or next_run_at <= now())
      order by next_run_at asc nulls first
      limit 5`
  );

  let created = 0;
  for (const s of due) {
    const remaining = Math.max(0, s.daily_quota - s.used_today);
    if (remaining <= 0) {
      await query(`update scrape_schedules set next_run_at = $2, updated_at = now() where id = $1`, [
        s.id,
        planNextRun(s),
      ]);
      continue;
    }

    const burst = Math.max(1, Math.min(remaining, Math.round(rand(s.burst_min, s.burst_max))));
    const options = { ...(s.options ?? {}), count: burst, mode: s.mode === 'import' ? 'import' : 'preview' };

    const job = await one<{ id: string }>(
      `insert into scrape_jobs (url, domain, mode, options, target_count, status, schedule_id, source_kind)
       values ($1,$2,$3,$4::jsonb,$5,'queued',$6,'schedule') returning id::text`,
      [s.url, s.domain, options.mode, JSON.stringify(options), burst, s.id]
    );

    await query(
      `update scrape_schedules
          set runs_today = runs_today + 1, total_jobs = total_jobs + 1,
              last_run_at = now(), next_run_at = $2, updated_at = now()
        where id = $1`,
      [s.id, planNextRun(s)]
    );

    if (job) created++;
  }
  return created;
}

/** Обновява статистиката на разписанието след като задачата му приключи. */
async function updateScheduleAfterJob(scheduleId: string, jobId: string): Promise<void> {
  const j = await one<{ imported: number; parsed: number; pages_visited: number }>(
    `select imported, parsed, pages_visited from scrape_jobs where id = $1`,
    [jobId]
  );
  if (!j) return;
  // Квотата се харчи и когато сме само в преглед — продуктите пак са взети от сайта.
  const taken = Number(j.imported || 0) > 0 ? Number(j.imported) : Number(j.parsed || 0);
  await query(
    `update scrape_schedules
        set used_today = used_today + $2,
            total_imported = total_imported + $3,
            total_crawled = total_crawled + $4,
            updated_at = now()
      where id = $1`,
    [scheduleId, taken, Number(j.imported || 0), Number(j.pages_visited || 0)]
  );
}

/** Пълна статистика за един сайт: по дни, по задачи и общо. */
export async function scheduleStats(domain: string): Promise<{
  totals: Record<string, unknown>;
  perDay: Array<Record<string, unknown>>;
  schedules: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
}> {
  const [totals, perDay, schedules, runs] = await Promise.all([
    one<Record<string, unknown>>(
      `select count(*)::int as jobs,
              coalesce(sum(imported),0)::int as imported,
              coalesce(sum(parsed),0)::int as parsed,
              coalesce(sum(pages_visited),0)::int as crawled,
              coalesce(sum(skipped),0)::int as skipped,
              coalesce(sum(failed),0)::int as failed,
              min(created_at)::text as first_run,
              max(created_at)::text as last_run
         from scrape_jobs where domain = $1`,
      [domain]
    ),
    many<Record<string, unknown>>(
      `select to_char(created_at at time zone 'Europe/Sofia', 'YYYY-MM-DD') as day,
              count(*)::int as jobs,
              coalesce(sum(imported),0)::int as imported,
              coalesce(sum(parsed),0)::int as parsed,
              coalesce(sum(pages_visited),0)::int as crawled
         from scrape_jobs
        where domain = $1 and created_at > now() - interval '30 days'
        group by 1 order by 1 desc limit 30`,
      [domain]
    ),
    many<Record<string, unknown>>(
      `select id::text, label, url, enabled, daily_quota, burst_min, burst_max, hour_from, hour_to,
              min_gap_min, mode, used_today, runs_today, total_imported, total_crawled, total_jobs,
              last_run_at::text, next_run_at::text
         from scrape_schedules where domain = $1 order by created_at asc`,
      [domain]
    ),
    many<Record<string, unknown>>(
      `select id::text, status, mode, source_kind, target_count, discovered, parsed, imported,
              skipped, failed, pages_visited, strategy, created_at::text, finished_at::text
         from scrape_jobs where domain = $1 order by created_at desc limit 25`,
      [domain]
    ),
  ]);
  return { totals: totals ?? {}, perDay, schedules, runs };
}

/** Плащане наведнъж (бутон „Пусни сега“). */
export async function runScheduleNow(scheduleId: string, force = false): Promise<string | null> {
  const s = await one<ScheduleRow>(`select * from scrape_schedules where id = $1`, [scheduleId]);
  if (!s) return null;
  const remaining = Math.max(0, s.daily_quota - s.used_today);
  if (!force && remaining <= 0) return null;
  const burst = force
    ? Math.max(1, Math.min(s.burst_max, s.daily_quota))
    : Math.max(1, Math.min(remaining, Math.round(rand(s.burst_min, s.burst_max))));
  const options = { ...(s.options ?? {}), count: burst, mode: s.mode === 'import' ? 'import' : 'preview' };
  const job = await one<{ id: string }>(
    `insert into scrape_jobs (url, domain, mode, options, target_count, status, schedule_id, source_kind)
     values ($1,$2,$3,$4::jsonb,$5,'queued',$6,'schedule') returning id::text`,
    [s.url, s.domain, options.mode, JSON.stringify(options), burst, scheduleId]
  );
  await query(
    `update scrape_schedules
        set runs_today = runs_today + 1, total_jobs = total_jobs + 1,
            last_run_at = now(), next_run_at = $2, updated_at = now()
      where id = $1`,
    [scheduleId, planNextRun({ ...s, used_today: s.used_today + burst })]
  );
  return job?.id ?? null;
}

/* ========================================================== задачи (worker) */

export interface JobRow {
  id: string;
  url: string;
  domain: string;
  status: string;
  mode: string;
  options: ScrapeOptions;
  target_count: number;
  schedule_id: string | null;
}

function mergeOptions(raw: Partial<ScrapeOptions> | null | undefined, saved?: Partial<ScrapeOptions>): Required<ScrapeOptions> {
  const merged = { ...DEFAULTS, ...(saved ?? {}), ...(raw ?? {}) } as Required<ScrapeOptions>;
  merged.count = Math.max(1, Math.min(2000, Number(merged.count) || DEFAULTS.count));
  merged.delayMs = Math.max(0, Math.min(5000, Number(merged.delayMs) ?? DEFAULTS.delayMs));
  merged.maxPages = Math.max(1, Math.min(60, Number(merged.maxPages) ?? DEFAULTS.maxPages));
  merged.maxImageMb = Math.max(1, Math.min(25, Number(merged.maxImageMb) ?? DEFAULTS.maxImageMb));
  merged.city = (merged.city ?? '').trim() || 'Онлайн';
  merged.mode = merged.mode === 'import' ? 'import' : 'preview';
  return merged;
}

export async function optionsForSite(domain: string, raw: Partial<ScrapeOptions> | null | undefined): Promise<Required<ScrapeOptions>> {
  const site = await one<{ selectors: Record<string, string> | null; defaults: Record<string, unknown> | null }>(
    `select selectors, defaults from scrape_sites where domain = $1`,
    [domain]
  );
  const saved = (site?.defaults ?? {}) as Partial<ScrapeOptions>;
  const merged = mergeOptions(raw, saved);
  if (!merged.selectors && site?.selectors && Object.keys(site.selectors).length) merged.selectors = site.selectors;
  return merged;
}

async function logLine(jobId: string, message: string) {
  await query(
    `update scrape_jobs
        set log = (case when jsonb_array_length(log) > 200 then log - 0 else log end) || to_jsonb($2::text),
            heartbeat_at = now()
      where id = $1`,
    [jobId, `${new Date().toISOString().slice(11, 19)} ${message}`]
  );
}

async function bump(jobId: string, field: 'discovered' | 'parsed' | 'imported' | 'skipped' | 'failed', by = 1) {
  await query(`update scrape_jobs set ${field} = ${field} + $2, heartbeat_at = now() where id = $1`, [jobId, by]);
}

/** Записва колко страници са отворени досега (за панела: „обходен ли е сайтът“). */
async function syncVisited(jobId: string) {
  const n = visitedCount(jobId);
  if (n > 0) {
    await query(`update scrape_jobs set pages_visited = $2, heartbeat_at = now() where id = $1`, [jobId, n]);
  }
}

async function setStatus(jobId: string, status: string, extra: Record<string, unknown> = {}) {
  const sets = ['status = $2', 'heartbeat_at = now()'];
  const values: unknown[] = [jobId, status];
  for (const [k, v] of Object.entries(extra)) {
    values.push(v);
    sets.push(`${k} = $${values.length}`);
  }
  await query(`update scrape_jobs set ${sets.join(', ')} where id = $1`, values);
}

async function isCancelled(jobId: string): Promise<boolean> {
  const row = await one<{ status: string }>(`select status from scrape_jobs where id = $1`, [jobId]);
  return !row || row.status === 'cancelled';
}

/**
 * Изпълнява една задача от начало до край.
 *
 * Стъпки: откриване → четене → (AI) → внасяне. Спира моментално при „Спри“.
 */
export async function runJob(jobId: string): Promise<void> {
  const job = await one<JobRow>(
    `select id, url, domain, status, mode, options, target_count, schedule_id from scrape_jobs where id = $1`,
    [jobId]
  );
  if (!job) return;

  const o = await optionsForSite(job.domain, job.options);
  const limit = Math.min(o.count, job.target_count || o.count);
  const origin = new URL(job.url).origin;
  const shopLabel = job.domain.replace(/^www\./, '');
  // Общите настройки за заявките + jobId, за да отчитаме обходените страници.
  const fo: FetchOpts = {
    delayMs: o.delayMs,
    respectRobots: o.respectRobots,
    allowPrivate: o.allowPrivate,
    maxPages: o.maxPages,
    jobId: job.id,
  };

  try {
    await setStatus(jobId, 'discovering', { started_at: new Date(), error: null });
    await logLine(jobId, `Стартирам: ${job.url} · искам до ${limit} продукта`);

    /* ---------------------------------------------- 1) откриване на продукти */
    let products: RawProduct[] = [];
    let strategy = '';

    const shopify = await tryShopify(origin, limit, fo);
    if (shopify) {
      products = shopify;
      strategy = 'shopify';
      await logLine(jobId, `Магазинът работи с Shopify — взех ${products.length} продукта от неговия каталог.`);
    }
    if (!products.length) {
      const woo = await tryWooCommerce(origin, limit, fo);
      if (woo) {
        products = woo;
        strategy = 'woocommerce';
        await logLine(jobId, `WooCommerce Store API — взех ${products.length} продукта.`);
      }
    }

    // Магазинни XML фийдове (Google Merchant / RSS) — работят на всяка платформа.
    if (!products.length) {
      const feed = await tryProductFeed(origin, limit, fo);
      if (feed) {
        products = feed;
        strategy = 'feed';
        await logLine(jobId, `Магазинният фийд (Google/RSS) даде ${products.length} продукта.`);
      }
    }

    // Magento / Adobe Commerce — чете продуктите през GraphQL, без ключ.
    if (!products.length) {
      const magento = await tryMagento(origin, limit, fo);
      if (magento) {
        products = magento;
        strategy = 'magento';
        await logLine(jobId, `Magento/Adobe — взех ${products.length} продукта през GraphQL.`);
      }
    }

    if (!products.length) {
      await setStatus(jobId, 'parsing');
      let urls: string[] = [];
      const isProductish = /\/(product|produkt|p|item|tovar|art)\//i.test(new URL(job.url).pathname);

      if (!isProductish) {
        const sm = await collectFromSitemap(job.url, limit, fo);
        if (sm.urls.length) {
          urls = sm.urls;
          strategy = 'sitemap';
          await logLine(jobId, `Sitemap: намерих ${sm.urls.length} продуктови адреса.`);
        } else {
          await logLine(jobId, 'Няма sitemap — гледам листинга.');
          const home = await politeFetch(job.url, fo);
          // Първо най-бързото: продуктите, изброени в самия листинг. За
          // PrestaShop и повечето магазини това стига — една заявка вместо 30.
          const cards = extractListingProducts(home.text, home.url);
          if (cards.length >= 2) {
            products = cards.slice(0, limit);
            strategy = 'listing-cards';
            await logLine(
              jobId,
              `Листингът съдържа ${cards.length} продукта в картите — взимам ги направо, без да отварям всяка страница.`
            );
          } else {
            // Много магазини нямат sitemap, а началната им страница е само меню.
            // Тогава продуктите са в категориите — обикаляме ги и ги взимаме оттам.
            const fromCats = await collectFromCategories(home.text, home.url, limit, fo);
            if (fromCats.length >= 2) {
              products = fromCats;
              strategy = 'categories';
              await logLine(
                jobId,
                `Началната е само меню — обиколих категориите и взех ${fromCats.length} продукта.`
              );
            } else {
              urls = extractProductLinks(home.text, home.url, o.selectors?.list);
              strategy = 'listing';
              await logLine(jobId, `Листингът даде ${urls.length} връзки към продукти.`);
            }
          }
        }
      } else {
        urls = [job.url];
        strategy = 'single';
        await logLine(jobId, 'Това е страница на конкретен продукт.');
      }

      if (!products.length && !urls.length) {
        await syncVisited(jobId);
        await setStatus(jobId, 'failed', {
          error:
            `Не намерих продукти в ${job.domain}. Пробвах: Shopify каталог, WooCommerce, магазинни ` +
            `фийдове (Google/RSS), Magento GraphQL, sitemap (вкл. от robots.txt), категории, връзки в ` +
            `листинга и карти в листинга. Най-честата причина: сайтът е с JavaScript ` +
            `(съдържанието идва чак след зареждане), или е нестандартен. Тогава дай ръчни селектори ` +
            `(list: a.product@href, price: .price@text, image: img@src).`,
          finished_at: new Date(),
        });
        await logLine(jobId, 'Спирам: няма намерени продукти.');
        return;
      }

      await query(`update scrape_jobs set discovered = $2 where id = $1`, [
        jobId,
        Math.max(urls.length, products.length),
      ]);

      // Ако картите в листинга вече ни дадоха продуктите, не отваряме нищо друго.
      if (!products.length) {
      const maxRead = Math.min(urls.length, limit * 2, o.maxPages * 60);
      for (const url of urls.slice(0, maxRead)) {
        if (await isCancelled(jobId)) {
          await logLine(jobId, 'Спряно от потребителя.');
          return;
        }
        if (products.length >= limit) break;

        let parsed: RawProduct | null = null;
        try {
          const res = await politeFetch(url, fo);
          if (res.ok && res.text) parsed = parseProductPage(res.text, res.url, o.selectors ?? {});
          if (!strategy) strategy = parsed?.via ?? 'heuristics';
        } catch (err) {
          await bump(jobId, 'failed');
          await logLine(jobId, `Пропуснах ${url}: ${(err as Error).message.slice(0, 120)}`);
          await syncVisited(jobId);
          continue;
        }
        if (!parsed) continue;
        products.push(parsed);
        await bump(jobId, 'parsed');
        await syncVisited(jobId);
      }
      } // край на „ако картите от листинга не са ни дали продуктите“
    } else {
      await query(`update scrape_jobs set discovered = $2, parsed = $2 where id = $1`, [jobId, products.length]);
      await setStatus(jobId, 'parsing');
    }

    if (!products.length) {
      await setStatus(jobId, 'failed', { error: 'Нищо не успях да прочета.', finished_at: new Date() });
      return;
    }
    await query(`update scrape_jobs set strategy = $2 where id = $1`, [jobId, strategy || 'heuristics']);
    await syncVisited(jobId);
    await logLine(
      jobId,
      `Прочетох ${products.length} продукта (стратегия: ${strategy || products[0]?.via}). Обходени страници: ${visitedCount(jobId)}.`
    );

    /* --------------------------------------------------- 2) AI обогатяване */
    let enriched: EnrichedItem[] = [];
    if (o.useAi && features.assistant) {
      await setStatus(jobId, 'enriching');
      // AI-ят понякога връща невалиден JSON за голяма група (отговорът се
      // отрязва). Затова: малки групи + при провал групата се разделя на две,
      // вместо целият пакет да се загуби тихо.
      const batches: Array<{ items: RawProduct[]; offset: number }> = [];
      for (let i = 0; i < products.length; i += 6) batches.push({ items: products.slice(i, i + 6), offset: i });

      let doneCount = 0;
      let calls = 0;
      while (batches.length && calls < 120) {
        if (await isCancelled(jobId)) {
          await logLine(jobId, 'Спряно от потребителя.');
          return;
        }
        const batch = batches.shift()!;
        calls++;
        const res = await enrichWithAi(
          batch.items.map((p) => ({
            title: p.title,
            description: p.description,
            price: p.price,
            breadcrumb: p.breadcrumb,
            sourceUrl: p.sourceUrl,
          })),
          shopLabel
        );

        if (!res.length) {
          if (batch.items.length > 1) {
            const half = Math.ceil(batch.items.length / 2);
            batches.unshift({ items: batch.items.slice(half), offset: batch.offset + half });
            batches.unshift({ items: batch.items.slice(0, half), offset: batch.offset });
            await logLine(jobId, `AI не успя за ${batch.items.length} продукта — разделям ги на по-малки групи.`);
          } else {
            await logLine(jobId, 'AI не успя за един продукт — минавам без него.');
          }
          continue;
        }

        for (const r of res) {
          r.index = batch.offset + Number(r.index ?? 0);
          enriched.push(r);
        }
        doneCount += batch.items.length;
        await logLine(jobId, `AI: готови ${Math.min(products.length, doneCount)}/${products.length}`);
      }
      const missing = products.length - enriched.length;
      await logLine(
        jobId,
        `AI обработи ${enriched.length} продукта.${missing > 0 ? ` Без AI (ползвам каквото е на сайта): ${missing}.` : ''}`
      );
    } else if (o.useAi) {
      await logLine(jobId, 'AI е изключен на сървъра (няма ключ) — минавам без него.');
    }

    const aiByIndex = new Map<number, EnrichedItem>();
    for (const e of enriched) aiByIndex.set(Number(e.index), e);

    /* ------------------------------------------------------- 3) записване */
    await setStatus(jobId, o.mode === 'import' ? 'importing' : 'parsing');
    let stored = 0;
    // Един и същ продукт в два варианта (цвят/размер) не бива да влиза два пъти:
    // за приложението това е един продукт с една цена.
    const seenNames = new Set<string>();

    for (let i = 0; i < products.length; i++) {
      if (await isCancelled(jobId)) {
        await logLine(jobId, 'Спряно от потребителя.');
        return;
      }
      const p = products[i]!;
      const ai = aiByIndex.get(i);

      if (ai?.skip) {
        await insertItem(jobId, p, ai, null, 'skipped', ai.skipReason ?? 'AI прецени, че не е продукт за приложението');
        await bump(jobId, 'skipped');
        continue;
      }
      if (!p.title || p.title.length < 3) {
        await insertItem(jobId, p, ai, null, 'skipped', 'Няма заглавие');
        await bump(jobId, 'skipped');
        continue;
      }
      if (!p.price) {
        await insertItem(jobId, p, ai, null, 'skipped', 'Няма цена на страницата');
        await bump(jobId, 'skipped');
        continue;
      }
      if (o.minPrice && p.price < o.minPrice) {
        await insertItem(jobId, p, ai, null, 'skipped', `Цената е под долната граница (${o.minPrice} €)`);
        await bump(jobId, 'skipped');
        continue;
      }
      if (o.maxPrice && p.price > o.maxPrice) {
        await insertItem(jobId, p, ai, null, 'skipped', `Цената е над горната граница (${o.maxPrice} €)`);
        await bump(jobId, 'skipped');
        continue;
      }
      if (o.skipWithoutImage && !p.imageUrl) {
        await insertItem(jobId, p, ai, null, 'skipped', 'Няма снимка');
        await bump(jobId, 'skipped');
        continue;
      }

      const title = (ai?.title ?? p.title).slice(0, 200);
      if (await alreadyImported({ sourceUrl: p.sourceUrl, title, dedupe: o.dedupe })) {
        await insertItem(jobId, p, ai, null, 'skipped', 'Вече го има в системата');
        await bump(jobId, 'skipped');
        continue;
      }

      const blob = `${title} ${p.breadcrumb ?? ''} ${p.description ?? ''}`;
      const cat =
        o.categoryMode === 'fixed' && o.fixedCategory && (SCRAPE_CATEGORIES as readonly string[]).includes(o.fixedCategory)
          ? o.fixedCategory
          : o.categoryMode === 'ai' && ai?.category && (SCRAPE_CATEGORIES as readonly string[]).includes(ai.category)
            ? ai.category
            : guessCategory(blob);

      const { priceEur } = normalizeCurrency(p.price, p.currency, `${title} ${p.breadcrumb ?? ''}`);

      const nameKey = `${title.toLowerCase().replace(/\s+/g, ' ').trim()}|${priceEur}`;
      if (seenNames.has(nameKey)) {
        await insertItem(jobId, p, ai, null, 'skipped', 'Същият продукт вече е в списъка (друг вариант)');
        await bump(jobId, 'skipped');
        continue;
      }
      seenNames.add(nameKey);
      const unitFromAi =
        ai?.unitQuantity && ai?.unitType ? { quantity: ai.unitQuantity, unit: ai.unitType as 'g' | 'kg' | 'ml' | 'l' | 'pcs' } : undefined;
      const unit = unitFromAi ?? parseUnit(`${title} ${p.breadcrumb ?? ''}`);
      const unitType = unit.unit && ['g', 'kg', 'ml', 'l', 'pcs'].includes(unit.unit) ? unit.unit : null;

      let polarity: 'green' | 'red' = 'green';
      let reference: number | null = null;
      if (o.polarityMode === 'trap') {
        polarity = 'red';
      } else if (o.polarityMode === 'compare') {
        const cmp = await findComparablePrice(title, priceEur);
        polarity = cmp.polarity;
        reference = cmp.reference;
      }

      const tags = [
        ...(o.addShopTag ? [shopLabel] : []),
        ...(ai?.tags ?? []).slice(0, 3),
        polarity === 'green' ? '#ТопНаходка' : '#ЧервенФлаг',
      ]
        .map((t) => (t.startsWith('#') ? t : `#${t.replace(/\s+/g, '')}`))
        .slice(0, 8);

      const description =
        (ai?.description ??
          (p.description ? p.description.slice(0, 1200) : `${title} — цена от онлайн магазин ${shopLabel}.`)).slice(
          0,
          4000
        );

      if (o.mode === 'preview') {
        await insertItem(jobId, p, ai, {
          title,
          description,
          priceEur,
          category: cat,
          unitQuantity: unit.quantity ?? null,
          unitType,
          polarity,
          reference,
          tags,
        }, 'parsed', null);
        stored++;
        continue;
      }

      let imageUrl: string | null = p.imageUrl ?? null;
      if (o.downloadImages && p.imageUrl) {
        const local = await downloadImage(p.imageUrl, o.maxImageMb, o);
        if (local) imageUrl = local;
      }
      if (!imageUrl) {
        await insertItem(jobId, p, ai, null, 'skipped', 'Снимката не можа да се свали');
        await bump(jobId, 'skipped');
        continue;
      }

      try {
        const item = await insertItem(
          jobId,
          p,
          ai,
          {
            title,
            description,
            priceEur,
            category: cat,
            unitQuantity: unit.quantity ?? null,
            unitType,
            polarity,
            reference,
            tags,
            imageUrl,
          },
          'imported',
          null
        );
        const res = await importProduct({
          jobId,
          itemId: item.id,
          title,
          description,
          price: priceEur,
          referencePrice: reference,
          category: cat,
          polarity,
          city: o.city,
          placeName: shopLabel,
          imageUrl,
          unitQuantity: unit.quantity ?? null,
          unitType,
          tags,
          sourceUrl: p.sourceUrl,
          domain: job.domain,
        });
        await query(`update scrape_items set post_id = $2 where id = $1`, [item.id, res.postId]);
        await bump(jobId, 'imported');
        stored++;
        await logLine(jobId, `Внесен: ${title.slice(0, 60)}`);
      } catch (err) {
        await bump(jobId, 'failed');
        await logLine(jobId, `Грешка при внасяне на „${title.slice(0, 40)}“: ${(err as Error).message.slice(0, 120)}`);
      }
    }

    if (o.saveProfile) {
      await query(
        `insert into scrape_sites (domain, label, strategy, selectors, defaults, runs, last_ok_at, updated_at)
         values ($1,$2,$3,$4,$5,1, now(), now())
         on conflict (domain) do update
           set strategy = excluded.strategy,
               selectors = case when scrape_sites.selectors = '{}'::jsonb then excluded.selectors else scrape_sites.selectors end,
               runs = scrape_sites.runs + 1,
               last_ok_at = now(),
               updated_at = now()`,
        [job.domain, shopLabel, strategy || 'heuristics', JSON.stringify(o.selectors ?? {}), JSON.stringify({
          city: o.city,
          categoryMode: o.categoryMode,
          fixedCategory: o.fixedCategory,
          polarityMode: o.polarityMode,
          delayMs: o.delayMs,
          useAi: o.useAi,
          downloadImages: o.downloadImages,
        })]
      );
    }

    await setStatus(jobId, 'done', { finished_at: new Date() });
    await logLine(jobId, `Готово: ${stored} ${o.mode === 'import' ? 'внесени' : 'готови за преглед'}.`);
    if (job.schedule_id) await updateScheduleAfterJob(job.schedule_id, jobId);
  } catch (err) {
    await setStatus(jobId, 'failed', { error: (err as Error).message.slice(0, 400), finished_at: new Date() });
    await logLine(jobId, `Счупи се: ${(err as Error).message.slice(0, 200)}`);
    if (job.schedule_id) await updateScheduleAfterJob(job.schedule_id, jobId).catch(() => undefined);
  }
}

async function insertItem(
  jobId: string,
  p: RawProduct,
  ai: EnrichedItem | undefined,
  computed: {
    title: string;
    description: string;
    priceEur: number;
    category: string;
    unitQuantity: number | null;
    unitType: string | null;
    polarity: 'green' | 'red';
    reference: number | null;
    tags: string[];
    imageUrl?: string;
  } | null,
  status: 'parsed' | 'imported' | 'skipped' | 'failed',
  reason: string | null
): Promise<{ id: string }> {
  const row = await one<{ id: string }>(
    `insert into scrape_items (
       job_id, source_url, title, description, price, reference_price, currency,
       image_url, local_image_url, category, unit_quantity, unit_type, polarity,
       breadcrumb, tags, status, reason, raw
     ) values ($1,$2,$3,$4,$5,$6,'EUR',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     returning id::text`,
    [
      jobId,
      p.sourceUrl,
      computed?.title ?? p.title ?? null,
      computed?.description ?? p.description ?? null,
      computed?.priceEur ?? p.price ?? null,
      computed?.reference ?? null,
      p.imageUrl ?? null,
      computed?.imageUrl ?? null,
      computed?.category ?? null,
      computed?.unitQuantity ?? null,
      computed?.unitType ?? null,
      computed?.polarity ?? null,
      p.breadcrumb ?? null,
      computed?.tags ?? [],
      status,
      reason,
      JSON.stringify({ via: p.via, breadcrumb: p.breadcrumb ?? null, ai: ai ?? null, currency: p.currency ?? null }),
    ]
  );
  return { id: row!.id };
}

/* ------------------------------------------------------------- worker */

let workerTimer: NodeJS.Timeout | null = null;
/** Едновременно вървящи задачи. Повече от 3 няма смисъл — ще ударим сайтовете. */
const MAX_PARALLEL = 3;
const runningJobs = new Set<string>();

/**
 * Подхваща чакащи задачи, възстановява изоставени и пуска разписанията.
 *
 * Може да върви по няколко задачи наведнъж (различни сайтове) — това е исканото
 * „пускам няколко сканирания“. Всяка задача пак е учтива към своя домейн.
 */
export async function startScraperWorker(): Promise<void> {
  if (workerTimer) return;

  const tick = async () => {
    try {
      // Изоставена задача: „работи“, но от 5 минути няма пулс (сървърът е умрял).
      await query(
        `update scrape_jobs
            set status = 'queued', log = log || to_jsonb($1::text)
          where status in ('discovering','parsing','enriching','importing')
            and (heartbeat_at is null or heartbeat_at < now() - interval '5 minutes')`,
        ['Възстановена след прекъсване на сървъра.']
      );

      // 1) Разписанията — дневна квота, разпръсната през деня.
      try {
        const created = await tickSchedules();
        if (created > 0) {
          await query(`select 1`); // (няма нужда от лог в базата)
        }
      } catch {
        /* следващият тик ще опита пак */
      }

      // 2) Пускаме чакащите задачи, до 3 наведнъж.
      while (runningJobs.size < MAX_PARALLEL) {
        const next = await one<{ id: string }>(
          `select id from scrape_jobs
            where status = 'queued' and not (id = any($1::uuid[]))
            order by created_at asc
            limit 1`,
          [[...runningJobs]]
        );
        if (!next) break;
        runningJobs.add(next.id);
        void runJob(next.id)
          .catch(() => undefined)
          .finally(() => runningJobs.delete(next.id));
      }
    } catch {
      /* тихо — следващият тик ще опита пак */
    }
  };

  workerTimer = setInterval(() => void tick(), 4000);
  if (typeof workerTimer.unref === 'function') workerTimer.unref();
  void tick();
}

/* ------------------------------------------------------------ помощни */

export async function scrapeInfo(): Promise<{
  aiAvailable: boolean;
  model: string;
  cities: string[];
  sites: number;
  jobs: { total: number; running: number; done: number };
}> {
  const [cities, sites, jobs] = await Promise.all([
    many<{ city: string }>(
      `select distinct city from posts where status = 'published' and city <> '' order by city limit 60`
    ),
    one<{ n: number }>(`select count(*)::int as n from scrape_sites`),
    one<{ total: number; running: number; done: number }>(
      `select count(*)::int as total,
              count(*) filter (where status in ('queued','discovering','parsing','enriching','importing'))::int as running,
              count(*) filter (where status = 'done')::int as done
         from scrape_jobs`
    ),
  ]);
  return {
    aiAvailable: features.assistant,
    model: env.ASSISTANT_MODEL,
    cities: cities.map((c) => c.city),
    sites: Number(sites?.n ?? 0),
    jobs: {
      total: Number(jobs?.total ?? 0),
      running: Number(jobs?.running ?? 0),
      done: Number(jobs?.done ?? 0),
    },
  };
}
