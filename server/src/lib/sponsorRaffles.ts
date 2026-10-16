/**
 * Томболи със спонсор — „Събери N находки и вземи <продукт>“.
 *
 * Защо е отделен файл: старите томболи се печелят с пъзел за време (най-бързото
 * нареждане в синхронен прозорец). Тук режимът е друг — първият, който изпълни
 * условието, печели ВЕДНАГА. Логиката е отделена, за да не се чупи старото.
 *
 * Три неща, които го правят честно:
 *   1. условието се проверява в базата (N находки със снимка от ≥2 различни дни);
 *   2. победителят се определя в транзакция със заключване на реда — при 10
 *      едновременни „аз първи“ само един може да стане победител;
 *   3. всичко се записва в raffle_events и се вижда публично — кой, кога, защо.
 */
import { many, one, query, tx } from '../db.js';
import { badRequest, forbidden, notFound } from './errors.js';
import { sendRaffleDeliveryEmail, sendRaffleWonEmail } from './email.js';
import {
  checkQualification,
  countQualifyingDays,
  countQualifyingPosts,
  effectiveStatus,
  loadRaffle,
  logEvent,
  type RaffleRow,
} from './raffles.js';

/* ------------------------------------------------------------------ помощни */

const iso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/** Полетата на спонсорската томбола (новите от миграция 021). */
export interface SponsorExtras {
  sponsor_name: string | null;
  sponsor_url: string | null;
  rules_text: string;
  sponsored_note: string | null;
  sponsor_contact: string | null;
  prize_kind: string;
  prize_value_eur: number | null;
  delivery_note: string;
  win_mode: 'fastest_puzzle' | 'first_to_complete';
  queue_order: number;
  auto_activate_next: boolean;
  claim_deadline_days: number;
  closed_reason: string | null;
  activated_at: Date | null;
}

export type SponsorRaffleRow = RaffleRow & SponsorExtras;

export async function loadSponsorRaffle(id: string): Promise<SponsorRaffleRow> {
  const row = await one<SponsorRaffleRow>(
    `select r.*,
            coalesce(sponsor_name, '') as sponsor_name_clean
       from raffles r where r.id = $1`,
    [id]
  );
  if (!row) throw notFound('Томболата не е намерена.');
  return row;
}

/** Публичен изглед: без вътрешните бележки за спонсора. */
export function publicRaffle(r: SponsorRaffleRow) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    prizeTitle: r.prize_title,
    prizeImage: r.prize_image_url ?? '',
    prizeUrl: r.prize_url ?? '',
    prizeKind: r.prize_kind,
    prizeValueEur: r.prize_value_eur == null ? null : Number(r.prize_value_eur),
    sponsor: r.sponsor_name
      ? { name: r.sponsor_name, url: r.sponsor_url ?? '' }
      : null,
    rules: r.rules_text,
    deliveryNote: r.delivery_note,
    winMode: r.win_mode,
    conditionPosts: r.condition_posts,
    conditionDays: r.condition_distinct_days,
    claimDeadlineDays: r.claim_deadline_days,
    status: effectiveStatus(r),
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    finishedAt: iso(r.finished_at),
    winnerId: r.winner_id,
    queueOrder: r.queue_order,
  };
}

/* ---------------------------------------------------------------- прогрес */

export interface RaffleProgress {
  posts: number;
  days: number;
  needPosts: number;
  needDays: number;
  /** Изпълнено ли е условието (без праговете за стаж на профила). */
  conditionMet: boolean;
  /** Пълно ли е всичко, включително праговете за стаж/потвърден имейл. */
  qualified: boolean;
  reason: string;
}

export async function raffleProgress(r: RaffleRow, userId: string): Promise<RaffleProgress> {
  const [posts, days, check] = await Promise.all([
    countQualifyingPosts(r, userId),
    countQualifyingDays(r, userId),
    checkQualification(r, userId),
  ]);
  const conditionMet = posts >= r.condition_posts && days >= r.condition_distinct_days;
  return {
    posts,
    days,
    needPosts: r.condition_posts,
    needDays: r.condition_distinct_days,
    conditionMet,
    qualified: check.ok,
    reason: check.ok
      ? 'Условието е изпълнено.'
      : check.reason ?? 'Условието още не е изпълнено.',
  };
}

