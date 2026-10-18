/**
 * 🔎 Откриване на магазини, които СТАВАТ за сканиране.
 *
 * Зад таба „Търси магазини“ в секцията Скрапер.
 *
 * Защо съществува: човекът знае какво търси („био козметика“, „кафе на зърна“),
 * но не знае кой магазин е устроен така, че да може да се обходи автоматично.
 * Затова тук:
 *   1. търсим магазини по ключова дума (търсачки + AI за подсказка);
 *   2. ПРОВЕРЯВАМЕ всеки — истинска проба по веригата от стратегии;
 *   3. показваме само тези, които стават, с доказателство (примерни продукти);
 *   4. ако сайтът не пуска датацентъра (Cloudflare), го слагаме в опашката за
 *      домашния робот — така „не може“ става „може“.
 *
 * Нищо не се внася тук. Това е само разузнаване; обиколката се пуска после,
 * с познатия бутон.
 */
import { many, one, query } from '../db.js';
import { env, features } from '../env.js';
import { addApifySpend, apifyBudgetAllows, apifyReady, apifyRenderHtml } from './apifyBrowser.js';
import { browserAvailable, renderHtml } from './render.js';
import {
  collectFromOpencart,
  collectFromSitemap,
  extractCategoryLinks,
  extractEmbeddedProducts,
  extractListingProducts,
  looksLikeJunkProduct,
  extractProductLinks,
  normalizeStartUrl,
  parseProductPage,
  politeFetch,
  resolveUrl,
  tryMagento,
  tryProductFeed,
  tryShopify,
  tryWooCommerce,
  type FetchOpts,
  type RawProduct,
} from './scraper.js';

/* ====================================================== търсене на магазини */

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Домейни, които НЕ са онлайн магазин (или не ни трябват). */
const NOT_A_SHOP =
  /(facebook|instagram|youtube|youtu\.be|wikipedia|wikimedia|olx\.|alo\.bg|bazar\.bg|pazaruvaj|prodavalnik|google\.|bing\.|duckduckgo|mojeek|reddit|tiktok|twitter|x\.com|linkedin|pinterest|blogspot|wordpress\.(com|org)|medium\.com|yandex|temu|aliexpress|amazon\.|ebay\.|shein|prom\.ua|tripadvisor|booking\.com|airbnb|glassdoor|jobs\.|karieri|rabota|imot\.bg|imot\.|homes\.bg|address\.bg|mobile\.bg\/forum|emag\.bg|smartprice\.bg|lookthis\.online|cloudflare|gstatic|googleapis|gravatar|w3\.org|mastodon|tumblr|vk\.com|ok\.ru|telegram|whatsapp|threads\.net|snapchat|discord|twitch|spotify|apple\.com|microsoft\.com|quora|stackexchange|stackoverflow)/i;

export interface FoundShop {
  domain: string;
  url: string;
  title?: string;
  snippet?: string;
  foundVia: 'search' | 'ai' | 'manual';
  /** В кои търсачки е видян — за ранкиране (повече = по-сигурно реален). */
  seenBy?: string[];
}

/** Една търсачка → списък с домейни. Всяка може да се провали без да чупи останалите. */
async function httpText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'bg,en;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return '';
    return (await res.text()).slice(0, 900_000);
  } catch {
    return '';
  }
}

/** Изважда всички външни адреси от HTML на страница с резултати. */
function hostsFromHtml(html: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let href = m[1].replace(/&amp;/g, '&').trim();
    // DuckDuckGo увива резултатите: /l/?uddg=<encoded>
    const wrapped = /[?&]uddg=([^&"']+)/.exec(href);
    if (wrapped) {
      try {
        href = decodeURIComponent(wrapped[1]);
      } catch {
        continue;
      }
    }
    if (/^\/\//.test(href)) href = `https:${href}`;
    if (!/^https?:\/\//i.test(href)) continue;
    let u: URL;
    try {
      u = new URL(href);
    } catch {
      continue;
    }
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,8}$/i.test(host)) continue;
    if (NOT_A_SHOP.test(host)) continue;
    // Категории/продукти не ни трябват — искаме началния адрес на магазина.
    if (/\/(search|login|register)(\/|$|\?)/i.test(u.pathname)) continue;
    out.push(host);
  }
  return out;
}

const ENGINES: Array<{ name: string; url: (q: string) => string }> = [
  // Mojeek е най-приятелски към автомати (няма Cloudflare пред себе си).
  { name: 'mojeek', url: (q) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}` },
  { name: 'ddg', url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=bg-bg` },
  { name: 'ddg-lite', url: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}` },
  { name: 'bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=bg&cc=bg` },
];

