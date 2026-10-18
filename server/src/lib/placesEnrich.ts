/**
 * Обогатяване на обектите през Google Maps (Apify).
 *
 * Защо съществува: обектът в SmartPrice (магазин, сервиз, майстор) се ражда от
 * сигналите на хората — има само име, град и цени. Google Maps дава рейтинг,
 * брой отзиви, работно време по дни, телефон, сайт, точни координати, квартал и
 * категория. Така страницата на обекта става истински полезна, без никой да
 * пише нищо.
 *
 * Цена: актьорът `compass/crawler-google-places` се таксува на място
 * (≈ $4 / 1000 места), затова по подразбиране обогатяваме малко наведнъж и
 * спазваме дневния лимит на Apify.
 */
import { many, one, query } from '../db.js';
import { apifyToken, apifyReady, apifyBudgetAllows, addApifySpend } from './apifyBrowser.js';

const ACTOR = 'compass~crawler-google-places';

export interface EnrichTarget {
  slug: string;
  place_name: string;
  city: string;
}

export interface EnrichResult {
  targeted: number;
  found: number;
  saved: number;
  usd: number;
  note: string;
  ok: boolean;
}

/** Кои обекти имат нужда от обогатяване (физически места, още без данни). */
export async function pendingObjects(limit = 10): Promise<EnrichTarget[]> {
  return many<EnrichTarget>(
    `select o.slug, o.place_name, o.city
       from v_objects o
       left join place_enrichment e on e.slug = o.slug
      where o.city is not null
        and o.city <> 'Онлайн'
        and o.place_name is not null
        and length(o.place_name) > 2
        and e.slug is null
        -- Не питаме за „обекти“, които са само име на град/област — това е шум
        -- от геокодирането („Пловдив, Пловдив“, „София-град, София“). Google
        -- връща празно, а ние плащаме заявката.
        and lower(o.place_name) <> lower(o.city)
        and o.place_name not ilike o.city || ',%'
        and o.place_name not ilike '%, ' || o.city
      order by o.signals_count desc
      limit $1`,
    [Math.max(1, Math.min(50, limit))]
  );
}

/** Колко са обогатени и колко чакат. */
export async function placesInfo(): Promise<{
  enriched: number;
  pending: number;
  lastAt: string | null;
}> {
  const row = await one<{ enriched: string; pending: string; last_at: string | null }>(
    `select (select count(*) from place_enrichment)::text as enriched,
            (select count(*) from v_objects o
               left join place_enrichment e on e.slug = o.slug
              where o.city is not null and o.city <> 'Онлайн' and e.slug is null)::text as pending,
            (select max(updated_at)::text from place_enrichment) as last_at`
  );
  return {
    enriched: Number(row?.enriched ?? 0),
    pending: Number(row?.pending ?? 0),
    lastAt: row?.last_at ?? null,
  };
}

/** Последно обогатените (за панела). */
export async function recentEnriched(limit = 20): Promise<Array<Record<string, unknown>>> {
  return many<Record<string, unknown>>(
    `select slug, place_name, city, address, neighborhood, latitude, longitude,
            rating, reviews_count, category, phone, website, hours, maps_url, updated_at::text
       from place_enrichment
      order by updated_at desc
      limit $1`,
    [Math.max(1, Math.min(100, limit))]
  );
}

interface PlaceRow {
  title?: string;
  address?: string;
  city?: string;
  neighborhood?: string;
  phone?: string;
  website?: string;
  totalScore?: number;
  reviewsCount?: number;
  categoryName?: string;
  location?: { lat?: number; lng?: number };
  openingHours?: Array<{ day?: string; hours?: string }>;
  url?: string;
  imageUrl?: string;
  placeId?: string;
}

/**
 * Обогатява до `limit` обекта. Връща какво е намерило и похарчило.
 * Честност: ако актьорът не върне нищо за даден обект, той остава без данни —
 * не измисляме рейтинг.
 */
