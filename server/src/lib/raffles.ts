import crypto from 'node:crypto';
import { env } from '../env.js';
import { isDemoMode } from './settings.js';
import { many, one, query } from '../db.js';
import { badRequest, forbidden, notFound } from './errors.js';

/**
 * Томболи — цялата логика на едно място.
 *
 * Три неща, които правят това ЧЕСТНО (а не „на честна дума“):
 *   1. условието се проверява в базата (N находки СЪС СНИМКА), не се вярва на клиента;
 *   2. официалното време се мери на СЪРВЪРА — клиентът не подава време, значи не може да мами;
 *   3. дъската на пъзела е една и съща за всички (генерира се от id-то на томболата),
 *      затова времената са сравними.
 */

/** Под 1.5 s две двойки не се намират с очи — праг срещу ботове и „налучкване“. */
export const MIN_RUN_MS = 1500;
export const MAX_RUN_MS = 20 * 60 * 1000;
export const PRACTICE_ATTEMPTS = 3;
export const PROMO_MAX_VIEWS = 3;
export const PUZZLE_TILES = 12;
export const PUZZLE_PAIRS = 2;

export function adminEmails(): string[] {
  return env.ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = adminEmails();
  return list.includes(email.trim().toLowerCase());
}

export interface RaffleRow {
  id: string;
  title: string;
  description: string;
  prize_title: string;
  prize_url: string | null;
  prize_image_url: string | null;
  prize_price: number | null;
  prize_currency: string;
  condition_posts: number;
  condition_images_only: boolean;
  /** Находките трябва да са от поне N различни дни (фарменето става бавно). */
  condition_distinct_days: number;
  /** Акаунтът трябва да е на поне N дни. */
  min_account_age_days: number;
  /** Имейлът трябва да е потвърден преди поне N дни. */
  min_verified_age_days: number;
  /** Синхронен старт: часът, в който нареждането се отваря за всички. */
  official_opens_at: Date | null;
  /** Колко минути трае официалният прозорец. */
  official_window_min: number;
  min_participants: number;
  count_from_start: boolean;
  starts_at: Date;
  ends_at: Date;
  status: 'draft' | 'active' | 'running' | 'finished' | 'cancelled';
  cancel_reason: string | null;
  winner_id: string | null;
  winning_time_ms: number | null;
  qualified_count: number;
  started_running_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

/* ------------------------------------------------------------------ помощни */

const iso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/** Ефективен статус: следим и времето, ако админът не е натиснал нищо. */
export function effectiveStatus(r: RaffleRow): RaffleRow['status'] {
  if (r.status === 'active' && new Date(r.ends_at).getTime() < Date.now()) return 'running';
  return r.status;
}

/** Колко находки със снимка има потребителят в прозореца на томболата. */
export async function countQualifyingPosts(r: RaffleRow, userId: string): Promise<number> {
  const row = await one<{ n: number }>(
    `select count(*) as n from posts p
      where p.author_id = $1
        and p.status = 'published'
        and p.polarity = 'green'
        and ($2 = false or (p.image_url is not null and btrim(p.image_url) <> ''))
        and ($3 = false or p.created_at >= $4)
        and p.created_at <= $5`,
    [userId, r.condition_images_only, r.count_from_start, r.starts_at, r.ends_at]
  );
  return Number(row?.n ?? 0);
}

/** От колко РАЗЛИЧНИ дни са находките (по българско време). */
export async function countQualifyingDays(r: RaffleRow, userId: string): Promise<number> {
  const row = await one<{ n: number }>(
    `select count(distinct (p.created_at at time zone 'Europe/Sofia')::date) as n
       from posts p
      where p.author_id = $1
        and p.status = 'published'
        and p.polarity = 'green'
        and ($2 = false or (p.image_url is not null and btrim(p.image_url) <> ''))
        and ($3 = false or p.created_at >= $4)
        and p.created_at <= $5`,
    [userId, r.condition_images_only, r.count_from_start, r.starts_at, r.ends_at]
  );
  return Number(row?.n ?? 0);
}

export interface QualificationCheck {
  ok: boolean;
  posts: number;
  days: number;
  reason?: string;
}

/**
 * Всички условия за участие на едно място — и находки, и различни дни,
 * и стаж на профила. Ползва се и при „участвай“, и при проверката за измами,
 * за да няма два различни отговора на един и същ въпрос.
 */
export async function checkQualification(r: RaffleRow, userId: string): Promise<QualificationCheck> {
  const [posts, days, profile] = await Promise.all([
    countQualifyingPosts(r, userId),
    countQualifyingDays(r, userId),
    one<{ created_at: Date; email_verified_at: Date | null }>(
      'select created_at, email_verified_at from profiles where id = $1',
      [userId]
    ),
  ]);

  const daysSince = (v: Date | null | undefined): number =>
    v ? (Date.now() - new Date(v).getTime()) / 86_400_000 : 0;

  const accountAge = daysSince(profile?.created_at);
  const verifiedAge = daysSince(profile?.email_verified_at);

  const out: QualificationCheck = { ok: true, posts, days };

  if (posts < r.condition_posts) {
    out.ok = false;
    out.reason = `Още ${r.condition_posts - posts} находки със снимка ти трябват, за да участваш.`;
    return out;
  }
  if (r.condition_distinct_days > 1 && days < r.condition_distinct_days) {
    out.ok = false;
    out.reason =
      `Находките трябва да са от поне ${r.condition_distinct_days} различни дни ` +
      `(имаш от ${days}). Качвай по няколко на ден — не всичко наведнъж.`;
    return out;
  }
  if (r.min_account_age_days > 0 && accountAge < r.min_account_age_days) {
    const left = Math.ceil(r.min_account_age_days - accountAge);
    out.ok = false;
    out.reason =
      `Профилът ти трябва да е на поне ${r.min_account_age_days} дни, за да участваш. ` +
      `Остават ${left} дни — качвай находки междувременно.`;
    return out;
  }
  if (r.min_verified_age_days > 0 && verifiedAge < r.min_verified_age_days) {
    const left = Math.ceil(r.min_verified_age_days - verifiedAge);
    out.ok = false;
    out.reason = `Имейлът ти трябва да е потвърден от поне ${r.min_verified_age_days} дни. Остават ${left}.`;
    return out;
  }
  return out;
}

/* --------------------------------------------------- синхронен старт */

export interface OfficialWindow {
  /** Зададен ли е синхронен старт (часът е фиксиран от админа). */
  synced: boolean;
  /** Отворено ли е официалното нареждане точно СЕГА. */
  open: boolean;
  opensAt: string | null;
  closesAt: string | null;
  /** Секунди до отваряне (0, ако вече е отворено). */
  opensInSeconds: number;
  /** Секунди до затваряне (0, ако е затворено). */
  closesInSeconds: number;
}

/**
 * Синхронният старт е най-силната защита срещу „много акаунти“: всички играят
 * в един и същи прозорец, значи човек с 5 акаунта пак има само един чифт ръце.
 * Ако админът не е задал час, прозорецът е отворен през цялото време (старото
 * поведение) — така не чупим вече пуснати томболи.
 */
export function officialWindow(r: RaffleRow, now: Date = new Date()): OfficialWindow {
  if (!r.official_opens_at) {
    return {
      synced: false,
      open: true,
      opensAt: null,
      closesAt: null,
      opensInSeconds: 0,
      closesInSeconds: 0,
    };
  }
  const opens = new Date(r.official_opens_at);
  const closes = new Date(opens.getTime() + r.official_window_min * 60_000);
  const t = now.getTime();
  return {
    synced: true,
    open: t >= opens.getTime() && t <= closes.getTime(),
    opensAt: opens.toISOString(),
    closesAt: closes.toISOString(),
    opensInSeconds: Math.max(0, Math.round((opens.getTime() - t) / 1000)),
    closesInSeconds: Math.max(0, Math.round((closes.getTime() - t) / 1000)),
  };
}

/* ------------------------------------------- проверка за злоупотреба */

export interface FraudFlag {
  code: string;
  label: string;
  weight: number;
}

export interface FraudEntry {
  userId: string;
  name: string;
  handle: string;
  email: string;
  city: string;
  signupIp: string | null;
  accountAgeDays: number;
  runTimeMs: number | null;
  disqualified: boolean;
  flags: FraudFlag[];
  score: number;
  risk: 'high' | 'medium' | 'low';
}

const FLAG = {
  sharedReceipt: { code: 'shared_receipt', label: 'Същата касова бележка като друг участник', weight: 50 },
  sharedPhoto: { code: 'shared_photo', label: 'Същата снимка като друг участник', weight: 45 },
  aliasEmail: { code: 'alias_email', label: 'Същият реален имейл (алиас) като друг участник', weight: 40 },
  sharedIp: { code: 'shared_ip', label: 'Едно и също IP като друг участник', weight: 25 },
  youngAccount: { code: 'young_account', label: 'Профилът е по-нов от изискваното', weight: 20 },
  tooFast: { code: 'too_fast', label: 'Подозрително бързо нареждане', weight: 10 },
} as const;

/**
 * Търси злоупотреба сред участниците в томбола.
 *
 * Идеята: не се вярва на нищо подадено от клиента — всички улики идват от
 * базата (бележки, снимки, IP, възраст на профила), а админът вижда кой е
 * съмнителен ПРЕДИ да обяви победител и решава сам.
 */
export async function scanRaffleForFraud(raffle: RaffleRow): Promise<FraudEntry[]> {
  const entrants = await many<{
    user_id: string;
    run_time_ms: number | null;
    disqualified: boolean;
    name: string;
    handle: string;
    email: string;
    email_key: string | null;
    signup_ip: string | null;
    city: string;
    created_at: Date;
  }>(
    `select e.user_id, e.run_time_ms, e.disqualified,
            p.name, p.handle, p.email, p.email_key, p.signup_ip, p.city, p.created_at
       from raffle_entries e
       join profiles p on p.id = e.user_id
      where e.raffle_id = $1
      order by e.run_time_ms asc nulls last`,
    [raffle.id]
  );
  if (!entrants.length) return [];

  // 1) Материални улики: същата касова бележка или същата снимка при двама участници.
  const sharedReceipts = await many<{ a: string; b: string }>(
    `with ea as (
       select e.user_id, r.fingerprint as fp
         from raffle_entries e
         join posts p on p.author_id = e.user_id
         join receipts r on r.post_id = p.id
        where e.raffle_id = $1 and r.fingerprint is not null
     )
     select distinct a.user_id as a, b.user_id as b
       from ea a join ea b on a.fp = b.fp and a.user_id < b.user_id`,
    [raffle.id]
  );

  const sharedPhotos = await many<{ a: string; b: string }>(
    `with ea as (
       select e.user_id, u.content_sha256 as sha
         from raffle_entries e
         join posts p on p.author_id = e.user_id and p.status = 'published'
         join uploads u on u.stored_name = regexp_replace(p.image_url, '^.*/', '')
        where e.raffle_id = $1 and u.content_sha256 is not null
     )
     select distinct a.user_id as a, b.user_id as b
       from ea a join ea b on a.sha = b.sha and a.user_id < b.user_id`,
    [raffle.id]
  );

  // 2) Свързани групи: един и същ реален имейл (алиас) или едно и също IP.
  const byKey = new Map<string, string[]>();
  const byIp = new Map<string, string[]>();
  for (const e of entrants) {
    if (e.email_key) byKey.set(e.email_key, [...(byKey.get(e.email_key) ?? []), e.user_id]);
    if (e.signup_ip) byIp.set(e.signup_ip, [...(byIp.get(e.signup_ip) ?? []), e.user_id]);
  }

  const perUser = new Map<string, FraudFlag[]>();
  const push = (userId: string, flag: FraudFlag) => {
    perUser.set(userId, [...(perUser.get(userId) ?? []), flag]);
  };
  const markGroups = (map: Map<string, string[]>, flag: FraudFlag) => {
    for (const ids of map.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) push(id, flag);
    }
  };
  markGroups(byIp, FLAG.sharedIp);
  markGroups(byKey, FLAG.aliasEmail);

