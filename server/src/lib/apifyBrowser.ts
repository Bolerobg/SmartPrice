/**
 * ☁️ Последна инстанция: отваряме страницата през Apify (истински браузър).
 *
 * Кога НИ ТРЯБВА:
 *   • сайтът блокира нашия сървър (Cloudflare → 403 / празна страница) — от
 *     Apify-ските IP-та (при нужда с RESIDENTIAL прокси) същият сайт се отваря;
 *   • страницата е изцяло JavaScript и нашият Chromium не се справя.
 *
 * Това струва пари (планът е STARTER, $19/месец), затова:
 *   • пуска се САМО когато всичко друго се е провалило;
 *   • има дневен лимит (`scraper_apify_daily_usd`, по подразбиране $0.50) и
 *     похарченото се пази по дни — скенерът не може да изяде целия план;
 *   • една заявка = няколко адреса НАВЕДНЪЖ (един actor run), не по един на адрес;
 *   • връщаме целия HTML, за да мине през СЪЩАТА ни логика (JSON-LD, вграден
 *     JSON, евристики за цена) — не пишем втори екстрактор.
 */
import { env } from '../env.js';
import { getSetting, setSetting } from './settings.js';

/** Актьорът: истински Playwright браузър, връща каквото му кажем от страницата. */
const ACTOR = 'apify~playwright-scraper';

/** Колко адреса най-много в един пуск (всеки адрес струва пари и време). */
export const MAX_URLS_PER_RUN = 8;

export async function apifyToken(): Promise<string> {
  const saved = await getSetting('apify_api_token', '');
  return (saved || env.APIFY_API_TOKEN || '').trim();
}

export async function apifyReady(): Promise<boolean> {
  return Boolean(await apifyToken());
}

/* ============================================================ дневен бюджет */

const LIMIT_KEY = 'scraper_apify_daily_usd';
const SPEND_KEY = 'scraper_apify_spend_days';

const DEFAULT_DAILY_USD = 0.5;

export async function apifyDailyLimit(): Promise<number> {
  const raw = await getSetting(LIMIT_KEY, String(DEFAULT_DAILY_USD));
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_DAILY_USD;
}

export async function setApifyDailyLimit(usd: number): Promise<void> {
  await setSetting(LIMIT_KEY, String(Math.max(0, Math.min(19, usd))));
}

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Похарченото днес (пазим последните 30 дни). */
export async function apifySpent(): Promise<{ today: number; month: number }> {
  const raw = await getSetting(SPEND_KEY, '{}');
  let data: Record<string, number> = {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'number') data[k] = v;
  } catch {
    data = {};
  }
  const today = data[dayKey()] ?? 0;
  const month = Object.values(data).reduce((a, b) => a + b, 0);
  return { today, month };
}

export async function addApifySpend(usd: number, note: string): Promise<void> {
  if (!(usd > 0)) return;
  const raw = await getSetting(SPEND_KEY, '{}');
  let data: Record<string, number> = {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'number') data[k] = v;
  } catch {
    data = {};
  }
  const d = dayKey();
  data[d] = Number(((data[d] ?? 0) + usd).toFixed(4));
  // Пазим само последните 30 дни, за да не расте безкрайно.
  const keys = Object.keys(data).sort().slice(-30);
  const trimmed: Record<string, number> = {};
  for (const k of keys) trimmed[k] = data[k]!;
  await setSetting(SPEND_KEY, JSON.stringify(trimmed));
  // Дневникът е отделно — за да се вижда КОЙ сайт колко е струвал.
  const logRaw = await getSetting('scraper_apify_log', '[]');
  let log: Array<Record<string, unknown>> = [];
  try {
    log = JSON.parse(logRaw) as Array<Record<string, unknown>>;
  } catch {
    log = [];
  }
  log.unshift({ at: new Date().toISOString(), usd: Number(usd.toFixed(4)), note: note.slice(0, 120) });
  await setSetting('scraper_apify_log', JSON.stringify(log.slice(0, 60)));
}

/** Има ли право едно пускане да похарчи приблизително толкова. */
export async function apifyBudgetAllows(estimateUsd = 0.15): Promise<{ allowed: boolean; today: number; limit: number }> {
  const limit = await apifyDailyLimit();
  const { today } = await apifySpent();
  if (limit <= 0) return { allowed: false, today, limit };
  return { allowed: today + estimateUsd <= limit, today, limit };
}

/* ============================================================ рендиране */

