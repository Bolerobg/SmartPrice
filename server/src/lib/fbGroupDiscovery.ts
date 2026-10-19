/**
 * 🔎 Откриване на нови публични Facebook групи (подобрение №9).
 *
 * Ползва Apify актьора `datahamster~facebook-groups-search` — търси публични
 * групи по ключови думи (без логин, без cookie), връща име, адрес, брой членове,
 * тип (публична/затворена) и описание. Не се пише нищо в приложението:
 * намереното пада в `fb_group_candidates` и чака одобрение от панела.
 * Одобрена група влиза в `app_settings.fb_groups` (списъкът за обиколки).
 */
import { many, one, query } from '../db.js';
import { getSetting, setSetting } from './settings.js';
import {
  addFbSpend,
  fbBudgetAllows,
  getFbGroups,
  getFbScraperConfig,
  parseFbGroupUrl,
  saveFbGroups,
} from './fbReceipts.js';

/** Актьорът в Apify, който търси групи по ключови думи. */
const ACTOR = 'datahamster~facebook-groups-search';

/** Ключови думи по подразбиране: градове + теми, които вършат работа на SmartPrice. */
export const DEFAULT_DISCOVERY_QUERIES: string[] = [
  'цени софия',
  'цени пловдив',
  'оферти варна',
  'промоции бургас',
  'намаления русе',
  'цени стара загора',
  'цени плевен',
  'цени втора употреба',
  'детски дрехи втора употреба',
  'майстори ремонт',
  'услуги цени',
  'храна цени софия',
  'борса плодове зеленчуци',
  'разпродажба намаления софия',
  'цени в магазините',
  'промоции храна',
  'изгодни оферти',
  'намалени стоки',
  'цени техника',
  'цени битови уреди',
];

/** Думи, които издават група, полезна за приложението. */
const HIT_WORDS = [
  'цени',
  'цена',
  'оферт',
  'промоц',
  'акци',
  'намален',
  'отстъпк',
  'евтин',
  'изгодн',
  'втора употреба',
  'обяви',
  'борс',
  'пазар',
  'магазин',
  'разпродажб',
  'дефект',
  'стоки',
  'майстор',
  'ремонт',
  'услуг',
  'храна',
  'детск',
  'бебе',
  'купи продай',
];

/**
 * 🚫 Думи, които показват, че групата НЕ е за приложението.
 *
 * Стягане на 19.10.2026: досега търсенето предлагаше за одобрение всичко, което
 * съдържа „обяви“ или е в голям град — идваха имоти, коли, коне, „ХОРА РОДЕНИ В
 * ЖЕРАВНА“, „Остеопороза“… Човекът трябваше да пресява шум. Имотите и колите
 * изрично НЕ са за SmartPrice (цени на стоки и услуги), затова тук се отрязват
 * още преди да стигнат до списъка за одобрение.
 */
const BLOCK_WORDS = [
  // имоти
  'имот',
  'наем',
  'квартир',
  'апартамент',
  'парцел',
  'къща',
  'къщи',
  'земя',
  'гараж',
  'етаж',
  'жилищ',
  // коли и части
  'авто',
  'автомобил',
  'кола',
  'коли',
  'гуми',
  'джанти',
  'мотоциклет',
  'мотопед',
  'караван',
  'тежковоз',
  // животни
  'коне',
  'кучета',
  'котки',
  'цихлиди',
  'аквариум',
  'птици',
  'животни',
  // здраве
  'ямр',
  'рентген',
  'скенер',
  'лечение',
  'болест',
  'здраве',
  'медицин',
  'остеопороз',
  'диагноз',
  // села и землячества
  'родени',
  'землячеств',
  'село ',
  'села',
  // работа
  'търся работа',
  'работни места',
  'наемане на',
  'свободни позиции',
];

/** Поне една дума от HIT_WORDS трябва да е в САМОТО име/описание на групата. */
function hasHit(input: { name?: string | null; description?: string | null }): boolean {
  const text = norm(`${input.name ?? ''} ${input.description ?? ''}`);
  return HIT_WORDS.some((w) => text.includes(w));
}

