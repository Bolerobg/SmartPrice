import { randomUUID } from 'node:crypto';
import { many, one, query, tx } from '../db.js';
import { env, features } from '../env.js';
import { addApifySpend, apifyBudgetAllows, apifyReady, apifyRenderHtml } from './apifyBrowser.js';
import { browserAvailable, renderHtml } from './render.js';
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
  /**
   * От кой адрес да започне обиколката (завърта списъка).
   * Разписанията слагат случаен брой всеки път, за да влизат от различно място
   * в каталога — различни продукти, различен маршрут, нищо за научаване.
   */
  startOffset?: number;
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
  'restaurants', 'hotels_airbnb', 'supermarket', 'cafes_bars', 'services_tech',
  'vehicles', 'real_estate', 'shops_places', 'private_sellers', 'other',
] as const;

// ВАЖНО: HTTP заглавията приемат само ASCII. Кирилица тук чупи всяка заявка
// с „Cannot convert argument to a ByteString“ — затова низът е само латиница.
const UA =
  'Mozilla/5.0 (compatible; SmartPriceBot/1.0; +https://smartprice.bg; product-prices)';

/**
 * Реалистични браузъри, между които се избира СЛУЧАЙНО за всяка заявка.
 *
 * Защо: един и същ User-Agent на всеки 30 секунди от един IP е най-лесният
 * признак за бот. Ротацията не лъже сайта (не се представяме за друг човек),
 * а разпределя трафика така, както би изглеждал от нормален браузър.
 */
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
];

/** Случаен браузър от пула (задачите „по разписание“ изглеждат различно всеки път). */
export function pickUserAgent(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)]!;
}

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

/** Отчита „обходена страница“ и когато сме я отворили с истински браузър. */
export function noteVisited(jobId: string | undefined, n = 1): void {
  for (let i = 0; i < n; i++) countVisit(jobId);
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
/**
 * Декодира тялото с ПРАВИЛНИЯ encoding.
 *
 * Защо: старите български магазини (напр. mobilen.bg) са на windows-1251. Ако ги
 * декодираме като UTF-8, кирилицата излиза „??????“ и заглавията са боклук.
 * Ред: charset от заглавието → от <meta>/<?xml…encoding> → ако няма обявен,
 * пробваме utf-8 и windows-1251 и взимаме този с по-малко счупени знаци.
 */
export function decodeBody(buf: ArrayBuffer, contentType = ''): string {
  const bytes = new Uint8Array(buf);
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    /encoding=["']([\w-]+)["']/i.exec(head)?.[1];

  const tryDecode = (label: string): string | null => {
    try {
      return new TextDecoder(label, { fatal: false }).decode(bytes);
    } catch {
      return null;
    }
  };
  const brokenCount = (s: string | null) => (s ? (s.match(/\ufffd/g) ?? []).length : Number.POSITIVE_INFINITY);

  if (declared) {
    const d = tryDecode(declared);
    if (d && brokenCount(d) === 0) return d;
    const win = tryDecode('windows-1251');
    if (win && brokenCount(win) < brokenCount(d)) return win;
    if (d) return d;
  }
  const utf8 = tryDecode('utf-8');
  if (utf8 && brokenCount(utf8) === 0) return utf8;
  const win = tryDecode('windows-1251');
  if (win && brokenCount(win) < brokenCount(utf8)) return win;
  return utf8 ?? '';
}

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
          'User-Agent': pickUserAgent(),
          Accept: opts.accept ?? (htmlOnly ? 'text/html,application/xhtml+xml' : DEFAULT_ACCEPT),
          'Accept-Language': 'bg,en;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
      });
      const contentType = res.headers.get('content-type') ?? '';
      const isText = /json|html|xml|text/i.test(contentType);
      // ВАЖНО: четем байтовете и ги декодираме сами — res.text() винаги приема UTF-8
      // и разваля кирилицата на сайтовете на windows-1251.
      const text = isText ? decodeBody(await res.arrayBuffer(), contentType).slice(0, 1_500_000) : '';

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
  /** Редовната (зачертана) цена, когато продуктът е на промоция. */
  listPrice?: number;
  currency?: string;
  imageUrl?: string;
  breadcrumb?: string;
  brand?: string;
  availability?: string;
  /** Откъде сме го взели — за диагностика в панела. */
  via: string;
}

/**
 * Редовната цена от страницата — зачертаната „беше“ цена при промоция.
 *
 * Защо: иначе оферта, взета по време на промоция, изглежда „сгрешена“, когато
 * магазинът върне редовната си цена. С тази стойност показваме „платено ↔
 * обичайна“ и обясняваме разликата с думи.
 */
export function extractListPrice(html: string): { price: number; currency?: string } | undefined {
  const blobs: string[] = [];
  // 1. Зачертани тагове: <del>, <s>, <strike>
  for (const m of html.matchAll(/<(?:del|s|strike)\b[^>]*>([\s\S]{0,80}?)<\/(?:del|s|strike)>/gi)) {
    blobs.push(m[1] ?? '');
  }
  // 2. Класове, които почти винаги носят старата цена (WooCommerce/OpenCart/Shopify).
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

/** Обръща HTML елементи в текст: маха скриптове/стилове, декодира основните знаци. */
/**
 * Маха името/домейна на магазина от описанието.
 *
 * Защо: в приложението НЕ показваме кой е сайтът (искане на потребителя) —
 * описанията обаче идваха от AI с „… предлаган от pottery-factory.com“.
 * Оставяме чисто описание на продукта, без реклама на конкретен магазин.
 */
export function stripShopMentions(text: string, domain?: string): string {
  let t = (text ?? '').trim();
  if (!t) return t;

  const hosts = new Set<string>();
  if (domain) hosts.add(domain.toLowerCase().replace(/^www\./, ''));
  for (const m of t.matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi)) {
    hosts.add(m[1]!.toLowerCase().replace(/^www\./, ''));
  }

  for (const host of hosts) {
    const h = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t
      // „, предлаган от shop.bg“ / „предлагана от shop.bg“ / „от shop.bg“
      .replace(new RegExp(`[,;]?\\s*(?:предлаган[аоы]?|предлагано|предлагат)\\s+(?:от\\s+)?(?:www\\.)?${h}`, 'gi'), '')
      .replace(new RegExp(`[,;]?\\s*(?:от|в|на)\\s+(?:www\\.)?${h}`, 'gi'), '')
      .replace(new RegExp(`\\((?:www\\.)?${h}\\)`, 'gi'), '')
      .replace(new RegExp(`(?:www\\.)?${h}`, 'gi'), '');
  }

  return t
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/,\s*\./g, '.')
    .replace(/^[\s,;.–-]+/, '')
    .trim();
}

/**
 * Маха изтекъл CSS от текст. Magento (Page Builder) слага правилата в `<style>`, но
 * JSON-LD описанието на продукта минава през `strip_tags`, което маха само таговете и
 * ОСТАВЯ тялото на стила направо в описанието:
 *   `#html-body [data-pb-style=XXX]{justify-content:flex-start;display:flex;…}`
 * Затова офертите от remedium.bg изглеждаха като CSS. Работи и по вложени блокове
 * (`@media …{ … }`), маха ги отвътре навън. Пази текста — маха само парче БЕЗ кирилица,
 * което съдържа `:` или `;` вътре в скобите.
 */