/* ------------------------------------------------------------ печалба */

/** Пуска следващата томбола от опашката (различна награда). */
export async function activateNextRaffle(afterOrder: number, excludeId: string) {
  const next = await one<{ id: string; title: string }>(
    `select id, title from raffles
      where status = 'draft' and id <> $2 and queue_order >= $1
        and ends_at > now()
      order by queue_order asc, starts_at asc
      limit 1`,
    [afterOrder, excludeId]
  );
  if (!next) return null;
  await query(
    `update raffles
        set status = 'active', activated_at = now(), updated_at = now()
      where id = $1 and status = 'draft'`,
    [next.id]
  );
  await logEvent(next.id, null, 'activated', { reason: 'след спечелена томбола' });
  return next;
}

/**
 * Обявява победител и затваря томболата.
 *
 * Транзакция със `for update` върху реда на томболата: ако двама едновременно
 * изпълнят условието, вторият вижда, че вече има победител, и не прави нищо.
 */
export async function declareWinner(params: {
  raffleId: string;
  userId: string;
  decidedBy?: 'auto' | 'admin' | 'replacement';
}) {
  const { raffleId, userId, decidedBy = 'auto' } = params;

  const result = await tx(async (client) => {
    const locked = await client.query<SponsorRaffleRow>(
      'select * from raffles where id = $1 for update',
      [raffleId]
    );
    const raffle = locked.rows[0];
    if (!raffle) throw notFound('Томболата не е намерена.');
    if (raffle.winner_id || raffle.status === 'finished') {
      return { already: true as const, winnerId: raffle.winner_id };
    }

    await client.query(
      `update raffles
          set status = 'finished', winner_id = $2, finished_at = now(),
              closed_reason = 'won', updated_at = now()
        where id = $1`,
      [raffleId, userId]
    );
    await client.query(
      `insert into raffle_wins (raffle_id, user_id, decided_by, status)
       values ($1, $2, $3, 'pending_data')
       on conflict (raffle_id) do nothing`,
      [raffleId, userId, decidedBy]
    );
    await client.query(
      `insert into profile_badges (profile_id, badge_id, unlocked_at)
       values ($1, 'badge-raffle-win', now())
       on conflict (profile_id, badge_id) do update set unlocked_at = now()`,
      [userId]
    );
    return { already: false as const, raffle };
  });

  if (result.already) return result;

  await logEvent(raffleId, userId, 'won', { decidedBy, mode: result.raffle.win_mode }, true);

  // Следващата томбола — различна награда.
  let activated: { id: string; title: string } | null = null;
  if (result.raffle.auto_activate_next) {
    activated = await activateNextRaffle(result.raffle.queue_order + 1, raffleId);
  }

  const winner = await one<{ name: string; email: string }>(
    'select name, email from profiles where id = $1',
    [userId]
  );
  if (winner) {
    void sendRaffleWonEmail({
      to: winner.email,
      name: winner.name,
      prizeTitle: result.raffle.prize_title,
      sponsorName: result.raffle.sponsor_name ?? '',
      raffleTitle: result.raffle.title,
      claimDeadlineDays: result.raffle.claim_deadline_days,
      deliveryNote: result.raffle.delivery_note,
    }).catch(() => undefined);
  }

  return { already: false as const, winnerId: userId, activated };
}

/**
 * Проверява дали потребителят току-що е изпълнил условието на активна томбола
 * от типа „първият, който събере N находки“. Извиква се след всяка публикация.
 */
export async function checkFirstToComplete(userId: string) {
  const rows = await many<SponsorRaffleRow>(
    `select * from raffles
      where win_mode = 'first_to_complete'
        and status = 'active'
        and winner_id is null
        and starts_at <= now()
        and ends_at > now()
        and created_by is distinct from $1
      order by queue_order asc, starts_at asc`,
    [userId]
  );

  const won: Array<{ raffleId: string; title: string; prizeTitle: string }> = [];
  for (const raffle of rows) {
    const check = await checkQualification(raffle, userId);
    if (!check.ok) continue;
    const res = await declareWinner({ raffleId: raffle.id, userId, decidedBy: 'auto' });
    if (!res.already) {
      won.push({ raffleId: raffle.id, title: raffle.title, prizeTitle: raffle.prize_title });
    }
  }
  return won;
}

