import { one, query } from '../db.js';

/**
 * Значките не са декорация — всяка зависи от реален показател и се отключва,
 * когато човекът я заслужи. Пазим ги така, за да е винаги вярно, независимо
 * откъде е дошло действието (публикация, проверка на цена, дарение).
 */
export interface BadgeMetrics {
  priceChecks: number;
  priceCorrections: number;
  reputationPoints: number;
  posts: number;
  receipts: number;
  redFlags: number;
  savings: number;
  isSupporter: boolean;
  /** Колко покани са довели реален (потвърден) нов потребител. */
  referrals: number;
}

/** Текущите стойности на всичко, от което зависи някоя значка. */
export async function badgeMetrics(userId: string): Promise<BadgeMetrics | null> {
  const row = await one<{
    price_checks: number;
    price_corrections: number;
    reputation_points: number;
    posts: number;
    receipts: number;
    red_flags: number;
    savings: number;
    is_supporter: boolean;
    referrals: number;
  }>(
    `select
       p.reputation_points,
       p.is_supporter,
       (select count(*) from posts po
         where po.author_id = p.id and po.status = 'published')                     as posts,
       (select count(*) from posts po join receipts r on r.post_id = po.id
         where po.author_id = p.id and r.verified_by_ai)                            as receipts,
       (select count(*) from posts po
         where po.author_id = p.id and po.status = 'published' and po.polarity = 'red') as red_flags,
       (select coalesce(sum(po.community_saved_bgn), 0) from posts po
         where po.author_id = p.id and po.status = 'published')                     as savings,
       (select count(*) from price_history ph
         where ph.reported_by = p.id and ph.status in ('confirmed','changed'))       as price_checks,
       (select count(*) from price_history ph
         where ph.reported_by = p.id and ph.status = 'changed')                     as price_corrections,
       (select count(*) from referrals r
         where r.inviter_id = p.id and r.status = 'rewarded')                       as referrals
     from profiles p
    where p.id = $1`,
    [userId]
  );

  if (!row) return null;

  return {
    priceChecks: Number(row.price_checks) || 0,
    priceCorrections: Number(row.price_corrections) || 0,
    reputationPoints: Number(row.reputation_points) || 0,
    posts: Number(row.posts) || 0,
    receipts: Number(row.receipts) || 0,
    redFlags: Number(row.red_flags) || 0,
    savings: Number(row.savings) || 0,
    referrals: Number(row.referrals) || 0,
    isSupporter: Boolean(row.is_supporter),
  };
}

/**
 * Отключва всичко заслужено. Извиква се при зареждане на профила — така
 * значката светва веднага след действието, а не чак при следващ вход.
 */
export async function syncBadges(userId: string): Promise<void> {
  await query(
    `with s as (
       select p.id,
              p.reputation_points,
              p.is_supporter,
              (select count(*) from posts po
                where po.author_id = p.id and po.status = 'published')                     as posts,
              (select count(*) from posts po join receipts r on r.post_id = po.id
                where po.author_id = p.id and r.verified_by_ai)                            as receipts,
              (select count(*) from posts po
                where po.author_id = p.id and po.status = 'published' and po.polarity = 'red') as red_flags,
              (select coalesce(sum(po.community_saved_bgn), 0) from posts po
                where po.author_id = p.id and po.status = 'published')                     as savings,
              (select count(*) from price_history ph
                where ph.reported_by = p.id and ph.status in ('confirmed','changed'))       as price_checks,
              (select count(*) from price_history ph
                where ph.reported_by = p.id and ph.status = 'changed')                     as price_corrections,
              (select count(*) from referrals r
                where r.inviter_id = p.id and r.status = 'rewarded')                       as referrals
         from profiles p
        where p.id = $1
     )
     update profile_badges pb
        set unlocked_at = now()
       from s, badges b
      where pb.profile_id = s.id
        and pb.badge_id = b.id
        and pb.unlocked_at is null
        and (
          (b.metric = 'posts'              and s.posts             >= b.threshold) or
          (b.metric = 'receipts'           and s.receipts          >= b.threshold) or
          (b.metric = 'red_flags'          and s.red_flags         >= b.threshold) or
          (b.metric = 'savings'            and s.savings           >= b.threshold) or
          (b.metric = 'price_checks'       and s.price_checks      >= b.threshold) or
          (b.metric = 'price_corrections'  and s.price_corrections >= b.threshold) or
          (b.metric = 'reputation_points'  and s.reputation_points >= b.threshold) or
          (b.metric = 'referrals'          and s.referrals         >= b.threshold) or
          (b.metric = 'supporter'          and s.is_supporter)
        )`,
    [userId]
  );
}

/** Колко е напреднал човекът по показателя на дадена значка. */
export function progressFor(
  metric: string | null | undefined,
  m: BadgeMetrics
): number {
  switch (metric) {
    case 'price_checks':
      return m.priceChecks;
    case 'price_corrections':
      return m.priceCorrections;
    case 'reputation_points':
      return m.reputationPoints;
    case 'posts':
      return m.posts;
    case 'receipts':
      return m.receipts;
    case 'red_flags':
      return m.redFlags;
    case 'savings':
      return Math.round(m.savings);
    case 'referrals':
      return m.referrals;
    case 'supporter':
      return m.isSupporter ? 1 : 0;
    default:
      return 0;
  }
}
