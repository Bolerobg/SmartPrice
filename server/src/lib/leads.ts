/**
 * 🧭 ОБИКОЛКИ — обекти извън приложението + проследяване на посещенията.
 *
 * Защо съществува: приложението има продукт за бизнесите („Проверен търговец“),
 * но НУЛА търговци — защото никой не е ходил да ги пита. Този модул дава работен
 * списък: кои обекти наблизо ги НЯМА в SmartPrice, с телефон и адрес, за да се
 * отиде при тях, плюс статус (нов → посетен → интересува се → отказал → включен),
 * за да не се ходи два пъти при един и същ човек.
 *
 * Обектите се намират през Google Maps (актьорът `compass/crawler-google-places`,
 * същият, който приложението вече ползва за Радара) — това ХАРЧИ ПАРИ, затова:
 *   • оценката се показва ПРЕДИ пускане (`estimateSearchUsd`),
 *   • проверява се дневният лимит (`apifyBudgetAllows` от apifyBrowser.ts),
 *   • търсенето върви във ФОНА (Cloudflare реже заявки над 100 секунди, а Apify
 *     търсенето отнема 1-3 минути) и панелът пита за готовност.
 */
import { many, one } from '../db.js';
import {
  addApifySpend,
  apifyBudgetAllows,
  apifyDailyLimit,
  apifySpent,
  apifyToken,
} from './apifyBrowser.js';

/**
 * Колко струва ЕДНО място в Apify.
 *
 * ⚠️ Измерено на 23.10.2026: търсене „аптека“ в 1 град, 5 обекта = $0.101,
 * тоест ~$0.020 на място (преди пишехме 0.012 — подценявахме с 40%).
 * Затова оценката тук е по-висока от реалната понякога; истинската се записва
 * от Apify след пускането (`real_usd` в `leads_search_runs`).
 */
export const PER_PLACE_USD = 0.02;

const ACTOR = 'compass~crawler-google-places';

export interface Lead {
  id: number;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  category: string | null;
  searchTerm: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  reviewsCount: number | null;
  mapsUrl: string | null;
  inApp: boolean;
  status: 'new' | 'contacted' | 'interested' | 'refused' | 'joined';
  note: string;
  contactedAt: string | null;
  createdAt: string;
}

