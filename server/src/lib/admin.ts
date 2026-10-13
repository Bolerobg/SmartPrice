import type { FastifyInstance, FastifyRequest } from 'fastify';
import { many, one } from '../db.js';
import { env } from '../env.js';
import { forbidden, unauthorized } from './errors.js';

/**
 * Админ панелът (отделен дашборд на /panel/) — права, одит и статистики.
 *
 * Правата се пазят ТУК, на сървъра: или роля 'admin' в базата, или имейлът е в
 * ADMIN_EMAILS. Дашбордът само показва бутони; ако някой ги извика без право,
 * получава 403.
 */

const ADMIN_TOKEN_TTL = '12h';

export interface AdminProfile {
  id: string;
  email: string;
  name: string;
  handle: string;
  role: string;
  avatar_url: string | null;
}

export function adminEmails(): string[] {
  return env.ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminProfile(profile: { role: string; email: string }): boolean {
  return profile.role === 'admin' || adminEmails().includes(profile.email.toLowerCase());
}

export async function loadAdminById(userId: string): Promise<AdminProfile | null> {
  const row = await one<AdminProfile>(
    `select id, email, name, handle, role, avatar_url from profiles
      where id = $1 and deleted_at is null`,
    [userId]
  );
  return row ?? null;
}

/** Пуска токен за дашборда (различен тип от мобилния — не се преизползва). */
export function signAdminToken(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId, typ: 'admin' } as never, { expiresIn: ADMIN_TOKEN_TTL });
}

/** Проверява токена на дашборда и че профилът наистина е админ. */
export async function requireAdminPanel(req: FastifyRequest): Promise<AdminProfile> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized('Липсва токен за достъп.');
  let userId: string;
  try {
    const payload = req.server.jwt.verify<{ sub?: string; typ?: string }>(header.slice(7).trim());
    if (payload.typ !== 'admin' || !payload.sub) throw new Error('грешен тип токен');
    userId = payload.sub;
  } catch {
    throw unauthorized('Токенът е невалиден или е изтекъл.');
  }
  const profile = await loadAdminById(userId);
  if (!profile) throw unauthorized('Профилът не е намерен.');
  if (!isAdminProfile(profile)) throw forbidden('Този профил няма админ права.');
  return profile;
}