/** Ключови думи, с които разширяваме заявката на човека. */
function queryVariants(q: string): string[] {
  const base = q.trim().replace(/\s+/g, ' ');
  return [`${base} онлайн магазин`, `${base} магазин цена`, `${base} shop България`];
}

export async function searchShops(keyword: string, limit = 12): Promise<FoundShop[]> {
  const variants = queryVariants(keyword);
  const hits = new Map<string, FoundShop>();

  for (const variant of variants) {
    for (const engine of ENGINES) {
      const html = await httpText(engine.url(variant));
      if (!html) continue;
      for (const host of hostsFromHtml(html)) {
        const found = hits.get(host) ?? {
          domain: host,
          url: `https://${host}/`,
          foundVia: 'search' as const,
          seenBy: [] as string[],
        };
        if (!found.seenBy!.includes(engine.name)) found.seenBy!.push(engine.name);
        found.title = found.title ?? host;
        hits.set(host, found);
      }
    }
    // Достатъчно сигурни резултати — не пускаме всички варианти напразно.
    if (hits.size >= limit * 2) break;
  }

  return [...hits.values()]
    .map((h) => ({
      ...h,
      // .bg първо, после тези, видени в повече от една търсачка.
      _score: (/\.bg$/i.test(h.domain) ? 10 : 0) + (h.seenBy?.length ?? 0) * 3,
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...rest }) => rest as FoundShop);
}

/**
 * Подсказка от модела, когато търсачките не вържат.
 * Не се вярва сляпо — всеки предложен домейн минава през същата проба.
 */