/* ------------------------------------------------- данни за доставка */

export async function claimWin(params: {
  raffleId: string;
  userId: string;
  name: string;
  phone: string;
  city: string;
  address: string;
  note?: string;
}) {
  const win = await one<{ id: string; status: string; won_at: Date }>(
    'select id, status, won_at from raffle_wins where raffle_id = $1 and user_id = $2',
    [params.raffleId, params.userId]
  );
  if (!win) throw forbidden('Не си победител в тази томбола.');
  if (win.status === 'expired') {
    throw badRequest('Срокът за получаване изтече. Свържи се с нас, ако смяташ, че е грешка.');
  }

  const raffle = await one<{ claim_deadline_days: number }>(
    'select claim_deadline_days from raffles where id = $1',
    [params.raffleId]
  );
  const deadlineDays = raffle?.claim_deadline_days ?? 7;
  const ageDays = (Date.now() - new Date(win.won_at).getTime()) / 86_400_000;
  if (ageDays > deadlineDays && win.status === 'pending_data') {
    throw badRequest(
      `Срокът от ${deadlineDays} дни изтече. Пиши ни и ще намерим решение.`
    );
  }

  await query(
    `update raffle_wins
        set delivery_name = $2, delivery_phone = $3, delivery_city = $4,
            delivery_address = $5, delivery_note = $6,
            claimed_at = now(), status = 'ready_to_ship', updated_at = now()
      where id = $1`,
    [
      win.id,
      params.name.trim(),
      params.phone.trim(),
      params.city.trim(),
      params.address.trim(),
      params.note?.trim() || null,
    ]
  );
  await logEvent(params.raffleId, params.userId, 'delivery_sent', {}, true);

  // Писмо до организатора с готовите данни за куриера — иначе ще се загубят.
  const info = await one<{
    prize_title: string;
    sponsor_name: string | null;
    email: string;
    name: string;
    phone: string;
  }>(
    `select r.prize_title, r.sponsor_name, p.email, p.name, coalesce(p.phone, '') as phone
       from raffles r join profiles p on p.id = $2 where r.id = $1`,
    [params.raffleId, params.userId]
  );
  if (info) {
    void sendRaffleDeliveryEmail({
      winnerName: params.name,
      winnerHandle: info.name,
      winnerEmail: info.email,
      prizeTitle: info.prize_title,
      sponsorName: info.sponsor_name ?? '',
      city: params.city,
      address: params.address,
      phone: params.phone,
      note: params.note ?? '',
    }).catch(() => undefined);
  }

  return { ok: true };
}

/** Данни за доставка — само за админа или за самия победител. */
export async function getWin(raffleId: string, userId: string, isAdmin: boolean) {
  const row = await one<Record<string, unknown>>(
    `select w.*, p.name as winner_name, p.handle as winner_handle, r.title, r.prize_title,
            r.sponsor_name, r.delivery_note
       from raffle_wins w
       join profiles p on p.id = w.user_id
       join raffles r on r.id = w.raffle_id
      where w.raffle_id = $1`,
    [raffleId]
  );
  if (!row) throw notFound('Няма печалба за тази томбола.');
  if (!isAdmin && row.user_id !== userId) throw forbidden('Лични данни.');
  return {
    raffleId,
    winnerName: row.winner_name,
    winnerHandle: row.winner_handle,
    prizeTitle: row.prize_title,
    sponsorName: row.sponsor_name ?? '',
    deliveryNote: row.delivery_note ?? '',
    status: row.status,
    wonAt: iso(row.won_at as Date),
    claimedAt: iso(row.claimed_at as Date | null),
    delivery:
      isAdmin || row.user_id === userId
        ? {
            name: row.delivery_name,
            phone: row.delivery_phone,
            city: row.delivery_city,
            address: row.delivery_address,
            note: row.delivery_note,
          }
        : null,
    shippedAt: iso(row.shipped_at as Date | null),
    trackingNote: row.tracking_note,
    isMine: row.user_id === userId,
  };
}