export function stripCssRules(text: string): string {
  let out = text;
  for (let i = 0; i < 10; i++) {
    const next = out.replace(
      /(?:@[a-z-]+[^{}]*?|[.#]?[A-Za-z0-9_\-[\]="'>:,.\s]*?)\{[^{}]*\}/gi,
      (m) => (/[:;]/.test(m) && !/[А-Яа-я]/.test(m) ? ' ' : m)
    );
    if (next === out) break;
    out = next;
  }
  // Остатъци: отворен блок (`@media … {`) и самотни скоби.
  out = out.replace(/@[a-z-]+[^{}]*\{/gi, ' ');
  if (/[{}]/.test(out) && /[A-Za-z]:[^А-Яа-я]*[;}]/.test(out)) out = out.replace(/[{}]/g, ' ');
  return out;
}

export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  return (
    stripCssRules(stripped)
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    // Валутни и типографски „named“ ентитита. Без тях OpenCart страниците дават
    // „5.50 &euro;“ и цената изглежда като число без валута → отпада.
    .replace(/&euro;/gi, '€')
    .replace(/&pound;/gi, '£')
    .replace(/&yen;/gi, '¥')
    .replace(/&cent;/gi, '¢')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&sect;/gi, '§')
      .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim()
  );
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
/**
 * Оправя адрес, изваден от HTML: `&amp;` → `&`, `&#38;` → `&`, `&quot;` → `"`.
 *
 * Защо: OpenCart (и още магазини) пишат `index.php?route=product/category&amp;path=20`.
 * Ако `&amp;` остане, заявката тръгва с параметър „amp;path“ и сайтът връща
 * началната страница вместо категорията — скраперът „не намира продукти“.
 */
export function decodeHref(href: string): string {
  return href
    .replace(/&#x([0-9a-f]{2,4});/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d{2,5});/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/gi, '&')
    .replace(/&#0?38;/g, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'");
}

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
      const href = decodeHref(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i').exec(m[2] ?? '')?.[1] ?? '');
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
    const href = decodeHref(m[1]!);
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
/**
 * Строга цена за КАРТА в листинг: число с валутен знак ВЕДНАГА до него.
 *
 * Защо не общата евристика: тя взима „всяко число“ и при JavaScript магазини
 * (home-max.bg) това дава цени от вида 263 250 € или 161 157 €, извадени от
 * сметки в скриптовете на страницата. В една карта цената ВИНАГИ е до валутния
 * знак („12.78 €“, „12,78 лв.“), затова тук искаме точно това съседство.
 * По-добре без цена (продуктът се пропуска), отколкото грозна цена в приложението.
 */
export function strictCardPrice(html: string): { price?: number; currency?: string } {
  const text = htmlToText(html).slice(0, 6000);
  const patterns: Array<[RegExp, string]> = [
    [/(\d[\d\s.,]*)\s?(?:€|EUR)(?![A-Za-z])/gi, 'EUR'],
    [/(\d[\d\s.,]*)\s?(?:лв\.?|BGN)(?![A-Za-zа-яА-Я])/gi, 'BGN'],
    [/(?:€|EUR)\s?(\d[\d\s.,]*)/gi, 'EUR'],
    [/(?:лв\.?|BGN)\s?(\d[\d\s.,]*)/gi, 'BGN'],
  ];
  // ВАЖНО: в картите първата цена често е ЛИЗИНГ/вноска („30 €/мес“) или „от 12,50 €“ —
  // това НЕ е цената на продукта. Точно това даваше „SAMSUNG 55" телевизор за 30 €“
  // на technomarket.bg. Затова събираме всички кандидати, отделяме вноските и:
  //   • ако има пълна цена → взимаме НАЙ-ГОЛЯМАТА (тя е редовната/промо цената);
  //   • ако има само вноски → по-добре без цена, отколкото грозна цена в приложението.
  const all: number[] = [];
  const full: number[] = [];
  for (const [re, currency] of patterns) {
    for (const m of text.matchAll(re)) {
      const price = parsePrice(m[1]!);
      if (!price || price <= 0 || price > 200_000) continue;
      all.push(price);
      const from = Math.max(0, (m.index ?? 0) - 16);
      const around = text.slice(from, (m.index ?? 0) + (m[0]?.length ?? 0) + 18);
      const isInstallment = /(?:\/|\s)(?:мес|месец|mo|month)|leasing|лизинг|вноск|на\s+изплащане|^\s*от\b|\bот\s*$/i.test(
        around
      );
      if (!isInstallment) full.push(price);
      void currency;
    }
  }
  if (!all.length) return {};
  if (!full.length) return {};
  const currency = /€|eur/i.test(text) ? 'EUR' : /лв|bgn/i.test(text) ? 'BGN' : undefined;
  // Има ли изобщо маркер за вноска? Ако да — взимаме най-голямата пълна цена.
  const hasInstallment = /(?:\/|\s)(?:мес|месец|leasing|лизинг|вноск|изплащане)/i.test(text);
  return { price: hasInstallment ? Math.max(...full) : full[0], currency };
}

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
    const { price, currency } = strictCardPrice(window);
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
  const deduped = out.filter((p) => {
    const nameKey = `${(p.title ?? '').toLowerCase().replace(/\s+/g, ' ').trim()}|${p.price}`;
    if (seenUrl.has(p.sourceUrl) || seenName.has(nameKey)) return false;
    seenUrl.add(p.sourceUrl);
    seenName.add(nameKey);
    return true;
  });

  // Проверка „тези карти наистина ли са продукти?“.
  //
  // Реален случай (bauhaus.bg, 18.10.2026): три РАЗЛИЧНИ продукта — калорифер,
  // стълба и лепило — излизаха с една и съща цена 14,83 €. Причината: в широката
  // карта на този шаблон попада общ елемент (цена на доставка/промо банер) и се
  // чете вместо цената на продукта. Затова: ако ≥3 продукта имат една и съща
  // цена, картите не са надеждни → връщаме празно, за да мине скраперът към
  // sitemap/рендиране, където цените са точни.
  if (deduped.length >= 3) {
    const byPrice = new Map<number, number>();
    for (const p of deduped) byPrice.set(p.price!, (byPrice.get(p.price!) ?? 0) + 1);
    const top = Math.max(...byPrice.values());
    if (top >= 3 && top / deduped.length >= 0.6) return [];
  }

  // Цена, която е абсурдно ниска спрямо останалите в СЪЩИЯ листинг, е артефакт
  // (вноска, такса, подарък), не цена на продукт. Реален случай: technomarket.bg
  // даваше „SAMSUNG 55\" телевизор — 30 €“ сред 83 продукта с медиана ~400 €.
  // Медианата е устойчива на изключения, за да не срине правилото един скъп артикул.
  if (deduped.length >= 10) {
    const prices = deduped.map((p) => p.price!).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)]!;
    if (median >= 50) {
      const floor = median * 0.05;
      return deduped.filter((p) => (p.price ?? 0) >= floor);
    }
  }
  return deduped;
}

/** Безплатен, но често най-точен начин: продуктовият адрес по sitemap. */
/** Явно НЕ е продукт: категория, марка, търсене, информационна страница. */
export function looksLikeNonProductUrl(loc: string): boolean {
  const p = loc.toLowerCase();
  return /\/(category|categories|kategor|katalog|catalog|brand|brands|marki|search|tag|blog|news|about|contact|kontakt|za-nas|za_nas|terms|privacy|policy|cart|checkout|account|login|register|compare|wishlist|sitemap)(\/|\.|$|\?)/.test(
    p
  );
}

/** Изглежда ли адресът на конкретен продукт? */
export function looksLikeProductUrl(loc: string): boolean {
  const p = loc.toLowerCase();
  if (/\/(product|produkt|produkti|produkty|item|artikel|goods|tovar|p|pr|dp)\//.test(p)) return true;
  if (/[?&](product_id|productId|pid|sku|art|id)=/i.test(p)) return true;
  if (/-\d{3,}(\.html?)?$/.test(p)) return true; // напр. .../kashkaval-lyulin-12345
  return false;
}

/**
 * Истинска продуктова страница ли е разчетеното?
 * Категориите от sitemap-а изглеждат като продукти, докато не се види цената:
 * „Продукти 4LIVING на изгодни цени“ с цена 28 = броят продукти в категорията.
 */
export function looksLikeProductPage(p: { title?: string; price?: number }): boolean {
  const t = (p.title ?? '').trim();
  if (!t) return false;
  if (t.length < 4) return false;
  const categoryish =
    /^(продукти|produkti|produktai|products|всички|all|kategor|категори|brands?|марки)\b/i.test(t) ||
    /(категори|kategor|all products|всички продукти)/i.test(t);
  if (categoryish) return false;
  if (p.price === undefined || p.price <= 0) return false;
  return true;
}

/**
 * OpenCart и подобни магазини имат СВОЯ карта на сайта: `index.php?route=information/sitemap`.
 *
 * Защо е отделна стъпка: при този тип магазини `sitemap.xml` често липсва, а
 * продуктите в листинга са скрити зад AJAX „бърз преглед“. Картата на сайта
 * изрежда всички продукти на една страница — една заявка вместо тридесет.
 * Ако в нея няма директни продуктови връзки, минаваме през категориите от същата карта.
 */
/**
 * Чете продуктите направо от картите на OpenCart темата.
 *
 * Защо не по адрес: OpenCart с „SEO адреси“ прави продукти като
 * `/domakinska-keramika/keramichno-gyuveche-kafqvo` — без ID, без „product“ и
 * без цифра. По адрес такъв продукт е неразличим от категория. В самия HTML обаче
 * картата е стандартна: `.product-thumb` → `<h4><a href>` (заглавие),
 * `<p class="price">4.50 €</p>`, `<img>`.
 */
export function extractOpencartCards(html: string, pageUrl: string): RawProduct[] {
  const out: RawProduct[] = [];
  // Търсим самите заглавия на картите. НЕ режем по контейнера: в този шаблон
  // картата съдържа големи вградени SVG икони и цената остава извън прозореца.
  const re = /<h4[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const sourceUrl = resolveUrl(decodeHref(m[1]!), pageUrl);
    const title = htmlToText(m[2]!).slice(0, 200);
    if (!sourceUrl || !title || title.length < 3) continue;
    if (out.some((x) => x.sourceUrl === sourceUrl)) continue;

    // Прозорецът е около картата: снимката е ПРЕДИ заглавието, цената — след него.
    const from = Math.max(0, m.index - 2600);
    const to = Math.min(html.length, m.index + 1800);
    const window = html.slice(from, to);

    // Цената: първо „новата“, после първото число с валута.
    const priceBlock =
      /<[^>]*class="[^"]*\bprice-new\b[^"]*"[^>]*>([\s\S]{0,80}?)<\//i.exec(window)?.[1] ??
      /<p[^>]*class="[^"]*\bprice\b[^"]*"[^>]*>([\s\S]{0,200}?)<\/p>/i.exec(window)?.[1];
    // Подаваме маркъпа, не само вътрешния текст: общата евристика първо гледа
    // елемент с клас „price“ — върху гол текст този път е недостъпен.
    const { price, currency } = extractGenericPrice(
      priceBlock ? `<div class="price">${priceBlock}</div>` : window
    );
    // Карта без цена не е продукт („ХоумМакс Помощник“, блог заглавия и т.н.).
    if (!price || price <= 0) continue;

    // Снимката: последната `<img>` преди заглавието (картата), не икона.
    // ВНИМАНИЕ: в този шаблон картата има големи вградени SVG икони и снимката
    // може да е 8–9 хил. знака преди заглавието — тясно окно я пропуска.
    const before = html.slice(Math.max(0, m.index - 12_000), m.index);
    const imgs = [...before.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
      .map((x) => x[1]!)
      .filter((src) => src && !/\.(svg|gif)$/i.test(src) && !/icon|logo|placeholder|loader/i.test(src));
    const image = resolveUrl(imgs.length ? imgs[imgs.length - 1]! : undefined, pageUrl);

    out.push({
      sourceUrl,
      title,
      price,
      currency,
      imageUrl: image && /^https?:/i.test(image) ? image : undefined,
      via: 'opencart',
    });
    if (out.length >= 200) break;
  }
  return out;
}

export async function collectFromOpencart(
  origin: string,
  limit: number,
  opts: FetchOpts
): Promise<RawProduct[]> {
  const smUrl = `${origin}/index.php?route=information/sitemap`;
  let res: FetchResult;
  try {
    res = await politeFetch(smUrl, { ...opts, accept: 'text/html,application/xhtml+xml' });
  } catch {
    return [];
  }
  if (!res.ok || !res.text || res.text.length < 500) return [];

  // Служебните страници не ни трябват — от картата на сайта взимаме само категориите.
  const service =
    /(account|information|contact|cart|checkout|wishlist|compare|manufacturer|login|register|special|search|sitemap|quick_view|route=common|route=product\/product|route=product\/quick_view|\.(jpg|jpeg|png|webp|gif|css|js|svg|xml)$|^\/cdn-cgi|\/(blog|news|ideas|uslugi|pages?|brochures?|shops?|pomosht|dostavka|usloviya|terms|privacy|about|za-nas)|\.html$|tel:|mailto:|fonts\.googleapis|static\/)/i;
  const candidates = [
    ...new Set(
      [...res.text.matchAll(/href=["']([^"']+)["']/gi)]
        .map((m) => decodeHref(m[1]!))
        .map((h) => {
          try {
            return new URL(h, res.url).toString();
          } catch {
            return '';
          }
        })
        .filter((u) => u && u.startsWith(origin) && !service.test(u) && u !== `${origin}/`)
    ),
  ].slice(0, 10);

  const out: RawProduct[] = [];
  const seen = new Set<string>();
  for (const cat of candidates) {
    if (out.length >= limit) break;
    try {
      const r2 = await politeFetch(cat, opts);
      if (!r2.ok || !r2.text) continue;
      const found = extractOpencartCards(r2.text, r2.url);
      if (found.length >= 2) {
        // Категория с карти — това са истинските продукти (със заглавие, цена и снимка).
        for (const p of found) {
          const key = (p.sourceUrl ?? p.title ?? '').toString();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(p);
          if (out.length >= limit) break;
        }
        continue;
      }
      // Единична продуктова страница (в картата на сайта понякога има и такива).
      if (found.length === 1) {
        out.push(found[0]!);
        continue;
      }
      const one2 = parseProductPage(r2.text, r2.url, {});
      if (one2.title && one2.price && looksLikeProductPage(one2) && looksLikeProductUrl(r2.url)) {
        out.push(one2);
      }
    } catch {
      // следваща категория
    }
  }
  return out.slice(0, limit);
}

/** OpenCart: AJAX „бърз преглед“ → истинската продуктова страница със същия продукт. */
export function realProductUrl(url: string): string {
  return url.replace(/route=product\/quick_view/i, 'route=product/product');
}

/**
 * Чете компресиран sitemap (`.xml.gz`).
 *
 * Защо: част от магазините (Magento, големи каталози) подават картата си gzip-ната.
 * Тогава обикновеното четене връща двоичен боклук и „няма адреси“, макар картата да
 * съдържа стотици продукти.
 */
async function fetchGzSitemap(url: string, opts: FetchOpts): Promise<string | null> {
  try {
    if (!(await robotsAllows(url, opts.respectRobots ?? true))) return null;
    await politeDelay(new URL(url).host, Math.max(0, Math.min(5000, opts.delayMs ?? DEFAULTS.delayMs)));
    const res = await fetch(url, {
      headers: { 'User-Agent': pickUserAgent(), Accept: 'application/xml,text/xml,application/gzip,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Ако сървърът вече я е разкомпресирал (Content-Encoding), това е готов XML.
    if (/^\s*</.test(buf.toString('latin1').slice(0, 8))) return buf.toString('utf8');
    const { gunzipSync } = await import('node:zlib');
    return gunzipSync(buf).toString('utf8');
  } catch {
    return null;
  }
}

export async function collectFromSitemap(
  startUrl: string,
  limit: number,
  opts: FetchOpts
): Promise<{ urls: string[]; usedSitemap?: string; fromProductSitemap?: boolean }> {
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
  let fromProductSitemap = false;
  const productUrls = new Set<string>();
  const visited: string[] = [];
  const maxSitemaps = opts.maxSitemaps ?? 8;

  async function walk(sitemapUrl: string, depth: number): Promise<void> {
    if (productUrls.size >= limit) return;
    if (seenSitemaps.size >= maxSitemaps) return;
    if (seenSitemaps.has(sitemapUrl) || depth > 2) return;
    seenSitemaps.add(sitemapUrl);

    let res: FetchResult;
    // Компресираните карти се четат отделно — иначе е двоичен боклук.
    if (/\.gz(\?|$)/i.test(sitemapUrl)) {
      const unzipped = await fetchGzSitemap(sitemapUrl, opts);
      if (!unzipped) return;
      seenSitemaps.add(sitemapUrl);
      res = { ok: true, status: 200, url: sitemapUrl, contentType: 'application/xml', text: unzipped };
    } else {
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
    }
    visited.push(sitemapUrl);
    if (/product|produkt|tovar|goods/i.test(sitemapUrl)) fromProductSitemap = true;

    const locs = [...res.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((mm) => mm[1]!);
    const isIndex = /<sitemapindex/i.test(res.text);
    if (isIndex) {
      const all = locs.filter((l) => /\.xml/i.test(l));
      // ВАЖНО: първо избираме продуктовите, чак после режем. Обратният ред беше бъг:
      // при praktiker индексът има 22 деца и Product-*.xml са ПОСЛЕДНИ, така че
      // отрязването на първите 8 обхождаше само марки/категории/съдържание.
      const productish = all.filter((l) => /product|produkt|tovar|goods/i.test(l));
      const children = (productish.length ? productish : all).slice(0, maxSitemaps);
      for (const child of children) await walk(child, depth + 1);
      return;
    }
    // Продуктовите адреси първи; категории/марки не се обхождат изобщо.
    const preferred: string[] = [];
    const fallback: string[] = [];
    for (const loc of locs) {
      if (/\.(jpg|jpeg|png|webp|gif|pdf)$/i.test(loc)) continue;
      if (looksLikeNonProductUrl(loc)) continue;
      (looksLikeProductUrl(loc) ? preferred : fallback).push(loc);
    }
    for (const loc of [...preferred, ...fallback]) {
      productUrls.add(loc);
      if (productUrls.size >= limit * 3) return;
    }
  }

  for (const c of candidates) {
    if (productUrls.size >= limit * 3) break;
    await walk(c, 0);
  }
  return { urls: [...productUrls], usedSitemap: visited[0], fromProductSitemap };
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
      // Трябва да е НАИСТИНА фийд. Магазини без фийд връщат началната си страница
      // на всеки непознат адрес (видяно на mobilen.bg) — HTML минаваше за фийд и
      // „продуктите“ бяха просто менюто на сайта.
      const isXml =
        /xml|rss|atom/i.test(res.contentType ?? '') ||
        /^\s*(<\?xml|<rss|<feed|<urlset|<sitemapindex)/i.test(res.text);
      if (!isXml || !/<(item|entry)[\s>]/i.test(res.text)) continue;
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
    // ВНИМАНИЕ: НЕ слагай `\b` след € или £ — те не са букви, значи граница на
    // дума няма и цена от вида „4.50 €“ се пропуска (хванато на pottery-factory.com).
    [/(\d[\d\s.,]*)\s*(?:€|EUR)(?![A-Za-z])/i, 'EUR'],
    [/(\d[\d\s.,]*)\s*(?:лв\.?|BGN)(?![A-Za-zа-яА-Я])/i, 'BGN'],
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

/** Маха шаблонни „опашки“ от SEO описания/фийдове: „… на цена 12.19€ произведен от BIOTRADE“. */
export function stripSeoTails(text: string): string {
  let out = text;
  out = out.replace(
    /\s*(?:на\s+цена|за\s+цена|price)\s*:?\s*\d[\d\s.,]*\s*(?:€|EUR|лв\.?|BGN|£|\$)\s*(?:произведен[ао]?\s+от|от|by)\s*[^.;|]{1,60}\.?\s*$/i,
    ' '
  );
  out = out.replace(/\s*произведен[ао]?\s+от\s+[^.;|]{1,60}\.?\s*$/i, ' ');
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** Истинското описание от продуктовата страница — ползва се, когато мета/JSON-LD описанието е
 *  късо или шаблонно. Познатите контейнери (PrestaShop, Woo, Magento, OpenCart, Shopify). */
export function extractRichDescription(html: string): string | undefined {
  const sels = [
    '#description',
    '#tab-description',
    '.product-description',
    '.product-details .description',
    '.product-attribute-description',
    '[itemprop="description"]',
    '.woocommerce-Tabs-panel--description',
    '.woocommerce-product-details__short-description',
    '.product-info__description',
    '.pdp-description',
    '.product__description',
    '.rte',
  ];
  const candidates: string[] = [];
  for (const sel of sels) {
    const raw = selectFirst(html, sel);
    if (!raw) continue;
    const text = htmlToText(raw);
    if (text.length >= 180 && text.length < 8000) candidates.push(text);
  }
  if (!candidates.length) return undefined;
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

/* ------------------------------------------------------ страница продукт */

/* ============================ лов на продукти в JSON, вграден в страницата */

/**
 * Много магазини слагат данните направо в HTML-а като JSON, а не като видим текст:
 * `__NEXT_DATA__` (Next.js), `window.__NUXT__`, `window.__INITIAL_STATE__`,
 * `var product = {...}`, `data-product="..."` (Angular SSR), `application/ld+json`.
 * В HTML няма нито цена, нито снимка — в този JSON ги има. Затова тук ровим
 * във всеки JSON-блок и търсим обект, който прилича на продукт: име + цена.
 *
 * Това е „универсалната“ част на скрапера: работи без значение коя платформа е
 * сайтът, стига данните да са в страницата (а не да идват с отделна заявка).
 */

/** Взима JSON-телата от всички <script> тагове, които изобщо може да съдържат продукти. */
function jsonBodies(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]{0,600000}?)<\/script>/gi)) {
    const body = m[1] ?? '';
    if (body.length < 40) continue;
    if (!/\{/.test(body)) continue;
    // Скъпо е да парсваме всеки скрипт — взимаме само тези, в които има намек
    // за продукт (цена/име). Аналитика и тракери отпадат веднага.
    if (!/(price|Price|PRICE|amount|сум|цена|product|Product)/.test(body)) continue;
    if (/google-analytics|googletagmanager|gtag\(|fbq\(|hotjar|clarity/i.test(body) && !/price/i.test(body)) continue;
    out.push(body);
  }
  return out;
}

/** Най-големият балансиран JSON в текст (започва от първия { или [). */
function biggestJson(text: string): unknown | null {
  for (const startCh of ['{', '[']) {
    const start = text.indexOf(startCh);
    if (start < 0) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length && i < start + 600_000; i++) {
      const c = text[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

const NAME_KEYS = ['name', 'title', 'productName', 'product_name', 'label', 'наименование'];
const PRICE_KEYS = ['price', 'final_price', 'finalPrice', 'priceValue', 'currentPrice', 'salePrice', 'priceWithVat', 'priceWithTax', 'minPrice', 'value', 'amount'];
const OLD_PRICE_KEYS = ['oldPrice', 'old_price', 'regularPrice', 'regular_price', 'listPrice', 'list_price', 'compareAtPrice', 'priceBefore', 'highPrice'];
const IMAGE_KEYS = ['image', 'imageUrl', 'image_url', 'img', 'photo', 'thumbnail', 'picture', 'mainImage', 'images'];

function numFrom(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v === 'string') {
    const p = parsePrice(v);
    return p && p > 0 ? p : undefined;
  }
  return undefined;
}

function firstImageIn(v: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (typeof v === 'string') return /\.(jpe?g|png|webp|avif)(\?|$)/i.test(v) || /^https?:\/\//i.test(v) ? v : undefined;
  if (Array.isArray(v)) {
    for (const it of v) {
      const got = firstImageIn(it, depth + 1);
      if (got) return got;
    }
    return undefined;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['url', 'src', 'href', 'path', ...IMAGE_KEYS]) {
      const got = firstImageIn(o[k], depth + 1);
      if (got) return got;
    }
  }
  return undefined;
}

function currencyIn(v: unknown, depth = 0): string | undefined {
  if (depth > 3 || !v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  for (const k of ['currency', 'currencyCode', 'currency_code', 'priceCurrency']) {
    if (typeof o[k] === 'string' && /^[A-Za-z]{3}$/.test(o[k] as string)) return String(o[k]);
  }
  for (const val of Object.values(o)) {
    const got = currencyIn(val, depth + 1);
    if (got) return got;
  }
  return undefined;
}

/** Търси цена в обект (вкл. вложени `price: {value, currency}` и `offers`). */
function priceIn(obj: Record<string, unknown>, depth = 0): number | undefined {
  if (depth > 3) return undefined;
  for (const k of PRICE_KEYS) {
    if (k in obj && !OLD_PRICE_KEYS.includes(k)) {
      const n = numFrom(obj[k]);
      if (n !== undefined) return n;
      // `price: {value: 12.5, currency: 'EUR'}` или `price: {final: ...}`
      const inner = obj[k];
      if (inner && typeof inner === 'object') {
        const nested = priceIn(inner as Record<string, unknown>, depth + 1);
        if (nested !== undefined) return nested;
      }
    }
  }
  for (const k of ['offers', 'prices', 'priceInfo', 'price_range', 'minimum_price', 'final_price', 'data']) {
    const inner = obj[k];
    if (inner && typeof inner === 'object') {
      const nested = priceIn(inner as Record<string, unknown>, depth + 1);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function nameIn(obj: Record<string, unknown>, depth = 0): string | undefined {
  for (const k of NAME_KEYS) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length >= 2) return v.trim();
  }
  if (depth === 0) return undefined;
  return undefined;
}

/** Върви по JSON-а и събира всичко, което прилича на продукт (име + цена). */
function huntProducts(node: unknown, out: RawProduct[], base: string, depth = 0): void {
  if (depth > 9 || out.length > 400) return;
  if (Array.isArray(node)) {
    for (const it of node) huntProducts(it, out, base, depth + 1);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  const name = nameIn(obj);
  if (name) {
    const price = priceIn(obj);
    if (price !== undefined && price > 0 && price < 200_000) {
      const img = firstImageIn(obj[IMAGE_KEYS.find((k) => k in obj) ?? 'image'] ?? obj.image ?? obj.images ?? obj.thumbnail, 0);
      const url =
        (typeof obj.url === 'string' && obj.url) ||
        (typeof obj.link === 'string' && obj.link) ||
        (typeof obj.href === 'string' && obj.href) ||
        (typeof obj.slug === 'string' && obj.slug) ||
        base;
      out.push({
        sourceUrl: resolveUrl(String(url), base) ?? base,
        title: name,
        description: typeof obj.description === 'string' ? stripCssRules(obj.description).slice(0, 2000) : undefined,
        price,
        currency: currencyIn(obj) ?? 'EUR',
        imageUrl: img ? resolveUrl(img, base) : undefined,
        breadcrumb: typeof obj.category === 'string' ? obj.category : undefined,
        via: 'embedded-json',
      });
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') huntProducts(v, out, base, depth + 1);
  }
}

/** Всички продукти, които успеем да извадим от JSON-а, вграден в страницата. */
export function extractEmbeddedProducts(html: string, pageUrl: string): RawProduct[] {
  const out: RawProduct[] = [];
  for (const body of jsonBodies(html)) {
    const parsed = biggestJson(body);
    if (parsed) huntProducts(parsed, out, pageUrl, 0);
    if (out.length > 400) break;
  }
  // Махаме боклука и повторенията — иначе една карта влиза 5 пъти.
  const seen = new Set<string>();
  return out.filter((p) => {
    if (!looksLikeJunkProduct(p)) return false;
    const key = `${(p.title ?? '').toLowerCase()}|${p.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Избира най-подходящия продукт от вградения JSON за дадена страница. */
export function pickBestEmbedded(items: RawProduct[], hint?: string): RawProduct | null {
  if (!items.length) return null;
  if (hint) {
    const h = hint.toLowerCase().trim();
    const exact = items.find((p) => (p.title ?? '').toLowerCase().trim() === h);
    if (exact) return exact;
    const near = items.find((p) => {
      const t = (p.title ?? '').toLowerCase();
      return t.length > 4 && (t.includes(h.slice(0, 18)) || h.includes(t.slice(0, 18)));
    });
    if (near) return near;
  }
  // Иначе: този с най-много данни (снимка + описание) и разумна цена.
  return [...items].sort((a, b) => scoreProduct(b) - scoreProduct(a))[0] ?? null;
}

/** Колко „истински“ изглежда един продукт (за подреждане и за проверки). */
export function scoreProduct(p: { title?: string; price?: number; imageUrl?: string; description?: string }): number {
  let s = 0;
  if (p.imageUrl) s += 3;
  if (p.description && p.description.length > 40) s += 2;
  if (p.price && p.price > 1) s += 2;
  const t = p.title ?? '';
  if (t.length >= 8 && t.length <= 120) s += 2;
  if (t.split(/\s+/).length >= 2) s += 1;
  return s;
}

/** Маха категориите/банерите с цена — за да не влизат в обявите. */
function clean(products: RawProduct[]): RawProduct[] {
  return products.filter((p) => !!p.title && !looksLikeJunkProduct(p));
}

/**
 * Боклук ли е това „продукт“?
 *
 * Реални случаи, които това спира (иначе влизат в приложението като оферти):
 *   • zora.bg → „A++“ (енергиен клас от категорийна картинка) за 239 €;
 *   • bauhaus.bg → „Навеси за автомобили“ (категория, цена от рекламна картинка);
 *   • technomarket.bg → заглавие „1111111“.
 */
export function looksLikeJunkProduct(p: { title?: string; price?: number; imageUrl?: string }): boolean {
  const t = (p.title ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 4 || t.length > 200) return true;
  // Трябва да има поне 3 букви/цифри в поне две „думи“ ИЛИ една дълга дума.
  const letters = (t.match(/[A-Za-zА-Яа-яЁё0-9]/g) ?? []).length;
  if (letters < 4) return true; // „A++“, „1111111“
  if (/^[\d\s.,+-]+$/.test(t)) return true; // само числа
  if (/^(категория|всички|всички продукти|category|каталог|catalog|разгледай|виж всички)\b/i.test(t)) return true;
  // Надписи от интерфейса, които изглеждат като заглавие (technomarket.bg даваше
  // „add to compare“ като продукт за 799 €).
  if (/^(add to|quick view|in stock|out of stock|купи|купи сега|сравни|сравнение|виж повече|виж още|добави|наличност|в наличност|преглед)\b/i.test(t)) {
    return true;
  }
  const price = p.price ?? 0;
  if (!price || price <= 0 || price > 200_000) return true;
  // Снимка от CMS/банер/икона/категория не е продуктова снимка.
  const img = p.imageUrl ?? '';
  if (img && /\/(cms|content\/images|banner|banners|slider|sprite|icon|icons|logo|placeholder|category_property|no[-_]?image|default)\//i.test(img)) {
    return true;
  }
  return false;
}

export function parseProductPage(html: string, pageUrl: string, selectors: Record<string, string> = {}): RawProduct {
  const jsonld = extractJsonLd(html);
  const product = jsonld.find((j) => j.name);
  const meta = extractMeta(html);
  const micro = selectFirst(html, 'h1') ? extractMicrodata(html) : {};
  const canonical = meta.canonical && /^https?:/i.test(meta.canonical) ? meta.canonical : pageUrl;

  const fromSel = (key: string) => (selectors[key] ? selectFirst(html, selectors[key]!) : undefined);

  // Данните може да са в JSON, вграден в страницата (Next.js/Nuxt/Angular SSR):
  // тогава в HTML-а няма видима цена, но в JSON-а я ИМА. Пускаме лова само ако
  // страницата изобщо съдържа такъв JSON — иначе е излишно ровене.
  const embedded = /__(NUXT|NEXT_DATA|INITIAL_STATE)__|window\.__|application\/ld\+json/i.test(html)
    ? pickBestEmbedded(extractEmbeddedProducts(html, pageUrl), meta['og:title'] ?? meta.title)
    : null;

  const title =
    fromSel('title') ??
    product?.name ??
    meta['og:title'] ??
    selectFirst(html, 'h1') ??
    (meta.title ? htmlToText(meta.title) : undefined) ??
    micro.title ??
    embedded?.title;

  let rawDesc =
    fromSel('description') ??
    product?.description ??
    meta['og:description'] ??
    meta.description ??
    extractGenericDescription(html) ??
    micro.title;
  // Мета/JSON-LD описанието често е късо или шаблонно (а на Magento носи изтекъл CSS).
  // Под 200 знака → вземи истинското описание от продуктовата страница.
  if (typeof rawDesc !== 'string' || rawDesc.length < 200) {
    rawDesc = extractRichDescription(html) ?? rawDesc;
  }

  const imageFromSel = resolveUrl(fromSel('image'), pageUrl);
  const image =
    imageFromSel ??
    resolveUrl(firstImage(product?.image), pageUrl) ??
    resolveUrl(meta['og:image:secure_url'] ?? meta['og:image'] ?? meta['twitter:image'], pageUrl) ??
    resolveUrl(micro.imageUrl, pageUrl) ??
    // Последна надежда — първата голяма снимка в страницата (и lazy-load вариантите).
    extractGenericImage(html, pageUrl) ??
    resolveUrl(embedded?.imageUrl, pageUrl);

  const offersPrice = fromOffers(product?.offers);
  // Редовната (зачертана) цена при промоция — за „платено ↔ обичайна“.
  const pageListRaw = extractListPrice(html);
  const priceFromSel = parsePrice(fromSel('price'));
  const priceFromMeta = parsePrice(meta['product:price:amount'] ?? meta['og:price:amount']);
  const priceFromMicro = micro.price;
  let price = priceFromSel ?? offersPrice.price ?? priceFromMeta ?? priceFromMicro ?? embedded?.price;
  // Дали цената е от структурирани данни (вярна) или от обща евристика (проверява се долу).
  let priceWeak = false;

  let currency: string | undefined =
    offersPrice.currency ?? meta['product:price:currency'] ?? meta['og:price:currency'] ?? embedded?.currency;

  // Класове, които почти винаги носят истинската цена (WooCommerce, Shopify теми,
  // стари магазини). Редът е от най-специфичния към най-общия.
  if (price === undefined) {
    for (const sel of ['.price_color', '.product-price', '.woocommerce-Price-amount', '.price', '[class*=price]@text']) {
      const p = parsePrice(selectFirst(html, sel));
      if (p) {
        price = p;
        priceWeak = true;
        break;
      }
    }
  }
  if (price === undefined) {
    const generic = extractGenericPrice(html);
    price = generic.price;
    currency = currency ?? generic.currency;
    if (generic.price !== undefined) priceWeak = true;
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

  // Слаба цена без валутен знак до себе си почти винаги е брояч („28 продукта“).
  // По-добре без цена, отколкото с грешна — приложението показва реални цени.
  if (price !== undefined && priceWeak) {
    const txt = htmlToText(html).slice(0, 60_000);
    // Сравняваме числата, не текста: 2.5 и 2.50 са една цена, а „28 продукта“ не е цена.
    const anchored: number[] = [];
    for (const mm of txt.matchAll(/(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:€|лв\.?|EUR|BGN|£|\$)/gi)) {
      const v = parsePrice(mm[1]);
      if (v !== undefined) anchored.push(v);
    }
    for (const mm of txt.matchAll(/(?:€|лв\.?|EUR|BGN|£|\$)\s*(\d[\d\s]*(?:[.,]\d{1,2})?)/gi)) {
      const v = parsePrice(mm[1]);
      if (v !== undefined) anchored.push(v);
    }
    if (!anchored.some((v) => Math.abs(v - price!) < 0.011)) {
      price = undefined;
      currency = undefined;
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
    // Сравняваме ЧАК ТУК: цената се доизчислява и след горните редове.
    listPrice:
      pageListRaw && price !== undefined && pageListRaw.price > price ? pageListRaw.price : undefined,
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
    originalDescription: (it.description ?? '').slice(0, 1200),
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
         seller_type, source, source_note, source_url
       ) values (
         $1,$2,$3,'Онлайн магазин',$4,$5,$6,$7,$8,$9,'EUR',$10,$11,$12,$13,$14,
         'business','scraper',$15,$16
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
        // Линк към продукта: картата на офертата води натам, не към картата с локация.
        params.sourceUrl.slice(0, 500),
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
  dry_runs: number;
  max_total: number | null;
  stop_when_done: boolean;
  rotate: boolean;
  auto_stopped_at: string | null;
  last_status: string | null;
  last_message: string | null;
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
    const options: Record<string, unknown> = {
      ...(s.options ?? {}),
      count: burst,
      mode: s.mode === 'import' ? 'import' : 'preview',
    };
    // „Да не се усетят“: всяка обиколка влиза от различно място в каталога и с
    // леко различно темпо, вместо всеки ден по един и същ маршрут.
    if (s.rotate) options.startOffset = Math.floor(Math.random() * 5000);
    if (options.delayMs === undefined) options.delayMs = Math.round(rand(1200, 4200));

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
  const j = await one<{ imported: number; parsed: number; pages_visited: number; status: string; error: string | null }>(
    `select imported, parsed, pages_visited, status, error from scrape_jobs where id = $1`,
    [jobId]
  );
  if (!j) return;
  const taken = Number(j.imported || 0) > 0 ? Number(j.imported) : Number(j.parsed || 0);
  const s = await one<ScheduleRow>(`select * from scrape_schedules where id = $1`, [scheduleId]);
  if (!s) return;

  // Нищо ново от сайта НЕ е грешка — това е изчерпване (всичко вече го имаме).
  const dry = taken > 0 ? 0 : Number(s.dry_runs || 0) + 1;
  const importedTotal = Number(s.total_imported || 0) + Number(j.imported || 0);
  const hitCap = s.max_total != null && importedTotal >= Number(s.max_total);
  const exhausted = dry >= 3;

  let enabled = s.enabled;
  let status = taken > 0 ? 'ok' : j.status === 'failed' ? 'error' : 'no_new';
  let message =
    taken > 0
      ? `Взех ${taken} продукта.`
      : j.status === 'failed'
        ? `Грешка: ${String(j.error ?? 'неизвестна').slice(0, 160)}`
        : `Няма нови продукти (${dry} поредни обиколки).`;

  let autoStopped: string | null = null;
  if (s.stop_when_done && (exhausted || hitCap)) {
    enabled = false;
    autoStopped = new Date().toISOString();
    status = hitCap ? 'done' : 'exhausted';
    message = hitCap
      ? `Стигнах тавана от ${s.max_total} продукта — спрях се сам.`
      : 'Сайтът е изчерпан — 3 поредни обиколки без нови продукти. Спрях се сам.';
  }

  // Квотата се харчи и когато сме само в преглед — продуктите пак са взети от сайта.
  await query(
    `update scrape_schedules
        set used_today = used_today + $2,
            total_imported = total_imported + $3,
            total_crawled = total_crawled + $4,
            dry_runs = $5, last_status = $6, last_message = $7,
            enabled = $8,
            auto_stopped_at = coalesce($9::timestamptz, auto_stopped_at),
            updated_at = now()
      where id = $1`,
    [
      scheduleId,
      taken,
      Number(j.imported || 0),
      Number(j.pages_visited || 0),
      dry,
      status,
      message,
      enabled,
      autoStopped,
    ]
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

    // Адреси, дошли от фийд без цени — по-долу се четат като страници.
    let urlsFromFeed: string[] = [];

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
        const withPrice = feed.filter((x) => (x.price ?? 0) > 0).length;
        if (withPrice >= Math.ceil(feed.length / 2)) {
          products = feed;
          strategy = 'feed';
        } else {
          // Някои фийдове (напр. WooCommerce RSS на zora.bg) нямат цени в себе си.
          // Тогава фийдът е само списък с адреси — цените се четат от страниците.
          urlsFromFeed = feed.map((x) => x.sourceUrl).filter((u): u is string => !!u);
          strategy = 'feed-pages';
        }
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
      let urls: string[] = [...urlsFromFeed];
      let sitemapFromProducts = false;
      const isProductish = /\/(product|produkt|p|item|tovar|art)\//i.test(new URL(job.url).pathname);

      if (!isProductish && !urls.length) {
        // Първо OpenCart-картата (ако е такъв магазин) — после sitemap.xml.
        const oc = await collectFromOpencart(origin, limit, fo);
        if (oc.length >= 2) {
          products = oc.slice(0, limit);
          strategy = 'opencart';
          await logLine(
            jobId,
            `OpenCart магазин: взех ${products.length} продукта направо от картите в категориите.`
          );
        }

        const sm = products.length || urls.length
          ? { urls: [] as string[], fromProductSitemap: false }
          : await collectFromSitemap(job.url, limit, fo);
        if (sm.urls.length) {
          urls = sm.urls;
          sitemapFromProducts = sm.fromProductSitemap === true;
          strategy = 'sitemap';
          await logLine(jobId, `Sitemap: намерих ${sm.urls.length} продуктови адреса.`);
        } else if (!urls.length && !products.length) {
          await logLine(jobId, 'Няма sitemap — гледам листинга.');
          const home = await politeFetch(job.url, fo);
          // Първо най-бързото: продуктите, изброени в самия листинг. За
          // PrestaShop и повечето магазини това стига — една заявка вместо 30.
          // ВАЖНО: картите често съдържат и категории с цена от рекламна картинка
          // (bauhaus.bg: „Навеси за автомобили“ 14.83 €). Такива НЕ са продукти.
          const cards = extractListingProducts(home.text, home.url).filter((c) => !looksLikeJunkProduct(c));
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
      } else if (!products.length && !urls.length) {
        // Само ако НЕ сме дошли с готови адреси (напр. от фийд) — иначе ще ги затрием.
        urls = [job.url];
        strategy = 'single';
        await logLine(jobId, 'Това е страница на конкретен продукт.');
      } else if (!products.length && urls.length && !strategy) {
        strategy = 'listing';
      }

      // Последна стъпка преди да се откажем: ако сайтът се рисува с JavaScript,
      // HTTP-отговорът е празна черупка. Отваряме началния адрес с истински браузър.
      if (!products.length && !urls.length && browserAvailable()) {
        await logLine(jobId, 'В HTTP отговора няма продукти — сайтът вероятно е JavaScript. Отварям го с истински браузър.');
        const r = await renderHtml(job.url, { waitMs: 1500 });
        if (r?.html) {
          noteVisited(jobId);
          const deepCards = extractListingProducts(r.html, r.url).filter((c) => !looksLikeJunkProduct(c));
          const deepJson = extractEmbeddedProducts(r.html, r.url);
          if (deepCards.length >= 2) {
            products = deepCards.slice(0, limit);
            strategy = 'render-cards';
          } else if (deepJson.length >= 2) {
            products = deepJson.slice(0, limit);
            strategy = 'render-json';
          } else {
            const links = extractProductLinks(r.html, r.url, o.selectors?.list);
            if (links.length) {
              urls = links;
              strategy = 'render-listing';
            }
          }
          await logLine(jobId, `След рендиране: ${products.length} продукта в картите/JSON-а, ${urls.length} връзки.`);
        } else {
          await logLine(jobId, 'Браузърът не успя да отвори сайта (или рендирането е изключено).');
        }
      }

      // Последна инстанция: сайтът може да блокира нашия сървър (Cloudflare).
      // Apify с жилищно прокси минава оттам.
      if (!products.length && !urls.length && (await apifyReady()) && (await apifyBudgetAllows(0.2)).allowed) {
        await logLine(jobId, 'Пробвам през Apify (истински браузър + residential IP)…');
        const r = await apifyRenderHtml([job.url], { resident: true });
        if (r.usd > 0) await addApifySpend(r.usd, `${job.domain}: начален адрес`);
        const page = r.pages.find((x) => x.html);
        if (page?.html) {
          noteVisited(jobId);
          const cards = clean(extractListingProducts(page.html, page.url || job.url));
          const emb = extractEmbeddedProducts(page.html, page.url || job.url);
          if (cards.length >= 1) {
            products = cards.slice(0, limit);
            strategy = 'apify';
          } else if (emb.length >= 1) {
            products = emb.slice(0, limit);
            strategy = 'apify';
          } else {
            const links = extractProductLinks(page.html, page.url || job.url, o.selectors?.list);
            if (links.length) {
              urls = links;
              strategy = 'apify';
            }
          }
          await logLine(jobId, `Apify: ${products.length} продукта, ${urls.length} връзки.`);
        } else if (r.reason) {
          await logLine(jobId, `Apify не успя: ${r.reason}`);
        }
      }

      if (!products.length && !urls.length) {
        await syncVisited(jobId);
        await setStatus(jobId, 'failed', {
          error:
            `Не намерих продукти в ${job.domain}. Пробвах: Shopify каталог, WooCommerce, магазинни ` +
            `фийдове (Google/RSS), Magento GraphQL, sitemap (вкл. от robots.txt), категории, връзки в ` +
            `листинга, карти в листинга, вграден JSON и отваряне с истински браузър. ` +
            `Най-честите причини: сайтът блокира датацентъра (Cloudflare) — тогава го пусни ` +
            `през „Обходи от моя компютър“; или е нестандартен — тогава дай ръчни селектори ` +
            `(list: a.product@href, price: .price@text, image: img@src).`,
          finished_at: new Date(),
        });
        await logLine(jobId, 'Спирам: няма намерени продукти.');
        // ВАЖНО: и при този изход разписанието се обновява. „Нула нови продукта“ е
        // точно случаят „сайтът се изчерпи“, който трябва да го спре сам.
        if (job.schedule_id) await updateScheduleAfterJob(job.schedule_id, jobId).catch(() => undefined);
        return;
      }

      await query(`update scrape_jobs set discovered = $2 where id = $1`, [
        jobId,
        Math.max(urls.length, products.length),
      ]);

      // Ако картите в листинга вече ни дадоха продуктите, не отваряме нищо друго.
      // Разписанията влизат от различно място в каталога всеки път.
      const off = Math.max(0, Number(o.startOffset ?? 0));
      if (off > 0 && urls.length > 1) {
        const k = off % urls.length;
        urls = [...urls.slice(k), ...urls.slice(0, k)];
        await logLine(jobId, `Влизам от ${k + 1}-ия адрес в списъка (различен вход всеки път).`);
      }
      if (!products.length) {
      const maxRead = Math.min(urls.length, limit * 2, o.maxPages * 60);
      // Колко страници имаме право да отворим с истински браузър. Всяко отваряне
      // струва ~5 сек и ~200 MB памет — затова има твърд таван.
      const renderCap = Math.min(limit, 12);
      let renders = 0;
      const canRender = () => renders < renderCap && browserAvailable();
      // Страниците, които не успяхме да прочетем (JavaScript цена или блокировка).
      // Накрая, ако има бюджет, ги отваряме наведнъж през Apify.
      const forApify: string[] = [];
      let blocked = false;
      for (const url of urls.slice(0, maxRead)) {
        if (await isCancelled(jobId)) {
          await logLine(jobId, 'Спряно от потребителя.');
          return;
        }
        if (products.length >= limit) break;

        let parsed: RawProduct | null = null;
        // OpenCart: връзките в листинга водят към AJAX „бърз преглед“ —
        // истинската страница с цената е product/product със същия product_id.
        const fetchUrl = realProductUrl(url);
        try {
          const res = await politeFetch(fetchUrl, fo);
          if (res.status === 403 || res.status === 429 || res.status === 503) blocked = true;
          if (res.ok && res.text) parsed = parseProductPage(res.text, res.url, o.selectors ?? {});
          if (!strategy) strategy = parsed?.via ?? 'heuristics';
        } catch (err) {
          await bump(jobId, 'failed');
          await logLine(jobId, `Пропуснах ${url}: ${(err as Error).message.slice(0, 120)}`);
          await syncVisited(jobId);
          continue;
        }
        // Магазин, който се рисува с JavaScript: в HTML-а няма цена (technomarket.bg,
        // technopolis.bg, bauhaus.bg…). Отваряме страницата с истински браузър и
        // четем пак — там цената вече я има, защото JavaScript-ът е свършил работа.
        if (parsed && !parsed.price && canRender()) {
          renders++;
          const r = await renderHtml(fetchUrl, { waitMs: 900 });
          if (r?.html) {
            noteVisited(jobId);
            const deep = parseProductPage(r.html, r.url, o.selectors ?? {});
            if (deep.price && !looksLikeJunkProduct(deep)) {
              parsed = deep;
              if (!strategy || ['heuristics', 'sitemap', 'listing'].includes(strategy)) strategy = 'render';
              await logLine(jobId, `Цената не беше в HTML-а — взех я след като отворих страницата с браузър (${renders}/${renderCap}).`);
            }
          }
        }
        // Без цена след нашите опити → оставяме я за Apify (наведнъж, най-накрая).
        if (parsed && !parsed.price && forApify.length < 8) forApify.push(fetchUrl);
        if (!parsed) {
          if (forApify.length < 8) forApify.push(fetchUrl);
          continue;
        }
        // Боклук (категория, енергиен клас, банер с цена) не влиза в обявите.
        if (looksLikeJunkProduct(parsed)) {
          await bump(jobId, 'skipped');
          continue;
        }
        // Категория/марка от sitemap-а не е продукт — не влиза в обявите.
        // Приемаме страницата, ако адресът ѝ изглежда продуктов ИЛИ данните ѝ са добри.
        if (strategy === 'sitemap' && !sitemapFromProducts && !looksLikeProductUrl(url)) {
          await bump(jobId, 'skipped');
          continue;
        }
        // Цената е задължителна: приложението показва цени, обява без цена е шум.
        if (strategy === 'sitemap' && !looksLikeProductPage(parsed)) {
          await bump(jobId, 'skipped');
          continue;
        }
        products.push(parsed);
        await bump(jobId, 'parsed');
        await syncVisited(jobId);
      }

      // Накрая: адресите, които не успяхме да прочетем (JS цена / блокировка),
      // се отварят НАВЕДНЪЖ през Apify — един actor run вместо осем заявки.
      if (forApify.length && products.length < limit && (await apifyReady()) && (await apifyBudgetAllows(0.2)).allowed) {
        await logLine(
          jobId,
          `Останали ${forApify.length} непрочетени страници — отварям ги през Apify (истински браузър${blocked ? ' + residential IP' : ''}).`
        );
        const r = await apifyRenderHtml(forApify, { resident: blocked });
        if (r.usd > 0) await addApifySpend(r.usd, `${job.domain}: ${forApify.length} стр.`);
        for (const page of r.pages) {
          if (!page.html || products.length >= limit) continue;
          const deep = parseProductPage(page.html, page.url || job.url, o.selectors ?? {});
          const cards = clean(extractListingProducts(page.html, page.url || job.url));
          const emb = extractEmbeddedProducts(page.html, page.url || job.url);
          const best =
            (deep.title && deep.price && !looksLikeJunkProduct(deep) && deep) ||
            cards[0] ||
            emb[0];
          if (!best) continue;
          products.push(best);
          await bump(jobId, 'parsed');
        }
        if (r.pages.length) {
          strategy = strategy && strategy !== 'heuristics' ? strategy : 'apify';
          await logLine(jobId, `Apify върна ${r.pages.length} страници (${r.usd.toFixed(3)} $).`);
        }
      }
      } // край на „ако картите от листинга не са ни дали продуктите“
    } else {
      await query(`update scrape_jobs set discovered = $2, parsed = $2 where id = $1`, [jobId, products.length]);
      await setStatus(jobId, 'parsing');
    }

    if (!products.length) {
      await setStatus(jobId, 'failed', { error: 'Нищо не успях да прочета.', finished_at: new Date() });
      if (job.schedule_id) await updateScheduleAfterJob(job.schedule_id, jobId).catch(() => undefined);
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
      // Ако страницата обявява редовна цена (промоция) — тя е най-точната „обичайна“.
      if (p.listPrice && p.listPrice > priceEur) reference = p.listPrice;

      const tags = [
        ...(o.addShopTag ? [shopLabel] : []),
        ...(ai?.tags ?? []).slice(0, 3),
        polarity === 'green' ? '#ТопНаходка' : '#ЧервенФлаг',
      ]
        .map((t) => (t.startsWith('#') ? t : `#${t.replace(/\s+/g, '')}`))
        .slice(0, 8);

      const description =
        stripShopMentions(
          ai?.description ??
            (p.description
              ? stripSeoTails(p.description).slice(0, 1200)
              : `${title} — цена от онлайн магазин.`),
          job.domain
        ).slice(0, 4000);

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