export async function enrichObjects(limit = 10): Promise<EnrichResult> {
  const targets = await pendingObjects(limit);
  if (!targets.length) {
    return { targeted: 0, found: 0, saved: 0, usd: 0, note: 'Няма обекти за обогатяване.', ok: true };
  }
  const token = await apifyToken();
  if (!token) return { targeted: targets.length, found: 0, saved: 0, usd: 0, note: 'Няма Apify токен.', ok: false };
  if (!(await apifyReady())) {
    return { targeted: targets.length, found: 0, saved: 0, usd: 0, note: 'Apify не е готов.', ok: false };
  }
  const budget = await apifyBudgetAllows(0.1);
  if (!budget.allowed) {
    return {
      targeted: targets.length,
      found: 0,
      saved: 0,
      usd: 0,
      note: `Дневният лимит за Apify е стигнат (${budget.today.toFixed(2)} / ${budget.limit.toFixed(2)} $).`,
      ok: false,
    };
  }

  // Търсим по „име, град“ — така Google връща точно този обект, а не всеки с
  // това име в страната. Едно място на заявка, за да е ясно кое на кого е.
  const input = {
    searchStringsArray: targets.map((t) => `${t.place_name}, ${t.city}`),
    maxCrawledPlacesPerSearch: 1,
    language: 'bg',
    skipClosedPlaces: false,
  };

  let rows: PlaceRow[] = [];
  let usd = 0;
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=240`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        targeted: targets.length,
        found: 0,
        saved: 0,
        usd: 0,
        note: `Google Maps върна грешка ${res.status} (${text.slice(0, 120)}).`,
        ok: false,
      };
    }
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) rows = parsed as PlaceRow[];
    // Реалният разход от Apify.
    try {
      const uRes = await fetch('https://api.apify.com/v2/actor-runs?limit=1', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const uJson = (await uRes.json()) as { data?: { items?: Array<{ usageTotalUsd?: number }> } };
      const real = uJson?.data?.items?.[0]?.usageTotalUsd;
      if (typeof real === 'number' && real >= 0) usd = Math.min(0.5, real);
    } catch {
      usd = Math.min(0.5, rows.length * 0.004);
    }
    if (usd > 0) await addApifySpend(usd, `Google Maps: ${rows.length} места`).catch(() => undefined);
  } catch (err) {
    return {
      targeted: targets.length,
      found: 0,
      saved: 0,
      usd: 0,
      note: (err as Error).message.slice(0, 200),
      ok: false,
    };
  }

  // Свързваме върнатото място с нашия обект по реда на заявките (актьорът пази
  // `searchString` в резултата, но ако липсва — падаме на реда).
  let saved = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const t = targets[i]!;
    const row =
      rows.find((r) => typeof (r as Record<string, unknown>).searchString === 'string' &&
        String((r as Record<string, unknown>).searchString).toLowerCase().includes(t.place_name.toLowerCase())) ??
      rows[i];
    if (!row || !row.title) continue;
    // Празен резултат не се записва — иначе обектът изглежда „обогатен“, а в
    // страницата му няма нищо. Остава в опашката за следващия път.
    const useful =
      typeof row.totalScore === 'number' ||
      typeof row.reviewsCount === 'number' ||
      Boolean(row.phone) ||
      Boolean(row.website) ||
      (Array.isArray(row.openingHours) && row.openingHours.length > 0) ||
      typeof row.location?.lat === 'number';
    if (!useful) continue;
    const hours = Array.isArray(row.openingHours)
      ? row.openingHours
          .filter((h) => h && h.day && h.hours)
          .map((h) => ({ day: String(h.day), hours: String(h.hours) }))
      : null;
    // ВНИМАНИЕ: всеки параметър трябва да се използва, иначе Postgres дава
    // „could not determine data type of parameter $N“ (проверено на живо).
    // Затова slug се смята от СЪЩИТЕ $1/$2, които отиват и в колоните.
    await query(
      `insert into place_enrichment (
         slug, place_name, city, address, neighborhood, latitude, longitude,
         rating, reviews_count, category, phone, website, hours, maps_url, image_url, updated_at
       ) values (
         (select md5(lower($1) || '|' || lower($2))), $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12::jsonb, $13, $14, now()
       )
       on conflict (slug) do update set
         address = excluded.address,
         neighborhood = excluded.neighborhood,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         rating = excluded.rating,
         reviews_count = excluded.reviews_count,
         category = excluded.category,
         phone = excluded.phone,
         website = excluded.website,
         hours = excluded.hours,
         maps_url = excluded.maps_url,
         image_url = excluded.image_url,
         updated_at = now()`,
      [
        t.place_name.slice(0, 200),
        t.city.slice(0, 80),
        (row.address ?? '').slice(0, 300) || null,
        (row.neighborhood ?? '').slice(0, 120) || null,
        typeof row.location?.lat === 'number' ? row.location.lat : null,
        typeof row.location?.lng === 'number' ? row.location.lng : null,
        typeof row.totalScore === 'number' ? row.totalScore : null,
        typeof row.reviewsCount === 'number' ? row.reviewsCount : null,
        (row.categoryName ?? '').slice(0, 120) || null,
        (row.phone ?? '').slice(0, 60) || null,
        (row.website ?? '').slice(0, 300) || null,
        hours ? JSON.stringify(hours) : null,
        (row.url ?? '').slice(0, 500) || null,
        (row.imageUrl ?? '').slice(0, 600) || null,
      ]
    );
    saved += 1;
  }

  return {
    targeted: targets.length,
    found: rows.length,
    saved,
    usd,
    note: `Обогатени ${saved} от ${targets.length} обекта.`,
    ok: true,
  };
}

/* ------------------------------------------------- състояние на последния пуск */

export interface PlacesRunState extends EnrichResult {
  at: string;
  running: boolean;
}

const RUN_KEY = 'places_last_run';

/** Какво стана с последната обиколка (панелът пита това, докато чака). */
export async function lastPlacesRun(): Promise<PlacesRunState | null> {
  const row = await one<{ value: string }>(`select value from app_settings where key = $1`, [RUN_KEY]);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as PlacesRunState;
  } catch {
    return null;
  }
}

async function saveRunState(st: PlacesRunState): Promise<void> {
  await query(
    `insert into app_settings (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [RUN_KEY, JSON.stringify(st)]
  );
}