/** Група, която изобщо не ни трябва (имоти, коли, животни, здраве, села, работа). */
export function isBlockedGroup(input: { name?: string | null; description?: string | null }): boolean {
  const text = norm(`${input.name ?? ''} ${input.description ?? ''}`);
  return BLOCK_WORDS.some((w) => text.includes(w));
}

/** Под този резултат групата е почти сигурно шум — не я предлагаме за одобрение. */
const MIN_CANDIDATE_SCORE = 26;

const CITY_WORDS = [
  'софия',
  'пловдив',
  'варна',
  'бургас',
  'русе',
  'стара загора',
  'плевен',
  'хасково',
  'благоевград',
  'добрич',
  'шумен',
  'перник',
  'сливен',
  'пазарджик',
  'ямбол',
  'велико търново',
  'българ',
];

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Оценка 0–100 колко е подходяща групата за SmartPrice (по име, описание, размер). */
export function scoreCandidate(input: {
  name?: string | null;
  description?: string | null;
  memberCount?: number | null;
  query?: string | null;
}): number {
  const text = norm(`${input.name ?? ''} ${input.description ?? ''} ${input.query ?? ''}`);
  let score = 0;
  for (const w of HIT_WORDS) if (text.includes(w)) score += 8;
  for (const w of CITY_WORDS) if (text.includes(w)) score += 3;
  const m = Number(input.memberCount ?? 0) || 0;
  if (m >= 50_000) score += 25;
  else if (m >= 10_000) score += 18;
  else if (m >= 3_000) score += 12;
  else if (m >= 500) score += 6;
  return Math.max(0, Math.min(100, score));
}

export interface GroupCandidate {
  id: number;
  group_url: string;
  group_id: string | null;
  name: string | null;
  member_count: number | null;
  privacy: string | null;
  description: string | null;
  query: string | null;
  score: number;
  status: string;
  created_at: string;
}

/** Списък с открити групи (по подразбиране — чакащите одобрение). */
export async function listGroupCandidates(status = 'pending', limit = 120): Promise<GroupCandidate[]> {
  return many<GroupCandidate>(
    `select id, group_url, group_id, name, member_count, privacy, description, query, score, status, created_at
       from fb_group_candidates
      where ($1 = 'all' or status = $1)
      order by score desc, member_count desc nulls last, created_at desc
      limit $2`,
    [status, Math.max(1, Math.min(300, limit))]
  );
}

/** Брой чакащи кандидати (показва се в панела). */
export async function countPendingCandidates(): Promise<number> {
  const row = await one<{ n: string }>(
    `select count(*)::text as n from fb_group_candidates where status = 'pending'`
  );
  return Number(row?.n ?? 0) || 0;
}

export interface DiscoverResult {
  ok: boolean;
  reason?: string;
  queries: string[];
  scanned: number;
  found: number;
  added: number;
  known: number;
  skippedPrivate: number;
  usd: number | null;
}

/**
 * Търси нови публични групи в Apify по ключови думи и записва намереното
 * в `fb_group_candidates` (без дубликати, без вече добавените групи).
 */
