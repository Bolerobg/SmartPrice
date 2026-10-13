import crypto from 'node:crypto';
import { env } from '../env.js';
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
      order by count(*) desc, min(p.created_at) desc
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
  detail: Record<string, unknown> = {}
): Promise<void> {
  await query('insert into raffle_events (raffle_id, user_id, kind, detail) values ($1,$2,$3,$4)', [
    raffleId,
    userId,
    kind,
    JSON.stringify(detail),
  ]);
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
