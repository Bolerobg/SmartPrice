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
import { env, features } from '../env.js';
// 🚗 Колите са изключени от обявите (по заявка, 22.10.2026).
import { isVehicleListing, vehiclesBlocked } from './noVehicles.js';

export type ClassifiedSource = 'olx' | 'imot' | 'alo' | 'facebook';

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
  /**
   * Какво чака актьорът: търсене по дума, адрес на категория или
   * Marketplace търсене (построяваме адреса ние).
   */
  input: 'query' | 'url' | 'marketplace';
  note?: string;
  /** Изключен източник — не се показва в панела и не се пуска. */
  disabled?: boolean;
}

export const CLASSIFIED_SOURCES: Record<ClassifiedSource, SourceMeta> = {
  olx: {
    actor: 'lowlanddata~olx-bg-scraper',
    label: 'olx.bg',
    input: 'query',
    note: 'Цена в евро центове, град/област, състояние, данни за коли и имоти.',
  },
  // imot.bg — ИЗКЛЮЧЕН по решение на собственика (18.10.2026): имотите от този
  // сайт не са полезни за приложението. Кодът за преобразуване остава тук, за да
  // може да се включи с една дума (`disabled: false`), ако потрябва.
  imot: {
    actor: 'logiover~imot-bg-scraper-bulgaria-real-estate',
    label: 'imot.bg',
    input: 'query',
    note: 'Имоти: цена, €/кв.м, кв.м, стаи, етаж, година, квартал.',
    disabled: true,
  },
  // alo.bg — ИЗКЛЮЧЕН: актьорът отхвърля всички опитани форми на вход (400) и
  // не публикува схемата си. Пробвани: startUrls/categoryUrls/urls, categoryUrl,
  // searchUrl, searchQuery/query/keyword/search. Включи го, щом се намери
  // точният вход — кодът за преобразуване е готов.
  alo: {
    actor: 'rainminer~alo-bg-scraper',
    label: 'alo.bg',
    input: 'url',
    note: 'Коли: пише се адресът на категорията в alo.bg (напр. /obiavi/avtomobili/).',
    disabled: true,
  },
  // Facebook Marketplace — обяви с цени от ЧАСТНИ продавачи. Проверено на живо
  // (18.10.2026): 24 обяви за една дума, $0.12, БЕЗ вход с профил.
  // Внимание: цените идват в ЛЕВА („BGN100“) — превръщаме ги в евро.
  //
  // ИЗКЛЮЧЕН по решение на собственика (23.10.2026): актьорът харчи
  // несъразмерно много спрямо ползата — два пуска = $5.70 при ~$2.85/пуск,
  // срещу ~$0.03/пуск за OLX. При бюджет $35/месец това изяжда почти всичко.
  // Включва се пак с `disabled: false`, когато потрябва.
  facebook: {
    actor: 'apify~facebook-marketplace-scraper',
    label: 'Facebook Marketplace',
    input: 'marketplace',
    note: 'Обяви с цени от частни продавачи. Цените са в лева — приложението ги смята в евро.',
    disabled: true,
  },
};

/** Фиксиран курс: 1 € = 1.95583 лв. (цените на Marketplace са в лева). */
const BGN_PER_EUR = 1.95583;

/* ------------------------------------------------------------------ помощни */

