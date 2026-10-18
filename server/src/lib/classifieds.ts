/**
 * Обяви от сайтове за обяви през Apify (OLX.bg, imot.bg, Alo.bg).
 *
 * Защо съществува: темите „частни продавачи“, „имоти“ и „авто“ се пълнеха само
 * от Facebook групи — тоест случайно и на парче. Тези сайтове са ИСТИНСКИЯТ
 * пазар на обяви в България и през Apify дават цена, град, снимки и данни за
 * продавача (частно лице или фирма), без да се борим със защитите им.
 *
 * Правилата за внасяне са същите като при магазините (`importExternalProducts`):
 * профил „SmartPrice Редакция“, дедупликация по адрес, снимка се тегли локално,
 * описание без име на сайт. Разликите тук:
 *   • градът е ИСТИНСКИЯТ от обявата (не „Онлайн“);
 *   • продавачът може да е частно лице (`seller_type='private'`);
 *   • от описанието се махат телефони и имейли (обявите често са пълни с тях);
 *   • етикет „Обява“, а не „Онлайн магазин“.
 *
 * Честност: ако актьорът не върне нищо или няма бюджет, връщаме причина —
 * не измисляме обяви.
 */
import { one, query } from '../db.js';
import {
  stripShopMentions,
  guessCategory,
  normalizeCurrency,
  officialProfileId,
  downloadImage,
} from './scraper.js';
import { apifyToken, apifyReady, apifyBudgetAllows, addApifySpend } from './apifyBrowser.js';

export type ClassifiedSource = 'olx' | 'imot' | 'alo';

export interface ClassifiedListing {
  /** ID в сайта — пази се в source_url, за да не влиза два пъти. */
  url: string;
  title: string;
  description?: string;
  priceEur: number;
  city?: string;
  region?: string;
  imageUrl?: string;
  sellerType?: 'private' | 'business';
  /** Допълнителни характеристики (кв.м, стаи, км, година) — отиват в описанието. */
  attrs?: Record<string, string>;
}

interface SourceMeta {
  actor: string;
  label: string;
  /** Какво чака актьорът: търсене по дума или адрес на категория. */
  input: 'query' | 'url';
  note?: string;
}

export const CLASSIFIED_SOURCES: Record<ClassifiedSource, SourceMeta> = {
  olx: {
    actor: 'lowlanddata~olx-bg-scraper',
    label: 'olx.bg',
    input: 'query',
    note: 'Цена в евро центове, град/област, състояние, данни за коли и имоти.',
  },
  imot: {
    actor: 'logiover~imot-bg-scraper-bulgaria-real-estate',
    label: 'imot.bg',
    input: 'query',
    note: 'Имоти: цена, €/кв.м, кв.м, стаи, етаж, година, квартал.',
  },
  alo: {
    actor: 'rainminer~alo-bg-scraper',
    label: 'alo.bg',
    input: 'url',
    note: 'Коли: пише се адресът на категорията в alo.bg (напр. /obiavi/avtomobili/).',
  },
};

/* ------------------------------------------------------------------ помощни */

/** Маха телефони и имейли от описанието — обявите са пълни с тях. */
export function stripContacts(text: string): string {
  return (text || '')
    // телефони: 08xx xxx xxx, +359..., с интервали/тирета/скоби
    .replace(/(\+?\d[\d\s().-]{6,}\d)/g, (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 8 && digits.length <= 15 ? '[контакт в обявата]' : m;
    })
    .replace(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g, '[контакт в обявата]')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** „гр. Стара Загора“ → „Стара Загора“; „Област Пловдив“ → „Пловдив“. */
export function cleanCity(raw?: string): string {
  const v = (raw || '').trim();
  if (!v) return '';
  return v
    .replace(/^(гр\.|с\.|град|село|област|общ\.|ж\.?к\.?)\s*/i, '')
    .replace(/\s*\(.*\)\s*$/, '')
    .trim()
    .slice(0, 80);
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** Прави списък „характеристика: стойност“ от обект, без празните. */
function attrPairs(attrs?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs || {})) {
    const val = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    if (val) out[k] = val.slice(0, 60);
  }
  return out;
}

/* ------------------------------------------------------------- преобразуване */

