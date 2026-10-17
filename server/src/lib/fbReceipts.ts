import { createHash, randomUUID } from 'node:crypto';
import { many, one, query, tx } from '../db.js';
import { env, features } from '../env.js';
import { getSetting, setSetting } from './settings.js';
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
  'other',
] as const;

export type ReceiptCategory = (typeof CATEGORIES)[number];

export interface RawFbPost {
  postId?: string;
  postUrl: string;
  text: string;
  imageUrls: string[];
  authorName?: string;
  postedAt?: string;
}

export interface ParsedReceiptLine {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  highlightReason?: string | null;
}

export interface AiReceiptAnalysis {
  kind: 'receipt' | 'price_signal' | 'not_relevant';
  isReceipt: boolean;
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

/** Чете настройките за Facebook скрапера (Apify токен и по избор FB cookie). */
export async function getFbScraperConfig(): Promise<{
  apifyToken: string;
  hasApifyToken: boolean;
  fbCookie: string;
  hasFbCookie: boolean;
  ocrAvailable: boolean;
  ocrModel: string;
}> {
  const savedApify = await getSetting('apify_api_token', '');
  const savedCookie = await getSetting('fb_cookie', '');
  const apifyToken = (savedApify || env.APIFY_API_TOKEN || '').trim();
  const fbCookie = (savedCookie || '').trim();
  return {
    apifyToken,
    hasApifyToken: Boolean(apifyToken),
    fbCookie,
    hasFbCookie: Boolean(fbCookie),
    ocrAvailable: features.ocr,
    ocrModel: env.OCR_MODEL,
  };
}

export async function saveFbScraperConfig(input: {
  apifyToken?: string;
  fbCookie?: string;
}): Promise<void> {
  if (input.apifyToken !== undefined) {
    await setSetting('apify_api_token', input.apifyToken.trim());
  }
  if (input.fbCookie !== undefined) {
    await setSetting('fb_cookie', input.fbCookie.trim());
  }
}

/* ================================================== 1) Сваляне от Facebook */

/**
 * Стратегия 1: Apify (`apify/facebook-groups-scraper`).
 * Работи изцяло от сървъра с публични групи (напр. groups/3111975342346393).
 */
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

export async function downloadReceiptImage(
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

export async function analyzeFbReceiptWithAi(params: {
  imageDataUrl: string;
  fbPostText: string;
  defaultCity?: string;
}): Promise<AiReceiptAnalysis> {
  if (!features.ocr) {
    throw new Error('Липсва OPENROUTER_API_KEY в конфигурацията за AI разчитане на касови бележки.');
  }

  const cleanPostText = maskSensitiveText(params.fbPostText).slice(0, 2500);
  const fallbackCity = (params.defaultCity || 'София').trim() || 'София';

  const systemPrompt = [
    'Ти си експертен OCR и анализатор за SmartPrice BG — приложение за реални цени, касови бележки и потребителски сигнали в България.',
    'Подава ти се СНИМКА от пост във Facebook група и ТЕКСТЪТ към поста, написан от автора.',
    '',
    'Твоята задача:',
    '1. Реши КАКВО показва снимката и върни "kind":',
    '   - "receipt" — касова бележка (фискален бон), сметка от заведение/ресторант или фактура.',
    '   - "price_signal" — СИГНАЛ ЗА ЦЕНА: снимка с цена (етикет, рафт, меню, табела, продукт), дори БЕЗ формален бон, но в комбинация с текст на поста, в който авторът СЕ ОПЛАКВА (скъпо, вдигнаха цената, малък грамаж, скрита такса, измама) или хвали цената.',
    '   - "not_relevant" — мем, селфи, пейзаж, снимка без никаква цена и без текст за цена.',
    '2. ЗАДЪЛЖИТЕЛНО за "price_signal" — трябва да е ЯСНО МЯСТОТО: "placeName" (магазин/обект) И "city" (град в България) И "citySource".',
    '   - "citySource": "receipt" (градът се чете от бележката/табелата/менюто), "post" (споменат е в текста на поста), "none" (никъде не личи).',
    '   - Ако "citySource" е "none" ИЛИ не можеш да определиш "placeName" → върни "kind": "not_relevant", "isReceipt": false, "skipReason": "Няма разпознаваем град/място". НЕ измисляй град и не ползвай град по подразбиране.',
    '   - Само когато мястото Е ясно и има реална цена (totalAmount > 0) → "isReceipt": true (това е билетът за опашката за одобрение).',
    '2. Прочети САМО това, което реално виждаш на касовата бележка/сметката: търговец (merchantName), ЕИК (merchantTaxId), дата (DD.MM.YYYY), час (HH:MM), обща сума (totalAmount), валута ("BGN" или "EUR") и всички артикули по редове (items).',
    '3. Комбинирай ТЕКСТА НА ПОСТА със СНИМКАТА НА БЕЛЕЖКАТА:',
    '   - "polarity": "red" (ако авторът се оплаква от висока цена, надценка, скрита такса, малък грамаж или измама) или "green" (ако споделя добра оферта, ниска цена или изгодна покупка). При "price_signal" почти винаги е "red" — "green" само ако изрично хвали цената.',
    '   - "category": точно една от: "restaurants" | "hotels_airbnb" | "supermarket" | "cafes_bars" | "services_tech" | "other".',
    '   - "title": ясно и грабващо заглавие на български (до 110 знака), което отразява какво е купено/коментирано и на каква цена/място.',
    '   - "description": запази смисъла и историята от текста на поста във Facebook + добави кратко обобщение какво се вижда на касовата бележка. Махни лични имена или телефони.',
    '   - "placeName": разбираемо име на магазина или заведението (напр. "Lidl", "Kaufland", "Ресторант ...", или името на фирмата от бона).',
    `   - "city": градът в България. За "receipt": от бележката или от текста; ако никъде не пише — "${fallbackCity}". За "price_signal": САМО истинският град (иначе "not_relevant").`,
    '   - "address": точен адрес/улица от касовата бележка, ако се чете, иначе null.',
    '',
    'Върни СТРИКТНО валиден JSON с тази форма:',
    '{',
    '  "kind": "receipt" | "price_signal" | "not_relevant",',
    '  "isReceipt": boolean,',
    '  "skipReason": string | null,',
    '  "citySource": "receipt" | "post" | "none",',
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
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: cleanPostText
                ? `Текст към поста във Facebook:\n"""\n${cleanPostText}\n"""\n\nРазчети касовата бележка от снимката и подготви публикацията.`
                : 'Постът няма допълнителен текст. Разчети касовата бележка от снимката и подготви публикацията.',
            },
            { type: 'image_url', image_url: { url: params.imageDataUrl } },
          ],
        },
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
  const kind: 'receipt' | 'price_signal' | 'not_relevant' =
    kindRaw === 'receipt' || kindRaw === 'price_signal' || kindRaw === 'not_relevant'
      ? kindRaw
      : isReceipt
        ? 'receipt'
        : 'not_relevant';
  const citySourceRaw = String(parsed.citySource ?? '').trim();
  const citySource: 'receipt' | 'post' | 'none' =
    citySourceRaw === 'post' || citySourceRaw === 'none'
      ? citySourceRaw
      : citySourceRaw === 'receipt' || kind === 'receipt'
        ? 'receipt'
        : 'none';
  const placeOk = (v: string) => Boolean(v) && v !== 'Неразчетен търговец';
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
  const category: ReceiptCategory = (CATEGORIES as readonly string[]).includes(catRaw) ? catRaw : 'other';
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
    kind === 'receipt'
      ? isReceipt && hasNumbers
      : kind === 'price_signal'
        ? locationOk && totalAmountEur > 0
        : false;