export async function aiSuggestShops(keyword: string, count = 10): Promise<FoundShop[]> {
  if (!features.assistant || !env.DEEPSEEK_API_KEY) return [];
  const system = `Ти помагаш на българското приложение SmartPrice да намери РЕАЛНИ български онлайн магазини.
Връщай само магазини, които наистина съществуват и продават стоки онлайн (не услуги, не форуми, не маркетплейси).
НЕ включвай: emag.bg, olx.bg, aliexpress, amazon, temu, facebook, instagram.
Отговаряй САМО с валиден JSON: {"shops":[{"domain":"magazin.bg","title":"Кратко име"}]}`;
  const prompt = `Магазини, които продават: ${keyword}\nДай до ${count} домейна. Само домейни, в които си сигурен.`;

  try {
    const res = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.ASSISTANT_MODEL,
        effort: 'low',
        max_tokens: 900,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = (data.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(raw) as { shops?: Array<{ domain?: string; title?: string }> };
    const out: FoundShop[] = [];
    for (const s of parsed.shops ?? []) {
      const host = String(s.domain ?? '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
      if (!/^[a-z0-9.-]+\.[a-z]{2,8}$/.test(host)) continue;
      if (NOT_A_SHOP.test(host)) continue;
      out.push({ domain: host, url: `https://${host}/`, title: s.title, foundVia: 'ai' });
      if (out.length >= count) break;
    }
    return out;
  } catch {
    return [];
  }
}

/* ============================================== може ли да се сканира сайтът */

export type CheckStatus = 'ok' | 'local' | 'manual' | 'error' | 'robots' | 'apify';

export interface SampleProduct {
  title?: string;
  price?: number;
  imageUrl?: string;
  url: string;
}

export interface ShopCheck {
  domain: string;
  url: string;
  httpStatus: number | null;
  platform: string;
  status: CheckStatus;
  strategy: string | null;
  scrapable: boolean;
  fromServer: boolean;
  productsFound: number;
  pagesProbed: number;
  sample: SampleProduct[];
  reason: string;
}

const CF_WALL =
  /just a moment|cf-browser-verification|attention required|checking your browser|cf_chl|enable javascript and cookies to continue|verify you are human|достъпът е отказан|access denied|cloudflare ray id/i;

function detectPlatform(html: string): string {
  if (/cdn\.shopify\.com|shopify\.theme|myshopify/i.test(html)) return 'shopify';
  if (/woocommerce|wp-content\/plugins\/woocommerce/i.test(html)) return 'woocommerce';
  if (/prestashop|var\/themes\/|prestashop\.com/i.test(html)) return 'prestashop';
  if (/data-mage-init|mage\/cookies|Magento_|static\/version\d|frontend\/[A-Za-z]+\/[A-Za-z]+\//.test(html)) return 'magento';
  if (/opencart|route=product\/|index\.php\?route=/i.test(html)) return 'opencart';
  if (/wp-content|wp-includes/i.test(html)) return 'wordpress';
  if (/__NEXT_DATA__|_next\/static/i.test(html)) return 'nextjs';
  return 'other';
}

/** Изглежда ли, че страницата се рисува от JavaScript (празен <div id="root">)? */
function looksLikeSpa(html: string): boolean {
  const links = (html.match(/<a\s[^>]*href=/gi) ?? []).length;
  const shell = /<div id="(root|app|__next)"><\/div>|<app-root|ng-version=|data-reactroot/i.test(html);
  return shell && links < 15;
}

/** Чупи ли се сайтът при заявка от датацентър? */
function wallReason(status: number, html: string): string | null {
  if (CF_WALL.test(html)) return 'Сайтът е зад Cloudflare / бот-защита — пуска само домашен IP.';
  if (status === 403) return 'Връща 403 (отказан достъп) за сървъра — иска домашен IP.';
  if (status === 429) return 'Връща 429 (твърде много заявки) — ограничава автомати.';
  if (status === 503) return 'Връща 503 (услугата е недостъпна) — вероятно проверка на браузъра.';
  return null;
}

function toSample(products: RawProduct[], base: string): SampleProduct[] {
  return products
    .filter((p) => p.title || p.price)
    .slice(0, 4)
    .map((p) => ({
      title: p.title,
      price: p.price,
      imageUrl: p.imageUrl ? resolveUrl(p.imageUrl, base) : undefined,
      url: p.sourceUrl || base,
    }));
}

/**
 * Годи ли се резултатът за „този сайт става“?
 *
 * Достатъчно е ЕДИН истински продукт (заглавие + цена + не е боклук). Проверката
 * `looksLikeJunkProduct` е важна: без нея bauhaus.bg минаваше за сканируем заради
 * категорията „Навеси за автомобили“ с цена от рекламна картинка.
 */
function good(products: RawProduct[] | null): boolean {
  return !!products && products.some((p) => !!p.title && (p.price ?? 0) > 0 && !looksLikeJunkProduct(p));
}

/** Маха категориите/банерите с цена от резултата, за да не заблуждават. */
function clean(products: RawProduct[]): RawProduct[] {
  return products.filter((p) => p.title && !looksLikeJunkProduct(p));
}

/**
 * Проба на един магазин: може ли да се обходи автоматично?
 *
 * Върви по евтиното: JSON API-та → sitemap → карти в листинга → категории.
 * Спира на първото, което даде реален продукт (заглавие + цена).
 */
export async function checkShop(
  domain: string,
  opts: { delayMs?: number; maxPages?: number; deadline?: number } = {}
): Promise<ShopCheck> {
  const base: ShopCheck = {
    domain,
    url: `https://${domain}/`,
    httpStatus: null,
    platform: 'other',
    status: 'error',
    strategy: null,
    scrapable: false,
    fromServer: false,
    productsFound: 0,
    pagesProbed: 0,
    sample: [],
    reason: 'Не успях да отворя сайта.',
  };

  /**
   * Ако сайтът е станал само с изключен robots.txt, го показваме като отделен
   * статус — човекът трябва да знае, че обиколката ще мине само с тази отметка.
   */
  const finish = (r: ShopCheck): ShopCheck =>
    r.status === 'ok' && robotsBlocked
      ? { ...r, status: 'robots' as const, reason: `Работи, но само с ИЗКЛЮЧЕН robots.txt (сайтът забранява на ботове). ${r.reason}` }
      : r;

  // Проверката върви в HTTP заявка през Cloudflare, която се реже след ~100 сек.
  // Затова всяка заявка получава толкова време, колкото остава до крайния срок —
  // така една бавна страница не прахосва целия бюджет.
  const deadline = opts.deadline ?? Date.now() + 45_000;
  const left = () => deadline - Date.now();
  // Ако robots.txt забранява на ботове (technopolis.bg), питаме с изключен robots —
  // иначе сайтът изглежда „не става“, а всъщност става (панелът има тази опция).
  let robotsBlocked = false;
  const fopts = (): FetchOpts => ({
    respectRobots: !robotsBlocked,
    delayMs: opts.delayMs ?? 200,
    timeoutMs: Math.max(2500, Math.min(12_000, left())),
    maxPages: 3,
    maxSitemaps: 3,
  });

  const budget = Math.max(4, Math.min(12, opts.maxPages ?? 8));

  // ---- 1. Началната страница: платформа, бот-защита, SPA -------------------
  let home = '';
  let homeStatus = 0;
  try {
    const res = await politeFetch(base.url, fopts());
    home = res.text;
    homeStatus = res.status;
    base.pagesProbed++;
    base.httpStatus = res.status;
    if (res.url) base.url = res.url;
    if (!res.ok && !res.text.trim()) {
      base.reason = `Сайтът отговори с HTTP ${res.status} и празно тяло.`;
      return finish(base);
    }
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (!/robots\.txt/i.test(msg)) {
      base.status = 'error';
      base.reason = msg;
      return finish(base);
    }
    // robots.txt забранява на ботове. Питаме още веднъж с изключен robots — така
    // разбираме дали сайтът ИНАЧЕ става, вместо просто да го отпишем.
    robotsBlocked = true;
    try {
      const res = await politeFetch(base.url, fopts());
      home = res.text;
      homeStatus = res.status;
      base.pagesProbed++;
      base.httpStatus = res.status;
      if (res.url) base.url = res.url;
    } catch (err2) {
      base.status = 'robots';
      base.reason = `robots.txt забранява обхождането, а с изключен robots страницата пак не се отвори (${(err2 as Error)
        .message.slice(0, 70)}).`;
      return finish(base);
    }
  }

  // robots.txt може да е забранил само вътрешните адреси — тогава home е празен.
  base.platform = home ? detectPlatform(home) : 'other';

  /**
   * Пробва през Apify: истински браузър от тяхна машина, при нужда с жилищно
   * (residential) прокси. Точно това минава Cloudflare, който не пуска сървъра.
   * Плаща се — затова само когато има дневен бюджет.
   */
  const viaApify = async (resident: boolean): Promise<ShopCheck | null> => {
    if (!(await apifyReady())) return null;
    if (!(await apifyBudgetAllows(0.15)).allowed) return null;
    const r = await apifyRenderHtml([base.url], { resident, timeoutMs: 130_000 });
    if (r.usd > 0) await addApifySpend(r.usd, `проверка ${base.domain}`);
    const page = r.pages.find((x) => x.html);
    if (!r.ok || !page?.html) return null;
    const at = page.url || base.url;
    const found = [...clean(extractListingProducts(page.html, at)), ...extractEmbeddedProducts(page.html, at)];
    const single = parseProductPage(page.html, at, {});
    if (single.title && single.price && !looksLikeJunkProduct(single)) found.push(single);
    if (!good(found)) return null;
    return {
      ...base,
      status: 'apify',
      strategy: 'apify',
      scrapable: true,
      fromServer: true,
      platform: detectPlatform(page.html),
      pagesProbed: base.pagesProbed + 1,
      productsFound: found.length,
      sample: toSample(found, at),
      reason: `Работи през Apify (истински браузър${resident ? ' + residential IP' : ''}) — сайтът не пуска нашия сървър.`,
    };
  };

  const wall = wallReason(homeStatus, home);
  if (wall) {
    base.status = 'local';
    base.reason = wall;
    // Доказателство, че сайтът изобщо съществува (иначе не пускаме заявка към робота).
    if (homeStatus >= 200 && homeStatus < 500) {
      base.reason += ' Ще го обходи домашният робот (scripts/scrape_local.py).';
    }
    // Първо пробваме с Apify + residential — това е начинът да минем Cloudflare
    // без да зависим от това дали домашният компютър е включен.
    const ap = await viaApify(true);
    if (ap) return finish(ap);
    return finish(base);
  }

  const origin = new URL(base.url).origin;

  // ---- 2. Верига от стратегии: първото, което даде продукт, печели ---------
  // Първо евтиното: 1–2 заявки и точен отговор (магазинните JSON API-та).
  const attempts: Array<{ name: string; run: () => Promise<RawProduct[] | null> }> = [
    { name: 'shopify-json', run: () => tryShopify(origin, 4, fopts()) },
    { name: 'woocommerce-store-api', run: () => tryWooCommerce(origin, 4, { ...fopts(), maxPages: 1 }) },
    { name: 'product-feed', run: () => tryProductFeed(origin, 4, fopts()) },
  ];
  // По-нататък: платформи, които искат повече заявки (затова са след картите).
  const heavyAttempts: Array<{ name: string; run: () => Promise<RawProduct[] | null> }> = [
    { name: 'magento', run: () => tryMagento(origin, 4, fopts()) },
    { name: 'opencart', run: () => collectFromOpencart(origin, 4, fopts()) },
  ];

  for (const a of attempts) {
    if (base.pagesProbed >= budget) break;
    try {
      const items = await a.run();
      base.pagesProbed++;
      if (good(items)) {
        base.status = 'ok';
        base.scrapable = true;
        base.fromServer = true;
        base.strategy = a.name;
        base.productsFound = items!.length;
        base.sample = toSample(items!, base.url);
        base.reason = `Работи веднага от сървъра (${a.name}).`;
        return finish(base);
      }
    } catch {
      /* следващата стратегия */
    }
  }

  // ---- 3. Картите на началната страница (0 допълнителни заявки) ------------
  if (home) {
    const cards = clean(extractListingProducts(home, base.url));
    if (good(cards)) {
      base.status = 'ok';
      base.scrapable = true;
      base.fromServer = true;
      base.strategy = 'listing-cards';
      base.productsFound = cards.length;
      base.sample = toSample(cards, base.url);
      base.reason = 'Работи от картите на началната страница.';
      return finish(base);
    }
  }

  // ---- 3б. Вграден JSON в страницата (0 заявки) --------------------------
  // Next.js/Nuxt/Angular SSR магазини слагат данните в JSON вътре в HTML-а.
  if (home) {
    const embedded = extractEmbeddedProducts(home, base.url);
    if (good(embedded)) {
      base.status = 'ok';
      base.scrapable = true;
      base.fromServer = true;
      base.strategy = 'embedded-json';
      base.productsFound = embedded.length;
      base.sample = toSample(embedded, base.url);
      base.reason = 'Работи от данните, вградени в страницата (JSON).';
      return finish(base);
    }
  }

  // ---- 3в. Истински браузър — сайтовете, които се рисуват с JavaScript -----
  // technomarket.bg и подобни връщат HTML без цени; цените идват след като
  // JavaScript-ът се изпълни. Затова тук отваряме страницата с Chromium.
  if (browserAvailable()) {
    const r = await renderHtml(base.url, { waitMs: 1500 });
    if (r?.html) {
      base.pagesProbed++;
      const rendered = [
        ...clean(extractListingProducts(r.html, r.url)),
        ...extractEmbeddedProducts(r.html, r.url),
      ];
      const parsed = parseProductPage(r.html, r.url, {});
      if (parsed.title && parsed.price && !looksLikeJunkProduct(parsed)) rendered.push(parsed);
      if (good(rendered)) {
        base.status = 'ok';
        base.scrapable = true;
        base.fromServer = true;
        base.platform = detectPlatform(r.html);
        base.strategy = 'render';
        base.productsFound = rendered.length;
        base.sample = toSample(rendered, r.url);
        base.reason = 'Работи след отваряне с истински браузър (сайтът е JavaScript).';
        return finish(base);
      }
    }
  }

  // ---- 4. По-тежките платформи (искат по няколко заявки) ------------------
  for (const a of heavyAttempts) {
    if (base.pagesProbed >= budget) break;
    try {
      const items = await a.run();
      base.pagesProbed++;
      if (good(items)) {
        base.status = 'ok';
        base.scrapable = true;
        base.fromServer = true;
        base.strategy = a.name;
        base.productsFound = items!.length;
        base.sample = toSample(items!, base.url);
        base.reason = `Работи от сървъра (${a.name}).`;
        return finish(base);
      }
    } catch {
      /* следващата стратегия */
    }
  }
  if (base.pagesProbed > 1 && base.platform === 'other') base.platform = detectPlatform(home);

  // ---- 5. sitemap → проверяваме 1–2 продуктови страници -------------------
  if (base.pagesProbed < budget) {
    try {
      const sm = await collectFromSitemap(base.url, 6, fopts());
      base.pagesProbed++;
      if (sm.urls.length) {
        const sampled: RawProduct[] = [];
        for (const u of sm.urls.slice(0, 2)) {
          if (base.pagesProbed >= budget) break;
          try {
            const page = await politeFetch(u, fopts());
            base.pagesProbed++;
            let p = parseProductPage(page.text, page.url, {});
            // Цената може да е само след като JavaScript-ът се изпълни
            // (technomarket.bg) — тогава отваряме продуктовата страница с браузър.
            if (!p.price && browserAvailable()) {
              const r = await renderHtml(u, { waitMs: 900 });
              if (r?.html) {
                base.pagesProbed++;
                const deep = parseProductPage(r.html, r.url, {});
                if (deep.price) p = deep;
              }
            }
            if (p.title && (p.price ?? 0) > 0 && !looksLikeJunkProduct(p)) sampled.push(p);
          } catch {
            /* пропускаме */
          }
        }
        if (sampled.length) {
          base.status = 'ok';
          base.scrapable = true;
          base.fromServer = true;
          base.strategy = sm.fromProductSitemap ? 'product-sitemap' : 'sitemap';
          base.productsFound = sm.urls.length;
          base.sample = toSample(sampled, base.url);
          base.reason = `Работи през sitemap (${sm.usedSitemap ?? 'sitemap.xml'}).`;
          return finish(base);
        }
      }
    } catch {
      /* продължаваме */
    }
  }

  // ---- 6. Категория → листинг → продуктова страница -----------------------
  if (home && base.pagesProbed < budget) {
    const cats = extractCategoryLinks(home, base.url).slice(0, 2);
    for (const cat of cats) {
      if (base.pagesProbed >= budget) break;
      try {
        const page = await politeFetch(cat, fopts());
        base.pagesProbed++;
        const cards = extractListingProducts(page.text, page.url);
        if (good(cards)) {
          base.status = 'ok';
          base.scrapable = true;
          base.fromServer = true;
          base.strategy = 'listing';
          base.productsFound = cards.length;
          base.sample = toSample(cards, base.url);
          base.reason = 'Работи от листинга на категория.';
          return finish(base);
        }
        const links = extractProductLinks(page.text, page.url);
        for (const link of links.slice(0, 2)) {
          if (base.pagesProbed >= budget) break;
          const prod = await politeFetch(link, fopts());
          base.pagesProbed++;
          const p = parseProductPage(prod.text, prod.url, {});
          if (p.title && (p.price ?? 0) > 0) {
            base.status = 'ok';
            base.scrapable = true;
            base.fromServer = true;
            base.strategy = 'listing-jsonld';
            base.productsFound = links.length;
            base.sample = toSample([p], base.url);
            base.reason = 'Работи през страница на продукт.';
            return finish(base);
          }
        }
      } catch {
        /* следващата категория */
      }
    }
  }

  // ---- 5б. Apify без residential (по-евтино) — ако собственият браузър не помогна
  {
    const ap = await viaApify(false);
    if (ap) return finish(ap);
  }

  // ---- 6. Не стана автоматично, но сайтът отговаря -----------------------
  base.status = 'manual';
  base.scrapable = false;
  base.fromServer = false;
  const anchorCount = (home.match(/<a\s[^>]*href=/gi) ?? []).length;
  if (home && home.length < 3000 && anchorCount < 3) {
    // Празна страница с 200 обикновено значи „провери, че си браузър“.
    // Домашният робот минава през това, затова е честно да го пратим там.
    base.status = 'local';
    base.reason =
      'Сайтът връща почти празна страница (проверка на браузъра/бот-защита). Ще го обходи домашният робот.';
    return base;
  }
  if (looksLikeSpa(home)) {
    base.reason =
      'Магазинът се рисува с JavaScript (едностранично приложение) — автоматичното четене не вижда продуктите. Нужни са ръчни селектори.';
  } else {
    base.reason =
      'Сайтът отговаря, но не открих продукти с цена автоматично. Пусни „Проба“ с ръчни селектори (title/price/image).';
  }
  return base;
}

/* =============================================================== запис в база */

export interface CandidateRow {
  domain: string;
  url: string;
  title: string | null;
  platform: string | null;
  strategy: string | null;
  status: string;
  reason: string | null;
  scrapable: boolean;
  products_found: number;
  pages_probed: number;
  sample: SampleProduct[];
  query: string | null;
  found_via: string;
  checked_at: string | null;
}

async function saveCandidate(c: ShopCheck, meta: { title?: string | null; query?: string; foundVia: string }): Promise<void> {
  await query(
    `insert into shop_candidates
       (domain, url, title, found_via, query, platform, strategy, scrapable, status, reason,
        http_status, products_found, pages_probed, sample, checked_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb, now(), now())
     on conflict (domain) do update set
       url = excluded.url,
       title = coalesce(excluded.title, shop_candidates.title),
       found_via = excluded.found_via,
       query = excluded.query,
       platform = excluded.platform,
       strategy = excluded.strategy,
       scrapable = excluded.scrapable,
       status = excluded.status,
       reason = excluded.reason,
       http_status = excluded.http_status,
       products_found = excluded.products_found,
       pages_probed = excluded.pages_probed,
       sample = excluded.sample,
       checked_at = now(),
       updated_at = now(),
       rejected_at = null`,
    [
      c.domain,
      c.url,
      meta.title ?? null,
      meta.foundVia,
      meta.query ?? null,
      c.platform,
      c.strategy,
      c.scrapable,
      c.status,
      c.reason,
      c.httpStatus,
      c.productsFound,
      c.pagesProbed,
      JSON.stringify(c.sample),
    ]
  );
}

/** Колко скорошна проверка приемаме за валидна (иначе не пускаме заявки пак). */
const FRESH_HOURS = 12;

async function freshCheck(domain: string): Promise<CandidateRow | null> {
  return one<CandidateRow>(
    `select domain, url, title, platform, strategy, status, reason, scrapable,
            products_found, pages_probed, sample, query, found_via, checked_at::text
       from shop_candidates
      where domain = $1 and checked_at is not null
        and checked_at > now() - ($2 || ' hours')::interval`,
    [domain, String(FRESH_HOURS)]
  );
}

export interface DiscoverResult {
  query: string;
  checked: number;
  items: CandidateRow[];
  skippedFresh: string[];
  usedAi: boolean;
  /** Стигнахме ли лимита за една заявка (проверката продължава при следващо пускане). */
  stopped?: boolean;
  note?: string;
}

/**
 * Пълното действие на таба: търси → проверява → връща само сканируемите.
 * Проверките вървят по 3 наведнъж, за да не е бавно (но и да не е грубо към сайтовете).
 */
export async function discoverShops(input: {
  query?: string;
  domains?: string[];
  limit?: number;
  force?: boolean;
}): Promise<DiscoverResult> {
  const limit = Math.max(1, Math.min(25, input.limit ?? 12));
  const queryText = (input.query ?? '').trim();
  const manual = (input.domains ?? [])
    .map((d) =>
      d
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '')
    )
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,8}$/.test(d));

  let found: FoundShop[] = [];
  let usedAi = false;

  if (manual.length) {
    found = manual.map((domain) => ({ domain, url: `https://${domain}/`, foundVia: 'manual' as const }));
  } else if (queryText) {
    found = await searchShops(queryText, limit);
    if (found.length < 4) {
      // Търсачките не вързаха — питаме и модела. Пак се проверява.
      const ai = await aiSuggestShops(queryText, Math.max(6, limit));
      if (ai.length) {
        usedAi = true;
        const known = new Set(found.map((f) => f.domain));
        found = [...found, ...ai.filter((a) => !known.has(a.domain))];
      }
    }
  } else {
    throw new Error('Дай ключова дума или поне един адрес.');
  }

  const candidates = found.slice(0, limit);
  const items: CandidateRow[] = [];
  const skippedFresh: string[] = [];
  const queue = [...candidates];

  // Проверката върви в една HTTP заявка през Cloudflare, която се реже на ~100 сек.
  // Затова спираме сами на 85 сек. и връщаме каквото сме проверили — честно,
  // вместо да върнем грешка и да загубим цялата работа.
  const totalDeadline = Date.now() + 85_000;
  let stopped = false;

  const worker = async () => {
    for (;;) {
      if (Date.now() > totalDeadline) {
        stopped = true;
        return;
      }
      const next = queue.shift();
      if (!next) return;
      const siteDeadline = Math.min(totalDeadline, Date.now() + 45_000);
      try {
        if (!input.force) {
          const fresh = await freshCheck(next.domain);
          if (fresh) {
            skippedFresh.push(next.domain);
            items.push(fresh);
            continue;
          }
        }
        const c = await checkShop(next.domain, { delayMs: 200, deadline: Math.min(siteDeadline, Date.now() + 45_000) });
        await saveCandidate(c, { title: next.title, query: queryText || undefined, foundVia: next.foundVia });
        const saved = await one<CandidateRow>(
          `select domain, url, title, platform, strategy, status, reason, scrapable,
                  products_found, pages_probed, sample, query, found_via, checked_at::text
             from shop_candidates where domain = $1`,
          [next.domain]
        );
        if (saved) items.push(saved);
      } catch (err) {
        items.push({
          domain: next.domain,
          url: next.url,
          title: next.title ?? null,
          platform: null,
          strategy: null,
          status: 'error',
          reason: (err as Error).message,
          scrapable: false,
          products_found: 0,
          pages_probed: 0,
          sample: [],
          query: queryText || null,
          found_via: next.foundVia,
          checked_at: new Date().toISOString(),
        });
      }
    }
  };

  await Promise.all([worker(), worker(), worker()]);

  // Сканируемите най-отпред — това е отговорът на въпроса „кои стават“.
  const order: Record<string, number> = { ok: 0, local: 1, manual: 2, error: 3 };
  items.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  const untouched = queue.length;
  return {
    query: queryText || manual.join(', '),
    checked: items.length,
    items,
    skippedFresh,
    usedAi,
    stopped,
    note:
      candidates.length === 0
        ? 'Не намерих нищо по тази ключова дума — пробвай по-общо или дай адрес.'
        : stopped || untouched > 0
          ? `Стигнах до лимита за една заявка — проверих ${items.length} от ${candidates.length}. Пусни пак, за да продължа (проверените се помнят 12 ч).`
          : undefined,
  };
}

