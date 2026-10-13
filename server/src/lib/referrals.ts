import { many, one, query } from '../db.js';
import { env } from '../env.js';
import { badRequest } from './errors.js';

/**
 * Поканален цикъл — сървърната логика.
 *
 * Идеята: всеки има код. Кодът се въвежда при регистрацията (или се „залепва“
 * после, ако профилът е пресен). Когато човекът си потвърди имейла, и двамата
 * получават по 100 точки (двойно спрямо обичайните 50 при старт).
 *
 * Защо точките се дават от БАЗАТА (тригер), а не от API-то: за да е вярно
 * независимо откъде е потвърден имейлът — приложение, имейл линк, админ.
 */

/** Точки за всеки от двамата (двойно спрямо стартовите 50). */
export const REFERRAL_POINTS = 100;

/** Колко дни след регистрация може да се „залепи“ код за вече създаден профил. */
const CLAIM_WINDOW_DAYS = 7;

/** Публичният адрес на приложението (без наклонена черта накрая). */
export function publicBase(): string {
  return env.PUBLIC_BASE_URL.replace(/\/+$/, '');
}

/** Нормализира въведен код: без интервали/тирета, с главни букви. */
export function normalizeCode(raw: string | undefined | null): string {
  return (raw ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12);
}

/** Линк за покана — води директно към регистрацията с попълнен код. */
export function referralLink(code: string, channel?: string): string {
  const base = `${publicBase()}/register?ref=${encodeURIComponent(code)}`;
  return channel ? `${base}&utm_source=${encodeURIComponent(channel)}` : base;
}

export interface InviterLookup {
  id: string;
  name: string;
  handle: string;
  avatar_url: string | null;
}

/** Намира кой стои зад кода (или null). */
export async function findInviterByCode(codeRaw: string): Promise<InviterLookup | null> {
  const code = normalizeCode(codeRaw);
  if (code.length < 4) return null;
  return one<InviterLookup>(
    `select id, name, handle, avatar_url from profiles where referral_code = $1`,
    [code]
  );
}

/**
 * Записва поканата (чака награда при потвърден имейл).
 * Не хвърля при невалиден код — регистрацията не бива да се чупи от код.
 */
export async function attachReferral(params: {
  inviteeId: string;
  codeRaw?: string | null;
  channel?: string | null;
}): Promise<{ applied: boolean; inviterName?: string }> {
  const code = normalizeCode(params.codeRaw);
  if (code.length < 4) return { applied: false };

  const inviter = await findInviterByCode(code);
  if (!inviter) return { applied: false };
  if (inviter.id === params.inviteeId) return { applied: false };

  await query(
    `insert into referrals (inviter_id, invitee_id, code, channel)
     values ($1, $2, $3, $4)
     on conflict (invitee_id) do nothing`,
    [inviter.id, params.inviteeId, code, params.channel ?? null]
  );

  await query(
    `update profiles set referred_by = $2, referred_at = now()
      where id = $1 and referred_by is null`,
    [params.inviteeId, inviter.id]
  );

  return { applied: true, inviterName: inviter.name };
}

/**
 * „Залепване“ на код за вече създаден профил (до 7 дни, само веднъж и само
 * ако човекът още не е идвал по покана). Тогава наградата е веднага, защото
 * имейлът отдавна е потвърден.
 */
export async function claimReferral(params: {
  userId: string;
  codeRaw: string;
}): Promise<{ ok: true; inviterName: string; points: number }> {
  const profile = await one<{
    referral_code: string | null;
    referred_by: string | null;
    email_verified_at: Date | null;
    created_at: Date;
    referral_points: number;
  }>(
    `select referral_code, referred_by, email_verified_at, created_at, referral_points
       from profiles where id = $1`,
    [params.userId]
  );
  if (!profile) throw badRequest('Профилът не е намерен.');
  if (!profile.email_verified_at) throw badRequest('Първо потвърди имейла си.');
  if (profile.referred_by) throw badRequest('Вече си дошъл по покана — кодът може да се използва само веднъж.');

  const ageDays = (Date.now() - new Date(profile.created_at).getTime()) / 86_400_000;
  if (ageDays > CLAIM_WINDOW_DAYS) {
    throw badRequest(
      `Код може да се използва само до ${CLAIM_WINDOW_DAYS} дни след регистрация.`
    );
  }

  const inviter = await findInviterByCode(params.codeRaw);
  if (!inviter) throw badRequest('Няма такъв код за покана.');
  if (inviter.id === params.userId) throw badRequest('Не можеш да използваш собствения си код.');
  if (normalizeCode(profile.referral_code ?? '') === normalizeCode(params.codeRaw)) {
    throw badRequest('Не можеш да използваш собствения си код.');
  }

  await query(
    `insert into referrals (inviter_id, invitee_id, code, channel)
     values ($1, $2, $3, 'late-claim')
     on conflict (invitee_id) do nothing`,
    [inviter.id, params.userId, normalizeCode(params.codeRaw)]
  );
  await query(
    `update profiles set referred_by = $2, referred_at = now()
      where id = $1 and referred_by is null`,
    [params.userId, inviter.id]
  );

  // Имейлът е потвърден → награждаваме веднага (същата функция като тригера).
  await query('select sp_award_referral($1)', [params.userId]);

  return { ok: true, inviterName: inviter.name, points: REFERRAL_POINTS };
}

export interface ReferralRow {
  id: string;
  name: string;
  handle: string;
  avatar_url: string | null;
  status: 'pending' | 'rewarded' | 'void';
  points_inviter: number;
  created_at: Date;
  rewarded_at: Date | null;
}

/** Пълна картина за „моите покани“ + готовност за споделяне. */
export async function loadReferralSummary(userId: string) {
  const profile = await one<{
    referral_code: string | null;
    referral_points: number;
  }>('select referral_code, referral_points from profiles where id = $1', [userId]);

  const rows = await many<ReferralRow>(
    `select r.id, r.status, r.points_inviter, r.created_at, r.rewarded_at,
            p.name, p.handle, p.avatar_url
       from referrals r
       join profiles p on p.id = r.invitee_id
      where r.inviter_id = $1
      order by r.created_at desc
      limit 100`,
    [userId]
  );

  const rewarded = rows.filter((r) => r.status === 'rewarded');
  const pending = rows.filter((r) => r.status === 'pending');
  const code = profile?.referral_code ?? '';

  return {
    code,
    link: code ? referralLink(code) : '',
    /** Колко точки НОСИ една успешна покана (и за двамата). */
    pointsPerInvite: REFERRAL_POINTS,
    invited: rows.length,
    rewarded: rewarded.length,
    pending: pending.length,
    pointsEarned: Number(profile?.referral_points ?? 0),
    invitedUsers: rows.map((r) => ({
      id: r.id,
      name: r.name,
      handle: r.handle,
      avatar: r.avatar_url ?? '',
      status: r.status,
      points: r.points_inviter,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      rewardedAt:
        r.rewarded_at instanceof Date ? r.rewarded_at.toISOString() : (r.rewarded_at ?? null),
    })),
    /** Готов за споделяне текст — еднакъв за всички канали. */
    shareText:
      'SmartPrice — провери цената, преди да платиш. Реални цени от хора като теб, ' +
      'без реклами и без платени ревюта. Влез по моя код и двамата получаваме по 100 точки:',
  };
}