  return {
    kind,
    isReceipt: accepted,
    skipReason:
      str(parsed.skipReason, 240) ??
      (accepted
        ? null
        : kind === 'price_signal'
          ? 'Няма разпознаваем град/място — не влиза в червените флагове'
          : 'Снимката не съдържа касова бележка или цени.'),
    polarity,
    category,
    title: title.slice(0, 200),
    description: description.slice(0, 4000),
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

    for (const imgUrl of post.imageUrls.slice(0, 3)) {
      if (queued >= cap) break;

      // Проверка дали вече не сме обработили същия пост + снимка
      const existingByUrl = await one<{ id: string }>(
        `select id::text from fb_receipt_queue
          where original_image_url = $1 or (fb_post_url = $2 and $2 <> '')
          limit 1`,
        [imgUrl, post.postUrl]
      );
      if (existingByUrl && post.imageUrls.length === 1) {
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

        const analysis = await analyzeFbReceiptWithAi({
          imageDataUrl: downloaded.dataUrl,
          fbPostText: post.text,
          defaultCity: params.defaultCity,
        });

        const status = analysis.isReceipt ? 'pending' : 'not_receipt';
        const row = await one<{ id: string }>(
          `insert into fb_receipt_queue (
             job_id, group_url, fb_post_id, fb_post_url, fb_author_name, fb_posted_at,
             fb_post_text, original_image_url, local_image_url, image_sha256,
             status, skip_reason, polarity, category, title, description,
             place_name, city, address, merchant_name, merchant_tax_id,
             receipt_date, receipt_time, total_amount, original_amount,
             original_currency, confidence, ai_model, items
           ) values (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             $11,$12,$13,$14,$15,$16,
             $17,$18,$19,$20,$21,
             $22,$23,$24,$25,$26,$27,$28,$29::jsonb
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
  const category = overrides?.category ?? row.category ?? 'other';
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
