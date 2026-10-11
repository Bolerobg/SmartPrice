import { many, one } from '../db.js';
import { notFound } from './errors.js';
import { mapProfile } from './mappers.js';

const TIER_TITLE: Record<string, string> = {
  coffee: 'Едно кафе',
  guardian: 'Пазител на Цените',
  legend: 'Легенда на Общността',
};

export interface ProfileCounters {
  posts_count: number;
  verified_receipts_count: number;
  community_saved_bgn: number;
}

/** Зарежда пълния профил (със значки, дарения и реални броячи) за даден потребител. */
export async function loadFullProfile(userId: string) {
  const profile = await one<Record<string, unknown> & { id: string }>(
    `select p.*,
            (select count(*) from posts po
              where po.author_id = p.id and po.status = 'published')            as posts_count,
            (select count(*) from posts po join receipts r on r.post_id = po.id
              where po.author_id = p.id and r.verified_by_ai)                    as verified_receipts_count,
            (select coalesce(sum(po.community_saved_bgn), 0) from posts po
              where po.author_id = p.id and po.status = 'published')             as community_saved_bgn
       from profiles p
      where p.id = $1`,
    [userId]
  );

  if (!profile) throw notFound('Профилът не е намерен.');

  const badges = await many<{
    id: string;
    title: string;
    icon: string;
    description: string;
    color: string;
    unlocked: boolean;
  }>(
    `select b.id, b.title, b.icon, b.description, b.color,
            (pb.unlocked_at is not null) as unlocked
       from badges b
       left join profile_badges pb
              on pb.badge_id = b.id and pb.profile_id = $1
      order by b.sort_order`,
    [userId]
  );

  const donations = await many<{
    id: string;
    amount_bgn: number;
    tier_id: string;
    is_monthly: boolean;
    created_at: Date;
    stripe_payment_intent_id: string | null;
  }>(
    `select id, amount_bgn, tier_id, is_monthly, created_at, stripe_payment_intent_id
       from donations
      where user_id = $1 and status = 'succeeded'
      order by created_at desc`,
    [userId]
  );

  return mapProfile(profile as never, {
    badges,
    donations: donations.map((d) => ({
      id: d.id,
      amountBgn: d.amount_bgn,
      tierName: TIER_TITLE[d.tier_id] ?? d.tier_id,
      isMonthly: d.is_monthly,
      createdAt: d.created_at instanceof Date ? d.created_at.toISOString() : String(d.created_at),
      paymentIntentId: d.stripe_payment_intent_id ?? '',
    })),
  });
}

/** Публичен профил (без имейл и без дарения) — за чужди профили. */
export async function loadPublicProfile(userId: string) {
  const full = await loadFullProfile(userId);
  const { email: _email, donations: _donations, ...rest } = full;
  return rest;
}