export interface ApifyPage {
  url: string;
  html?: string;
  error?: string;
}

export interface ApifyRenderResult {
  ok: boolean;
  pages: ApifyPage[];
  usd: number;
  reason?: string;
}

/**
 * Функцията, която се изпълнява В браузъра на Apify.
 * Връща суровия HTML на страницата — за да го обработим със същата логика,
 * с която обработваме и нашите HTTP заявки.
 */
/** Дължината на HTML-а, който връщаме (по-дълъг = по-скъпо, но ни трябва целият). */
const MAX_HTML = 900_000;

/**
 * Функцията, която се изпълнява В браузъра на Apify.
 *
 * ВАЖНО (проверено на живо, 18.10.2026):
 *   • `preNavigationHooks` в входа НЕ се приема — пускът пада с FAILED, затова НЕ го ползваме;
 *   • снимките се спират през `launchContext.launchOptions.args` (работи), не с `page.route`;
 *   • актьорът сам чака `networkidle` с 60 сек таймаут и `navigationTimeoutSecs` не го
 *     променя — затова сайт, който не „утихва“ (Cloudflare проверка), пада с грешка
 *     вместо да върне страницата. За такива сайтове не разчитай на Apify.
 *   • `page.content()` е по-надеждно от `page.evaluate(() => documentElement.outerHTML)`.
 */
const PAGE_FUNCTION = `async function pageFunction(context) {
  const { page, request } = context;
  let html = '';
  let error = null;
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(function () {});
    await page.waitForTimeout(3500);
  } catch (e) { error = String((e && e.message) || e).slice(0, 300); }
  try { html = await page.content(); } catch (e) { error = error || String((e && e.message) || e).slice(0, 300); }
  return { url: request.url, html: String(html).slice(0, MAX_HTML), error: error };
}`;

/** Колко струва едно пускане (взимаме го от последния run на актьора). */
async function lastRunCost(token: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/runs?token=${encodeURIComponent(token)}&limit=1&desc=true`,
      { signal: AbortSignal.timeout(20_000) }
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { data?: { items?: Array<{ usageTotalUsd?: number }> } };
    const usd = data.data?.items?.[0]?.usageTotalUsd;
    return typeof usd === 'number' ? usd : 0;
  } catch {
    return 0;
  }
}

/**
 * Отваря до MAX_URLS_PER_RUN адреса с истински браузър през Apify и връща HTML-а.
 *
 * `resident: true` пуска през жилищни (residential) проксита — това е начинът да
 * минем Cloudflare, който не пуска датацентрове. По-скъпо е, затова не е винаги.
 */
/**
 * Универсален обход на УПОРИТ сайт през Apify Website Content Crawler.
 *
 * Защо: този актьор е с безплатен модел на резултат (плащаш само изчислителни
 * единици) и минава там, където нашият сървър и домашният робот се провалят.
 * Проверено на живо (18.10.2026): ikea.bg (13 195 знака), decathlon.bg
 * (Cloudflare!), mr-bricolage.bg — по $0.02–0.07 на обход. emag.bg дава
 * капча (511) и този актьор НЕ го решава — не обещаваме чудеса.
 *
 * Връща и HTML (за нашите селектори), и markdown (за AI), и кода на отговора.
 */
export interface CrawlPage {
  url: string;
  html: string;
  markdown: string;
  title: string;
  /** HTTP кодът, който сайтът е върнал (511 = капча, значи не сме влезли). */
  status: number;
}

export async function apifyCrawl(
  urls: string[],
  opts: { maxPages?: number; resident?: boolean; timeoutMs?: number } = {}
): Promise<{ ok: boolean; pages: CrawlPage[]; usd: number }> {
  const empty = { ok: false, pages: [] as CrawlPage[], usd: 0 };
  const token = await apifyToken().catch(() => '');
  if (!token) return empty;
  if (!(await apifyReady().catch(() => false))) return empty;
  if (!(await apifyBudgetAllows(0.05).catch(() => ({ allowed: false }))).allowed) return empty;

  const maxPages = Math.max(1, Math.min(10, opts.maxPages ?? 3));
  // Без residential сайтовете зад Cloudflare ни отказват — същото като при
  // проверката на цената. Затова по подразбиране е включен.
  const resident = opts.resident ?? true;
  const input = {
    startUrls: urls.slice(0, 5).map((u) => ({ url: u })),
    maxCrawlPages: maxPages,
    maxCrawlDepth: 1,
    crawlerType: 'playwright:adaptive',
    ...(resident
      ? { proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] } }
      : {}),
  };

  const api = async (path: string, method = 'GET', body?: unknown): Promise<unknown> => {
    const res = await fetch(`https://api.apify.com/v2${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`apify ${res.status}`);
    return res.json();
  };

  try {
    const started = (await api(
      `/acts/apify~website-content-crawler/runs?token=${encodeURIComponent(token)}`,
      'POST',
      input
    )) as { data?: { id?: string } };
    const runId = started?.data?.id;
    if (!runId) return empty;

    // Обходът на 3–5 страници отнема 40–120 сек.
    const deadline = Date.now() + Math.max(30_000, Math.min(240_000, opts.timeoutMs ?? 150_000));
    let status = 'RUNNING';
    let datasetId = '';
    let spend = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 6_000));
      const run = (await api(`/actor-runs/${runId}`)) as {
        data?: { status?: string; defaultDatasetId?: string; usageTotalUsd?: number };
      };
      status = run?.data?.status ?? 'RUNNING';
      datasetId = run?.data?.defaultDatasetId ?? '';
      spend = run?.data?.usageTotalUsd ?? 0;
      if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) break;
    }
    // Разходът се записва и при провал — иначе бюджетът излиза от синхрон.
    if (spend > 0) await addApifySpend(spend, `обход ${urls[0]?.slice(0, 40) ?? ''}`).catch(() => undefined);
    if (status !== 'SUCCEEDED' || !datasetId) return { ok: false, pages: [], usd: spend };

    const items = (await api(`/datasets/${datasetId}/items?limit=${maxPages + 2}`)) as Array<{
      url?: string;
      html?: string;
      markdown?: string;
      text?: string;
      crawl?: { httpStatusCode?: number };
      metadata?: { title?: string };
    }>;
    const pages: CrawlPage[] = (Array.isArray(items) ? items : []).map((it) => ({
      url: String(it.url ?? ''),
      html: String(it.html ?? ''),
      markdown: String(it.markdown ?? it.text ?? ''),
      title: String(it.metadata?.title ?? ''),
      status: Number(it.crawl?.httpStatusCode ?? 0),
    }));
    return { ok: pages.length > 0, pages, usd: spend };
  } catch {
    return empty;
  }
}