  // Материалните улики сочат ВТОРИЯ участник — първият може да е жертвата,
  // чиято бележка или снимка е прекопирана.
  for (const r of sharedReceipts) push(r.b, FLAG.sharedReceipt);
  for (const r of sharedPhotos) push(r.b, FLAG.sharedPhoto);

  for (const e of entrants) {
    const ageDays = (Date.now() - new Date(e.created_at).getTime()) / 86_400_000;
    if (raffle.min_account_age_days > 0 && ageDays < raffle.min_account_age_days) {
      push(e.user_id, FLAG.youngAccount);
    }
    if (e.run_time_ms != null && e.run_time_ms < 2200) push(e.user_id, FLAG.tooFast);
  }

  const out: FraudEntry[] = entrants.map((e) => {
    const flags = perUser.get(e.user_id) ?? [];
    const score = flags.reduce((s, f) => s + f.weight, 0);
    return {
      userId: e.user_id,
      name: e.name,
      handle: e.handle,
      email: e.email,
      city: e.city,
      signupIp: e.signup_ip,
      accountAgeDays: Math.floor((Date.now() - new Date(e.created_at).getTime()) / 86_400_000),
      runTimeMs: e.run_time_ms,
      disqualified: e.disqualified,
      flags,
      score,
      risk: score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
    };
  });