export async function discoverFbGroups(params: {
  queries?: string[];
  maxItems?: number;
  minMembers?: number;
  onLog?: (msg: string) => void | Promise<void>;
}): Promise<DiscoverResult> {
  const log = async (m: string) => {
    if (params.onLog) await params.onLog(m);
  };

  const queries = (params.queries && params.queries.length ? params.queries : DEFAULT_DISCOVERY_QUERIES)
    .map((q) => String(q).trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 30);
  const maxItems = Math.max(5, Math.min(200, Number(params.maxItems ?? 60) || 60));
  const minMembers = Number(params.minMembers ?? 0) || 0;
  const empty: DiscoverResult = {
    ok: false,
    queries,
    scanned: 0,
    found: 0,
    added: 0,
    known: 0,
    skippedPrivate: 0,
    usd: null,
  };

  const budget = await fbBudgetAllows();
  if (!budget.allowed) {
    return { ...empty, reason: budget.reason ?? 'Дневният лимит за Apify е достигнат.' };
  }

  const cfg = await getFbScraperConfig();
  if (!cfg.hasApifyToken) {
    return { ...empty, reason: 'Няма записан Apify API токен (ФБ Бележки → Настройки за Facebook).' };
  }

  await log(
    `Търся нови групи в Apify по ${queries.length} заявки (до ${maxItems} групи, без затворените)…`
  );

  const body: Record<string, unknown> = {
    queries,
    resultsPerQuery: 10,
    fetchDetails: true,
    maxItems,
    mode: 'scrape',
  };
  if (minMembers > 0) body.minMembers = minMembers;

  let items: Array<Record<string, unknown>> = [];
  try {
    const res = await fetch(
      'https://api.apify.com/v2/acts/' +
        ACTOR +
        '/run-sync-get-dataset-items?token=' +
        encodeURIComponent(cfg.apifyToken),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(240_000),
      }
    );
    const text = await res.text();
    if (!res.ok) {
      return { ...empty, reason: `Apify върна HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) items = parsed as Array<Record<string, unknown>>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...empty, reason: 'Грешка при връзка с Apify: ' + msg.slice(0, 200) };
  }

  await log(`Apify върна ${items.length} реда. Пресявам…`);

  // Вече известните групи — не ги предлагаме пак.
  const existingGroups = await getFbGroups();
  const knownUrls = new Set<string>();
  const knownIds = new Set<string>();
  for (const g of existingGroups) {
    try {
      const p = parseFbGroupUrl(g);
      knownUrls.add(p.canonicalUrl);
      if (p.groupId) knownIds.add(p.groupId);
    } catch {
      knownUrls.add(String(g).trim());
    }
  }
  const dbKnown = await many<{ group_url: string; group_id: string | null }>(
    `select group_url, group_id from fb_group_candidates where status <> 'rejected'`
  );
  for (const r of dbKnown) {
    knownUrls.add(r.group_url);
    if (r.group_id) knownIds.add(r.group_id);
  }

  let found = 0;
  let added = 0;
  let known = 0;
  let skippedPrivate = 0;
  let skippedBlocked = 0;
  let skippedWeak = 0;

  for (const it of items) {
    const rawUrl = String(it.url ?? '').trim();
    if (!rawUrl) continue;
    let canonicalUrl = rawUrl;
    let groupId = String(it.groupId ?? '').trim();
    try {
      const p = parseFbGroupUrl(rawUrl);
      canonicalUrl = p.canonicalUrl;
      groupId = groupId || p.groupId;
    } catch {
      /* оставяме адреса както идва */
    }

    const privacy = String(it.privacy ?? '').toLowerCase();
    if (privacy === 'private' || privacy === 'затворена') {
      skippedPrivate += 1;
      continue;
    }
    if (knownUrls.has(canonicalUrl) || (groupId && knownIds.has(groupId))) {
      known += 1;
      continue;
    }

    const name = String(it.name ?? '').trim().slice(0, 200) || null;
    const rawMembers = Number(it.memberCount ?? 0);
    const memberCount = Number.isFinite(rawMembers) && rawMembers > 0 ? Math.round(rawMembers) : null;
    if (minMembers > 0 && (memberCount ?? 0) < minMembers) continue;
    const description = String(it.description ?? '').trim().slice(0, 2000) || null;
    const q = String(it.query ?? '').trim().slice(0, 80) || null;
    const score = scoreCandidate({ name, description, memberCount, query: q });

    // 🚫 Стягане: имоти/коли/животни/здраве/села/работа → не влизат изобщо.
    if (isBlockedGroup({ name, description })) {
      skippedBlocked += 1;
      continue;
    }
    // Изискваме ПОНЕ една дума-признак в самото име/описание + минимален резултат,
    // иначе списъкът за одобрение се пълни с несвързани групи.
    if (!hasHit({ name, description }) || score < MIN_CANDIDATE_SCORE) {
      skippedWeak += 1;
      continue;
    }

    found += 1;
    try {
      const rows = await many<{ inserted: boolean }>(
        `insert into fb_group_candidates (group_url, group_id, name, member_count, privacy, description, query, score)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (group_url) do update
            set name = coalesce(excluded.name, fb_group_candidates.name),
                group_id = coalesce(excluded.group_id, fb_group_candidates.group_id),
                member_count = coalesce(excluded.member_count, fb_group_candidates.member_count),
                privacy = coalesce(excluded.privacy, fb_group_candidates.privacy),
                description = coalesce(excluded.description, fb_group_candidates.description),
                score = greatest(excluded.score, fb_group_candidates.score)
          where fb_group_candidates.status = 'pending'
         returning (xmax = 0) as inserted`,
        [canonicalUrl, groupId || null, name, memberCount, privacy || null, description, q, score]
      );
      if (rows.length > 0) added += 1;
    } catch {
      /* дубликат или лош запис — пропускаме */
    }
  }

  // Разходът за обиколката се записва в дневния бюджет.
  let usd: number | null = null;
  try {
    const u = await fetch(
      'https://api.apify.com/v2/acts/' + ACTOR + '/runs?token=' + encodeURIComponent(cfg.apifyToken) + '&limit=1&desc=true',
      { signal: AbortSignal.timeout(20_000) }
    );
    if (u.ok) {
      const d = (await u.json()) as { data?: { items?: Array<{ usageTotalUsd?: number }> } };
      const v = d.data?.items?.[0]?.usageTotalUsd;
      if (typeof v === 'number') usd = v;
    }
  } catch {
    /* разходът не е критичен */
  }
  if (usd && usd > 0) await addFbSpend({ usd });

  await log(
    `Готово: нови групи за преглед — ${added} (познати: ${known}, затворени: ${skippedPrivate}, ` +
      `отрязани като неподходящи: ${skippedBlocked}, слаби: ${skippedWeak}).`
  );

  return { ok: true, queries, scanned: items.length, found, added, known, skippedPrivate, usd };
}

/** Върви ли в момента търсене на нови групи. */
let discoveryRunning = false;

export function isDiscoveryRunning(): boolean {
  return discoveryRunning;
}

/** Последен резултат от търсене на нови групи (пази се в настройките). */
export async function readDiscoveryStatus(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await getSetting('fb_discover_last', '');
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Пуска търсенето на нови групи ФОНОВО. Синхронната заявка минава през
 * Cloudflare, който я реже след ~100 секунди (грешка 504), затова тук
 * връщаме веднага, а резултатът се записва в настройките.
 */
export async function startDiscoveryInBackground(params: {
  queries?: string[];
  maxItems?: number;
  minMembers?: number;
}): Promise<{ started: boolean; reason?: string }> {
  if (discoveryRunning) return { started: false, reason: 'Търсенето вече върви — изчакай да завърши.' };
  discoveryRunning = true;
  const startedAt = new Date().toISOString();

  void (async () => {
    let payload: Record<string, unknown>;
    try {
      const res = await discoverFbGroups(params);
      payload = { ...res, startedAt, finishedAt: new Date().toISOString() };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      payload = {
        ok: false,
        reason: 'Грешка при търсенето: ' + msg.slice(0, 240),
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } finally {
      discoveryRunning = false;
    }
    try {
      await setSetting('fb_discover_last', JSON.stringify(payload));
    } catch {
      /* настройката не е критична */
    }
  })();

  return { started: true };
}

/** Одобрява кандидат: добавя групата в списъка за обиколки. */
export async function approveGroupCandidate(id: number): Promise<{
  ok: boolean;
  groupUrl: string;
  groups: number;
}> {
  const row = await one<{ group_url: string }>(
    `select group_url from fb_group_candidates where id = $1`,
    [id]
  );
  if (!row) throw new Error('Няма такава група в списъка.');
  let canonicalUrl = row.group_url;
  try {
    canonicalUrl = parseFbGroupUrl(row.group_url).canonicalUrl;
  } catch {
    /* оставяме както е */
  }

  const groups = await getFbGroups();
  const already = groups.some((g) => {
    try {
      return parseFbGroupUrl(g).canonicalUrl === canonicalUrl;
    } catch {
      return g.trim() === canonicalUrl;
    }
  });
  if (!already) await saveFbGroups([...groups, canonicalUrl]);

  await query(`update fb_group_candidates set status = 'approved', reviewed_at = now() where id = $1`, [id]);
  const after = await getFbGroups();
  return { ok: true, groupUrl: canonicalUrl, groups: after.length };
}

/** Отхвърля кандидат (повече няма да се предлага). */
export async function rejectGroupCandidate(id: number): Promise<{ ok: boolean }> {
  await query(`update fb_group_candidates set status = 'rejected', reviewed_at = now() where id = $1`, [id]);
  return { ok: true };
}