export async function listCandidates(filter: { status?: string; q?: string; limit?: number } = {}): Promise<CandidateRow[]> {
  const limit = Math.max(1, Math.min(200, filter.limit ?? 60));
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.status && filter.status !== 'all') {
    params.push(filter.status);
    where.push(`status = $${params.length}`);
  }
  if (filter.q) {
    params.push(`%${filter.q.toLowerCase()}%`);
    where.push(`(lower(domain) like $${params.length} or lower(coalesce(title,'')) like $${params.length})`);
  }
  params.push(limit);
  return many<CandidateRow>(
    `select domain, url, title, platform, strategy, status, reason, scrapable,
            products_found, pages_probed, sample, query, found_via, checked_at::text
       from shop_candidates
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by (status = 'ok') desc, (status = 'local') desc, coalesce(checked_at, created_at) desc
      limit $${params.length}`,
    params
  );
}

export async function rejectCandidate(domain: string): Promise<void> {
  await query(`update shop_candidates set status = 'rejected', rejected_at = now(), updated_at = now() where domain = $1`, [
    domain,
  ]);
}

export async function rememberJob(domain: string, jobId: string): Promise<void> {
  await query(`update shop_candidates set last_job_id = $2, updated_at = now() where domain = $1`, [domain, jobId]);
}