export interface LeadSearchRun {
  id: number;
  city: string;
  term: string;
  limitCount: number;
  estUsd: number | null;
  realUsd: number | null;
  status: 'running' | 'done' | 'failed';
  found: number;
  added: number;
  note: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface LeadStats {
  total: number;
  byStatus: Record<string, number>;
  withPhone: number;
  notInApp: number;
}

const mapLead = (r: Record<string, unknown>): Lead => ({
  id: Number(r.id),
  name: String(r.name),
  city: (r.city as string) ?? null,
  address: (r.address as string) ?? null,
  phone: (r.phone as string) ?? null,
  website: (r.website as string) ?? null,
  category: (r.category as string) ?? null,
  searchTerm: (r.search_term as string) ?? null,
  latitude: r.latitude == null ? null : Number(r.latitude),
  longitude: r.longitude == null ? null : Number(r.longitude),
  rating: r.rating == null ? null : Number(r.rating),
  reviewsCount: r.reviews_count == null ? null : Number(r.reviews_count),
  mapsUrl: (r.maps_url as string) ?? null,
  inApp: Boolean(r.in_app),
  status: String(r.status) as Lead['status'],
  note: String(r.note ?? ''),
  contactedAt: r.contacted_at ? new Date(r.contacted_at as string).toISOString() : null,
  createdAt: new Date(r.created_at as string).toISOString(),
});

const mapRun = (r: Record<string, unknown>): LeadSearchRun => ({
  id: Number(r.id),
  city: String(r.city),
  term: String(r.term),
  limitCount: Number(r.limit_count),
  estUsd: r.est_usd == null ? null : Number(r.est_usd),
  realUsd: r.real_usd == null ? null : Number(r.real_usd),
  status: String(r.status) as LeadSearchRun['status'],
  found: Number(r.found ?? 0),
  added: Number(r.added ?? 0),
  note: String(r.note ?? ''),
  startedAt: new Date(r.started_at as string).toISOString(),
  finishedAt: r.finished_at ? new Date(r.finished_at as string).toISOString() : null,
});

/** Оценка преди пускане — показва се на човека, за да знае какво харчи. */
export function estimateSearchUsd(limit: number): number {
  return Number((Math.max(1, limit) * PER_PLACE_USD).toFixed(3));
}

/**
 * Преизчислява двата автоматични признака на лийдовете:
 *   • `in_app` — вече има ли сигнал за този обект (да не му се предлага пак);
 *   • `status='joined'` — вече има ли ПРОВЕРЕН ТЪРГОВЕЦ за този обект.
 * Пуска се при отваряне на списъка, за да е винаги вярно.
 */
export async function refreshLeadFlags(): Promise<{ inApp: number; joined: number }> {
  const inApp = await many<{ id: number }>(
    `with computed as (
       select l.id,
              exists (
                select 1 from posts p
                 where p.status = 'published'
                   and lower(btrim(p.place_name)) = lower(btrim(l.name))
                   and (l.city is null or lower(btrim(p.city)) = lower(btrim(l.city)))
              ) as has_it
         from leads l
     )
     update leads l
        set in_app = c.has_it, updated_at = now()
       from computed c
      where c.id = l.id and l.in_app is distinct from c.has_it
      returning l.id`,
    []
  );

  const joined = await many<{ id: number }>(
    `update leads l
        set status = 'joined', contacted_at = coalesce(l.contacted_at, now()), updated_at = now()
       from business_accounts b
      where l.status <> 'joined'
        and lower(btrim(b.place_name)) = lower(btrim(l.name))
        and (l.city is null or b.city is null or lower(btrim(b.city)) = lower(btrim(l.city)))
      returning l.id`,
    []
  );

  return { inApp: inApp.length, joined: joined.length };
}

export interface ListLeadsParams {
  status?: string;
  city?: string;
  q?: string;
  /** Само обекти, които ГИ НЯМА в приложението (за обиколка). */
  onlyNotInApp?: boolean | undefined;
  /** Само с телефон — за да има кого да питаш по Viber/телефон. */
  onlyWithPhone?: boolean | undefined;
  limit?: number;
}

export async function listLeads(
  params: ListLeadsParams = {}
): Promise<{ items: Lead[]; stats: LeadStats }> {
  const where: string[] = [];
  const values: unknown[] = [];

  if (params.status && params.status !== 'all') {
    values.push(params.status);
    where.push(`l.status = $${values.length}`);
  }
  if (params.city && params.city !== 'all') {
    values.push(params.city);
    where.push(`lower(btrim(coalesce(l.city, ''))) = lower(btrim($${values.length}))`);
  }
  if (params.q) {
    values.push(`%${params.q.trim()}%`);
    where.push(`(l.name ilike $${values.length} or coalesce(l.address, '') ilike $${values.length})`);
  }
  if (params.onlyNotInApp) where.push('l.in_app = false');
  if (params.onlyWithPhone) where.push(`(l.phone is not null and btrim(l.phone) <> '')`);

  values.push(Math.min(500, Math.max(1, params.limit ?? 200)));
  const rows = await many<Record<string, unknown>>(
    `select l.* from leads l
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by
        case l.status when 'interested' then 0 when 'new' then 1 when 'contacted' then 2
                       when 'refused' then 3 else 4 end,
        l.created_at desc
      limit $${values.length}`,
    values
  );

  const stat = await one<{
    total: string;
    with_phone: string;
    not_in_app: string;
    s_new: string;
    s_contacted: string;
    s_interested: string;
    s_refused: string;
    s_joined: string;
  }>(
    `select count(*)::text as total,
            count(*) filter (where phone is not null and btrim(phone) <> '')::text as with_phone,
            count(*) filter (where in_app = false)::text as not_in_app,
            count(*) filter (where status = 'new')::text as s_new,
            count(*) filter (where status = 'contacted')::text as s_contacted,
            count(*) filter (where status = 'interested')::text as s_interested,
            count(*) filter (where status = 'refused')::text as s_refused,
            count(*) filter (where status = 'joined')::text as s_joined
       from leads`,
    []
  );

  return {
    items: rows.map(mapLead),
    stats: {
      total: Number(stat?.total ?? 0),
      withPhone: Number(stat?.with_phone ?? 0),
      notInApp: Number(stat?.not_in_app ?? 0),
      byStatus: {
        new: Number(stat?.s_new ?? 0),
        contacted: Number(stat?.s_contacted ?? 0),
        interested: Number(stat?.s_interested ?? 0),
        refused: Number(stat?.s_refused ?? 0),
        joined: Number(stat?.s_joined ?? 0),
      },
    },
  };
}

export interface AddLeadInput {
  name: string;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  category?: string | null;
  note?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  mapsUrl?: string | null;
}

/** Добавя обект на ръка (човекът го е видял на улицата и го записва). */
export async function addLead(input: AddLeadInput, addedBy?: string): Promise<Lead> {
  const row = await one<Record<string, unknown>>(
    `insert into leads (name, city, address, phone, website, category, note, latitude, longitude, maps_url)
     values ($1, $2, $3, $4, $5, $6, coalesce($7, ''), $8, $9, $10)
     on conflict (lower(btrim(name)), lower(btrim(coalesce(city, '')))) do update set
       address = coalesce(excluded.address, leads.address),
       phone = coalesce(excluded.phone, leads.phone),
       website = coalesce(excluded.website, leads.website),
       category = coalesce(excluded.category, leads.category),
       note = case when excluded.note <> '' then excluded.note else leads.note end,
       latitude = coalesce(excluded.latitude, leads.latitude),
       longitude = coalesce(excluded.longitude, leads.longitude),
       maps_url = coalesce(excluded.maps_url, leads.maps_url),
       updated_at = now()
     returning *`,
    [
      input.name.trim(),
      input.city?.trim() || null,
      input.address?.trim() || null,
      input.phone?.trim() || null,
      input.website?.trim() || null,
      input.category?.trim() || null,
      input.note?.trim() || '',
      input.latitude ?? null,
      input.longitude ?? null,
      input.mapsUrl?.trim() || null,
    ]
  );
  if (!row) throw new Error('Лиййдът не се записа.');
  void addedBy;
  return mapLead(row);
}

/** Сменя статуса на обиколката (+ бележка). */
export async function setLeadStatus(
  id: number,
  status: Lead['status'],
  note?: string
): Promise<Lead | null> {
  const row = await one<Record<string, unknown>>(
    `update leads
        set status = $2,
            note = case when $3::text is not null and $3 <> '' then $3 else note end,
            contacted_at = case when $2 <> 'new' then coalesce(contacted_at, now()) else contacted_at end,
            updated_at = now()
      where id = $1
      returning *`,
    [id, status, note ?? '']
  );
  return row ? mapLead(row) : null;
}

export async function deleteLead(id: number): Promise<boolean> {
  const row = await one<{ id: number }>(`delete from leads where id = $1 returning id`, [id]);
  return Boolean(row);
}

/* ================================================= търсене в Google Maps */

/* ============================================= 🗺️ маршрут за един ден */

/** Разстояние по права линия между две точки, в километри (формула на хаверсинуса). */
function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface RouteStop {
  order: number;
  lead: Lead;
  /** Колко километра е от предишната спирка (по права линия). */
  kmFromPrev: number;
}

export interface DayRoute {
  city: string;
  stops: RouteStop[];
  totalKm: number;
  /** Готов линк за навигация в Google Maps с всички спирки. */
  mapsUrl: string;
  /** Списък за копиране — за дни без интернет. */
  text: string;
  withCoords: number;
  skippedNoCoords: number;
  message?: string;
}

/**
 * 🗺️ Подрежда спирките в маршрут за един ден.
 *
 * Как: тръгва от зададена точка (или от първия обект) и винаги отива до
 * НАЙ-БЛИЗКИЯ непосетен обект („най-близък съсед“). Не е математически
 * оптималният маршрут, но е това, което човек прави с кола — и е много по-добро
 * от списък по азбучен ред. Разстоянията са по права линия (с кола ще са
 * ~20-30% повече — казано е честно в текста).
 */
export async function planDayRoute(params: {
  city: string;
  maxStops?: number;
  startLat?: number | null;
  startLng?: number | null;
  onlyNotInApp?: boolean | undefined;
  onlyWithPhone?: boolean | undefined;
}): Promise<DayRoute> {
  const maxStops = Math.min(10, Math.max(1, params.maxStops ?? 8));
  const all = await listLeads({
    city: params.city,
    onlyNotInApp: params.onlyNotInApp ?? true,
    onlyWithPhone: params.onlyWithPhone ?? false,
    limit: 500,
  });

  const withCoords = all.items.filter((l) => l.latitude != null && l.longitude != null);
  const skippedNoCoords = all.items.length - withCoords.length;

  if (!withCoords.length) {
    return {
      city: params.city,
      stops: [],
      totalKm: 0,
      mapsUrl: '',
      text: '',
      withCoords: 0,
      skippedNoCoords,
      message:
        'Няма обекти с координати в този град. Обектите от Google Maps ги имат; ' +
        'добавените на ръка — не (за тях може само по адрес).',
    };
  }

  let lat = params.startLat ?? withCoords[0]!.latitude!;
  let lng = params.startLng ?? withCoords[0]!.longitude!;

  const left = [...withCoords];
  const stops: RouteStop[] = [];
  let totalKm = 0;

  while (left.length && stops.length < maxStops) {
    let bestIdx = 0;
    let bestKm = Number.POSITIVE_INFINITY;
    for (let i = 0; i < left.length; i++) {
      const d = kmBetween(lat, lng, left[i]!.latitude!, left[i]!.longitude!);
      if (d < bestKm) {
        bestKm = d;
        bestIdx = i;
      }
    }
    const next = left.splice(bestIdx, 1)[0]!;
    lat = next.latitude!;
    lng = next.longitude!;
    totalKm += bestKm;
    stops.push({ order: stops.length + 1, lead: next, kmFromPrev: Number(bestKm.toFixed(2)) });
  }

  const coordsOf = (l: Lead) => `${l.latitude},${l.longitude}`;
  const first = stops[0]!.lead;
  const last = stops[stops.length - 1]!.lead;
  const middle = stops.slice(1, -1).map((s) => coordsOf(s.lead));
  const mapsUrl =
    'https://www.google.com/maps/dir/?api=1' +
    `&origin=${coordsOf(first)}&destination=${coordsOf(last)}` +
    (middle.length ? `&waypoints=${middle.join('|')}` : '') +
    '&travelmode=driving';

  const text = [
    `🧭 Маршрут за деня — ${params.city} (${stops.length} спирки, ~${totalKm.toFixed(1)} км по права линия)`,
    '',
    ...stops.map(
      (s) =>
        `${s.order}. ${s.lead.name}${s.lead.address ? ' — ' + s.lead.address : ''}` +
        `${s.lead.phone ? ' · ' + s.lead.phone : ''}` +
        (s.order > 1 ? `  (${s.kmFromPrev} км от предишната)` : '')
    ),
    '',
    'Навигация: ' + mapsUrl,
  ].join('\n');

  return {
    city: params.city,
    stops,
    totalKm: Number(totalKm.toFixed(1)),
    mapsUrl,
    text,
    withCoords: withCoords.length,
    skippedNoCoords,
  };
}

/* ============================================= 📊 доклад за обиколките */

export interface LeadsReport {
  total: number;
  byStatus: Record<string, number>;
  visited7: number;
  new7: number;
  followUp: Lead[];
  spent7: number;
  runs7: number;
  lines: string[];
}

/**
 * 📊 Как върви ходенето по обекти.
 *
 * Числата, които имат значение за решение: колко е посетено, колко се
 * интересуват, колко СА СТАНАЛИ търговци (реалният резултат) и колко пари е
 * похарчено за намирането им. Плюс списък „върни се при тези“ — интересът
 * изстива, ако не се върнеш до седмица.
 */
export async function leadsReport(): Promise<LeadsReport> {
  await refreshLeadFlags();

  const s = await one<Record<string, string>>(
    `select count(*)::text as total,
            count(*) filter (where status = 'new')::text as s_new,
            count(*) filter (where status = 'contacted')::text as s_contacted,
            count(*) filter (where status = 'interested')::text as s_interested,
            count(*) filter (where status = 'refused')::text as s_refused,
            count(*) filter (where status = 'joined')::text as s_joined,
            count(*) filter (where contacted_at > now() - interval '7 days')::text as visited7,
            count(*) filter (where created_at > now() - interval '7 days')::text as new7
       from leads`,
    []
  );

  const spend = await one<Record<string, string>>(
    `select coalesce(sum(real_usd), 0)::text as spent, count(*)::text as runs
       from leads_search_runs
      where status = 'done' and started_at > now() - interval '7 days'`,
    []
  );

  const followUp = await many<Record<string, unknown>>(
    `select * from leads
      where status = 'interested'
        and coalesce(contacted_at, created_at) < now() - interval '7 days'
      order by contacted_at asc nulls first
      limit 10`,
    []
  );

  const byStatus = {
    new: Number(s?.s_new ?? 0),
    contacted: Number(s?.s_contacted ?? 0),
    interested: Number(s?.s_interested ?? 0),
    refused: Number(s?.s_refused ?? 0),
    joined: Number(s?.s_joined ?? 0),
  };
  const total = Number(s?.total ?? 0);
  const visited7 = Number(s?.visited7 ?? 0);
  const new7 = Number(s?.new7 ?? 0);
  const spent7 = Number(spend?.spent ?? 0);
  const runs7 = Number(spend?.runs ?? 0);

  const pct = total > 0 ? Math.round((byStatus.joined / total) * 100) : 0;
  const lines = [
    '🧭 Обиколки — докладът за седмицата',
    '',
    `Общо обекти в списъка: ${total}`,
    `🆕 непосетени: ${byStatus.new}`,
    `📞 говорено (тази седмица): ${visited7}`,
    `🤝 проявяват интерес: ${byStatus.interested}`,
    `🎉 станали търговци: ${byStatus.joined} (${pct}% от списъка)`,
    `❌ отказали: ${byStatus.refused}`,
    '',
    `Нови обекти, намерени тази седмица: ${new7}`,
    `Похарчено за намирането им: $${spent7.toFixed(2)} (${runs7} търсения)`,
  ];

  if (followUp.length) {
    lines.push('', '⏰ Върни се при тези (интересът изстива):');
    for (const l of followUp.map(mapLead)) {
      lines.push(`  • ${l.name}${l.city ? ' — ' + l.city : ''}${l.phone ? ' · ' + l.phone : ''}`);
    }
  } else if (byStatus.interested) {
    lines.push('', '⏰ Няма изстиващи — всички заинтересовани са говорени скоро.');
  }

  if (visited7 === 0 && !byStatus.joined) {
    lines.push(
      '',
      '⚠️ Тази седмица няма нито един отбелязан разговор. Без обиколки списъкът си стои.',
      'Отвори панела → 🧭 Обиколки и тръгни от най-близките 5.'
    );
  } else if (byStatus.joined) {
    lines.push('', '💰 Всеки станал търговец = 19 €/мес, ако плати плана.');
  }

  return {
    total,
    byStatus,
    visited7,
    new7,
    followUp: followUp.map(mapLead),
    spent7,
    runs7,
    lines,
  };
}

async function lastRunCost(token: string): Promise<number> {
  try {
    const res = await fetch('https://api.apify.com/v2/actor-runs?limit=1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = (await res.json()) as { data?: { items?: Array<{ usageTotalUsd?: number }> } };
    return Number(d.data?.items?.[0]?.usageTotalUsd ?? 0) || 0;
  } catch {
    return 0;
  }
}

/**
 * Питаме за разрешение ПРЕДИ да харчим: оценка + дневен лимит.
 * Панелът показва това и чак след потвърждение пускаме.
 */
export async function leadsBudget(limit: number): Promise<{
  estUsd: number;
  today: number;
  limitUsd: number;
  allowed: boolean;
}> {
  const estUsd = estimateSearchUsd(limit);
  const { today } = await apifySpent();
  const limitUsd = await apifyDailyLimit();
  const { allowed } = await apifyBudgetAllows(estUsd);
  return { estUsd, today, limitUsd, allowed };
}

/**
 * ПУСКА търсене във ФОНА и връща веднага id на пуска.
 *
 * Защо във фона: търсенето в Google Maps отнема 1-3 минути, а Cloudflare реже
 * заявки над 100 секунди — ако чакахме, панелът щеше да получава 524.
 */
export async function startLeadsSearch(params: {
  city: string;
  term: string;
  limit: number;
  requestedBy?: string;
}): Promise<{ run: LeadSearchRun; budget: Awaited<ReturnType<typeof leadsBudget>>; message?: string }> {
  const city = params.city.trim();
  const term = params.term.trim();
  const limit = Math.min(120, Math.max(1, Math.round(params.limit)));

  const budget = await leadsBudget(limit);
  const insert = await one<Record<string, unknown>>(
    `insert into leads_search_runs (city, term, limit_count, est_usd, status, requested_by)
     values ($1, $2, $3, $4, 'running', $5) returning *`,
    [city, term, limit, budget.estUsd, params.requestedBy ?? null]
  );
  if (!insert) throw new Error('Пуска не се записа.');
  const run = mapRun(insert);

  if (!budget.allowed) {
    await one(
      `update leads_search_runs set status = 'failed', finished_at = now(),
              note = $2 where id = $1 returning id`,
      [
        run.id,
        `Дневният лимит на Apify не стига: похарчени ${budget.today.toFixed(2)}$ от ${budget.limitUsd.toFixed(2)}$, ` +
          `а търсенето иска ~${budget.estUsd.toFixed(2)}$.`,
      ]
    );
    return {
      run,
      budget,
      message: `Спрях преди да похарча: днес са похарчени ${budget.today.toFixed(2)}$ от лимит ${budget.limitUsd.toFixed(2)}$, а търсенето иска ~${budget.estUsd.toFixed(2)}$.`,
    };
  }

  // 🔥 Пускаме и НЕ чакаме — панелът пита за готовност.
  void runLeadsSearchJob(run.id, city, term, limit);
  return { run, budget };
}

/** Самата работа: вика Apify, записва намереното като лийдове. */
async function runLeadsSearchJob(runId: number, city: string, term: string, limit: number): Promise<void> {
  try {
    const token = await apifyToken();
    if (!token) throw new Error('Няма Apify токен в настройките.');

    const body = {
      searchStringsArray: [term],
      locationQuery: `${city}, Bulgaria`,
      maxCrawledPlacesPerSearch: limit,
      language: 'bg',
      maxReviews: 0,
      scrapeReviewsPersonalData: false,
    };

    const res = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=300`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(320_000),
      }
    );
    if (!res.ok) throw new Error(`Apify върна ${res.status}`);
    const items = (await res.json()) as Array<Record<string, unknown>>;

    let added = 0;
    for (const it of items) {
      const name = String(it.title ?? '').trim();
      if (name.length < 3) continue;
      const loc = (it.location ?? {}) as { lat?: number; lng?: number };
      const cityName = String(it.city ?? '').trim() || city;
      await one(
        `insert into leads (name, city, address, phone, website, category, search_term,
                            latitude, longitude, rating, reviews_count, maps_url)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (lower(btrim(name)), lower(btrim(coalesce(city, '')))) do update set
           phone = coalesce(excluded.phone, leads.phone),
           address = coalesce(excluded.address, leads.address),
           website = coalesce(excluded.website, leads.website),
           category = coalesce(excluded.category, leads.category),
           rating = excluded.rating,
           reviews_count = excluded.reviews_count,
           maps_url = coalesce(excluded.maps_url, leads.maps_url),
           latitude = coalesce(excluded.latitude, leads.latitude),
           longitude = coalesce(excluded.longitude, leads.longitude),
           search_term = excluded.search_term,
           updated_at = now()
         returning id`,
        [
          name,
          cityName,
          String(it.address ?? '') || null,
          String(it.phone ?? '') || null,
          String(it.website ?? '') || null,
          String(it.categoryName ?? term) || null,
          `${term} в ${city}`,
          loc.lat ?? null,
          loc.lng ?? null,
          it.totalScore == null ? null : Number(it.totalScore),
          it.reviewsCount == null ? null : Number(it.reviewsCount),
          String(it.url ?? '') || null,
        ]
      );
      added += 1;
    }

    // Оценяваме кой вече е в приложението (за да не ходим при него напразно).
    await refreshLeadFlags();

    const cost = await lastRunCost(token);
    await addApifySpend(cost || estimateSearchUsd(items.length), `Обиколки: „${term}“ в ${city} (${added} обекта)`);

    await one(
      `update leads_search_runs
          set status = 'done', found = $2, added = $3, real_usd = $4, finished_at = now(),
              note = $5
        where id = $1 returning id`,
      [
        runId,
        items.length,
        added,
        cost || null,
        added === 0
          ? 'Google не върна нищо за този термин — опитай с друга дума (напр. „аптека“, „кафене“).'
          : `Готово: ${added} обекта (пари похарчени: ${(cost || 0).toFixed(3)}$).`,
      ]
    );
  } catch (err) {
    await one(
      `update leads_search_runs set status = 'failed', finished_at = now(), note = $2
        where id = $1 returning id`,
      [runId, `Грешка: ${(err as Error)?.message ?? String(err)}`.slice(0, 300)]
    ).catch(() => undefined);
  }
}

export async function listSearchRuns(limit = 10): Promise<LeadSearchRun[]> {
  const rows = await many<Record<string, unknown>>(
    `select * from leads_search_runs order by started_at desc limit $1`,
    [Math.min(50, Math.max(1, limit))]
  );
  return rows.map(mapRun);
}

/** CSV за разпечатване/телефон — теренната работа не винаги има нет. */
export async function leadsCsv(): Promise<string> {
  const { items } = await listLeads({ limit: 500, onlyNotInApp: true });
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Име', 'Град', 'Адрес', 'Телефон', 'Категория', 'Рейтинг', 'Отзиви', 'Статус', 'Бележка', 'Google Maps'];
  const lines = [head.map(esc).join(';')];
  for (const l of items) {
    lines.push(
      [
        l.name,
        l.city,
        l.address,
        l.phone,
        l.category,
        l.rating,
        l.reviewsCount,
        l.status,
        l.note,
        l.mapsUrl,
      ]
        .map(esc)
        .join(';')
    );
  }
  return '\uFEFF' + lines.join('\n');
}