/** Превръща суровия запис на актьора в наша обява. Връща null, ако не става. */
export function mapListing(source: ClassifiedSource, raw: Record<string, unknown>): ClassifiedListing | null {
  const url = String(raw.url || raw.listingUrl || '').trim();
  const title = String(raw.title || raw.titleBg || '').trim().slice(0, 200);
  if (!/^https?:/i.test(url) || title.length < 4) return null;

  if (source === 'olx') {
    // Цената идва в ЕВРО ЦЕНТОВЕ („priceCents: 158900“ = 1589.00 €).
    const priceEur = num(raw.priceCents) / 100;
    const images = Array.isArray(raw.imageUrls) ? (raw.imageUrls as string[]) : [];
    return {
      url,
      title,
      description: String(raw.description || '').slice(0, 1200),
      priceEur: priceEur > 0 ? priceEur : num(raw.price),
      city: cleanCity(String(raw.city || '')),
      region: cleanCity(String(raw.region || '')),
      imageUrl: String(images[0] || '').trim(),
      sellerType: String(raw.sellerType || '').toLowerCase().includes('priv') ? 'private' : 'business',
      attrs: attrPairs(raw.attributes as Record<string, unknown>),
    };
  }

  if (source === 'imot') {
    const images = Array.isArray(raw.imageUrls) ? (raw.imageUrls as string[]) : [];
    const attrs: Record<string, unknown> = {
      'Кв.м': raw.area,
      'Стаи': raw.rooms,
      Етаж: raw.floor && raw.totalFloors ? `${raw.floor} от ${raw.totalFloors}` : raw.floor,
      'Година на строеж': raw.yearBuilt,
      'Тип': raw.propertyType,
      'Строителство': raw.constructionType,
      'Цена на кв.м': raw.pricePerSqm ? `${raw.pricePerSqm} €` : undefined,
      Квартал: raw.neighborhoodBg || raw.neighborhood,
    };
    return {
      url,
      title: String(raw.titleBg || raw.title || title).trim().slice(0, 200),
      description: String(raw.descriptionBg || raw.description || '').slice(0, 1200),
      priceEur: num(raw.price),
      city: cleanCity(String(raw.cityBg || raw.city || '')),
      region: '',
      imageUrl: String(images[0] || raw.imageThumbnail || '').trim(),
      sellerType: raw.isPrivateSeller === true || String(raw.isPrivateSeller).toLowerCase() === 'true'
        ? 'private'
        : 'business',
      attrs: attrPairs(attrs),
    };
  }

  // alo.bg — коли (адресът се подава отвън)
  return {
    url,
    title,
    description: String(raw.description || '').slice(0, 1200),
    priceEur: num(raw.price),
    city: cleanCity(String(raw.location || raw.city || '')),
    region: '',
    imageUrl: String(raw.image || raw.imageUrl || '').trim(),
    sellerType: 'business',
    attrs: attrPairs({ Категория: raw.category }),
  };
}

/* ------------------------------------------------------------------- Apify */

export interface ActorRunResult {
  ok: boolean;
  items: Record<string, unknown>[];
  usd: number;
  reason?: string;
}

/** Пуска актьора и връща записите (синхронно — чака до timeoutSecs). */
export async function runClassifiedsActor(
  source: ClassifiedSource,
  query: string,
  maxItems: number
): Promise<ActorRunResult> {
  const meta = CLASSIFIED_SOURCES[source];
  if (!meta) return { ok: false, items: [], usd: 0, reason: 'Непознат източник.' };
  const token = await apifyToken();
  if (!token) return { ok: false, items: [], usd: 0, reason: 'Няма Apify токен.' };
  if (!(await apifyReady())) return { ok: false, items: [], usd: 0, reason: 'Apify не е готов.' };
  const budget = await apifyBudgetAllows(0.05);
  if (!budget.allowed) {
    return {
      ok: false,
      items: [],
      usd: 0,
      reason: `Дневният лимит за Apify е стигнат (${budget.today.toFixed(2)} / ${budget.limit.toFixed(2)} $).`,
    };
  }

  const q = (query || '').trim().slice(0, 120);
  if (!q) return { ok: false, items: [], usd: 0, reason: 'Липсва дума за търсене.' };
  const limit = Math.max(1, Math.min(200, Math.floor(maxItems) || 20));

  // Всяка стойност се подава под няколко възможни имена — актьорите не
  // публикуват схемата си, а излишните полета се игнорират.
  const input: Record<string, unknown> = meta.input === 'url'
    ? { startUrls: [{ url: q }], categoryUrls: [q], urls: [q], maxItems: limit, maxListings: limit }
    : {
        searchQuery: q,
        query: q,
        keyword: q,
        search: q,
        maxItems: limit,
        maxResults: limit,
        limit,
      };

  const url = `https://api.apify.com/v2/acts/${meta.actor}/run-sync-get-dataset-items?timeout=240`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        items: [],
        usd: 0,
        reason: `Актьорът върна грешка ${res.status} (${text.slice(0, 120)}). Провери входа в Apify.`,
      };
    }
    let items: Record<string, unknown>[] = [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) items = parsed as Record<string, unknown>[];
    } catch {
      return { ok: false, items: [], usd: 0, reason: 'Актьорът върна нещо, което не е списък.' };
    }
    // Приблизителен разход: Apify таксува на резултат; пазим го, за да има
    // бюджетна картина (по-точно число идва от самите пускове).
    const usd = Math.min(0.5, items.length * 0.004);
    if (usd > 0) await addApifySpend(usd, `обяви ${meta.label}: ${items.length} записа`).catch(() => undefined);
    return { ok: true, items: items.slice(0, limit), usd, reason: `${items.length} записа за ${Math.round((Date.now() - started) / 1000)} сек.` };
  } catch (err) {
    return { ok: false, items: [], usd: 0, reason: (err as Error).message.slice(0, 200) };
  }
}