/* ================================================== опашка за домашния робот */

export interface LocalScanRow {
  id: string;
  domain: string;
  url: string;
  count: number;
  status: string;
  note: string | null;
  created_at: string;
}

/**
 * Слага сайт в опашката за домашния робот.
 *
 * Това е отговорът на „ако не може да се сканира, направи така че да може“:
 * сайтовете зад Cloudflare не пускат датацентъра, но се отварят от домашен IP.
 */
export async function queueLocalScan(input: {
  domain: string;
  count?: number;
  userId?: string | null;
  note?: string | null;
}): Promise<LocalScanRow> {
  const domain = input.domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
  const row = await one<LocalScanRow>(
    `insert into local_scan_queue (domain, url, count, requested_by, note)
     values ($1, $2, $3, $4, $5)
     on conflict (domain) where status in ('pending','taken')
       do update set count = greatest(local_scan_queue.count, excluded.count), note = coalesce(excluded.note, local_scan_queue.note)
     returning id::text, domain, url, count, status, note, created_at::text`,
    [domain, `https://${domain}/`, Math.max(1, Math.min(500, input.count ?? 10)), input.userId ?? null, input.note ?? null]
  );
  return row!;
}

export async function pendingLocalScans(limit = 20): Promise<LocalScanRow[]> {
  return many<LocalScanRow>(
    `select id::text, domain, url, count, status, note, created_at::text
       from local_scan_queue
      where status = 'pending'
      order by created_at asc
      limit $1`,
    [Math.max(1, Math.min(100, limit))]
  );
}

