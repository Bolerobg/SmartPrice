import { createHash, randomUUID } from 'node:crypto';
import { many, one, query, tx } from '../db.js';
import { env, features } from '../env.js';
import { getSetting, setSetting } from './settings.js';
import { parseUnit } from './scraper.js';
import { putImage, publicUrl } from './storage.js';
import { officialProfileId, pickUserAgent } from './scraper.js';

/** Официален фиксиран курс: 1 € = 1.95583 лв. */
const BGN_PER_EUR = 1.95583;

const CATEGORIES = [
  'restaurants',
  'hotels_airbnb',
  'supermarket',
  'cafes_bars',
  'services_tech',
  'real_estate',
  'shops_places',
  'private_sellers',
  'other',
] as const;

export type ReceiptCategory = (typeof CATEGORIES)[number];

/**
 * ТЕМИ (интереси) — какво търсим във Facebook групите. Избират се от панела,
 * а AI-ят обработва всяка тема по същия начин: преразказ на български, псевдоним
 * вместо име, ясно място (град + обект), само България и само чисти снимки.
 */
export interface FbTopic {
  key: string;
  title: string;
  emoji: string;
  /** Категория в приложението, в която влиза офертата (null = AI-ят решава, както при офертите). */
  category: ReceiptCategory | null;
  /** Какво точно да търси AI-ят за тази тема. */
  hint: string;
}

export const FB_TOPICS: FbTopic[] = [
  {
    key: 'deals',
    title: 'Оферти и цени',
    emoji: '🏷️',
    category: null,
    hint: 'касови бележки, етикети и рафтове с цени, менюта, сметки, скрити такси, промоции и шринкфлация',
  },
  {
    key: 'services',
    title: 'Услуги',
    emoji: '🔧',
    category: 'services_tech',
    hint: 'цени на услуги: ремонт и майсторлък, автосервиз, почистване, зъболекар и лекар, фризьор и козметика, уроци, куриер, интернет и телефон',
  },
  {
    key: 'masters',
    title: 'Майстори и занаятчии',
    emoji: '👷',
    category: 'services_tech',
    hint: 'препоръки и предупреждения за конкретен майстор/фирма с ЦЕНА на труда или на материалите („искаха ми X € за …“)',
  },
  {
    key: 'real_estate',
    title: 'Имоти',
    emoji: '🏠',
    category: 'real_estate',
    hint: 'наеми, продажби, цени на квадратен метър, брокерски такси и скрити разходи по имот',
  },
  {
    key: 'shops_places',
    title: 'Обекти и магазини',
    emoji: '🏪',
    category: 'shops_places',
    hint: 'нови или затворени обекти, впечатления от магазин или заведение (обслужване, хигиена, ремонт) — с цена, ако има',
  },
  {
    key: 'private_sellers',
    title: 'Частни продавачи',
    emoji: '🧍',
    category: 'private_sellers',
    hint: 'обяви от частни лица, сергии, пазар, втора употреба — с цена и място',
  },
];

export const FB_TOPIC_KEYS: string[] = FB_TOPICS.map((t) => t.key);

/** Кои теми са включени (настройка `fb_topics`). По подразбиране само „Оферти и цени“. */
export async function getFbTopics(): Promise<FbTopic[]> {
  const saved = (await getSetting('fb_topics', 'deals')).trim();
  if (saved === 'all') return FB_TOPICS;
  const keys = saved
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const on = FB_TOPICS.filter((t) => keys.includes(t.key));
  return on.length ? on : FB_TOPICS.filter((t) => t.key === 'deals');
}

/** Запис на избраните теми. Празен списък → връщаме се към „Оферти и цени“. */
export async function saveFbTopics(keys: string[]): Promise<FbTopic[]> {
  const chosen = FB_TOPICS.filter((t) => keys.includes(t.key)).map((t) => t.key);
  const final = chosen.length ? chosen : ['deals'];
  await setSetting('fb_topics', final.join(','));
  return FB_TOPICS.filter((t) => final.includes(t.key));
}

export interface RawFbPost {
  postId?: string;
  postUrl: string;
  text: string;
  imageUrls: string[];
  authorName?: string;
  postedAt?: string;
  /** Коментари под поста (за място/потвърждение + като самостоятелни сигнали). */
  comments?: Array<{ id?: string; author?: string; text: string; postedAt?: string }>;
}

export interface ParsedReceiptLine {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  highlightReason?: string | null;
}

export interface AiReceiptAnalysis {
  kind: 'receipt' | 'price_signal' | 'offer' | 'not_relevant';
  /** Ключ на темата, в която влиза постът (или 'not_relevant'). */
  topic: string;
  isReceipt: boolean;
  /** false, ако на снимката личи, че е от Facebook (интерфейс, профили, лого). */
  imageClean: boolean;
  /** Какво точно издава Facebook — за дневника/причината за отказ. */
  imageTraces?: string | null;
  skipReason?: string | null;
  polarity: 'green' | 'red';
  category: ReceiptCategory;
  title: string;
  description: string;
  placeName: string;
  city: string;
  address?: string | null;
  merchantName: string;
  merchantTaxId?: string | null;
  receiptDate?: string | null;
  receiptTime?: string | null;
  totalAmountEur: number;
  originalAmount?: number | null;
  originalCurrency?: 'BGN' | 'EUR' | null;
  confidenceScore: number;
  items: ParsedReceiptLine[];
  model: string;
}

/** Маскира чувствителни данни (IBAN, банкови карти, телефонни номера). */
export function maskSensitiveText(value?: string | null): string {
  if (!value) return '';
  return value
    .replace(/\bBG\d{2}[A-Z0-9]{14,20}\b/gi, '••••')
    .replace(/\b(?:\d[ -]?){12,19}\b/g, '••••')
    .replace(/\b\d{10,}\b/g, '••••');
}