/** Записва всяко действие на админа — кой, какво, кога, откъде. */
export async function audit(params: {
  admin: { id: string; email: string };
  action: string;
  targetType?: string;
  targetId?: string | null;
  targetLabel?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  try {
    await one(
      `insert into admin_audit_log
         (admin_id, admin_email, action, target_type, target_id, target_label, details, ip)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id`,
      [
        params.admin.id,
        params.admin.email,
        params.action,
        params.targetType ?? null,
        params.targetId ?? null,
        params.targetLabel ?? null,
        JSON.stringify(params.details ?? {}),
        params.ip ?? null,
      ]
    );
  } catch {
    // Одитът не бива да чупи действието, ако записът се провали.
  }
}

/* ------------------------------------------------------------------ статистики */

export interface DashboardStats {
  generatedAt: string;
  users: Record<string, number>;
  posts: Record<string, number>;
  engagement: Record<string, number>;
  money: Record<string, number>;
  moderation: Record<string, number>;
  growth: Array<{ day: string; users: number; posts: number; comments: number }>;
  activity: Array<{ day: string; active: number }>;
  byCategory: Array<{ id: string; title: string; posts: number }>;
  byCity: Array<{ city: string; posts: number }>;
  topAuthors: Array<{ id: string; name: string; handle: string; posts: number; saved: number }>;
  topReferrers: Array<{ id: string; name: string; handle: string; code: string; invited: number; rewarded: number }>;
  topPosts: Array<{ id: string; code: string; title: string; helped: number; comments: number; saved: number }>;
  recentUsers: Array<Record<string, unknown>>;
  recentPosts: Array<Record<string, unknown>>;
  security: Array<Record<string, unknown>>;
  mail: Record<string, number>;
}

const n = (v: unknown): number => Number(v ?? 0);

export async function loadDashboardStats(): Promise<DashboardStats> {
  const [
    users,
    posts,
    engagement,
    money,
    moderation,
    growth,
    activity,
    byCategory,
    byCity,
    topAuthors,
    topReferrers,
    topPosts,
    recentUsers,
    recentPosts,
    security,
    mail,
  ] = await Promise.all([
    one<Record<string, unknown>>(`
      select
        count(*)::int                                                      as total,
        count(*) filter (where created_at >= current_date)::int             as today,
        count(*) filter (where created_at >= now() - interval '7 days')::int as week,
        count(*) filter (where created_at >= now() - interval '30 days')::int as month,
        count(*) filter (where last_seen_at >= now() - interval '1 day')::int as active_today,
        count(*) filter (where last_seen_at >= now() - interval '7 days')::int as active_week,
        count(*) filter (where suspended_at is not null
                           and (suspended_until is null or suspended_until > now()))::int as suspended,
        count(*) filter (where deleted_at is not null)::int                  as deleted,
        count(*) filter (where email_verified_at is not null)::int           as verified,
        count(*) filter (where is_supporter)::int                            as supporters,
        count(*) filter (where role = 'admin')::int                          as admins
      from profiles
    `),
    one<Record<string, unknown>>(`
      select
        count(*)::int                                                        as total,
        count(*) filter (where created_at >= current_date)::int               as today,
        count(*) filter (where created_at >= now() - interval '7 days')::int  as week,
        count(*) filter (where status = 'published')::int                     as published,
        count(*) filter (where status = 'hidden')::int                        as hidden,
        count(*) filter (where status = 'removed')::int                       as removed,
        count(*) filter (where polarity = 'green')::int                       as green,
        count(*) filter (where polarity = 'red')::int                         as red,
        coalesce(sum(price_paid), 0)::float                                   as price_sum,
        coalesce(sum(community_saved_bgn), 0)::float                          as saved_sum,
        coalesce(avg(price_paid), 0)::float                                   as price_avg
      from posts
    `),
    one<Record<string, unknown>>(`
      select
        (select count(*) from comments)::int                                as comments,
        (select count(*) from comments where created_at >= current_date)::int as comments_today,
        (select count(*) from post_reactions)::int                          as reactions,
        (select count(*) from post_helped_marks)::int                       as helped_marks,
        (select count(*) from post_bookmarks)::int                          as bookmarks,
        (select count(*) from receipts)::int                                as receipts,
        (select count(*) from receipts where verified_by_ai)::int           as receipts_ai,
        (select count(*) from price_history)::int                           as price_events,
        (select count(*) from price_alerts where is_active)::int            as price_alerts,
        (select count(*) from uploads)::int                                 as uploads,
        (select coalesce(sum(byte_size), 0)::bigint from uploads)           as uploads_bytes
    `),
    one<Record<string, unknown>>(`
      select
        (select count(*) from donations)::int                                        as donations,
        (select count(*) from donations where status = 'succeeded')::int             as donations_ok,
        (select coalesce(sum(amount_bgn), 0)::float from donations
          where status = 'succeeded')::float                                         as donated_sum,
        (select coalesce(sum(amount_bgn), 0)::float from donations
          where status = 'succeeded' and is_monthly)::float                          as donated_monthly,
        (select coalesce(sum(total_donated_bgn), 0)::float from profiles)::float     as supporters_sum
    `),
    one<Record<string, unknown>>(`
      select
        (select count(*) from content_reports)::int                                  as reports,
        (select count(*) from content_reports where status = 'open')::int            as reports_open,
        (select count(*) from security_events where resolved_at is null)::int        as alerts_open,
        (select count(*) from security_events
           where created_at >= now() - interval '24 hours')::int                     as alerts_24h,
        (select count(*) from login_attempts where not ok
           and created_at >= now() - interval '24 hours')::int                       as failed_logins_24h,
        (select count(*) from login_attempts where ok
           and created_at >= now() - interval '24 hours')::int                       as logins_24h,
        (select count(*) from raffles where status in ('active', 'running'))::int     as raffles_live
    `),
    many<Record<string, unknown>>(`
      with days as (
        select generate_series(current_date - interval '29 days', current_date, interval '1 day')::date as day
      )
      select to_char(d.day, 'YYYY-MM-DD') as day,
        (select count(*) from profiles p where p.created_at::date = d.day)::int as users,
        (select count(*) from posts p where p.created_at::date = d.day)::int as posts,
        (select count(*) from comments c where c.created_at::date = d.day)::int as comments
      from days d order by d.day
    `),
    many<Record<string, unknown>>(`
      with days as (
        select generate_series(current_date - interval '29 days', current_date, interval '1 day')::date as day
      )
      select to_char(d.day, 'YYYY-MM-DD') as day,
        (select count(*) from profiles p where p.last_seen_at::date = d.day)::int as active
      from days d order by d.day
    `),
    many<Record<string, unknown>>(`
      select p.category as id, coalesce(cl.title, p.category) as title, count(*)::int as posts
        from posts p left join category_labels cl on cl.id = p.category
       where p.status = 'published'
       group by p.category, cl.title
       order by posts desc
    `),
    many<Record<string, unknown>>(`
      select city, count(*)::int as posts from posts
       where status = 'published' group by city order by posts desc limit 12
    `),
    many<Record<string, unknown>>(`
      select pr.id, pr.name, pr.handle,
             count(p.id)::int as posts,
             coalesce(sum(p.community_saved_bgn), 0)::float as saved
        from profiles pr left join posts p on p.author_id = pr.id and p.status = 'published'
       group by pr.id, pr.name, pr.handle
       order by posts desc, saved desc limit 10
    `),
    many<Record<string, unknown>>(`
      select pr.id, pr.name, pr.handle, pr.referral_code as code,
             (select count(*) from referrals r where r.inviter_id = pr.id)::int as invited,
             (select count(*) from referrals r where r.inviter_id = pr.id and r.status = 'rewarded')::int as rewarded
        from profiles pr
       where pr.referral_code is not null
       order by invited desc, rewarded desc limit 10
    `),
    many<Record<string, unknown>>(`
      select p.id, p.public_code as code, p.title, p.helped_count::int as helped,
             (select count(*) from comments c where c.post_id = p.id)::int as comments,
             p.community_saved_bgn::float as saved
        from posts p where p.status = 'published'
       order by p.helped_count desc, saved desc limit 10
    `),
    many<Record<string, unknown>>(`
      select id, email, name, handle, city, role, created_at, last_seen_at,
             (suspended_at is not null and (suspended_until is null or suspended_until > now())) as suspended,
             (select count(*) from posts p where p.author_id = profiles.id)::int as posts
        from profiles order by created_at desc limit 12
    `),
    many<Record<string, unknown>>(`
      select p.id, p.public_code as code, p.title, p.city, p.price_paid::float as price,
             p.status, p.polarity, p.created_at, pr.handle as author_handle
        from posts p join profiles pr on pr.id = p.author_id
       order by p.created_at desc limit 12
    `),
    many<Record<string, unknown>>(`
      select id, kind, severity, title, details, created_at, alerted_at, resolved_at
        from security_events order by created_at desc limit 15
    `),
    one<Record<string, unknown>>(`
      select
        (select count(*) from admin_email_log)::int as total,
        (select count(*) from admin_email_log where status = 'failed')::int as failed,
        (select count(*) from admin_email_log
           where created_at >= now() - interval '24 hours')::int as last24h
    `),
  ]);

  const num = (row: Record<string, unknown> | null): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(row ?? {})) out[k] = n(v);
    return out;
  };

  return {
    generatedAt: new Date().toISOString(),
    users: num(users),
    posts: num(posts),
    engagement: num(engagement),
    money: num(money),
    moderation: num(moderation),
    growth: growth.map((r) => ({
      day: String(r.day),
      users: n(r.users),
      posts: n(r.posts),
      comments: n(r.comments),
    })),
    activity: activity.map((r) => ({ day: String(r.day), active: n(r.active) })),
    byCategory: byCategory.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      posts: n(r.posts),
    })),
    byCity: byCity.map((r) => ({ city: String(r.city), posts: n(r.posts) })),
    topAuthors: topAuthors.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      handle: String(r.handle),
      posts: n(r.posts),
      saved: n(r.saved),
    })),
    topReferrers: topReferrers.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      handle: String(r.handle),
      code: String(r.code ?? ''),
      invited: n(r.invited),
      rewarded: n(r.rewarded),
    })),
    topPosts: topPosts.map((r) => ({
      id: String(r.id),
      code: String(r.code ?? ''),
      title: String(r.title),
      helped: n(r.helped),
      comments: n(r.comments),
      saved: n(r.saved),
    })),
    recentUsers: recentUsers as Array<Record<string, unknown>>,
    recentPosts: recentPosts as Array<Record<string, unknown>>,
    security: security as Array<Record<string, unknown>>,
    mail: num(mail),
  };
}