/** Роботът взима заявка (за да не я обхожда втори път). */
export async function takeLocalScans(domains: string[]): Promise<number> {
  if (!domains.length) return 0;
  const res = await query(
    `update local_scan_queue set status = 'taken', taken_at = now()
      where status = 'pending' and domain = any($1::text[])`,
    [domains]
  );
  return res.rowCount ?? 0;
}

export async function finishLocalScan(input: {
  domain: string;
  ok: boolean;
  imported?: number;
  note?: string | null;
}): Promise<void> {
  await query(
    `update local_scan_queue
        set status = $2, imported = coalesce($3, imported), note = coalesce($4, note), finished_at = now()
      where domain = $1 and status in ('pending','taken')`,
    [input.domain, input.ok ? 'done' : 'failed', input.imported ?? null, input.note ?? null]
  );
  if (input.ok) {
    await query(
      `update shop_candidates
          set status = 'ok', scrapable = true, strategy = coalesce(strategy, 'local-robot'),
              reason = 'Обходен от домашния робот (домашен IP).', updated_at = now()
        where domain = $1 and status = 'local'`,
      [input.domain]
    );
  }
}

export async function localQueueStats(): Promise<{ pending: number; taken: number; done: number; failed: number }> {
  const row = await one<{ pending: number; taken: number; done: number; failed: number }>(
    `select count(*) filter (where status = 'pending')::int as pending,
            count(*) filter (where status = 'taken')::int as taken,
            count(*) filter (where status = 'done')::int as done,
            count(*) filter (where status = 'failed')::int as failed
       from local_scan_queue`
  );
  return row ?? { pending: 0, taken: 0, done: 0, failed: 0 };
}