  return out.sort((a, b) => b.score - a.score);
}

/** Участва ли вече? */
export async function loadEntry(raffleId: string, userId: string) {
  return one<{
    raffle_id: string;
    user_id: string;
    qualified_at: Date;
    practice_used: number;
    best_practice_ms: number | null;
    run_started_at: Date | null;
    run_time_ms: number | null;
    run_finished_at: Date | null;
    official_attempts: number;
    disqualified: boolean;
  }>('select * from raffle_entries where raffle_id = $1 and user_id = $2', [raffleId, userId]);
}

/* ---------------------------------------------------------------- пъзелът */

interface Tile {
  id: string;
  imageUrl: string;
  pairId: string | null;
  label: string;
}

/** Детерминиран shuffle (една и съща дъска за всички). */
function seededShuffle<T>(items: T[], seed: string): T[] {
  const out = [...items];
  let state = parseInt(crypto.createHash('md5').update(seed).digest('hex').slice(0, 8), 16);
  const next = () => {
    // xorshift32 — достатъчно за разбъркване, детерминирано от seed
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = next() % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const pairIdOf = (productKey: string): string =>
  crypto.createHash('md5').update(`sp-puzzle:${productKey}`).digest('hex').slice(0, 10);

/**
 * Дъската: 2 двойки еднакви продукти + разсейващи, общо 12 плочки.
 * Продуктът се разпознава по еднакво име (нормализирано), а към клиента
 * отива само хеш (`pairId`) — не самото име, за да не е подсказка.
 */
export async function buildPuzzle(raffleId: string): Promise<Tile[]> {
  const groups = await many<{ key: string; images: string[]; label: string }>(
    `select lower(btrim(p.title)) as key,
            array_agg(p.image_url order by p.created_at desc) as images,
            min(p.title) as label
       from posts p
      where p.status = 'published'
        and p.image_url is not null and btrim(p.image_url) <> ''
      group by 1
      -- 🎁 По изрична заявка на собственика: предпочитаме ЧИСТИ продуктови
      -- снимки (опаковка на бял фон) — такива идват от вноса от онлайн
      -- магазини. Те са от СЪЩИЯ ВИД като в тренировката, но са си наши,
      -- различни продукти. Ако няма достатъчно, падаме към останалите.
      order by (count(*) filter (where coalesce(p.platform_tag,'') ilike '%магазин%'
                                   or coalesce(p.place_name,'') ilike '%онлайн%')) desc,
               count(*) desc, min(p.created_at) desc
      limit 12`
  );

  const withPairs = groups.filter((g) => g.images.length >= 2);
  const tiles: Tile[] = [];
  let tileSeq = 0;

  for (const group of withPairs.slice(0, PUZZLE_PAIRS)) {
    const pairId = pairIdOf(group.key);
    // Всяка двойка = 2 плочки (различни снимки на СЪЩИЯ продукт — както е в живота).
    for (let i = 0; i < 2; i += 1) {
      tiles.push({
        id: `t${tileSeq++}`,
        imageUrl: group.images[i] ?? group.images[0]!,
        pairId,
        label: group.label,
      });
    }
  }

  // Ако в приложението още няма 2 продукта с по 2 снимки, двойката се прави от
  // ЕДНАКВИ изображения (същият продукт два пъти) — иначе дъската е нерешима.
  while (tiles.length < PUZZLE_PAIRS * 2) {
    const spare = groups.find((g) => !withPairs.slice(0, PUZZLE_PAIRS).includes(g));
    if (!spare) break;
    withPairs.push(spare);
    const pairId = pairIdOf(`${spare.key}#dup`);
    tiles.push({ id: `t${tileSeq++}`, imageUrl: spare.images[0]!, pairId, label: spare.label });
    tiles.push({ id: `t${tileSeq++}`, imageUrl: spare.images[0]!, pairId, label: spare.label });
  }

  // Разсейващи: изображения от други продукти (без да повтаряме вече ползвани).
  const usedKeys = new Set(withPairs.slice(0, PUZZLE_PAIRS).map((g) => g.key));
  const distractors: Tile[] = [];
  for (const group of groups) {
    if (usedKeys.has(group.key)) continue;
    distractors.push({
      id: `d${distractors.length}`,
      imageUrl: group.images[0]!,
      pairId: null,
      label: group.label,
    });
  }

  // Ако приложението още няма достатъчно снимки — дъската се допълва от това, което има,
  // за да не се чупи играта на празна база.
  let pool = [...distractors];
  while (tiles.length + pool.length < PUZZLE_TILES && groups.length > 0) {
    pool = pool.concat(
      groups.map((g, index) => ({
        id: `x${pool.length}_${index}`,
        imageUrl: g.images[0]!,
        pairId: null,
        label: g.label,
      }))
    );
    if (pool.length > 60) break;
  }

  const needed = Math.max(0, PUZZLE_TILES - tiles.length);
  const chosen = pool.slice(0, needed).map((t, index) => ({ ...t, id: `d${index}` }));

  return seededShuffle([...tiles, ...chosen], raffleId).map((t, index) => ({
    ...t,
    id: `tile-${index}`,
  }));
}

/* ------------------------------------------------------------- статистики */

export async function loadRaffle(id: string): Promise<RaffleRow> {
  const row = await one<RaffleRow>('select * from raffles where id = $1', [id]);
  if (!row) throw notFound('Томболата не е намерена.');
  return row;
}

export async function standings(raffleId: string, limit = 50) {
  const rows = await many<{
    user_id: string;
    name: string;
    handle: string;
    avatar_url: string | null;
    run_time_ms: number | null;
    practice_used: number;
    best_practice_ms: number | null;
    qualified_at: Date;
    run_finished_at: Date | null;
    disqualified: boolean;
  }>(
    `select e.user_id, p.name, p.handle, p.avatar_url,
            e.run_time_ms, e.practice_used, e.best_practice_ms,
            e.qualified_at, e.run_finished_at, e.disqualified
       from raffle_entries e
       join profiles p on p.id = e.user_id
      where e.raffle_id = $1
      order by (e.run_time_ms is null), e.run_time_ms asc, e.qualified_at asc
      limit $2`,
    [raffleId, limit]
  );
  return rows.map((r, index) => ({
    rank: r.run_time_ms != null ? index + 1 : null,
    userId: r.user_id,
    name: r.name,
    handle: r.handle,
    avatar: r.avatar_url ?? '',
    runTimeMs: r.run_time_ms,
    practiceUsed: r.practice_used,
    bestPracticeMs: r.best_practice_ms,
    qualifiedAt: iso(r.qualified_at),
    runFinishedAt: iso(r.run_finished_at),
    disqualified: r.disqualified,
  }));
}

/* ------------------------------------------------- прозрачни резултати */

/**
 * Пълните резултати от една томбола — за ВСИЧКИ, не само за участниците.
 *
 * Защо: ако човек загуби и не вижда нищо, той си мисли, че е измамен. Затова
 * след края се показва всичко: кой за колко време се е справил, кога е играл,
 * колко тренировки е използвал, колко души са отстранени и защо, и целият
 * одитен дневник на томболата.
 *
 * ВАЖНО (поверителност): НЕ излизат имейли, телефони и IP-та. Отстранените
 * участници НЕ се посочват поименно — показва се само броят. Причина: човек,
 * отстранен по погрешка, не бива да бъде заклеймяван публично. Причината се
 * вижда само в админ панела.
 */
export interface RaffleResults {
  final: boolean;
  /** Сайтът в демо режим ли е. Когато НЕ е, демо участниците се показват като демо. */
  demoMode: boolean;
  winner: {
    userId: string;
    name: string;
    handle: string;
    avatar: string;
    timeMs: number | null;
    /** Демо (тестов) играч — не е реален човек. */
    isDemo: boolean;
  } | null;
  stats: {
    participants: number;
    finished: number;
    disqualified: number;
    fastestMs: number | null;
    averageMs: number | null;
    slowestMs: number | null;
    practiceUsedTotal: number;
  };
  rows: {
    rank: number | null;
    userId: string;
    name: string;
    handle: string;
    avatar: string;
    runTimeMs: number | null;
    practiceUsed: number;
    bestPracticeMs: number | null;
    joinedAt: string;
    runFinishedAt: string | null;
    disqualified: boolean;
    /** Демо (тестов) играч — не е реален човек. */
    isDemo: boolean;
  }[];
  /** Одитен дневник: какво се е случило и кога, без вътрешните подробности. */
  timeline: { kind: string; label: string; at: string; user: string | null; timeMs: number | null }[];
}

const EVENT_LABEL: Record<string, string> = {
  created: 'Томболата е създадена',
  status: 'Промяна на статуса',
  joined: 'Включи се в томболата',
  run_started: 'Стартира официалното нареждане',
  run_finished: 'Завърши официалното нареждане',
  run_too_fast: 'Опит с невъзможно време — не се брои',
  disqualified_by_admin: 'Отстранен след проверка за злоупотреба',
  requalified_by_admin: 'Върнат обратно след проверка',
  demo_enabled: 'Включен демо играч (тест)',
  demo_disabled: 'Изключен демо играч',
  demo_played: 'Демо играчът изигра нареждането — тестово участие',
  cancelled: 'Томболата е анулирана',
  drawn: 'Разиграна — има победител',
};

export async function raffleResults(raffle: RaffleRow): Promise<RaffleResults> {
  const demoMode = await isDemoMode();
  const rows = await many<{
    user_id: string;
    name: string;
    handle: string;
    avatar_url: string | null;
    run_time_ms: number | null;
    practice_used: number;
    best_practice_ms: number | null;
    qualified_at: Date;
    run_finished_at: Date | null;
    disqualified: boolean;
    is_demo: boolean;
  }>(
    `select e.user_id, p.name, p.handle, p.avatar_url,
            e.run_time_ms, e.practice_used, e.best_practice_ms,
            e.qualified_at, e.run_finished_at, e.disqualified, e.is_demo
       from raffle_entries e
       join profiles p on p.id = e.user_id
      where e.raffle_id = $1
      order by (e.run_time_ms is null), e.run_time_ms asc, e.qualified_at asc`,
    [raffle.id]
  );

  const valid = rows.filter((r) => !r.disqualified && r.run_time_ms != null);
  const times = valid.map((r) => Number(r.run_time_ms)).sort((a, b) => a - b);
  const avg = times.length ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null;

  let rank = 0;
  const mapped = rows.map((r) => {
    const counted = !r.disqualified && r.run_time_ms != null;
    if (counted) rank += 1;
    return {
      rank: counted ? rank : null,
      userId: r.user_id,
      name: r.name,
      handle: r.handle,
      avatar: r.avatar_url ?? '',
      runTimeMs: r.run_time_ms,
      practiceUsed: r.practice_used,
      bestPracticeMs: r.best_practice_ms,
      joinedAt: iso(r.qualified_at)!,
      runFinishedAt: iso(r.run_finished_at),
      disqualified: r.disqualified,
      isDemo: r.is_demo,
    };
  });

  const winnerRow = raffle.winner_id ? mapped.find((m) => m.userId === raffle.winner_id) ?? null : null;

  // Одитът се показва само след края — преди това би издал кой още не е играл.
  const final = ['finished', 'cancelled'].includes(effectiveStatus(raffle));
  const timeline: RaffleResults['timeline'] = [];
  if (final) {
    const events = await many<{ kind: string; created_at: Date; name: string | null; detail: Record<string, unknown> }>(
      `select v.kind, v.created_at, p.name, v.detail
         from raffle_events v
         left join profiles p on p.id = v.user_id
        where v.raffle_id = $1
        order by v.created_at asc
        limit 500`,
      [raffle.id]
    );
    for (const e of events) {
      const label = EVENT_LABEL[e.kind] ?? null;
      if (!label) continue;
      const detailMs =
        e.kind === 'run_finished' || e.kind === 'run_too_fast'
          ? Number((e.detail as { timeMs?: number })?.timeMs ?? 0) || null
          : null;
      timeline.push({ kind: e.kind, label, at: iso(e.created_at)!, user: e.name ?? null, timeMs: detailMs });
    }
  }

  return {
    final,
    demoMode,
    winner: winnerRow
      ? {
          userId: winnerRow.userId,
          name: winnerRow.name,
          handle: winnerRow.handle,
          avatar: winnerRow.avatar,
          timeMs: winnerRow.runTimeMs,
          isDemo: winnerRow.isDemo,
        }
      : null,
    stats: {
      participants: rows.length,
      finished: valid.length,
      disqualified: rows.filter((r) => r.disqualified).length,
      fastestMs: times[0] ?? null,
      averageMs: avg,
      slowestMs: times.length ? times[times.length - 1]! : null,
      practiceUsedTotal: rows.reduce((s, r) => s + (r.practice_used ?? 0), 0),
    },
    rows: mapped,
    timeline,
  };
}

/* ------------------------------------------------- демо (тестов) играч */

export const DEMO_PLAYER_EMAIL = 'demo.player@smartprice.local';
const DEMO_PLAYER_NAME = 'Демо Играч';

/**
 * Профилът на ДЕМО играча — тестов участник, който админът може да включи в
 * томбола, за да види как изглежда победа (или за проби преди пускане).
 *
 * ВАЖНО: профилът е маркиран `is_demo`, значи не е реален човек и това се
 * вижда — в панела, в публичните резултати (значка „демо“) и в одитния
 * дневник. Така играчите не биват подвеждани, че печели истински човек.
 * Паролата е невалидна нарочно — с този профил НЕ може да се влезе.
 */
export async function getOrCreateDemoPlayer(): Promise<{ id: string; name: string; handle: string }> {
  const existing = await one<{ id: string; name: string; handle: string; is_demo: boolean }>(
    'select id, name, handle, is_demo from profiles where is_demo or email = $1 order by created_at limit 1',
    [DEMO_PLAYER_EMAIL]
  );
  if (existing) {
    if (!existing.is_demo) {
      await query('update profiles set is_demo = true where id = $1', [existing.id]);
    }
    return { id: existing.id, name: existing.name, handle: existing.handle };
  }

  // Паролата е нарочно невалидна (не е bcrypt хеш) — вход с този профил не работи.
  const passwordHash = `demo-disabled-${crypto.randomBytes(24).toString('hex')}`;

  let handle = '@demo';
  for (let i = 0; i < 30; i += 1) {
    const candidate = i === 0 ? handle : `@demo${i + 1}`;
    const taken = await one('select 1 from profiles where handle = $1', [candidate]);
    if (!taken) {
      handle = candidate;
      break;
    }
  }

  const row = await one<{ id: string }>(
    `insert into profiles (email, email_key, password_hash, name, handle, city, email_verified_at, is_demo)
     values ($1,$2,$3,$4,$5,'София', now(), true)
     returning id`,
    [DEMO_PLAYER_EMAIL, DEMO_PLAYER_EMAIL, passwordHash, DEMO_PLAYER_NAME, handle]
  );
  const id = row!.id;
  await query(
    `insert into profile_badges (profile_id, badge_id)
     select $1, id from badges on conflict do nothing`,
    [id]
  );
  return { id, name: DEMO_PLAYER_NAME, handle };
}

/**
 * Прави демо играча да изглежда като истински човек — име, град, снимка.
 *
 * Защо е позволено: в ДЕМО РЕЖИМ трябва да се види точно как ще изглежда
 * победа на реален участник (за проби и за снимки). Профилът пак остава
 * маркиран is_demo в базата и в админ дневника — не се губи следата.
 */
export async function updateDemoProfile(input: {
  name?: string;
  city?: string;
  avatarUrl?: string | null;
}): Promise<{ id: string; name: string; handle: string; city: string; avatarUrl: string | null }> {
  const player = await getOrCreateDemoPlayer();
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (sql: string, value: unknown) => {
    values.push(value);
    sets.push(`${sql} = $${values.length}`);
  };
  if (input.name?.trim()) push('name', input.name.trim());
  if (input.city?.trim()) push('city', input.city.trim());
  if (input.avatarUrl !== undefined) push('avatar_url', input.avatarUrl || null);
  if (sets.length) {
    values.push(player.id);
    await query(`update profiles set ${sets.join(', ')} where id = $${values.length}`, values);
  }
  const row = await one<{ id: string; name: string; handle: string; city: string; avatar_url: string | null }>(
    'select id, name, handle, city, avatar_url from profiles where id = $1',
    [player.id]
  );
  return {
    id: row!.id,
    name: row!.name,
    handle: row!.handle,
    city: row!.city,
    avatarUrl: row!.avatar_url,
  };
}

export interface DemoState {
  raffleId: string;
  enabled: boolean;
  player: { id: string; name: string; handle: string } | null;
  /** Сайтът в демо режим ли е (само тогава демо играч може да участва). */
  demoMode: boolean;
}

/** Включен ли е демо играчът в тази томбола? */
export async function loadRaffleDemo(raffleId: string): Promise<DemoState> {
  const demoMode = await isDemoMode();
  const row = await one<{ user_id: string; name: string; handle: string }>(
    `select e.user_id, p.name, p.handle
       from raffle_entries e
       join profiles p on p.id = e.user_id
      where e.raffle_id = $1 and e.is_demo
      limit 1`,
    [raffleId]
  );
  if (!row) return { raffleId, enabled: false, player: null, demoMode };
  return {
    raffleId,
    enabled: true,
    player: { id: row.user_id, name: row.name, handle: row.handle },
    demoMode,
  };
}

/** Включва/изключва демо играча за дадена томбола. */
export async function setRaffleDemo(raffle: RaffleRow, enabled: boolean): Promise<DemoState> {
  if (!enabled) {
    await query('delete from raffle_entries where raffle_id = $1 and is_demo', [raffle.id]);
    await logEvent(raffle.id, null, 'demo_disabled');
    return loadRaffleDemo(raffle.id);
  }

  // ЗАЩИТА: демо играч може да участва САМО докато сайтът е в демо режим.
  // В реален режим реалните хора не бива да виждат измислен победител —
  // това е подвеждане (и в БГ/ЕС може да е нелоялна търговска практика).
  if (!(await isDemoMode())) {
    throw badRequest(
      'Демо играч може да се включи само в ДЕМО РЕЖИМ. Включи демо режима от „🎭 Демо играч“ — ' +
        'той е за проби и демонстрации, докато сайтът не е на живо.'
    );
  }

  const player = await getOrCreateDemoPlayer();
  await query(
    `insert into raffle_entries (raffle_id, user_id, posts_count, qualified_at, is_demo)
     values ($1,$2,$3, now(), true)
     on conflict (raffle_id, user_id) do update set is_demo = true`,
    [raffle.id, player.id, raffle.condition_posts]
  );
  await logEvent(raffle.id, player.id, 'demo_enabled', { name: player.name });
  return loadRaffleDemo(raffle.id);
}

/**
 * Дава на демо играча време, което изпреварва най-доброто РЕАЛНО време.
 *
 * Защо точно така: времето трябва да изглежда възможно и близко до
 * постижимото — ако е 0.4 секунди или под прага MIN_RUN_MS, всеки вижда, че
 * е нагласено. Затова изпреварва с 0.3–1.5 с и никога не слиза под прага.
 */
export async function playDemoEntry(raffleId: string): Promise<number | null> {
  // Втора проверка (освен при включването) — ако режимът е изключен след
  // включването на играча, той не играе и не печели.
  if (!(await isDemoMode())) return null;

  const demo = await one<{ user_id: string }>(
    'select user_id from raffle_entries where raffle_id = $1 and is_demo limit 1',
    [raffleId]
  );
  if (!demo) return null;

  const bestReal = await one<{ t: number | null }>(
    `select min(run_time_ms) as t from raffle_entries
      where raffle_id = $1 and not disqualified and not is_demo and run_time_ms is not null`,
    [raffleId]
  );
  const best = Number(bestReal?.t ?? 0);

  const target =
    best > 0
      ? Math.max(MIN_RUN_MS, best - (300 + Math.floor(Math.random() * 1200)))
      : MIN_RUN_MS + 2500 + Math.floor(Math.random() * 4000);

  await query(
    `update raffle_entries
        set run_time_ms = $3,
            run_started_at = coalesce(run_started_at, now()),
            run_finished_at = now(),
            official_attempts = 1,
            disqualified = false
      where raffle_id = $1 and user_id = $2 and is_demo`,
    [raffleId, demo.user_id, target]
  );
  await logEvent(raffleId, demo.user_id, 'demo_played', { timeMs: target });
  return target;
}

/** Стена на печелившите: кой, кога, каква награда (за мотивация на всички). */
export async function winnersWall(limit = 20) {
  const rows = await many<{
    id: string;
    title: string;
    prize_title: string;
    prize_image_url: string | null;
    finished_at: Date;
    winning_time_ms: number | null;
    name: string | null;
    handle: string | null;
    avatar_url: string | null;
  }>(
    `select r.id, r.title, r.prize_title, r.prize_image_url, r.finished_at, r.winning_time_ms,
            p.name, p.handle, p.avatar_url
       from raffles r
       left join profiles p on p.id = r.winner_id
      where r.status = 'finished' and r.winner_id is not null
      order by r.finished_at desc
      limit $1`,
    [limit]
  );
  return rows.map((r) => ({
    raffleId: r.id,
    title: r.title,
    prizeTitle: r.prize_title,
    prizeImage: r.prize_image_url ?? '',
    finishedAt: iso(r.finished_at),
    winningTimeMs: r.winning_time_ms,
    winner: r.name ? { name: r.name, handle: r.handle ?? '', avatar: r.avatar_url ?? '' } : null,
  }));
}

/** Разиграване: най-бързото ЗАВЪРШЕНО официално нареждане печели. */
export async function drawWinner(raffleId: string) {
  const raffle = await loadRaffle(raffleId);
  if (raffle.status === 'finished') throw badRequest('Тази томбола вече е разиграна.');

  // Ако админът е включил демо играч, той „изиграва“ нареждането ТУК — точно
  // преди тегленето и след като всички реални времена са известни. Така
  // изпреварва реалния лидер, без да слиза под прага за невъзможно време.
  await playDemoEntry(raffleId);

  const countRow = await one<{ n: number }>(
    `select count(*) as n from raffle_entries
      where raffle_id = $1 and not disqualified and run_time_ms is not null and run_time_ms >= $2`,
    [raffleId, MIN_RUN_MS]
  );
  const finished = Number(countRow?.n ?? 0);

  if (finished < raffle.min_participants) {
    await query(
      `update raffles set status = 'cancelled', cancel_reason = $2,
              qualified_count = $3, finished_at = now(), updated_at = now()
        where id = $1`,
      [raffleId, `Само ${finished} от нужните ${raffle.min_participants} завършиха пъзела.`, finished]
    );
    await logEvent(raffleId, null, 'cancelled', { finished, min: raffle.min_participants });
    return { cancelled: true as const, finished, min: raffle.min_participants };
  }

  const winner = await one<{ user_id: string; run_time_ms: number }>(
    `select user_id, run_time_ms from raffle_entries
      where raffle_id = $1 and not disqualified and run_time_ms is not null and run_time_ms >= $2
      order by run_time_ms asc limit 1`,
    [raffleId, MIN_RUN_MS]
  );

  await query(
    `update raffles set status = 'finished', winner_id = $2, winning_time_ms = $3,
            qualified_count = $4, finished_at = now(), updated_at = now()
      where id = $1`,
    [raffleId, winner!.user_id, winner!.run_time_ms, finished]
  );

  await query(
    `insert into profile_badges (profile_id, badge_id, unlocked_at)
     values ($1, 'badge-raffle-win', now())
     on conflict (profile_id, badge_id) do update set unlocked_at = now()`,
    [winner!.user_id]
  );
  await logEvent(raffleId, winner!.user_id, 'won', { timeMs: winner!.run_time_ms, finished });

  return { cancelled: false as const, winnerId: winner!.user_id, timeMs: winner!.run_time_ms, finished };
}

export async function logEvent(
  raffleId: string,
  userId: string | null,
  kind: string,
  detail: Record<string, unknown> = {},
  isPublic = false
): Promise<void> {
  await query(
    `insert into raffle_events (raffle_id, user_id, kind, detail, is_public)
     values ($1,$2,$3,$4,$5)`,
    [raffleId, userId, kind, JSON.stringify(detail), isPublic]
  );
}

/** Колко пъти сме показали рекламата и дали е редно да я покажем пак. */
/** Между две показвания минават поне 4 часа — иначе рекламата дразни. */
const PROMO_MIN_GAP_MS = 4 * 60 * 60 * 1000;

export async function promoState(userId: string, raffleId: string) {
  const entry = await loadEntry(raffleId, userId);
  const row = await one<{ views: number; last_shown_at: Date }>(
    'select views, last_shown_at from raffle_promo_views where raffle_id = $1 and user_id = $2',
    [raffleId, userId]
  );
  const views = Number(row?.views ?? 0);
  const lastShown = row?.last_shown_at ? new Date(row.last_shown_at).getTime() : 0;
  const gapPassed = Date.now() - lastShown >= PROMO_MIN_GAP_MS;
  return {
    views,
    maxViews: PROMO_MAX_VIEWS,
    participating: Boolean(entry),
    shouldShow: !entry && views < PROMO_MAX_VIEWS && gapPassed,
    nextAllowedInMs: Math.max(0, PROMO_MIN_GAP_MS - (Date.now() - lastShown)),
  };
}

/** Проверка на админ правата (роля в базата ИЛИ имейл в ADMIN_EMAILS). */
export async function requireAdmin(userId: string): Promise<{ id: string; email: string; name: string }> {
  const profile = await one<{ id: string; email: string; role: string; name: string }>(
    'select id, email, role, name from profiles where id = $1',
    [userId]
  );
  if (!profile) throw notFound('Профилът не е намерен.');
  if (profile.role === 'admin' || isAdminEmail(profile.email)) {
    return { id: profile.id, email: profile.email, name: profile.name };
  }
  throw forbidden('Само администратор може да управлява томболи.');
}