/**
 * Победителят не е дал адрес навреме → наградата отива при следващия
 * в класирането. Без това наградата увисва завинаги.
 */
export async function giveToNextInLine(raffleId: string) {
  const current = await one<{ id: string; user_id: string; status: string }>(
    'select id, user_id, status from raffle_wins where raffle_id = $1',
    [raffleId]
  );
  if (!current) throw badRequest('Тази томбола няма записана печалба.');
  if (current.status === 'shipped' || current.status === 'delivered') {
    throw badRequest('Наградата вече е изпратена — не може да се прехвърля.');
  }

  const next = await one<{ user_id: string; name: string }>(
    `select e.user_id, p.name
       from raffle_entries e
       join profiles p on p.id = e.user_id
      where e.raffle_id = $1
        and e.user_id <> $2
        and not e.disqualified
      order by e.qualified_at asc
      limit 1`,
    [raffleId, current.user_id]
  );
  if (!next) throw badRequest('Няма друг участник, на когото да дадем наградата.');

  await tx(async (client) => {
    await client.query(
      `update raffle_wins set status = 'expired', admin_note = coalesce(admin_note,'') ||
              ' | прехвърлена на следващия', updated_at = now()
        where id = $1`,
      [current.id]
    );
    await client.query(
      `insert into raffle_wins (raffle_id, user_id, decided_by, status)
       values ($1, $2, 'replacement', 'pending_data')
       on conflict (raffle_id) do update
         set user_id = excluded.user_id, decided_by = 'replacement',
             status = 'pending_data', won_at = now(),
             delivery_name = null, delivery_phone = null, delivery_city = null,
             delivery_address = null, delivery_note = null, claimed_at = null,
             updated_at = now()`,
      [raffleId, next.user_id]
    );
    await client.query(
      'update raffles set winner_id = $2, updated_at = now() where id = $1',
      [raffleId, next.user_id]
    );
  });

  await logEvent(raffleId, next.user_id, 'won', { decidedBy: 'replacement' }, true);
  return { ok: true, next: next.name };
}

/** Автоматично изтичане на неполучените награди (вика се от админ панела). */
export async function expireStaleWins() {
  const rows = await many<{ id: string; raffle_id: string; name: string }>(
    `select w.id, w.raffle_id, p.name
       from raffle_wins w
       join profiles p on p.id = w.user_id
       join raffles r on r.id = w.raffle_id
      where w.status = 'pending_data'
        and w.won_at < now() - (r.claim_deadline_days || ' days')::interval`
  );
  for (const row of rows) {
    await query(
      `update raffle_wins set status = 'expired', admin_note = coalesce(admin_note,'') ||
              ' | срокът изтече', updated_at = now()
        where id = $1`,
      [row.id]
    );
    await logEvent(row.raffle_id, null, 'claim_expired', { winner: row.name });
  }
  return rows.length;
}

/* ------------------------------------------------------- прозрачност */