/**
 * Обогатяването върви ФОНОВО (Cloudflare реже заявката на ~100 сек, а Google
 * Maps отнема 30–90 сек). Панелът пита `/places/last`, докато свърши.
 * Заключването остарява след 10 минути — убит пуск не блокира завинаги.
 */
export async function startPlacesEnrich(limit = 10): Promise<{ started: boolean; reason?: string }> {
  const current = await lastPlacesRun().catch(() => null);
  const ageMs = current?.at ? Date.now() - Date.parse(current.at) : Number.NaN;
  const stale = !Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000;
  if (current?.running && !stale) {
    return { started: false, reason: 'Вече върви обогатяване — изчакай да свърши.' };
  }
  const n = Math.max(1, Math.min(50, Math.floor(limit) || 10));
  await saveRunState({
    at: new Date().toISOString(),
    running: true,
    targeted: n,
    found: 0,
    saved: 0,
    usd: 0,
    ok: false,
    note: `Върви… питам Google Maps за до ${n} обекта.`,
  });

  void enrichObjects(n)
    .then((r) => saveRunState({ at: new Date().toISOString(), running: false, ...r }))
    .catch((err) =>
      saveRunState({
        at: new Date().toISOString(),
        running: false,
        targeted: n,
        found: 0,
        saved: 0,
        usd: 0,
        ok: false,
        note: (err as Error).message.slice(0, 200),
      })
    );

  return { started: true };
}