/** Маха покани за връзка от описанието — те не са част от стоката. */
export function stripContactPrompts(text: string): string {
  return (text || '')
    .replace(
      /[^.!?]{0,80}(пишете\s+(ми\s+)?(съобщение|на\s+лично)|обад(и|е)те\s+се|звънн?ете|на\s+телефона|viber|whatsapp|whats\s?app|по\s+имейл|на\s+лс|на\s+лични)[^.!?]{0,80}/gi,
      ' '
    )
    .replace(/[>\-–—]{2,}\s*$/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Маха телефони и имейли от описанието — обявите са пълни с тях. */
export function stripContacts(text: string): string {
  return stripContactPrompts(text)
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

/** Ключовете на характеристиките идват на английски от сайтовете — превеждаме ги. */
const ATTR_LABELS: Record<string, string> = {
  state: 'Състояние',
  condition: 'Състояние',
  floor: 'Етаж',
  floors: 'Етажи',
  rooms: 'Стаи',
  area: 'Кв.м',
  'built area': 'Кв.м',
  year: 'Година',
  yearbuilt: 'Година на строеж',
  mileage: 'Пробег',
  kilometers: 'Пробег',
  fuel: 'Гориво',
  fueltype: 'Гориво',
  transmission: 'Скоростна кутия',
  gearbox: 'Скоростна кутия',
  engine: 'Двигател',
  power: 'Мощност',
  color: 'Цвят',
  brand: 'Марка',
  model: 'Модел',
  make: 'Марка',
  negotiable: 'Договаряне',
};

/** Прави списък „характеристика: стойност“ от обект, без празните. */
function attrPairs(attrs?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs || {})) {
    const val = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    if (!val) continue;
    const label = ATTR_LABELS[k.toLowerCase().replace(/[\s_]/g, '')] ?? ATTR_LABELS[k.toLowerCase()] ?? k;
    out[label] = val.slice(0, 60);
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

  if (source === 'facebook') {
    // Продадените/скритите обяви не ни трябват — офертата вече не е валидна.
    if (raw.is_sold === true || raw.is_hidden === true || raw.is_pending === true) return null;

    const priceObj = (raw.listing_price ?? {}) as Record<string, unknown>;
    const amount = num(priceObj.amount ?? raw.price);
    // „formatted_amount“ е „BGN100“ — оттам вадим валутата, ако я няма отделно.
    const formatted = String(priceObj.formatted_amount ?? '');
    const currency = String(priceObj.currency ?? (formatted.match(/^[A-Z]{3}/)?.[0] ?? 'BGN')).toUpperCase();
    // Еврото остава, левчетата се делят по фиксирания курс.
    const priceEur = currency === 'EUR' ? amount : amount / BGN_PER_EUR;

    const photo = (raw.primary_listing_photo ?? {}) as Record<string, unknown>;
    const geo = ((raw.location as Record<string, unknown>)?.reverse_geocode ?? {}) as Record<string, unknown>;
    const title =
      String(raw.custom_title || raw.marketplace_listing_title || raw.title || '').trim() ||
      String(raw.redacted_description || '').trim().slice(0, 70);

    return {
      url,
      title: title.slice(0, 200),
      description: String(raw.redacted_description || '').slice(0, 1200),
      priceEur: priceEur > 0 ? Number(priceEur.toFixed(2)) : 0,
      city: cleanCity(String(geo.city || '')),
      region: cleanCity(String(geo.state || '')),
      imageUrl: String(photo.photo_image_url || '').trim(),
      // Marketplace е предимно частни хора.
      sellerType: 'private',
      attrs: {
        ...(currency !== 'EUR' && amount > 0 ? { 'обявена цена': `${amount.toFixed(2)} лв.` } : {}),
        ...(Array.isArray(raw.delivery_types) && (raw.delivery_types as string[]).length
          ? { доставка: (raw.delivery_types as string[]).join(', ') }
          : {}),
      },
    };
  }

  if (source === 'imot') {
    const images = Array.isArray(raw.imageUrls) ? (raw.imageUrls as string[]) : [];
    // imot дава слабо заглавие („Продава 2-СТАЕН“). Правим истинско описание от
    // характеристиките: „2-стаен, 65 кв.м — София, Оборище“.
    // Внимание: imot връща стаите вече с наставка („1-стаен“) — не я удвояваме.
    const rawRooms = String(raw.rooms ?? '').trim();
    const rooms = !rawRooms ? '' : /стаен/i.test(rawRooms) ? rawRooms : `${rawRooms}-стаен`;
    const area = raw.area ? `${raw.area} кв.м` : '';
    const hood = cleanCity(String(raw.neighborhoodBg || raw.neighborhood || ''));
    // Типът понякога идва на английски („apartment“) — превеждаме познатите.
    const KIND_BG: Record<string, string> = {
      apartment: 'апартамент',
      house: 'къща',
      plot: 'парцел',
      land: 'земя',
      garage: 'гараж',
      office: 'офис',
      villa: 'вила',
      room: 'стая',
      shop: 'магазин',
      warehouse: 'склад',
      studio: 'студио',
    };
    const rawKind = String(raw.propertyType || '').trim();
    const kind = KIND_BG[rawKind.toLowerCase()] ?? rawKind;
    const head = [rooms || kind, area].filter(Boolean).join(', ');
    const where = [cleanCity(String(raw.cityBg || raw.city || '')), hood].filter(Boolean).join(', ');
    const niceTitle = [head, where].filter(Boolean).join(' — ');
    const attrs: Record<string, unknown> = {
      'Кв.м': raw.area,
      'Стаи': rooms || raw.rooms,
      Етаж: raw.floor && raw.totalFloors ? `${raw.floor} от ${raw.totalFloors}` : raw.floor,
      'Година на строеж': raw.yearBuilt,
      'Тип': kind,
      'Строителство': raw.constructionType,
      'Цена на кв.м': raw.pricePerSqm ? `${raw.pricePerSqm} €` : undefined,
      Квартал: raw.neighborhoodBg || raw.neighborhood,
    };
    return {
      url,
      title: (niceTitle || String(raw.titleBg || raw.title || title)).trim().slice(0, 200),
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
  if (meta.disabled) return { ok: false, items: [], usd: 0, reason: 'Този източник е изключен.' };
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
  // Marketplace чака АДРЕС на търсене. Ако човекът е дал адрес — ползваме него,
  // иначе строим търсене за София (там има най-много обяви).
  const marketplaceUrl = /^https?:/i.test(q)
    ? q
    : `https://www.facebook.com/marketplace/sofia/search?query=${encodeURIComponent(q)}`;

  const input: Record<string, unknown> = meta.input === 'marketplace'
    ? { startUrls: [{ url: marketplaceUrl }], maxItems: limit, maxListings: limit, limit }
    : meta.input === 'url'
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
    // Разходът се взима от САМИЯ Apify (usageTotalUsd на последния пуск).
    // Първата версия слагаше груба оценка 0.004 $/запис — при 70 имота това
    // надуваше вътрешния брояч до 0.28 $ и след два пуска изкуствено „стигаше“
    // дневния лимит, макар реално да бяха похарчени стотинки.
    let usd = Math.min(0.5, items.length * 0.0005);
    try {
      const uRes = await fetch('https://api.apify.com/v2/actor-runs?limit=1', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const uJson = (await uRes.json()) as { data?: { items?: Array<{ usageTotalUsd?: number }> } };
      const real = uJson?.data?.items?.[0]?.usageTotalUsd;
      if (typeof real === 'number' && real >= 0) usd = Math.min(0.5, real);
    } catch {
      /* остава резервната оценка */
    }
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
  // 🚗 Без автомобили в обявите (по заявка на собственика, 22.10.2026).
  const noVehicles = await vehiclesBlocked();

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

    // 🚗 Кола/част за кола не се внася (по заявка, 22.10.2026).
    if (noVehicles && isVehicleListing(title, l.description, Object.values(l.attrs ?? {}).join(' '))) {
      skipped += 1;
      skippedReasons.push(`${title.slice(0, 40)}: автомобил`);
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

    // AI-изчистване: маха „ПИШЕТЕ СЪОБЩЕНИЕ!!!“, КАПС-а и следите от сайта.
    // При провал остава фактологичното описание по-горе.
    let finalTitle = title;
    let finalDescription = description;
    const tidied = await aiTidyListing(title, description, attrs).catch(() => null);
    if (tidied) {
      finalTitle = tidied.title;
      if (tidied.description.length >= 20) finalDescription = tidied.description;
    }

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
        finalTitle,
        finalDescription,
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

/* ------------------------------------------------------------ AI изчистване */

const AI_TIDY_SYSTEM = `Ти си редактор в SmartPrice — приложение за сравняване на цени в България.
Пренаписваш обяви от сайтове за обяви в неутрален, фактологичен тон.

ЗАДЪЛЖИТЕЛНО:
- НЕ споменавай име на сайт, име на продавач, телефон, имейл, "пишете съобщение", "обадете се", "на лично".
- МАХАШ КАПС ЛОК букви, "!!!", емотикони и рекламни викове.
- Запазваш САМО фактите: какво е стоката, ключови характеристики, състояние, град.
- Заглавие: до 70 знака, конкретно (напр. "Климатик Fujitsu 18 000 BTU, използван").
- Описание: 1–3 кратки изречения само с факти. БЕЗ цена в текста — цената е отделно поле.

Отговаряй само с JSON: {"title": "...", "description": "..."}`;

/**
 * Пренаписва обявата с AI — маха рекламните викове и следите от сайта.
 * Връща null при всякакъв проблем, за да остане фактологичното описание.
 * По ЕДНА обява на заявка: при групи AI-ят тихо връща невалиден JSON.
 */
export async function aiTidyListing(
  title: string,
  description: string,
  attrs: Record<string, string>
): Promise<{ title: string; description: string } | null> {
  if (!features.assistant || !env.DEEPSEEK_API_KEY) return null;
  try {
    const res = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.ASSISTANT_MODEL,
        max_tokens: 600,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: AI_TIDY_SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              title: title.slice(0, 200),
              description: description.slice(0, 1200),
              attributes: attrs,
            }),
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const txt = data?.choices?.[0]?.message?.content ?? '';
    if (!txt) return null;
    const parsed = JSON.parse(txt) as { title?: string; description?: string };
    const t = String(parsed.title ?? '').trim().slice(0, 200);
    const d = String(parsed.description ?? '').trim().slice(0, 1200);
    if (t.length < 4) return null;
    return { title: t, description: d };
  } catch {
    return null;
  }
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

/* ------------------------------------------------ състояние на последния пуск */

export interface ClassifiedRunState {
  at: string;
  source: ClassifiedSource | '';
  label: string;
  query: string;
  found: number;
  imported: number;
  skipped: number;
  skippedReasons: string[];
  usd: number;
  note: string;
  ok: boolean;
  running: boolean;
}

const RUN_KEY = 'classifieds_last_run';

/** Какво стана с последната обиколка (панелът пита това, докато чака). */
export async function lastClassifiedsRun(): Promise<ClassifiedRunState | null> {
  const row = await one<{ value: string }>(`select value from app_settings where key = $1`, [RUN_KEY]);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as ClassifiedRunState;
  } catch {
    return null;
  }
}

async function saveRunState(st: ClassifiedRunState): Promise<void> {
  await query(
    `insert into app_settings (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [RUN_KEY, JSON.stringify(st)]
  );
}

/**
 * Пуска обиколката ФОНОВО и връща веднага.
 *
 * Защо фон: nginx/Cloudflare режат заявката на ~100 сек, а imot.bg отнема ~113 сек
 * (видяно на живо: синхронната заявка даваше 504 и НИЩО не се внасяше).
 * Панелът пита `/classifieds/last`, докато `running` стане false.
 */
export async function startClassifiedsScan(
  source: ClassifiedSource,
  query: string,
  maxItems: number
): Promise<{ started: boolean; reason?: string }> {
  const meta = CLASSIFIED_SOURCES[source];
  if (!meta) return { started: false, reason: 'Непознат източник.' };
  if (meta.disabled) return { started: false, reason: 'Този източник е изключен.' };
  const q = (query || '').trim();
  if (q.length < 2) return { started: false, reason: 'Липсва дума за търсене (или адрес на категория).' };

  // Заключване с остаряване: ако предишната обиколка е била убита (деплой,
  // рестарт, спрян панел), състоянието остава `running: true` завинаги и
  // блокира всички следващи пускове. Реален случай: 18.10.2026 — след убит
  // пуск дневният робот не можеше да тръгне („Вече върви друга обиколка“).
  const current = await lastClassifiedsRun().catch(() => null);
  const ageMs = current?.at ? Date.now() - Date.parse(current.at) : Number.NaN;
  const stale = !Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000;
  if (current?.running && !stale) {
    return { started: false, reason: 'Вече върви друга обиколка — изчакай да свърши.' };
  }

  const limit = Math.max(1, Math.min(200, Math.floor(maxItems) || 20));
  await saveRunState({
    at: new Date().toISOString(),
    source,
    label: meta.label,
    query: q,
    found: 0,
    imported: 0,
    skipped: 0,
    skippedReasons: [],
    usd: 0,
    note: `Върви… питам ${meta.label}. Отнема 30–150 секунди.`,
    ok: false,
    running: true,
  });

  void scanClassifieds(source, q, limit)
    .then((r) =>
      saveRunState({
        at: new Date().toISOString(),
        source,
        label: r.label,
        query: q,
        found: r.found,
        imported: r.imported,
        skipped: r.skipped,
        skippedReasons: r.skippedReasons,
        usd: r.usd,
        note: r.note,
        ok: r.ok,
        running: false,
      })
    )
    .catch((err) =>
      saveRunState({
        at: new Date().toISOString(),
        source,
        label: meta.label,
        query: q,
        found: 0,
        imported: 0,
        skipped: 0,
        skippedReasons: [],
        usd: 0,
        note: (err as Error).message.slice(0, 200),
        ok: false,
        running: false,
      })
    );

  return { started: true };
}