export async function apifyRenderHtml(
  urls: string[],
  opts: { resident?: boolean; timeoutMs?: number } = {}
): Promise<ApifyRenderResult> {
  const token = await apifyToken();
  if (!token) return { ok: false, pages: [], usd: 0, reason: 'Няма Apify токен.' };
  const list = urls.filter(Boolean).slice(0, MAX_URLS_PER_RUN);
  if (!list.length) return { ok: false, pages: [], usd: 0, reason: 'Няма адреси за отваряне.' };

  const body: Record<string, unknown> = {
    startUrls: list.map((u) => ({ url: u })),
    pageFunction: PAGE_FUNCTION,
    maxPagesPerCrawl: list.length,
    maxRequestRetries: 0,
    pageFunctionTimeoutSecs: 90,
    memoryMbytes: 1024,
    // Снимките не ги теглим — при residential прокси се плаща трафик.
    launchContext: { useChrome: false, launchOptions: { args: ['--blink-settings=imagesEnabled=false'] } },
    proxyConfiguration: opts.resident
      ? { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] }
      : { useApifyProxy: true },
  };

  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 240_000),
      }
    );
    const text = await res.text();
    const usd = await lastRunCost(token);
    if (!res.ok) {
      return { ok: false, pages: [], usd, reason: `Apify върна HTTP ${res.status}: ${text.slice(0, 160)}` };
    }
    let items: Array<Record<string, unknown>> = [];
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) items = parsed as Array<Record<string, unknown>>;
    } catch {
      return { ok: false, pages: [], usd, reason: 'Apify върна нещо, което не е списък.' };
    }
    const pages: ApifyPage[] = items.map((it) => ({
      url: String(it.url ?? ''),
      html: typeof it.html === 'string' ? it.html : undefined,
      error: typeof it.error === 'string' ? it.error : undefined,
    }));
    return { ok: pages.some((p) => p.html), pages, usd };
  } catch (err) {
    return { ok: false, pages: [], usd: 0, reason: `Грешка при връзка с Apify: ${(err as Error).message.slice(0, 160)}` };
  }
}