/** Моите томболи: в кои съм участвал, какъв е резултатът, кой е спечелил. */
export async function myRaffles(userId: string) {
  const rows = await many<{
    id: string;
    title: string;
    prize_title: string;
    prize_image_url: string | null;
    sponsor_name: string | null;
    status: string;
    win_mode: string;
    condition_posts: number;
    condition_distinct_days: number;
    starts_at: Date;
    ends_at: Date;
    finished_at: Date | null;
    qualified_at: Date;
    posts_count: number;
    run_time_ms: number | null;
    disqualified: boolean;
    i_won: boolean;
    win_status: string | null;
    winner_name: string | null;
    winner_city: string | null;
  }>(
    `select r.id, r.title, r.prize_title, r.prize_image_url, r.sponsor_name,
            r.status, r.win_mode, r.condition_posts, r.condition_distinct_days,
            r.starts_at, r.ends_at, r.finished_at,
            e.qualified_at, e.posts_count, e.run_time_ms, e.disqualified,
            (r.winner_id = $1) as i_won,
            w.status as win_status,
            wp.name as winner_name, wp.city as winner_city
       from raffle_entries e
       join raffles r on r.id = e.raffle_id
       left join raffle_wins w on w.raffle_id = r.id and w.user_id = $1
       left join profiles wp on wp.id = r.winner_id
      where e.user_id = $1
      order by coalesce(r.finished_at, r.ends_at) desc
      limit 50`,
    [userId]
  );

  const stats = await one<{ posts_total: string; posts_photo: string; wins: string; entries: string }>(
    `select
       (select count(*) from posts where author_id = $1 and status = 'published')                as posts_total,
       (select count(*) from posts where author_id = $1 and status = 'published'
          and image_url is not null and btrim(image_url) <> '')                                   as posts_photo,
       (select count(*) from raffle_wins where user_id = $1)                                      as wins,
       (select count(*) from raffle_entries where user_id = $1)                                   as entries`,
    [userId]
  );

  return {
    stats: {
      postsTotal: Number(stats?.posts_total ?? 0),
      postsWithPhoto: Number(stats?.posts_photo ?? 0),
      wins: Number(stats?.wins ?? 0),
      entries: Number(stats?.entries ?? 0),
    },
    items: rows.map((r) => ({
      raffleId: r.id,
      title: r.title,
      prizeTitle: r.prize_title,
      prizeImage: r.prize_image_url ?? '',
      sponsorName: r.sponsor_name ?? '',
      status: effectiveStatus(r as unknown as RaffleRow),
      winMode: r.win_mode,
      conditionPosts: r.condition_posts,
      conditionDays: r.condition_distinct_days,
      joinedAt: iso(r.qualified_at),
      myPostsCount: r.posts_count,
      myRunTimeMs: r.run_time_ms,
      iWon: Boolean(r.i_won),
      winStatus: r.win_status,
      winner:
        r.winner_name == null
          ? null
          : { name: r.winner_name, city: r.winner_city ?? '' },
      finishedAt: iso(r.finished_at),
      endsAt: iso(r.ends_at),
    })),
  };
}

/** Публична история: коя томбола, каква награда, кой спечели и кога. */
export async function raffleHistory(limit = 30) {
  const rows = await many<{
    id: string;
    title: string;
    prize_title: string;
    prize_image_url: string | null;
    sponsor_name: string | null;
    sponsor_url: string | null;
    finished_at: Date | null;
    closed_reason: string | null;
    winning_time_ms: number | null;
    name: string | null;
    handle: string | null;
    avatar_url: string | null;
    city: string | null;
    win_status: string | null;
    shipped_at: Date | null;
  }>(
    `select r.id, r.title, r.prize_title, r.prize_image_url, r.sponsor_name, r.sponsor_url,
            r.finished_at, r.closed_reason, r.winning_time_ms,
            p.name, p.handle, p.avatar_url, p.city,
            w.status as win_status, w.shipped_at
       from raffles r
       left join profiles p on p.id = r.winner_id
       left join raffle_wins w on w.raffle_id = r.id
      where r.status in ('finished', 'cancelled')
      order by r.finished_at desc nulls last
      limit $1`,
    [limit]
  );

  return rows.map((r) => ({
    raffleId: r.id,
    title: r.title,
    prizeTitle: r.prize_title,
    prizeImage: r.prize_image_url ?? '',
    sponsor: r.sponsor_name ? { name: r.sponsor_name, url: r.sponsor_url ?? '' } : null,
    finishedAt: iso(r.finished_at),
    closedReason: r.closed_reason,
    winningTimeMs: r.winning_time_ms,
    // Показваме име + град, но НЕ адрес/телефон — те са лични.
    winner:
      r.name == null
        ? null
        : {
            name: r.name,
            handle: r.handle ?? '',
            avatar: r.avatar_url ?? '',
            city: r.city ?? '',
          },
    prizeSent: Boolean(r.shipped_at) || r.win_status === 'delivered',
    prizeStatus: r.win_status,
  }));
}