/* ------------------------------------------------------------------ внасяне */

export interface ClassifiedImportResult {
  imported: number;
  skipped: number;
  skippedReasons: string[];
}

/** Внася обявите като оферти под профила „SmartPrice Редакция“. */
export async function importClassifieds(
  source: ClassifiedSource,
  listings: ClassifiedListing[]
): Promise<ClassifiedImportResult> {
  const meta = CLASSIFIED_SOURCES[source] ?? { label: source };
  const authorId = await officialProfileId();
  let imported = 0;
  let skipped = 0;
  const skippedReasons: string[] = [];

  for (const l of listings) {
    const title = (l.title || '').trim().slice(0, 200);
    const price = Number(l.priceEur);
    if (!l.url || !/^https?:/i.test(l.url) || title.length < 4 || !Number.isFinite(price) || price <= 0 || price > 1_000_000) {
      skipped += 1;
      skippedReasons.push(`${title.slice(0, 40) || l.url.slice(0, 40)}: няма заглавие/цена`);
      continue;
    }
    const exists = await one<{ id: string }>('select id from posts where source_url = $1 limit 1', [l.url]);
    if (exists) {
      skipped += 1;
      skippedReasons.push(`${title.slice(0, 40)}: вече е в приложението`);
      continue;
    }

    const { priceEur } = normalizeCurrency(price, 'EUR', `${title} EUR`);

    // Снимката се тегли локално — чуждите CDN-и често блокират горещи връзки.
    let imageUrl = (l.imageUrl || '').trim().slice(0, 600);
    if (/^https?:/i.test(imageUrl)) {
      try {
        const local = await downloadImage(imageUrl, 5, { respectRobots: false, delayMs: 0 });
        if (local) imageUrl = local;
      } catch {
        /* остава оригиналният адрес */
      }
    }

    // Описанието: без контакти, без име на сайта, с характеристиките отпред.
    const attrs = attrPairs(l.attrs as Record<string, unknown>);
    const attrLine = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(' · ');
    const body = stripContacts(
      [attrLine, l.description].filter(Boolean).join('\n\n')
    ).slice(0, 1200);
    const description = stripShopMentions(body, meta.label).slice(0, 4000);

    const city = l.city || 'Онлайн';
    const seller = l.sellerType === 'private' ? 'private' : 'business';
    const tags = [
      meta.label,
      city !== 'Онлайн' ? `#${city.replace(/\s+/g, '')}` : '#Обява',
      '#Обява',
    ].slice(0, 8);
    const blob = `${title} ${description} ${attrLine}`;

    await query(
      `insert into posts (
         author_id, polarity, category, platform_tag, title, description,
         place_name, city, price_paid, reference_price, currency,
         image_url, tags, seller_type, source, source_note, source_url
       ) values (
         $1,'green',$2,$3,$4,$5,$6,$7,$8,NULL,'EUR',$9,$10,$11,$12,$13,$14
       )`,
      [
        authorId,
        guessCategory(blob),
        `Обява ${meta.label}`.slice(0, 60),
        title,
        description,
        (l.region ? `${l.region}${city !== 'Онлайн' ? ', ' + city : ''}` : city).slice(0, 200),
        city,
        Number(priceEur.toFixed(2)),
        imageUrl,
        tags,
        seller,
        source,
        `Обява от ${meta.label}: ${l.url}`.slice(0, 300),
        l.url.slice(0, 500),
      ]
    );
    imported += 1;
  }

  return { imported, skipped, skippedReasons: skippedReasons.slice(0, 30) };
}

/* ---------------------------------------------------------------- целият път */

export interface ClassifiedScanResult {
  source: ClassifiedSource;
  label: string;
  found: number;
  imported: number;
  skipped: number;
  skippedReasons: string[];
  usd: number;
  note: string;
  ok: boolean;
}

/** Пълна обиколка: пуска актьора → преобразува → внася. */
export async function scanClassifieds(
  source: ClassifiedSource,
  query: string,
  maxItems: number
): Promise<ClassifiedScanResult> {
  const meta = CLASSIFIED_SOURCES[source];
  const run = await runClassifiedsActor(source, query, maxItems);
  if (!run.ok) {
    return {
      source,
      label: meta?.label ?? source,
      found: run.items.length,
      imported: 0,
      skipped: 0,
      skippedReasons: [],
      usd: run.usd,
      note: run.reason ?? 'Не успях да пусна актьора.',
      ok: false,
    };
  }
  const listings = run.items
    .map((raw) => mapListing(source, raw))
    .filter((x): x is ClassifiedListing => Boolean(x));
  const res = await importClassifieds(source, listings);
  return {
    source,
    label: meta?.label ?? source,
    found: listings.length,
    imported: res.imported,
    skipped: res.skipped,
    skippedReasons: res.skippedReasons,
    usd: run.usd,
    note: run.reason ?? '',
    ok: true,
  };
}