/** Извлича чисто ID или slug на Facebook група от произволен линк. */
export function parseFbGroupUrl(rawUrl: string): { canonicalUrl: string; groupId: string } {
  const trimmed = rawUrl.trim();
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error('Невалиден адрес на Facebook група.');
  }
  if (!/(^|\.)facebook\.com$|(^|\.)fb\.com$/i.test(u.hostname)) {
    throw new Error('Адресът трябва да е от facebook.com (напр. https://www.facebook.com/groups/3111975342346393).');
  }
  const m = /\/groups\/([^/?#]+)/i.exec(u.pathname);
  const groupId = m?.[1] ? m[1].trim() : u.pathname.replace(/^\/+|\/+$/g, '') || 'group';
  const canonicalUrl = m?.[1]
    ? `https://www.facebook.com/groups/${groupId}`
    : `https://www.facebook.com/${u.pathname.replace(/^\/+/, '')}`;
  return { canonicalUrl, groupId };
}



/** Геокод през OpenStreetMap Nominatim — безплатно и без ключ (учтиво: 1 заявка/сек). */
async function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  const q = (query || '').trim();
  if (q.length < 4) return null;
  try {
    const res = await fetch(
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=bg&q=' +
        encodeURIComponent(q),
      {
        headers: { 'User-Agent': 'SmartPriceBot/1.0 (+https://smartprice.bg)', Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const first = Array.isArray(arr) ? arr[0] : undefined;
    if (!first?.lat || !first?.lon) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

/**
 * Проверка, че числото прилича на реален ЕИК.
 * 9 цифри → проверява се контролната цифра (тегла 1..8; при остатък 10 — втори ред тегла 3..10).
 * 13 цифри → отхвърляме само очевидните боклуци (000000000, 111111111…), решението остава на VIES.
 */
export function isValidEik(raw: string | null | undefined): boolean {
  const n = String(raw || '').replace(/\D/g, '');
  if (n.length !== 9 && n.length !== 13) return false;
  if (/^(\d)\1+$/.test(n)) return false;
  if (n.length === 13) return true;
  const d = n.split('').map(Number);
  const sum1 = [1, 2, 3, 4, 5, 6, 7, 8].reduce((acc, w, i) => acc + d[i]! * w, 0);
  let r = sum1 % 11;
  if (r === 10) {
    const sum2 = [3, 4, 5, 6, 7, 8, 9, 10].reduce((acc, w, i) => acc + d[i]! * w, 0);
    r = sum2 % 11;
    if (r === 10) r = 0;
  }
  return d[8] === r;
}

/** Кеш на VIES отговорите (24 ч) — ЕС ограничава честотата на заявките. */
const viesCache = new Map<string, { at: number; val: { name: string; address: string } | null }>();
const VIES_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Заявка към VIES. Първо официалният (документиран) REST endpoint
 * POST /rest-api/check-vat-number — връща { valid, name, address }.
 * Ако не отговори, падаме на стария път GET /rest-api/ms/BG/vat/{vat} (още работи).
 */
async function viesQuery(vat: string): Promise<{ valid: boolean; name?: string; address?: string } | null> {
  try {
    const res = await fetch('https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ countryCode: 'BG', vatNumber: vat }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const r = (await res.json()) as { valid?: boolean; isValid?: boolean; name?: string; address?: string };
      return { valid: Boolean(r.valid ?? r.isValid), name: r.name, address: r.address };
    }
  } catch {
    /* пробваме стария път */
  }
  try {
    const res = await fetch(
      'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/BG/vat/' + vat,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return null;
    const r = (await res.json()) as { isValid?: boolean; name?: string; address?: string };
    return { valid: Boolean(r.isValid), name: r.name, address: r.address };
  } catch {
    return null;
  }
}

/** ЕИК → име и адрес на търговеца през безплатния VIES на ЕС (REST, без ключ). */
async function viesLookup(eik: string | null | undefined): Promise<{ name: string; address: string } | null> {
  const vat = String(eik || '').replace(/\D/g, '');
  if (!isValidEik(vat)) return null;
  const hit = viesCache.get(vat);
  if (hit && Date.now() - hit.at < VIES_TTL_MS) return hit.val;
  const d = await viesQuery(vat);
  if (!d?.valid) {
    if (viesCache.size > 500) viesCache.clear();
    viesCache.set(vat, { at: Date.now(), val: null });
    return null;
  }
  const name = String(d.name ?? '').replace(/\s+/g, ' ').trim();
  const address = String(d.address ?? '').replace(/\s+/g, ' ').trim();
  if (!name || name === '---') return null;
  const val = { name, address };
  if (viesCache.size > 500) viesCache.clear();
  viesCache.set(vat, { at: Date.now(), val });
  return val;
}

/** Списък с групи за автоматични обиколки (един адрес на ред). */
export async function getFbGroups(): Promise<string[]> {
  const saved = await getSetting('fb_groups', '');
  return saved
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => /facebook\.com\/groups\//i.test(s));
}

export async function saveFbGroups(urls: string[]): Promise<string[]> {
  const clean: string[] = [];
  for (const raw of urls) {
    const url = String(raw || '').trim();
    if (!url) continue;
    try {
      const parsed = parseFbGroupUrl(url);
      if (!clean.includes(parsed.canonicalUrl)) clean.push(parsed.canonicalUrl);
    } catch {
      /* невалиден адрес — прескачаме */
    }
  }
  await setSetting('fb_groups', clean.join('\n'));
  return clean;
}

/**
 * Пуска обиколка на ВСИЧКИ запазени групи, една след друга (без да удряме Facebook наведнъж).
 * Връща веднага — задачите вървят във фона.
 */
export async function runAllFbGroups(params: {
  adminId: string;
  count?: number;
  defaultCity?: string;
}): Promise<{ started: Array<{ groupUrl: string; jobId: string }>; skipped: string[] }> {
  const groups = await getFbGroups();
  const started: Array<{ groupUrl: string; jobId: string }> = [];
  const skipped: string[] = [];
  // Само създаваме задачите — изпълнението е в извикващия (една след друга, с пауза).
  for (const groupUrl of groups) {
    try {
      const parsed = parseFbGroupUrl(groupUrl);
      const job = await one<{ id: string }>(
        `insert into fb_receipt_jobs (group_url, group_id, status, target_count, created_by)
         values ($1, $2, 'running', $3, $4)
         returning id::text`,
        [parsed.canonicalUrl, parsed.groupId, params.count ?? 20, params.adminId]
      );
      if (job) started.push({ groupUrl: parsed.canonicalUrl, jobId: job.id });
      else skipped.push(groupUrl);
    } catch {
      skipped.push(groupUrl);
    }
  }
  return { started, skipped };
}

/** Чете настройките за Facebook скрапера (Apify токен и по избор FB cookie). */
export async function getFbScraperConfig(): Promise<{
  apifyToken: string;
  hasApifyToken: boolean;
  fbCookie: string;
  hasFbCookie: boolean;
  ocrAvailable: boolean;
  ocrModel: string;
  commentsEnabled: boolean;
  autoApprove: boolean;
  autoApproveMin: number;
}> {
  const savedApify = await getSetting('apify_api_token', '');
  const savedCookie = await getSetting('fb_cookie', '');
  const savedComments = await getSetting('fb_comments', 'on');
  const savedAuto = await getSetting('fb_auto_approve', 'off');
  const savedAutoMin = await getSetting('fb_auto_approve_min', '0.85');
  const apifyToken = (savedApify || env.APIFY_API_TOKEN || '').trim();
  const fbCookie = (savedCookie || '').trim();
  const autoApproveMin = Number(savedAutoMin);
  return {
    apifyToken,
    hasApifyToken: Boolean(apifyToken),
    fbCookie,
    hasFbCookie: Boolean(fbCookie),
    ocrAvailable: features.ocr,
    ocrModel: env.OCR_MODEL,
    commentsEnabled: savedComments !== 'off',
    autoApprove: savedAuto === 'on',
    autoApproveMin: Number.isFinite(autoApproveMin) && autoApproveMin > 0 && autoApproveMin <= 1 ? autoApproveMin : 0.85,
  };
}

export async function saveFbScraperConfig(input: {
  apifyToken?: string;
  fbCookie?: string;
  commentsEnabled?: boolean;
  autoApprove?: boolean;
  autoApproveMin?: number;
}): Promise<void> {
  if (input.apifyToken !== undefined) {
    await setSetting('apify_api_token', input.apifyToken.trim());
  }
  if (input.fbCookie !== undefined) {
    await setSetting('fb_cookie', input.fbCookie.trim());
  }
  if (input.commentsEnabled !== undefined) {
    await setSetting('fb_comments', input.commentsEnabled ? 'on' : 'off');
  }
  if (input.autoApprove !== undefined) {
    await setSetting('fb_auto_approve', input.autoApprove ? 'on' : 'off');
  }
  if (input.autoApproveMin !== undefined) {
    const v = Number(input.autoApproveMin);
    if (Number.isFinite(v) && v > 0 && v <= 1) await setSetting('fb_auto_approve_min', String(v));
  }
}

/* ================================================== 1) Сваляне от Facebook */

/**
 * Стратегия 1: Apify (`apify/facebook-groups-scraper`).
 * Работи изцяло от сървъра с публични групи (напр. groups/3111975342346393).
 */

/**
 * Съдържанието към AI-я: текстът на поста/коментара + (по избор) коментарите като
 * контекст и снимката. Без снимка работим само по текст (сигнали от коментари).
 */
function buildAnalyzerUserContent(
  postText: string,
  params: { imageDataUrl?: string | null; commentsText?: string; commentContext?: string }
): Array<Record<string, unknown>> {
  const q = String.fromCharCode(34, 34, 34);
  const lines: string[] = [];
  if (params.commentContext) {
    lines.push('Коментарът е под пост във Facebook с текст:\n' + q + params.commentContext + q);
  } else if (postText) {
    lines.push('Текст към поста във Facebook:\n' + q + postText + q);
  }
  if (params.commentsText) {
    lines.push('Коментари под поста (само за място/потвърждение, без имена):\n' + q + params.commentsText + q);
  }
  lines.push(
    params.imageDataUrl
      ? 'Разчети касовата бележка/цената от снимката и подготви публикацията.'
      : 'Няма снимка — работи САМО с текста и подготви публикацията.'
  );
  const parts: Array<Record<string, unknown>> = [{ type: 'text', text: lines.join('\n\n') }];
  if (params.imageDataUrl) {
    parts.push({ type: 'image_url', image_url: { url: params.imageDataUrl } });
  }
  return parts;
}

/** Чете коментарите под дадени постове през Apify (apify~facebook-comments-scraper).
 *  При грешка връща празни масиви — никога не чупи обиколката. */
async function fetchViaApifyComments(
  postUrls: string[],
  apifyToken: string,
  maxPerPost: number
): Promise<Array<Array<{ id?: string; author?: string; text: string; postedAt?: string }>>> {
  type Cmt = { id?: string; author?: string; text: string; postedAt?: string };
  const empty: Array<Cmt[]> = postUrls.map(() => []);
  if (!apifyToken || postUrls.length === 0) return empty;
  const endpoint =
    'https://api.apify.com/v2/acts/apify~facebook-comments-scraper/run-sync-get-dataset-items?token=' +
    encodeURIComponent(apifyToken);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startUrls: postUrls.slice(0, 10).map((url) => ({ url })),
      resultsLimit: Math.min(200, Math.max(10, maxPerPost * postUrls.length * 2)),
      includeReplies: false,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error('Apify comments HTTP ' + res.status);
  }
  const items = (await res.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(items)) return empty;
  for (const it of items) {
    // apify~facebook-comments-scraper връща: facebookUrl (адресът на ПОСТА),
    // profileName (автор), id (на коментара), text, date.
    const parent = fbUrlKey(
      String(it.facebookUrl ?? it.inputUrl ?? it.postUrl ?? it.topLevelUrl ?? it.url ?? '')
    );
    const text = String(it.text ?? it.message ?? '').trim();
    if (!text || text.length < 8) continue;
    const authorObj = it.user as Record<string, unknown> | undefined;
    const author =
      String(authorObj?.name ?? it.profileName ?? it.userName ?? it.authorName ?? '').trim() || undefined;
    const idx = postUrls.findIndex((u) => fbUrlKey(u) === parent);
    if (idx < 0) continue;
    const bucket = empty[idx]!;
    if (bucket.length >= maxPerPost) continue;
    bucket.push({
      id: String(it.id ?? it.commentId ?? '').trim() || undefined,
      author,
      text: text.slice(0, 1200),
      postedAt: String(it.date ?? it.time ?? '').trim() || undefined,
    });
  }
  return empty;
}

/** Закача коментарите към постовете (до limited поста, до perPost коментара на пост). */
async function attachFbComments(
  posts: RawFbPost[],
  apifyToken: string,
  onLog: (msg: string) => Promise<void>,
  perPost = 8,
  limited = 10
): Promise<number> {
  const targets = posts.slice(0, limited);
  if (!targets.length) return 0;
  await onLog('Чета коментарите под ' + targets.length + ' поста…');
  const buckets = await fetchViaApifyComments(
    targets.map((t) => t.postUrl),
    apifyToken,
    perPost
  );
  const commentsUsd = await fetchApifyRunUsage(apifyToken, 'apify~facebook-comments-scraper');
  if (commentsUsd !== null) {
    await onLog('Apify разход за коментарите: $' + commentsUsd.toFixed(4));
  }
  let n = 0;
  targets.forEach((t, i) => {
    const list = buckets[i] ?? [];
    if (list.length) {
      t.comments = list;
      n++;
    }
  });
  return n;
}

/** Дали текстът си струва да влезе като сигнал (цена или оплакване). */
function looksLikePriceSignal(text: string): boolean {
  const t = (text || '').trim();
  if (t.length < 15) return false;
  const price = /(\d[\d\s.,]*)\s*(€|лв\.?|EUR|BGN|евро|лева|евроцента)/i.test(t);
  const complaint = /скъп|измам|надцен|вдигна|повиши|такс|грамаж|необоснов|лъж|промоция|завиши/i.test(t);
  return price || complaint;
}

/** Колко е изяла последната обиколка на даден Apify актьор (в долари). */
async function fetchApifyRunUsage(token: string, actor: string): Promise<number | null> {
  try {
    const res = await fetch(
      'https://api.apify.com/v2/acts/' +
        actor +
        '/runs?token=' +
        encodeURIComponent(token) +
        '&limit=1&desc=true',
      { signal: AbortSignal.timeout(20_000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { items?: Array<{ usageTotalUsd?: number }> } };
    const usd = data.data?.items?.[0]?.usageTotalUsd;
    return typeof usd === 'number' ? usd : null;
  } catch {
    return null;
  }
}

async function fetchViaApify(
  groupUrl: string,
  count: number,
  apifyToken: string,
  onLog: (msg: string) => Promise<void>
): Promise<RawFbPost[]> {
  await onLog(`Изпращам заявка към Apify Facebook Groups Scraper за до ${count} поста…`);
  const endpoint = `https://api.apify.com/v2/acts/apify~facebook-groups-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(
    apifyToken
  )}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startUrls: [{ url: groupUrl }],
      resultsLimit: Math.min(100, Math.max(5, count * 2)),
      viewOption: 'CHRONOLOGICAL',
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Apify върна HTTP ${res.status}: ${body.slice(0, 240)}`);
  }

  const rawItems = (await res.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(rawItems)) return [];

  const runUsd = await fetchApifyRunUsage(apifyToken, 'apify~facebook-groups-scraper');
  if (runUsd !== null) {
    await onLog('Apify разход за тази обиколка: $' + runUsd.toFixed(4));
  }

  const posts: RawFbPost[] = [];
  for (const item of rawItems) {
    const postUrl = String(
      item.url ?? item.facebookUrl ?? item.postUrl ?? item.topLevelUrl ?? ''
    ).trim();
    const postId = String(item.id ?? item.postId ?? item.legacyId ?? '').trim() || undefined;
    const text = String(item.text ?? item.message ?? item.postText ?? '').trim();
    const authorObj = item.user as Record<string, unknown> | undefined;
    const authorName = String(
      authorObj?.name ?? item.userName ?? item.authorName ?? ''
    ).trim() || undefined;
    const postedAt = String(item.time ?? item.timestamp ?? item.date ?? '').trim() || undefined;

    const imageUrls = new Set<string>();
    const pushUrl = (u: unknown) => {
      if (typeof u === 'string' && /^https?:\/\//i.test(u) && !/profile|avatar|emoji|static\.xx/i.test(u)) {
        imageUrls.add(u.trim());
      }
    };

    pushUrl(item.imageUrl);
    pushUrl(item.photo);
    pushUrl(item.thumbnail);

    if (Array.isArray(item.images)) {
      for (const img of item.images) {
        if (typeof img === 'string') pushUrl(img);
        else if (img && typeof img === 'object') {
          const o = img as Record<string, unknown>;
          pushUrl(o.url ?? o.uri ?? o.image ?? o.src);
        }
      }
    }

    if (Array.isArray(item.attachments)) {
      for (const att of item.attachments) {
        if (!att || typeof att !== 'object') continue;
        const a = att as Record<string, unknown>;
        pushUrl(a.photo_image && (a.photo_image as Record<string, unknown>).uri);
        pushUrl(a.image && (a.image as Record<string, unknown>).uri);
        pushUrl(a.url ?? a.thumbnail ?? a.mediaUrl ?? a.photo);
        const media = a.media as Record<string, unknown> | undefined;
        if (media?.image && typeof media.image === 'object') {
          pushUrl((media.image as Record<string, unknown>).uri ?? (media.image as Record<string, unknown>).src);
        }
        if (Array.isArray(a.subattachments)) {
          for (const sub of a.subattachments) {
            if (sub && typeof sub === 'object') {
              const s = sub as Record<string, unknown>;
              pushUrl(s.url ?? s.photo ?? (s.image as Record<string, unknown> | undefined)?.uri);
            }
          }
        }
      }
    }

    if (Array.isArray(item.media)) {
      for (const m of item.media) {
        if (!m || typeof m !== 'object') continue;
        const mo = m as Record<string, unknown>;
        pushUrl(mo.thumbnail ?? mo.photo ?? mo.url ?? mo.ocrText);
        if (mo.image && typeof mo.image === 'object') {
          pushUrl((mo.image as Record<string, unknown>).uri ?? (mo.image as Record<string, unknown>).src);
        }
        if (mo.photo_image && typeof mo.photo_image === 'object') {
          pushUrl((mo.photo_image as Record<string, unknown>).uri);
        }
      }
    }

    if (imageUrls.size > 0) {
      posts.push({
        postId,
        postUrl: postUrl || `${groupUrl}/posts/${postId || randomUUID()}`,
        text,
        imageUrls: [...imageUrls],
        authorName,
        postedAt,
      });
    }
  }

  return posts;
}

/** Декодира JSON-екранирани низове от Relay HTML на Facebook (напр. \u0025, \/). */
function unescapeFbString(raw: string): string {
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    return raw
      .replace(/\\\/|\//g, '/')
      .replace(/\\u0025/g, '%')
      .replace(/\\u0026/g, '&')
      .replace(/\\u003C/gi, '<')
      .replace(/\\u003E/gi, '>')
      .replace(/\\n/g, '\n')
      .replace(/&amp;/g, '&');
  }
}

/**
 * Стратегия 2: Директно четене от Facebook (www / mbasic / m.facebook.com)
 * с извличане на Relay JSON (`message.text`, `photo_image.uri`, `scontent` снимки)
 * и OpenGraph тагове.
 */
async function fetchViaDirectHttp(
  groupUrl: string,
  groupId: string,
  count: number,
  fbCookie: string,
  onLog: (msg: string) => Promise<void>
): Promise<RawFbPost[]> {
  const headers: Record<string, string> = {
    'User-Agent': pickUserAgent(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'bg-BG,bg;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
  };
  if (fbCookie) headers.Cookie = fbCookie;

  const candidateUrls = [
    groupUrl,
    `https://m.facebook.com/groups/${groupId}`,
    `https://mbasic.facebook.com/groups/${groupId}`,
  ];

  const posts: RawFbPost[] = [];
  const seenImages = new Set<string>();

  for (const url of candidateUrls) {
    if (posts.length >= count) break;
    try {
      await onLog(`Проверявам директно: ${url}…`);
      const res = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html || html.length < 500) continue;

      // 1) Проверка за единичен пост през OpenGraph (og:image + og:description)
      const ogImage =
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ??
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html)?.[1];
      const ogDesc =
        /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ??
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i.exec(html)?.[1];

      if (ogImage && /scontent|fbcdn/i.test(ogImage) && !/rsrc\.php|static\.xx/i.test(ogImage)) {
        const cleanImg = ogImage.replace(/&amp;/g, '&');
        if (!seenImages.has(cleanImg)) {
          seenImages.add(cleanImg);
          posts.push({
            postUrl: groupUrl,
            text: ogDesc ? unescapeFbString(ogDesc) : '',
            imageUrls: [cleanImg],
          });
        }
      }

      // 2) Извличане на постове от вградения Relay JSON на Facebook
      // Facebook вгражда обекти с "message":{"text":"..."} и "photo_image":{"uri":"https:\/\/scontent..."}
      const textBlocks: Array<{ index: number; text: string }> = [];
      for (const m of html.matchAll(/"message"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
        if (m.index !== undefined && m[1]) {
          const decoded = unescapeFbString(m[1]).trim();
          if (decoded.length >= 3) {
            textBlocks.push({ index: m.index, text: decoded });
          }
        }
      }

      const photoBlocks: Array<{ index: number; uri: string; postId?: string }> = [];
      const photoRegex =
        /"(?:photo_image|viewer_image|large_share_image|image)"\s*:\s*\{\s*"uri"\s*:\s*"(https?:\\?\/\\?\/[^"]+)"/g;
      for (const m of html.matchAll(photoRegex)) {
        if (m.index === undefined || !m[1]) continue;
        const uri = unescapeFbString(m[1]).trim();
        if (!/scontent|fbcdn/i.test(uri) || /rsrc\.php|emoji|static\.xx|p50x50|p100x100|s100x100/i.test(uri)) {
          continue;
        }
        // Търсим близък post_id около снимката
        const windowStart = Math.max(0, m.index - 2500);
        const windowEnd = Math.min(html.length, m.index + 2500);
        const slice = html.slice(windowStart, windowEnd);
        const pid =
          /"post_id"\s*:\s*"(\d{8,25})"/i.exec(slice)?.[1] ??
          /\/groups\/[^/]+\/posts\/(\d{8,25})/i.exec(slice)?.[1] ??
          /story_fbid=(\d{8,25})/i.exec(slice)?.[1];
        photoBlocks.push({ index: m.index, uri, postId: pid });
      }

      for (const pb of photoBlocks) {
        if (seenImages.has(pb.uri)) continue;
        seenImages.add(pb.uri);
        // Намираме най-близкия текст на пост преди или около снимката
        let bestText = '';
        let bestDist = Infinity;
        for (const tb of textBlocks) {
          const dist = Math.abs(pb.index - tb.index);
          if (dist < 12_000 && dist < bestDist) {
            bestDist = dist;
            bestText = tb.text;
          }
        }
        const postUrl = pb.postId
          ? `https://www.facebook.com/groups/${groupId}/posts/${pb.postId}`
          : `${groupUrl}#img-${createHash('md5').update(pb.uri).digest('hex').slice(0, 10)}`;
        posts.push({
          postId: pb.postId,
          postUrl,
          text: bestText,
          imageUrls: [pb.uri],
        });
        if (posts.length >= count * 2) break;
      }
    } catch {
      /* преминаваме към следващия вариант */
    }
  }

  return posts;
}

/* ========================================= 2) Изтегляне на снимка при нас */

async function downloadReceiptImageOnce(
  imageUrl: string
): Promise<{ localUrl: string; dataUrl: string; sha256: string } | null> {
  try {
    if (imageUrl.startsWith('data:image/')) {
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(imageUrl);
      if (!m) return null;
      const mimeType = m[1]!;
      const buf = Buffer.from(m[2]!, 'base64');
      if (buf.length === 0 || buf.length > env.MAX_UPLOAD_MB * 1024 * 1024) return null;
      const ext = /png/i.test(mimeType) ? 'png' : /webp/i.test(mimeType) ? 'webp' : 'jpg';
      const name = `${randomUUID()}.${ext}`;
      const sha256 = createHash('sha256').update(buf).digest('hex');
      await putImage(name, buf, mimeType);
      return {
        localUrl: publicUrl(name),
        dataUrl: imageUrl,
        sha256,
      };
    }

    const u = new URL(imageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const res = await fetch(u.toString(), {
      headers: {
        'User-Agent': pickUserAgent(),
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: 'https://www.facebook.com/',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim();
    if (!/^image\//i.test(contentType)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1500 || buf.length > env.MAX_UPLOAD_MB * 1024 * 1024) return null;

    const ext = /png/i.test(contentType) ? 'png' : /webp/i.test(contentType) ? 'webp' : 'jpg';
    const name = `${randomUUID()}.${ext}`;
    const sha256 = createHash('sha256').update(buf).digest('hex');
    await putImage(name, buf, contentType);
    return {
      localUrl: publicUrl(name),
      dataUrl: `data:${contentType};base64,${buf.toString('base64')}`,
      sha256,
    };
  } catch {
    return null;
  }
}

/** Сваля снимката с ВТОРИ опит — Facebook CDN понякога не отговаря от първия път. */
export async function downloadReceiptImage(
  imageUrl: string
): Promise<{ localUrl: string; dataUrl: string; sha256: string } | null> {
  const first = await downloadReceiptImageOnce(imageUrl);
  if (first) return first;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return downloadReceiptImageOnce(imageUrl);
}

/* =========================== 3) AI Vision OCR + Анализ на текста от поста */

const num = (v: unknown, fallback = 0): number => {
  const parsed =
    typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.').replace(/[^\d.-]/g, '')) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const str = (v: unknown, max = 200): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};

/** Годината от дата-низ („16.10.2026“, „2026-10-16T…“) или null. */
function yearFromDate(date: string | null | undefined): number | null {
  if (!date) return null;
  const m = /(\d{4})/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 2000 && y <= 2100 ? y : null;
}

/** Всяка цена в текста да е в евро: „12.50 лв.“ → „6.39 €“. */
function toEuroText(text: string): string {
  return (text || '')
    .replace(/(\d+[.,]?\d*)\s*(?:лв\.?|лева|BGN|LV)(?![A-Za-zА-Яа-я])/gi, (full, n: string) => {
      const v = Number(String(n).replace(',', '.'));
      if (!isFinite(v) || v <= 0) return full;
      return (v / BGN_PER_EUR).toFixed(2) + ' €';
    })
    .replace(/\s*€\s*€/g, ' €')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const ALIAS_FIRST_NAMES = [
  'Мария', 'Иван', 'Елена', 'Петър', 'Десислава', 'Николай', 'Габриела', 'Стоян',
  'Виктория', 'Антон', 'Калина', 'Мартин', 'Ивелина', 'Димитър', 'Силвия', 'Радослав',
  'Теодора', 'Костадин', 'Яна', 'Борис', 'Лилия', 'Емил', 'Невена', 'Красимир',
  'Полина', 'Живко', 'Ралица', 'Тодор', 'Милена', 'Валентин', 'Диана', 'Георги',
  'Василена', 'Христо', 'Даниела', 'Светослав', 'Адриана', 'Пламен', 'Йорданка', 'Веселин',
  'Кристина', 'Асен', 'Биляна', 'Огнян', 'Стела', 'Румен', 'Магдалена', 'Илия',
  'Анелия', 'Здравко', 'Преслава', 'Любомир', 'Мирослава', 'Тихомир', 'Станислава', 'Чавдар',
  'Елица', 'Никола', 'Румяна', 'Владимир', 'Цветелина', 'Младен', 'Гергана', 'Слави',
  'Ирена', 'Бойко', 'Таня', 'Евгени', 'Надежда', 'Кирил', 'Радостина', 'Симеон',
  'Юлия', 'Атанас', 'Миглена', 'Гроздан', 'Албена', 'Драгомир', 'Зорница', 'Орлин',
];
/** Безличното обръщение, което ползваме, когато нямаме автор (или за оплаквания). */
export const NEUTRAL_AUTHOR = 'Потребител сигнализира';

/** Стабилен (детерминистичен) псевдоним за автор: един и същ човек получава един и същ
 *  измислен псевдоним във всички групи и задачи — звучи човешки, но не издава самоличност.
 *  Истинското име НИКОГА не излиза от сървъра. */
export function pseudonymFor(authorName: string | null | undefined): string {
  const raw = (authorName || '').trim();
  if (!raw) return NEUTRAL_AUTHOR;
  let h = 7;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) % 1000003;
  return ALIAS_FIRST_NAMES[h % ALIAS_FIRST_NAMES.length]!;
}

/** Маха истинското име (и линкове към профил) от текст, който отива в приложението. */
export function scrubAuthorName(
  text: string,
  authorName: string | null | undefined,
  alias: string
): string {
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = text || '';
  const rawName = (authorName || '').trim();
  if (rawName.length >= 3) {
    out = out.split(rawName).join(alias);
    const first = rawName.split(/\s+/)[0] ?? '';
    if (first.length >= 4) {
      // \b в JS е ASCII-базиран и не хваща кирилица → собствени граници на дума.
      const re = new RegExp('(^|[^\u0410-\u044f\u0401\u0451A-Za-z])' + escapeRe(first) + '($|[^\u0410-\u044f\u0401\u0451A-Za-z])', 'gi');
      out = out.replace(re, (_m, before: string, after: string) => before + alias + after);
    }
  }
  return out
    .replace(/\b(?:facebook|fb)\.[a-z]+\/\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function analyzeFbReceiptWithAi(params: {
  /** Снимка като data URL или null/празно, когато анализираме само текст (коментар). */
  imageDataUrl: string | null;
  fbPostText: string;
  defaultCity?: string;
  /** Измислен псевдоним на автора (никога истинското име). */
  authorAlias?: string;
  /** Коментари под поста — само за място/потвърждение на цената. */
  commentsText?: string;
  /** Текстът на поста, когато анализираме коментар (контекст). */
  commentContext?: string;
}): Promise<AiReceiptAnalysis> {
  if (!features.ocr) {
    throw new Error('Липсва OPENROUTER_API_KEY в конфигурацията за AI разчитане на касови бележки.');
  }

  const topics = await getFbTopics();
  const cleanPostText = maskSensitiveText(params.fbPostText).slice(0, 2500);
  const fallbackCity = (params.defaultCity || 'София').trim() || 'София';

  const systemPrompt = [
    'Ти си експертен OCR и анализатор за SmartPrice BG — приложение за реални цени, касови бележки и потребителски сигнали в България.',
    'Подава ти се СНИМКА от пост във Facebook група и ТЕКСТЪТ към поста, написан от автора.',
    '',
    'АКТИВНИ ТЕМИ (интереси) — приемаме само постове, които влизат в някоя от тях:',
    ...topics.map((t) => `   • "${t.key}" — ${t.title}: ${t.hint}.`),
    'Ако постът не влиза в нитоя от активните теми → "topic": "not_relevant" и "kind": "not_relevant".',
    '',
    'Твоята задача:',
    '1. Реши КАКВО показва снимката и върни "kind":',
    '   - "receipt" — касова бележка (фискален бон), сметка от заведение/ресторант или фактура.',
    '   - "price_signal" — СИГНАЛ ЗА ЦЕНА: снимка с цена (етикет, рафт, меню, табела, продукт), дори БЕЗ формален бон, но в комбинация с текст на поста, в който авторът СЕ ОПЛАКВА (скъпо, вдигнаха цената, малък грамаж, скрита такса, измама) или хвали цената.',
    '   - "offer" — пост от ДРУГА активна тема (услуга, имот, обект, майстор, частен продавач): има ЯСНО място (град + обект/фирма) и ЯСНА цена (сума в € или лв. за услугата, наема или стоката). Тогава "topic" е ключът на темата.',
    '   - "not_relevant" — мем, селфи, пейзаж, снимка без никаква цена и без текст за цена, или пост извън активните теми.',
    '2. ЗАДЪЛЖИТЕЛНО за "price_signal" — трябва да е ЯСНО МЯСТОТО: "placeName" (магазин/обект) И "city" (град в България) И "citySource".',
    '   - "citySource": "receipt" (градът се чете от бележката/табелата/менюто), "post" (споменат е в текста на поста), "none" (никъде не личи).',
    '   - Ако "citySource" е "none" ИЛИ не можеш да определиш "placeName" → върни "kind": "not_relevant", "isReceipt": false, "skipReason": "Няма разпознаваем град/място". НЕ измисляй град и не ползвай град по подразбиране.',
    '   - "country": "BG" ако мястото е в БЪЛГАРИЯ, иначе кратък код на държавата на английски ("GB", "MD", "IT", "DE", …). Ако не е ясно — празен низ.',
    '   - Ако държавата НЕ е България → "kind": "not_relevant", "isReceipt": false, "skipReason": "Не е от България — не влиза в приложението". Приложението показва само български цени.',
    '   - Само когато мястото Е ясно и има реална цена (totalAmount > 0) → "isReceipt": true (това е билетът за опашката за одобрение).',
    '2. Прочети САМО това, което реално виждаш на касовата бележка/сметката: търговец (merchantName), ЕИК (merchantTaxId), дата (DD.MM.YYYY), час (HH:MM), обща сума (totalAmount), валута ("BGN" или "EUR") и всички артикули по редове (items).',
    '3. Комбинирай ТЕКСТА НА ПОСТА със СНИМКАТА НА БЕЛЕЖКАТА:',
    '   - "polarity": "red" (ако авторът се оплаква от висока цена, надценка, скрита такса, малък грамаж или измама) или "green" (ако споделя добра оферта, ниска цена или изгодна покупка). При "price_signal" почти винаги е "red" — "green" само ако изрично хвали цената.',
    '   - "category": точно една от: "restaurants" | "hotels_airbnb" | "supermarket" | "cafes_bars" | "services_tech" | "other".',
    '   - "title": ясно и неутрално заглавие на български (до 110 знака) — какво е купено/коментирано и на каква цена и място. Без имена, без емоции, без КАПС и удивителни.',
    '   - "description": ПРЕРАЗКАЖИ текста на поста със СВОИ ДУМИ в стила на SmartPrice — 2 до 4 кратки изречения, като за приложение с реални цени, НЕ като пост във Facebook.',
    '     • Тон: неутрален, приятелски, спокоен и полезен. Без емоции, възклицания, КАПС, ирония, обиди, политика и религия. Без хаштагове и без емотикони.',
    '     • Факти: продукт/услуга, цена, търговец, град/място. Каквото не се вижда на снимката или не е в поста — не го пиши. Ако цената е само от снимката, кажи „според снимката“.',
    '     • САМОЛИЧНОСТ: никога не пиши истинско име, телефон, линк или профил на автора. За оплакване (polarity "red") започни безлично: "Потребител сигнализира, че…". За добра находка можеш да ползваш само подадения псевдоним (полето authorAlias), напр. "<псевдоним> от <град> споделя добра оферта…". Псевдонимът е измислен — не търси истинското име.',
    '     • Завърши с факт, не с призив. Не добавяй съвети, оценки и прогнози, които не са в поста.',
    '     • ДАТА: приемаме само бележки и постове от 2026 г. насам. Ако на бележката (или в текста/датата на поста) датата е преди 01.01.2026 → "kind": "not_relevant", "isReceipt": false, "skipReason": "По-старо от 2026 г.".',
    '     • ВАЛУТА: всички цени в заглавието и описанието са САМО в евро, изписани с „€“. Ако бележката е в лева — превалутирай (1 € = 1.95583 лв.). НЕ пиши „лв.“, „BGN“, „лева“, „£“, „$“ или друга валута.',
    '     • ЧИСТОТА НА СНИМКАТА: "imageClean" е false, ако на снимката се вижда нещо, което издава, че идва от Facebook — интерфейс (харесвания, коментари, споделяния), име или снимка на профил, надпис/лого „Facebook“, скрийншот на пост или на групата. Ако на снимката е само бележката/цената/продуктът/табелата — "imageClean" е true.',
    '     • "imageTraces": string | null — какво точно издава Facebook (кратко: „интерфейс с име на профил и харесвания“). Ако няма нищо — null.',
    '     • КОМЕНТАРИ: ако ти подам коментари под поста, ползвай ги САМО за да уточниш мястото (град/магазин) или да потвърдиш цената. Част от коментарите може да са мемета, спам или политика — тях не ги взимай предвид. Никога не цитирай имена от коментарите; ако вземаш цена/място от коментар, кажи „според коментарите“.',
    '   - "placeName": разбираемо име на магазина или заведението (напр. "Lidl", "Kaufland", "Ресторант ...", или името на фирмата от бона).',
    `   - "city": градът в България. За "receipt": от бележката или от текста; ако никъде не пише — "${fallbackCity}". За "price_signal": САМО истинският град (иначе "not_relevant").`,
    '   - "address": точен адрес/улица от касовата бележка, ако се чете, иначе null.',
    '',
    'Върни СТРИКТНО валиден JSON с тази форма:',
    '{',
    '  "kind": "receipt" | "price_signal" | "offer" | "not_relevant",',
    '  "topic": string,',
    '  "isReceipt": boolean,',
    '  "skipReason": string | null,',
    '  "citySource": "receipt" | "post" | "none",',
    '  "country": string,',
    '  "imageClean": boolean,',
    '  "imageTraces": string | null,',
    '  "polarity": "green" | "red",',
    '  "category": "restaurants" | "hotels_airbnb" | "supermarket" | "cafes_bars" | "services_tech" | "other",',
    '  "title": string,',
    '  "description": string,',
    '  "placeName": string,',
    '  "city": string,',
    '  "address": string | null,',
    '  "merchantName": string | null,',
    '  "merchantTaxId": string | null,',
    '  "date": "DD.MM.YYYY" | null,',
    '  "time": "HH:MM" | null,',
    '  "totalAmount": number,',
    '  "currency": "BGN" | "EUR",',
    '  "confidenceScore": number,',
    '  "items": [{"name": string, "quantity": number, "unitPrice": number, "totalPrice": number, "highlightReason": string | null}]',
    '}',
  ].join('\n');

  const response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': env.PUBLIC_BASE_URL,
      'X-Title': 'SmartPrice BG Admin FB Receipts',
    },
    body: JSON.stringify({
      model: env.OCR_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildAnalyzerUserContent(cleanPostText, params) },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Vision моделът върна грешка (${response.status}): ${body.slice(0, 240)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? '';
  if (!content) {
    throw new Error('Vision моделът не върна съдържание.');
  }

  let parsed: Record<string, unknown>;
  try {
    const cleanJson = content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(cleanJson) as Record<string, unknown>;
  } catch {
    throw new Error('Vision моделът не върна валиден JSON.');
  }

  const isReceipt = Boolean(parsed.isReceipt);
  const kindRaw = String(parsed.kind ?? '').trim();
  const kind: 'receipt' | 'price_signal' | 'offer' | 'not_relevant' =
    kindRaw === 'receipt' || kindRaw === 'price_signal' || kindRaw === 'offer' || kindRaw === 'not_relevant'
      ? kindRaw
      : isReceipt
        ? 'receipt'
        : 'not_relevant';
  // Тема (интерес): коя от активните теми покрива постът. „deals“ е както досега
  // (бележки и сигнали за цена); останалите теми влизат с kind "offer".
  const topicRaw = String(parsed.topic ?? '').trim();
  const dealsOn = topics.some((t) => t.key === 'deals');
  const topicKey: string =
    kind === 'receipt' || kind === 'price_signal'
      ? dealsOn
        ? 'deals'
        : 'not_relevant'
      : topicRaw && topicRaw !== 'deals' && topics.some((t) => t.key === topicRaw)
        ? topicRaw
        : 'not_relevant';
  const topicObj = topics.find((t) => t.key === topicKey) ?? null;
  const citySourceRaw = String(parsed.citySource ?? '').trim();
  const citySource: 'receipt' | 'post' | 'none' =
    citySourceRaw === 'post' || citySourceRaw === 'none'
      ? citySourceRaw
      : citySourceRaw === 'receipt' || kind === 'receipt'
        ? 'receipt'
        : 'none';
  const placeOk = (v: string) => Boolean(v) && v !== 'Неразчетен търговец';
  // Само от 2026 г. насам — стари бележки не влизат в приложението.
  const receiptYear = yearFromDate(str(parsed.date, 40) ?? null);
  const tooOld = receiptYear !== null && receiptYear < 2026;
  const countryRaw = String(parsed.country ?? '').trim().toUpperCase();
  const isForeign = countryRaw !== '' && countryRaw !== 'BG' && !countryRaw.startsWith('БЪЛГАР');
  // Чисти снимки: не публикуваме изображения, по които личи Facebook.
  const imageClean = parsed.imageClean === undefined ? true : Boolean(parsed.imageClean);
  const imageTraces = imageClean
    ? null
    : str(parsed.imageTraces, 240) ?? 'интерфейс или данни от Facebook';
  const rawCurrency = String(parsed.currency ?? 'BGN').toUpperCase() === 'EUR' ? 'EUR' : 'BGN';
  const isBgn = rawCurrency === 'BGN';
  const toEur = (val: number) => Number((val / BGN_PER_EUR).toFixed(2));

  const rawItems = Array.isArray(parsed.items) ? (parsed.items as Array<Record<string, unknown>>) : [];
  const items: ParsedReceiptLine[] = rawItems
    .map((it) => {
      const name = str(it.name, 200);
      if (!name) return null;
      const quantity = Math.max(0.001, Number(num(it.quantity, 1).toFixed(3)));
      const rawUnit = Math.max(0, num(it.unitPrice, 0));
      const rawTotal = Math.max(0, num(it.totalPrice, Number((quantity * rawUnit).toFixed(2))));

      let unitPrice = isBgn ? toEur(rawUnit) : Number(rawUnit.toFixed(2));
      let totalPrice = isBgn ? toEur(rawTotal) : Number(rawTotal.toFixed(2));

      // Ако само едното е разчетено, изчисляваме другото
      if (unitPrice <= 0 && totalPrice > 0) {
        unitPrice = Number((totalPrice / quantity).toFixed(2));
      }
      // Спазваме ограничението receipt_items_math в PostgreSQL:
      // abs(total_price - round(quantity * unit_price, 2)) <= greatest(0.05, 0.01 * total_price)
      const expectedTotal = Number((quantity * unitPrice).toFixed(2));
      if (Math.abs(totalPrice - expectedTotal) > Math.max(0.05, 0.01 * totalPrice)) {
        totalPrice = expectedTotal;
      }

      return {
        name,
        quantity,
        unitPrice,
        totalPrice,
        highlightReason: str(it.highlightReason, 200) ?? null,
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null && (i.totalPrice > 0 || i.unitPrice > 0));

  const itemsSumEur = Number(items.reduce((acc, i) => acc + i.totalPrice, 0).toFixed(2));
  const rawTotalAmount = num(parsed.totalAmount, 0);
  const totalAmountEur =
    rawTotalAmount > 0
      ? isBgn
        ? toEur(rawTotalAmount)
        : Number(rawTotalAmount.toFixed(2))
      : itemsSumEur;

  const catRaw = String(parsed.category ?? 'other').trim() as ReceiptCategory;
  // За темите с фиксирана категория (услуги, имоти, обекти, частни продавачи) тя печели,
  // за да не попадат офертите в „Други“.
  const category: ReceiptCategory =
    topicObj?.category ?? ((CATEGORIES as readonly string[]).includes(catRaw) ? catRaw : 'other');
  const polarity: 'green' | 'red' = parsed.polarity === 'green' ? 'green' : 'red';

  const merchantName = str(parsed.merchantName, 200) ?? str(parsed.placeName, 200) ?? 'Неразчетен търговец';
  const placeName = str(parsed.placeName, 200) ?? merchantName;
  const city = str(parsed.city, 80) ?? fallbackCity;

  const fallbackTitle =
    items[0]?.name
      ? `${placeName}: ${items[0].name} (${totalAmountEur.toFixed(2)} €)`
      : `Касова бележка от ${placeName} (${totalAmountEur.toFixed(2)} €)`;

  const title = str(parsed.title, 200) ?? fallbackTitle;
  const aiDesc = str(parsed.description, 3500) ?? '';
  const description = maskSensitiveText(
    aiDesc || cleanPostText || `Касова бележка от ${placeName} (${city}) на обща стойност ${totalAmountEur.toFixed(2)} €.`
  );

  // Мястото е ЗАДЪЛЖИТЕЛНО за сигналите с цена (червени флагове): без град и обект
  // офертата не е полезна за хората → изобщо не влиза в опашката.
  const locationOk = citySource !== 'none' && placeOk(placeName) && Boolean(city);
  const hasNumbers = totalAmountEur > 0 || items.length > 0;
  const accepted =
    isForeign || !imageClean || tooOld || !topicObj
      ? false
      : topicKey === 'deals'
        ? kind === 'receipt'
          ? isReceipt && hasNumbers
          : kind === 'price_signal'
            ? locationOk && totalAmountEur > 0
            : false
        : // Другите теми (услуги, имоти, обекти, майстори, частни продавачи): искаме
          // ясно място и ясна цена — приложението сравнява цени, не публикува обяви без цена.
          locationOk && totalAmountEur > 0;

  return {
    kind,
    topic: topicKey,
    imageClean,
    imageTraces,
    isReceipt: accepted,
    skipReason:
      str(parsed.skipReason, 240) ??
      (accepted
        ? null
        : tooOld
          ? `От ${receiptYear} г. е — приемаме само от 2026 г. насам`
          : !imageClean
            ? `Снимката издава Facebook (${imageTraces ?? 'интерфейс/данни'}) — приложението показва само чисти снимки`
          : isForeign
            ? 'Не е от България — не влиза в приложението'
          : !topicObj
            ? `Не влиза в избраните теми (${topics.map((t) => t.key).join(', ')})`
          : kind === 'price_signal'
            ? 'Няма разпознаваем град/място — не влиза в червените флагове'
            : 'Снимката не съдържа касова бележка или цени.'),
    polarity,
    category,
    title: toEuroText(title).slice(0, 200),
    description: toEuroText(description).slice(0, 4000),
    placeName: placeName.slice(0, 200),
    city: city.slice(0, 80),
    address: str(parsed.address, 240) ?? null,
    merchantName: merchantName.slice(0, 200),
    merchantTaxId: maskSensitiveText(str(parsed.merchantTaxId, 40)) || null,
    receiptDate: str(parsed.date, 40) ?? null,
    receiptTime: str(parsed.time, 20) ?? null,
    totalAmountEur: Math.max(0, Number(totalAmountEur.toFixed(2))),
    originalAmount: rawTotalAmount > 0 ? Number(rawTotalAmount.toFixed(2)) : null,
    originalCurrency: rawTotalAmount > 0 ? rawCurrency : null,
    confidenceScore: Math.min(1, Math.max(0, Number(num(parsed.confidenceScore, 0.8).toFixed(3)))),
    items,
    model: env.OCR_MODEL,
  };
}

/* =============================== 4) Обработка на постове и запис в опашката */

/** Адрес без query/hash и без крайни наклонени черти — за сравнение „същият пост/снимка“.
 *  Facebook CDN слага изтичащи параметри (?\_nc\_cat=…), затова сравняваме само пътя. */
export function fbUrlKey(url: string | null | undefined): string {
  return (url || '')
    .split('#')[0]!
    .split('?')[0]!
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
}


/**
 * Коментарите под постовете също могат да са сигнали („и в Пловдив е 12 лв“). Всяка
 * подходяща реплика минава през същия AI (само по текст, със снимката на поста като
 * доказателство) и влиза в опашката за одобрение — с псевдоним вместо име.
 */
async function processCommentSignals(params: {
  jobId?: string | null;
  groupUrl: string;
  posts: RawFbPost[];
  defaultCity?: string;
  maxSignals?: number;
}): Promise<{ queued: number; skipped: number }> {
  const cap = params.maxSignals ?? 20;
  let queued = 0;
  let skipped = 0;
  for (const post of params.posts) {
    if (queued >= cap) break;
    const comments = post.comments ?? [];
    let perPost = 0;
    for (let i = 0; i < comments.length && perPost < 3 && queued < cap; i++) {
      const c = comments[i]!;
      const commentYear = yearFromDate(c.postedAt ?? null);
      if (commentYear !== null && commentYear < 2026) {
        skipped++;
        continue;
      }
      if (!looksLikePriceSignal(c.text)) {
        skipped++;
        continue;
      }
      const commentKey = (post.postId ?? fbUrlKey(post.postUrl)) + '#c' + (c.id ?? i);
      const seen = await one<{ id: string }>(
        'select id::text from fb_receipt_queue where fb_post_id = $1 limit 1',
        [commentKey]
      );
      if (seen) {
        skipped++;
        continue;
      }
      const parent = await one<{
        local_image_url: string | null;
        original_image_url: string | null;
        image_sha256: string | null;
      }>(
        `select local_image_url, original_image_url, image_sha256 from fb_receipt_queue
          where local_image_url is not null
            and (($1 <> '' and fb_post_id = $1)
                 or ($2 <> '' and regexp_replace(split_part(coalesce(fb_post_url, ''), '?', 1), '/+$', '') = $2))
          order by created_at desc limit 1`,
        [post.postId ?? '', fbUrlKey(post.postUrl)]
      );
      if (!parent?.local_image_url) {
        skipped++;
        continue;
      }
      try {
        const authorAlias = pseudonymFor(c.author);
        if (params.jobId) {
          await logJob(params.jobId, 'Разчитам коментар с AI: ' + c.text.slice(0, 60) + '…');
        }
        const analysis = await analyzeFbReceiptWithAi({
          imageDataUrl: null,
          fbPostText: c.text,
          commentContext: post.text,
          defaultCity: params.defaultCity,
          authorAlias,
        });
        const title = scrubAuthorName(analysis.title, c.author, authorAlias);
        const description = scrubAuthorName(analysis.description, c.author, authorAlias);
        const status = analysis.isReceipt ? 'pending' : 'not_receipt';
        await one(
          `insert into fb_receipt_queue (
             job_id, group_url, fb_post_id, fb_post_url, fb_author_name, fb_post_text,
             original_image_url, local_image_url, image_sha256, status, skip_reason,
             polarity, category, title, description, place_name, city, address,
             merchant_name, merchant_tax_id, receipt_date, receipt_time,
             total_amount, original_amount, original_currency, confidence, ai_model, items, topic
           ) values (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb,$29
           ) returning id::text`,
          [
            params.jobId ?? null,
            params.groupUrl,
            commentKey,
            post.postUrl,
            c.author ?? null,
            c.text.slice(0, 2000),
            parent.original_image_url,
            parent.local_image_url,
            parent.image_sha256,
            status,
            analysis.skipReason ?? null,
            analysis.polarity,
            analysis.category,
            title,
            description,
            analysis.placeName,
            analysis.city,
            analysis.address ?? null,
            analysis.merchantName,
            analysis.merchantTaxId ?? null,
            analysis.receiptDate ?? null,
            analysis.receiptTime ?? null,
            analysis.totalAmountEur,
            analysis.originalAmount ?? null,
            analysis.originalCurrency ?? null,
            analysis.confidenceScore,
            analysis.model,
            JSON.stringify(analysis.items),
            analysis.topic,
          ]
        );
        perPost++;
        if (analysis.isReceipt) {
          queued++;
          if (params.jobId) {
            await query('update fb_receipt_jobs set receipts_found = receipts_found + 1 where id = $1', [
              params.jobId,
            ]);
            await logJob(
              params.jobId,
              '💬 Сигнал от коментар: „' +
                title +
                '“ — ' +
                analysis.totalAmountEur.toFixed(2) +
                ' € · ' +
                analysis.city
            );
          }
        } else {
          skipped++;
        }
      } catch (err) {
        skipped++;
        if (params.jobId) {
          await logJob(params.jobId, '⚠️ Коментар: ' + (err as Error).message.slice(0, 120));
        }
      }
    }
  }
  return { queued, skipped };
}


/** Адрес на снимка → data URL (ползва се за повторна проверка на вече свалени снимки). */
async function imageUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return null;
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    return 'data:' + contentType + ';base64,' + buf.toString('base64');
  } catch {
    return null;
  }
}

/** Питаме Vision модела дали по снимката личи, че е от Facebook. */
export async function checkImageCleanliness(
  imageDataUrl: string
): Promise<{ clean: boolean; traces: string | null }> {
  const res = await fetch(env.OPENROUTER_BASE_URL + '/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.OPENROUTER_API_KEY,
      'Content-Type': 'application/json',
      'HTTP-Referer': env.PUBLIC_BASE_URL,
      'X-Title': 'SmartPrice BG image cleanliness',
    },
    body: JSON.stringify({
      model: env.OCR_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Ти проверяваш снимка за българското приложение SmartPrice. Връщаш СТРИКТНО JSON: ' +
            '{"imageClean": boolean, "traces": string | null, "verdict": "ok" | "fb"}. ' +
            'imageClean е false, ако по снимката личи, че идва от Facebook: интерфейс на приложението ' +
            '(харесвания, коментари, споделяния), име/снимка на профил, надпис или лого „Facebook“, ' +
            'скрийншот на пост/група, броячи. true, ако е само бележката, цената, продуктът, табелата ' +
            'или снимка от място. traces описва КРАТКО на български какво издава Facebook, иначе null.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Провери тази снимка и върни JSON.' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error('Vision моделът върна грешка ' + res.status);
  }
  const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content ?? '';
  const clean = content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(clean) as Record<string, unknown>;
  const isClean = parsed.imageClean === undefined ? true : Boolean(parsed.imageClean);
  const tracesRaw = parsed.traces;
  return {
    clean: isClean,
    traces: isClean ? null : (typeof tracesRaw === 'string' && tracesRaw.trim() ? tracesRaw.trim().slice(0, 240) : 'интерфейс/данни от Facebook'),
  };
}

/**
 * Проверява снимките в опашката за следи от Facebook. „Мръсните“ не се одобряват —
 * маркират се като `not_receipt` с причина какво точно издава Facebook.
 */
export async function checkQueueImages(params: { ids?: number[]; limit?: number }): Promise<{
  checked: number;
  clean: number;
  dirty: number;
  details: Array<{ id: string; title: string | null; clean: boolean; traces: string | null }>;
}> {
  const limit = params.limit ?? 20;
  const rows = params.ids?.length
    ? await many<{ id: string; local_image_url: string; title: string | null }>(
        `select id::text, local_image_url, title from fb_receipt_queue
          where id = any($1::bigint[]) and local_image_url is not null`,
        [params.ids]
      )
    : await many<{ id: string; local_image_url: string; title: string | null }>(
        `select id::text, local_image_url, title from fb_receipt_queue
          where status = 'pending' and local_image_url is not null
          order by created_at desc limit $1`,
        [limit]
      );
  let clean = 0;
  let dirty = 0;
  const details: Array<{ id: string; title: string | null; clean: boolean; traces: string | null }> = [];
  for (const row of rows) {
    const dataUrl = await imageUrlToDataUrl(row.local_image_url);
    if (!dataUrl) continue;
    let verdict: { clean: boolean; traces: string | null };
    try {
      verdict = await checkImageCleanliness(dataUrl);
    } catch {
      continue;
    }
    if (verdict.clean) {
      clean++;
    } else {
      dirty++;
      await query(
        `update fb_receipt_queue
            set status = 'not_receipt', skip_reason = $2, reviewed_at = now()
          where id = $1 and status = 'pending'`,
        [row.id, `Снимката издава Facebook (${verdict.traces ?? 'интерфейс/данни'}) — не пускаме такива`]
      );
    }
    details.push({ id: row.id, title: row.title, clean: verdict.clean, traces: verdict.traces });
  }
  return { checked: details.length, clean, dirty, details };
}

async function logJob(jobId: string, msg: string) {
  const line = `${new Date().toISOString().slice(11, 19)} ${msg}`;
  await query(
    `update fb_receipt_jobs
        set log = (case when jsonb_array_length(log) > 150 then log - 0 else log end) || to_jsonb($2::text)
      where id = $1`,
    [jobId, line]
  );
}

/**
 * Обработва списък от сурови Facebook постове (сваля снимките, пуска AI OCR
 * и ги записва в `fb_receipt_queue` със статус `pending` за одобрение).
 */
export async function processRawFbPosts(params: {
  jobId?: string | null;
  groupUrl: string;
  posts: RawFbPost[];
  defaultCity?: string;
  maxReceipts?: number;
}): Promise<{
  queued: number;
  skipped: number;
  failed: number;
  items: Array<Record<string, unknown>>;
}> {
  let queued = 0;
  let skipped = 0;
  let failed = 0;
  const insertedIds: string[] = [];
  const cap = params.maxReceipts ?? 50;

  for (const post of params.posts) {
    if (queued >= cap) break;

    // Само постове от 2026 г. насам.
    const postYear = yearFromDate(post.postedAt ?? null);
    if (postYear !== null && postYear < 2026) {
      skipped++;
      if (params.jobId) {
        await logJob(params.jobId, `⏭ Постът е от ${postYear} г. — приемаме само от 2026 г. насам`);
      }
      continue;
    }

    for (const imgUrl of post.imageUrls.slice(0, 3)) {
      if (queued >= cap) break;

      // Дедупликация: НЕ теглим повторно вече видяно — нито одобрено, нито отхвърлено,
      // нито чакащо. Сравняваме пост по стабилния fb_post_id, а адресите (пост и снимка)
      // без query част, защото Facebook CDN слага изтичащи параметри при всеки fetch.
      const existingByUrl = await one<{ id: string }>(
        `select id::text from fb_receipt_queue
          where ($1 <> '' and fb_post_id = $1)
             or ($2 <> '' and regexp_replace(split_part(coalesce(fb_post_url, ''), '?', 1), '/+$', '') = $2)
             or ($3 <> '' and regexp_replace(split_part(coalesce(original_image_url, ''), '?', 1), '/+$', '') = $3)
          limit 1`,
        [(post.postId ?? '').trim(), fbUrlKey(post.postUrl), fbUrlKey(imgUrl)]
      );
      if (existingByUrl) {
        skipped++;
        if (params.jobId) {
          await query(`update fb_receipt_jobs set skipped = skipped + 1 where id = $1`, [params.jobId]);
        }
        continue;
      }

      const downloaded = await downloadReceiptImage(imgUrl);
      if (!downloaded) {
        failed++;
        if (params.jobId) {
          await query(`update fb_receipt_jobs set failed = failed + 1 where id = $1`, [params.jobId]);
        }
        continue;
      }

      // Дедупликация по SHA-256 на самата снимка
      const existingByHash = await one<{ id: string }>(
        `select id::text from fb_receipt_queue where image_sha256 = $1 limit 1`,
        [downloaded.sha256]
      );
      if (existingByHash) {
        skipped++;
        if (params.jobId) {
          await query(`update fb_receipt_jobs set skipped = skipped + 1 where id = $1`, [params.jobId]);
        }
        continue;
      }

      try {
        if (params.jobId) {
          await logJob(
            params.jobId,
            `Разчитам снимка с AI (${env.OCR_MODEL}): ${post.text ? post.text.slice(0, 60) + '…' : post.postUrl}`
          );
        }

        const authorAlias = pseudonymFor(post.authorName);
        const analysis = await analyzeFbReceiptWithAi({
          imageDataUrl: downloaded.dataUrl,
          fbPostText: post.text,
          defaultCity: params.defaultCity,
          authorAlias,
          commentsText: post.comments?.length
            ? post.comments
                .map((c) => maskSensitiveText(c.text).slice(0, 300))
                .slice(0, 8)
                .join('\n- ')
            : undefined,
        });
        // Самоличността: истинското име на автора не бива да стига до приложението.
        analysis.title = scrubAuthorName(analysis.title, post.authorName, authorAlias);
        analysis.description = scrubAuthorName(analysis.description, post.authorName, authorAlias);

        const status = analysis.isReceipt ? 'pending' : 'not_receipt';
        const row = await one<{ id: string }>(
          `insert into fb_receipt_queue (
             job_id, group_url, fb_post_id, fb_post_url, fb_author_name, fb_posted_at,
             fb_post_text, original_image_url, local_image_url, image_sha256,
             status, skip_reason, polarity, category, title, description,
             place_name, city, address, merchant_name, merchant_tax_id,
             receipt_date, receipt_time, total_amount, original_amount,
             original_currency, confidence, ai_model, items, topic
           ) values (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             $11,$12,$13,$14,$15,$16,
             $17,$18,$19,$20,$21,
             $22,$23,$24,$25,$26,$27,$28,$29::jsonb,$30
           ) returning id::text`,
          [
            params.jobId ?? null,
            params.groupUrl,
            post.postId ?? null,
            post.postUrl,
            post.authorName ?? null,
            post.postedAt ?? null,
            post.text || '',
            imgUrl.slice(0, 1000),
            downloaded.localUrl,
            downloaded.sha256,
            status,
            analysis.skipReason ?? null,
            analysis.polarity,
            analysis.category,
            analysis.title,
            analysis.description,
            analysis.placeName,
            analysis.city,
            analysis.address ?? null,
            analysis.merchantName,
            analysis.merchantTaxId ?? null,
            analysis.receiptDate ?? null,
            analysis.receiptTime ?? null,
            analysis.totalAmountEur,
            analysis.originalAmount ?? null,
            analysis.originalCurrency ?? null,
            analysis.confidenceScore,
            analysis.model,
            JSON.stringify(analysis.items),
            analysis.topic,
          ]
        );

        if (row) insertedIds.push(row.id);

        if (analysis.isReceipt) {
          queued++;
          if (params.jobId) {
            await query(`update fb_receipt_jobs set receipts_found = receipts_found + 1 where id = $1`, [
              params.jobId,
            ]);
            await logJob(
              params.jobId,
              analysis.kind === 'price_signal'
                ? `🔴 Сигнал за цена (${analysis.polarity === 'green' ? 'добра цена' : 'червен флаг'}): „${analysis.title}“ — ${analysis.totalAmountEur.toFixed(2)} € · ${analysis.city}`
                : `✅ Разчетена бележка: „${analysis.title}“ — ${analysis.totalAmountEur.toFixed(2)} € (${analysis.items.length} артикула)`
            );
          }
        } else {
          skipped++;
          if (params.jobId) {
            await query(`update fb_receipt_jobs set skipped = skipped + 1 where id = $1`, [params.jobId]);
            await logJob(params.jobId, `⏭ Пропуснато (${analysis.kind === 'price_signal' ? 'сигнал без ясно място' : 'не е касова бележка'}): ${analysis.skipReason ?? ''}`);
          }
        }
      } catch (err) {
        failed++;
        if (params.jobId) {
          await query(`update fb_receipt_jobs set failed = failed + 1 where id = $1`, [params.jobId]);
          await logJob(params.jobId, `⚠️ Грешка при AI анализ: ${(err as Error).message.slice(0, 160)}`);
        }
      }
    }
  }

  const items = insertedIds.length
    ? await many<Record<string, unknown>>(
        `select * from fb_receipt_queue where id = any($1::bigint[]) order by id desc`,
        [insertedIds.map(Number)]
      )
    : [];

  return { queued, skipped, failed, items };
}

/**
 * Изпълнява задача за сваляне на постове от публична Facebook група.
 */
export async function runFbGroupJob(
  jobId: string,
  options: { defaultCity?: string } = {}
): Promise<void> {
  const job = await one<{
    id: string;
    group_url: string;
    group_id: string | null;
    target_count: number;
  }>(`select id::text, group_url, group_id, target_count from fb_receipt_jobs where id = $1`, [jobId]);
  if (!job) return;

  try {
    const cfg = await getFbScraperConfig();
    if (!cfg.ocrAvailable) {
      throw new Error('AI OCR не е активен: липсва OPENROUTER_API_KEY в .env.');
    }

    const { canonicalUrl, groupId } = parseFbGroupUrl(job.group_url);
    await logJob(jobId, `Стартирам обиколка на Facebook група: ${canonicalUrl}`);

    let rawPosts: RawFbPost[] = [];
    let strategy = '';

    // 1) Първо пробваме Apify Facebook Groups Scraper, ако има токен
    if (cfg.hasApifyToken) {
      try {
        rawPosts = await fetchViaApify(canonicalUrl, job.target_count, cfg.apifyToken, (m) => logJob(jobId, m));
        if (rawPosts.length > 0) {
          strategy = 'apify';
          await logJob(jobId, `Apify върна ${rawPosts.length} поста със снимки.`);
        }
        // Коментарите под постовете: и като контекст за мястото, и като отделни сигнали.
        if (rawPosts.length > 0 && (await getSetting('fb_comments', 'on')) !== 'off') {
          try {
            const withComments = await attachFbComments(rawPosts, cfg.apifyToken, (m) => logJob(jobId, m));
            await logJob(jobId, `Коментари: прочетени за ${withComments} поста.`);
          } catch (err) {
            await logJob(jobId, `Коментари (предупреждение): ${(err as Error).message.slice(0, 140)}`);
          }
        }
      } catch (err) {
        await logJob(jobId, `Apify предупреждение: ${(err as Error).message}`);
      }
    }

    // 2) Ако няма Apify токен или не е върнал постове, пробваме директно четене
    if (rawPosts.length === 0) {
      rawPosts = await fetchViaDirectHttp(
        canonicalUrl,
        groupId,
        job.target_count,
        cfg.fbCookie,
        (m) => logJob(jobId, m)
      );
      if (rawPosts.length > 0) {
        strategy = cfg.hasFbCookie ? 'direct+cookie' : 'direct';
        await logJob(jobId, `Директното четене откри ${rawPosts.length} поста със снимки.`);
      }
    }

    await query(
      `update fb_receipt_jobs set discovered = $2, strategy = $3 where id = $1`,
      [jobId, rawPosts.length, strategy || 'none']
    );

    if (rawPosts.length === 0) {
      const hint = !cfg.hasApifyToken
        ? 'Facebook изисква вход за тази група при четене от сървър. Добави Apify API ключ или FB Cookie в „Настройки за Facebook“ по-долу, или ползвай бутона „Браузър колектор (1 клик)“.'
        : 'Не бяха открити нови постове със снимки в групата.';
      await logJob(jobId, `⚠️ ${hint}`);
      await query(
        `update fb_receipt_jobs set status = 'failed', error = $2, finished_at = now() where id = $1`,
        [jobId, hint]
      );
      return;
    }

    const res = await processRawFbPosts({
      jobId,
      groupUrl: canonicalUrl,
      posts: rawPosts,
      defaultCity: options.defaultCity,
      maxReceipts: job.target_count,
    });

    // Коментарите под постовете също може да са сигнали („и в Пловдив е 12 лв“).
    try {
      const commentRes = await processCommentSignals({
        jobId,
        groupUrl: canonicalUrl,
        posts: rawPosts,
        defaultCity: options.defaultCity,
        maxSignals: Math.min(20, Math.max(5, Math.round(job.target_count / 2))),
      });
      if (commentRes.queued || commentRes.skipped) {
        await logJob(
          jobId,
          `Коментари: нови сигнали ${commentRes.queued}, прескочени ${commentRes.skipped}.`
        );
      }
    } catch (err) {
      await logJob(jobId, `Коментари (предупреждение): ${(err as Error).message.slice(0, 120)}`);
    }

    // Авто-одобрение: сигнали с висока увереност влизат сами (само ако е включено).
    try {
      const cfgNow = await getFbScraperConfig();
      if (cfgNow.autoApprove) {
        const approver = await one<{ created_by: string | null }>(
          'select created_by from fb_receipt_jobs where id = $1',
          [jobId]
        );
        if (approver?.created_by) {
          const auto = await many<{ id: string }>(
            `select id::text from fb_receipt_queue
              where status = 'pending' and local_image_url is not null and confidence >= $1
                and coalesce(topic, 'deals') = 'deals'
              order by confidence desc limit 25`,
            [cfgNow.autoApproveMin]
          );
          let approved = 0;
          for (const row of auto) {
            try {
              const done = await approveFbReceiptItem(row.id, approver.created_by);
              if (done) approved++;
            } catch {
              /* не мина — остава за ръчно одобрение */
            }
          }
          if (auto.length) {
            await logJob(
              jobId,
              `🤖 Авто-одобрени ${approved} от ${auto.length} сигнала (увереност ≥ ${cfgNow.autoApproveMin}).`
            );
          }
        }
      }
    } catch (err) {
      await logJob(jobId, `Авто-одобрение (предупреждение): ${(err as Error).message.slice(0, 120)}`);
    }

    await logJob(
      jobId,
      `Готово! Чакат одобрение: ${res.queued} бележки · пропуснати: ${res.skipped} · грешки: ${res.failed}.`
    );
    await query(
      `update fb_receipt_jobs set status = 'done', finished_at = now() where id = $1`,
      [jobId]
    );
  } catch (err) {
    const msg = (err as Error).message || 'Неизвестна грешка';
    await logJob(jobId, `❌ Задачата спря с грешка: ${msg}`);
    await query(
      `update fb_receipt_jobs set status = 'failed', error = $2, finished_at = now() where id = $1`,
      [jobId, msg.slice(0, 400)]
    );
  }
}

/* ================================ 5) Одобрение и публикуване в SmartPrice */

export interface ApproveOverrides {
  title?: string;
  description?: string;
  polarity?: 'green' | 'red';
  category?: ReceiptCategory;
  placeName?: string;
  city?: string;
  address?: string | null;
  merchantName?: string;
  merchantTaxId?: string | null;
  receiptDate?: string | null;
  receiptTime?: string | null;
  totalAmount?: number;
  items?: ParsedReceiptLine[];
}

/**
 * Одобрява ред от `fb_receipt_queue` и го публикува в `posts` + `receipts` + `receipt_items`.
 */
export async function approveFbReceiptItem(
  queueId: string,
  adminId: string,
  overrides?: ApproveOverrides
): Promise<{ postId: string; alreadyApproved?: boolean }> {
  const row = await one<{
    id: string;
    status: string;
    post_id: string | null;
    fb_post_url: string;
    local_image_url: string;
    polarity: 'green' | 'red';
    category: ReceiptCategory;
    title: string;
    description: string;
    place_name: string;
    city: string;
    address: string | null;
    merchant_name: string;
    merchant_tax_id: string | null;
    receipt_date: string | null;
    receipt_time: string | null;
    total_amount: string;
    confidence: string;
    topic: string | null;
    ai_model: string | null;
    items: ParsedReceiptLine[] | null;
  }>(`select * from fb_receipt_queue where id = $1`, [queueId]);

  if (!row) {
    throw new Error('Записът не е намерен в опашката.');
  }
  if (row.status === 'approved' && row.post_id) {
    return { postId: row.post_id, alreadyApproved: true };
  }

  const title = (overrides?.title ?? row.title).trim().slice(0, 200);
  const description = (overrides?.description ?? row.description).trim().slice(0, 4000);
  const polarity: 'green' | 'red' = overrides?.polarity ?? (row.polarity === 'green' ? 'green' : 'red');
  // Темата на сигнала може да наложи категория (услуги / имоти / обекти / частни продавачи).
  const topicObj = FB_TOPICS.find((t) => t.key === row.topic) ?? null;
  const category = overrides?.category ?? topicObj?.category ?? row.category ?? 'other';
  const placeName = (overrides?.placeName ?? row.place_name ?? row.merchant_name).trim().slice(0, 200) || 'Магазин';
  const city = (overrides?.city ?? row.city).trim().slice(0, 80) || 'София';
  const address = (overrides?.address !== undefined ? overrides.address : row.address)?.trim().slice(0, 300) || null;
  const merchantName = (overrides?.merchantName ?? row.merchant_name ?? placeName).trim().slice(0, 200);
  const merchantTaxId =
    (overrides?.merchantTaxId !== undefined ? overrides.merchantTaxId : row.merchant_tax_id)?.trim().slice(0, 40) ||
    null;
  const receiptDate =
    (overrides?.receiptDate !== undefined ? overrides.receiptDate : row.receipt_date)?.trim().slice(0, 40) || null;
  const receiptTime =
    (overrides?.receiptTime !== undefined ? overrides.receiptTime : row.receipt_time)?.trim().slice(0, 20) || null;

  const rawItems = Array.isArray(overrides?.items)
    ? overrides!.items
    : Array.isArray(row.items)
      ? row.items
      : [];

  const cleanItems: ParsedReceiptLine[] = rawItems
    .map((it) => {
      const name = String(it.name ?? '').trim().slice(0, 200);
      if (!name) return null;
      const quantity = Math.max(0.001, Number(num(it.quantity, 1).toFixed(3)));
      const unitPrice = Math.max(0, Number(num(it.unitPrice, 0).toFixed(2)));
      let totalPrice = Math.max(0, Number(num(it.totalPrice, Number((quantity * unitPrice).toFixed(2))).toFixed(2)));
      const expectedTotal = Number((quantity * unitPrice).toFixed(2));
      if (Math.abs(totalPrice - expectedTotal) > Math.max(0.05, 0.01 * totalPrice)) {
        totalPrice = expectedTotal;
      }
      return {
        name,
        quantity,
        unitPrice,
        totalPrice,
        highlightReason: it.highlightReason ? String(it.highlightReason).trim().slice(0, 200) : null,
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null);

  const itemsSum = Number(cleanItems.reduce((acc, i) => acc + i.totalPrice, 0).toFixed(2));
  const pricePaid = Math.max(
    0.01,
    Number((overrides?.totalAmount ?? (Number(row.total_amount) || itemsSum || 1)).toFixed(2))
  );

  if (title.length < 3) {
    throw new Error('Заглавието трябва да е поне 3 символа.');
  }

  const authorId = await officialProfileId();

  // Групиране: ако същият обект в същия град вече има публикувана оферта на СЪЩАТА цена,
  // не правим дубликат — вдигаме брояча „N души сигнализират“ и свързваме сигнала с нея.
  // ВНИМАНИЕ: не сравняваме с lower() в SQL — при locale C Postgres не сгъва кирилица.
  // Затова вадим кандидатите по цена и сравняваме имената в JavaScript (toLowerCase работи с кирилица).
  const candidates = await many<{
    id: string;
    place_name: string | null;
    city: string | null;
    signal_count: number;
  }>(
    `select id::text, place_name, city, signal_count::int as signal_count from posts
      where source = 'receipt_basket' and coalesce(price_paid, 0) = $1
      order by created_at asc
      limit 25`,
    [pricePaid]
  );
  const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const existingPost = placeName.trim()
    ? candidates.find((c) => norm(c.place_name) === norm(placeName) && norm(c.city) === norm(city))
    : undefined;
  if (existingPost) {
    // Брояч + видим етикет в приложението (таговете се показват и на картата, и в офертата).
    const nextCount = (existingPost.signal_count ?? 1) + 1;
    await query(
      `update posts
          set signal_count = $2,
              tags = (
                select coalesce(array_agg(t), '{}')
                  from unnest(coalesce(tags, '{}'::text[])) as t
                 where t !~ '^#[0-9]+Сигнал'
              ) || $3::text
        where id = $1`,
      [existingPost.id, nextCount, '#' + nextCount + 'Сигнала']
    );
    await query(
      `update fb_receipt_queue
          set status = 'approved', post_id = $2, reviewed_at = now(), reviewed_by = $3
        where id = $1 and status in ('pending', 'not_receipt')`,
      [row.id, existingPost.id, adminId]
    );
    return { postId: existingPost.id, alreadyApproved: true };
  }

  const tags = [
    polarity === 'green' ? '#ТопНаходка' : '#ЧервенФлаг',
    '#КасоваБележка',
    `#${city.replace(/\s+/g, '')}`,
  ];

  const postId = await tx(async (client) => {
    const postRes = await client.query<{ id: string }>(
      `insert into posts (
         author_id, polarity, category, platform_tag, title, description,
         place_name, city, address, price_paid, currency, image_url, tags,
         seller_type, source, source_note
       ) values (
         $1,$2,$3,'На място',$4,$5,$6,$7,$8,$9,'EUR',$10,$11,
         'business','receipt_basket',$12
       ) returning id`,
      [
        authorId,
        polarity,
        category,
        title,
        description,
        placeName,
        city,
        address,
        pricePaid,
        row.local_image_url,
        tags,
        `Касова бележка от публична група: ${row.fb_post_url}`.slice(0, 300),
      ]
    );
    const newPostId = postRes.rows[0]!.id;

    // Единична цена (€/кг, €/л) от грамажа в заглавието/артикулите — за да може да се сравнява.
    let unitQty: number | null = null;
    let unitType: string | null = null;
    let perUnit: number | null = null;
    const unit = parseUnit(`${title} ${cleanItems.map((i) => i.name).join(' ')}`);
    const QTY_TO_KG: Record<string, number> = { g: 1000, kg: 1, ml: 1000, l: 1, pcs: 1 };
    const unitQtyRaw = typeof unit.quantity === 'number' ? unit.quantity : 0;
    const unitKey = typeof unit.unit === 'string' ? unit.unit : '';
    if (unitKey && QTY_TO_KG[unitKey] !== undefined && unitQtyRaw > 0) {
      unitType = unitKey;
      unitQty = unitQtyRaw;
      perUnit = Number(((pricePaid / unitQtyRaw) * QTY_TO_KG[unitKey]!).toFixed(4));
    }

    // „Уж промоция“: ако същият продукт в същия град вече е бил на същата или по-ниска цена,
    // обявената „промоция“ не е промоция. Пазим го като флаг (колоната съществува в базата).
    const words = title
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4);
    let fakePromo = false;
    if (words.length) {
      const prev = await client.query<{ min_price: string | null }>(
        `select min(ph.price)::text as min_price
           from price_history ph
           join posts pp on pp.id = ph.post_id
          where pp.city = $1 and pp.id <> $2
            and pp.title ilike '%' || $3 || '%'
            and ph.price < $4`,
        [city, newPostId, words[0]!, pricePaid]
      );
      const minPrev = Number(prev.rows[0]?.min_price ?? 0);
      const claimsDeal = /промоц|намал|отстъпк|изгодн|евтин/i.test(`${title} ${description}`);
      // Обявява „промоция“, а в приложението същият продукт в този град вече е бил по-евтин.
      fakePromo = claimsDeal && minPrev > 0 && minPrev < pricePaid;
    }

    // ЕИК → име/адрес на търговеца (VIES, безплатно) и геокод, за да сочи картата точно.
    // Ако ЕИК-ът е прочетен, но VIES не знае нищо за него (фирмата не е регистрирана по ДДС),
    // го казваме честно в офертата, вместо да мълчим.
    const vies = await viesLookup(row.merchant_tax_id);
    const eikDigits = String(row.merchant_tax_id ?? '').replace(/\D/g, '');
    const viesNote = vies
      ? `Търговец по ДДС: ${vies.name}${vies.address ? ', ' + vies.address : ''}`
      : isValidEik(eikDigits)
        ? `ЕИК ${eikDigits} — няма данни в регистъра по ДДС на ЕС (VIES); вероятно търговецът не е регистриран по ДДС.`
        : null;
    const geo =
      (await geocodeAddress([address || vies?.address || '', placeName, city].filter(Boolean).join(', '))) ??
      (await geocodeAddress(`${placeName}, ${city}`)) ??
      (await geocodeAddress(city));
    if (geo || viesNote) {
      await client.query(
        `update posts
            set latitude = coalesce($2, latitude),
                longitude = coalesce($3, longitude),
                google_maps_url = coalesce($4, google_maps_url),
                seller_note = coalesce($5, seller_note)
          where id = $1`,
        [
          newPostId,
          geo?.lat ?? null,
          geo?.lng ?? null,
          geo ? `https://www.google.com/maps?q=${geo.lat},${geo.lng}` : null,
          viesNote ? viesNote.slice(0, 300) : null,
        ]
      );
    }

    if (unitQty !== null || fakePromo) {
      await client.query(
        'update posts set unit_quantity = $2, unit_type = $3, price_per_unit = $4, is_fake_promo = $5 where id = $1',
        [newPostId, unitQty, unitType, perUnit, fakePromo]
      );
    }

    await client.query(
      `insert into price_history (post_id, price, status, reported_by)
       values ($1,$2,'initial',$3)`,
      [newPostId, pricePaid, authorId]
    );

    const receiptRes = await client.query<{ id: string }>(
      `insert into receipts (
         post_id, merchant_name, merchant_tax_id, receipt_date, receipt_time,
         total_amount, currency, confidence, verified_by_ai, source, model, image_url
       ) values ($1,$2,$3,$4,$5,$6,'EUR',$7,true,'openrouter',$8,$9)
       returning id`,
      [
        newPostId,
        merchantName,
        merchantTaxId,
        receiptDate,
        receiptTime,
        pricePaid,
        Math.min(1, Math.max(0, Number(row.confidence) || 0.85)),
        row.ai_model ?? env.OCR_MODEL,
        row.local_image_url,
      ]
    );
    const receiptId = receiptRes.rows[0]!.id;

    for (const [idx, item] of cleanItems.entries()) {
      await client.query(
        `insert into receipt_items
           (receipt_id, position, name, quantity, unit_price, total_price, highlight_reason)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          receiptId,
          idx,
          item.name,
          item.quantity,
          item.unitPrice,
          item.totalPrice,
          item.highlightReason ?? null,
        ]
      );
    }

    await client.query(
      `update fb_receipt_queue
          set status = 'approved',
              post_id = $2,
              title = $3,
              description = $4,
              polarity = $5,
              category = $6,
              place_name = $7,
              city = $8,
              address = $9,
              merchant_name = $10,
              merchant_tax_id = $11,
              receipt_date = $12,
              receipt_time = $13,
              total_amount = $14,
              items = $15::jsonb,
              reviewed_at = now(),
              reviewed_by = $16
        where id = $1`,
      [
        queueId,
        newPostId,
        title,
        description,
        polarity,
        category,
        placeName,
        city,
        address,
        merchantName,
        merchantTaxId,
        receiptDate,
        receiptTime,
        pricePaid,
        JSON.stringify(cleanItems),
        adminId,
      ]
    );

    return newPostId;
  });

  return { postId };
}
