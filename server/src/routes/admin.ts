import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/auth.js';
import {
  audit,
  isAdminProfile,
  loadAdminById,
  loadDashboardStats,
  requireAdminPanel,
  signAdminToken,
} from '../lib/admin.js';
import { runSecurityScan, ALERT_EMAIL } from '../lib/security.js';
import {
  sendAccountDeletedEmail,
  sendAccountSuspendedEmail,
  sendAdminAlertEmail,
} from '../lib/email.js';

/**
 * Админ панелът — HTTP слоят.
 *
 * Всичко тук е зад проверка на сървъра (роля admin или имейл в ADMIN_EMAILS).
 * Панелът е отделен: ползва свой токен (typ: 'admin'), за да не може токен от
 * мобилното приложение да отваря админ функции, дори да е на админ.
 */

const ADMIN_PAGE_LIMIT = 100;

const iso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

const paging = {
  limit: z.coerce.number().int().min(1).max(ADMIN_PAGE_LIMIT).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
};

const like = (q: string) => `%${q.trim()}%`;

export default async function adminRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------ вход */

  app.post('/api/admin/login', async (req) => {
    const input = z
      .object({ email: z.string().trim().email(), password: z.string().min(1).max(200) })
      .parse(req.body);

    const row = await one<{ id: string; password_hash: string; role: string; email: string; name: string }>(
      `select id, password_hash, role, email, name from profiles
        where email = $1 and deleted_at is null`,
      [input.email]
    );

    const ip = req.ip;
    const okPassword = row ? await verifyPassword(input.password, row.password_hash) : false;

    await one(
      `insert into login_attempts (email, ip, ok, reason) values ($1,$2,$3,$4) returning id`,
      [input.email, ip, Boolean(row && okPassword), row ? (okPassword ? null : 'wrong_password') : 'no_profile']
    ).catch(() => undefined);

    if (!row || !okPassword) throw unauthorized('Грешен имейл или парола.');
    if (!isAdminProfile(row)) {
      await audit({
        admin: { id: row.id, email: row.email },
        action: 'admin_login_denied',
        details: { reason: 'not_admin' },
        ip,
      });
      throw unauthorized('Този профил няма админ права.');
    }

    await one(`update profiles set last_login_at = now(), login_count = login_count + 1 where id = $1 returning id`, [
      row.id,
    ]).catch(() => undefined);

    await audit({ admin: { id: row.id, email: row.email }, action: 'admin_login', ip });

    return {
      token: signAdminToken(app, row.id),
      admin: { id: row.id, email: row.email, name: row.name, role: row.role },
    };
  });

  app.get('/api/admin/me', async (req) => {
    const admin = await requireAdminPanel(req);
    return { admin };
  });

  /* ------------------------------------------------------- статистики */

  app.get('/api/admin/stats', async (req) => {
    await requireAdminPanel(req);
    return loadDashboardStats();
  });

  /* ------------------------------------------------------- потребители */

  app.get('/api/admin/users', async (req) => {
    await requireAdminPanel(req);
    const q = z
      .object({
        search: z.string().max(120).optional(),
        status: z.enum(['all', 'active', 'suspended', 'deleted', 'unverified']).default('all'),
        role: z.enum(['all', 'user', 'moderator', 'admin']).default('all'),
        sort: z.enum(['newest', 'oldest', 'most_posts', 'last_seen']).default('newest'),
        ...paging,
      })
      .parse(req.query);

    const where: string[] = ['1=1'];
    const values: unknown[] = [];
    const bind = (v: unknown) => {
      values.push(v);
      return `$${values.length}`;
    };

    if (q.search) {
      const p = bind(like(q.search));
      where.push(`(sp_fold(pr.name) like sp_fold(${p}) or sp_fold(pr.email::text) like sp_fold(${p})
                   or sp_fold(pr.handle) like sp_fold(${p}) or sp_fold(pr.city) like sp_fold(${p}))`);
    }
    if (q.status === 'active') where.push(`pr.suspended_at is null and pr.deleted_at is null`);
    if (q.status === 'suspended')
      where.push(`pr.suspended_at is not null and (pr.suspended_until is null or pr.suspended_until > now())`);
    if (q.status === 'deleted') where.push(`pr.deleted_at is not null`);
    if (q.status === 'unverified') where.push(`pr.email_verified_at is null`);
    if (q.role !== 'all') where.push(`pr.role = ${bind(q.role)}`);

    const order =
      q.sort === 'oldest'
        ? 'pr.created_at asc'
        : q.sort === 'most_posts'
          ? 'posts_count desc'
          : q.sort === 'last_seen'
            ? 'pr.last_seen_at desc nulls last'
            : 'pr.created_at desc';

    const rows = await many<Record<string, unknown>>(
      `select pr.id, pr.email, pr.name, pr.handle, pr.city, pr.role, pr.avatar_url,
              pr.is_supporter, pr.reputation_points, pr.personal_saved_bgn::float as saved,
              pr.created_at, pr.last_seen_at, pr.last_login_at, pr.login_count,
              pr.email_verified_at, pr.suspended_at, pr.suspended_until, pr.suspended_reason,
              pr.deleted_at, pr.deleted_reason, pr.referral_code,
              (select count(*) from posts p where p.author_id = pr.id)::int as posts_count,
              (select count(*) from comments c where c.author_id = pr.id)::int as comments_count,
              (select count(*) from referrals r where r.inviter_id = pr.id)::int as invited
         from profiles pr
        where ${where.join(' and ')}
        order by ${order}
        limit ${bind(q.limit)} offset ${bind(q.offset)}`,
      values
    );

    const total = await one<{ n: number }>(
      `select count(*)::int as n from profiles pr where ${where.join(' and ')}`,
      values.slice(0, values.length - 2)
    );

    return { items: rows, total: Number(total?.n ?? 0), limit: q.limit, offset: q.offset };
  });

  app.get('/api/admin/users/:id', async (req) => {
    await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const profile = await one<Record<string, unknown>>(
      `select pr.*, pr.total_donated_bgn::float as donated,
              (select count(*) from posts p where p.author_id = pr.id)::int as posts_count,
              (select count(*) from comments c where c.author_id = pr.id)::int as comments_count,
              (select count(*) from post_reactions r where r.user_id = pr.id)::int as reactions_count,
              (select count(*) from post_bookmarks b where b.user_id = pr.id)::int as favorites_count,
              (select count(*) from referrals r where r.inviter_id = pr.id)::int as invited,
              (select count(*) from referrals r where r.invitee_id = pr.id)::int as invited_by_someone
         from profiles pr where pr.id = $1`,
      [id]
    );
    if (!profile) throw notFound('Профилът не е намерен.');

    const [posts, comments, donations, attempts, events, audits] = await Promise.all([
      many<Record<string, unknown>>(
        `select id, public_code, title, city, price_paid::float as price, status, polarity, created_at
           from posts where author_id = $1 order by created_at desc limit 20`,
        [id]
      ),
      many<Record<string, unknown>>(
        `select c.id, c.body, c.status, c.created_at, p.public_code, p.title as post_title
           from comments c join posts p on p.id = c.post_id
          where c.author_id = $1 order by c.created_at desc limit 20`,
        [id]
      ),
      many<Record<string, unknown>>(
        `select id, amount_bgn::float as amount, tier_id, status, is_monthly, created_at
           from donations where user_id = $1 order by created_at desc limit 20`,
        [id]
      ),
      many<Record<string, unknown>>(
        `select ip, ok, reason, created_at from login_attempts
          where email = (select email from profiles where id = $1)
          order by created_at desc limit 20`,
        [id]
      ),
      many<Record<string, unknown>>(
        `select id, kind, severity, title, details, created_at, resolved_at from security_events
          where subject_id = $1 order by created_at desc limit 20`,
        [id]
      ),
      many<Record<string, unknown>>(
        `select id, action, admin_email, details, created_at from admin_audit_log
          where target_id = $1 order by created_at desc limit 20`,
        [id]
      ),
    ]);

    return { profile, posts, comments, donations, loginAttempts: attempts, securityEvents: events, audit: audits };
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        city: z.string().trim().min(2).max(80).optional(),
        bio: z.string().trim().max(1000).optional(),
        role: z.enum(['user', 'moderator', 'admin']).optional(),
        isSupporter: z.boolean().optional(),
        reputationPoints: z.coerce.number().int().min(0).max(1_000_000).optional(),
        markVerified: z.boolean().optional(),
        newPassword: z.string().min(8).max(200).optional(),
      })
      .strict()
      .parse(req.body);

    const target = await one<{ email: string; handle: string }>(
      'select email, handle from profiles where id = $1',
      [id]
    );
    if (!target) throw notFound('Профилът не е намерен.');

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, val: unknown) => {
      values.push(val);
      sets.push(`${col} = $${values.length}`);
    };
    if (input.name !== undefined) push('name', input.name);
    if (input.city !== undefined) push('city', input.city);
    if (input.bio !== undefined) push('bio', input.bio);
    if (input.role !== undefined) push('role', input.role);
    if (input.isSupporter !== undefined) push('is_supporter', input.isSupporter);
    if (input.reputationPoints !== undefined) push('reputation_points', input.reputationPoints);
    if (input.markVerified) sets.push('email_verified_at = coalesce(email_verified_at, now())');
    if (input.newPassword !== undefined) push('password_hash', await hashPassword(input.newPassword));
    if (!sets.length) throw badRequest('Няма какво да се обнови.');

    values.push(id);
    await one(`update profiles set ${sets.join(', ')} where id = $${values.length} returning id`, values);

    await audit({
      admin,
      action: 'user_update',
      targetType: 'profile',
      targetId: id,
      targetLabel: target.handle,
      details: { ...input, newPassword: input.newPassword ? 'сменена' : undefined },
      ip: req.ip,
    });

    return { profile: await one(`select * from profiles where id = $1`, [id]) };
  });

  /** Спиране за срок (или безсрочно) + имейл с причината. */
  app.post('/api/admin/users/:id/suspend', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z
      .object({
        reason: z.string().trim().min(3, 'Напиши причина — тя отива в имейла до човека.').max(500),
        days: z.coerce.number().int().min(1).max(3650).optional(),
        hidePosts: z.boolean().default(true),
        notify: z.boolean().default(true),
      })
      .parse(req.body);

    const target = await one<{ email: string; name: string; handle: string; suspended_at: string | null }>(
      'select email, name, handle, suspended_at from profiles where id = $1 and deleted_at is null',
      [id]
    );
    if (!target) throw notFound('Профилът не е намерен.');
    if (target.suspended_at) throw conflict('Профилът вече е спрян.');

    const until = input.days ? new Date(Date.now() + input.days * 86_400_000).toISOString() : null;

    await one(
      `update profiles
          set suspended_at = now(), suspended_until = $2::timestamptz, suspended_reason = $3, suspended_by = $4
        where id = $1 returning id`,
      [id, until, input.reason, admin.id]
    );

    let hiddenPosts = 0;
    if (input.hidePosts) {
      const res = await one<{ n: number }>(
        `with upd as (
           update posts set status = 'hidden'
            where author_id = $1 and status = 'published' returning 1
         ) select count(*)::int as n from upd`,
        [id]
      );
      hiddenPosts = Number(res?.n ?? 0);
    }

    let mailSent = false;
    let mailError: string | null = null;
    if (input.notify) {
      try {
        const res = await sendAccountSuspendedEmail({
          to: target.email,
          name: target.name,
          reason: input.reason,
          until: until ? new Date(until).toLocaleDateString('bg-BG') : null,
        });
        mailSent = true;
        await one(
          `insert into admin_email_log (to_email, subject, kind, provider_id, status, related_type, related_id)
           values ($1,$2,'account_suspended',$3,'sent','profile',$4) returning id`,
          [target.email, 'SmartPrice: профилът ти е спрян временно', res.id, id]
        );
      } catch (err) {
        mailError = String(err).slice(0, 300);
        await one(
          `insert into admin_email_log (to_email, subject, kind, status, error, related_type, related_id)
           values ($1,$2,'account_suspended','failed',$3,'profile',$4) returning id`,
          [target.email, 'SmartPrice: профилът ти е спрян временно', mailError, id]
        );
      }
    }

    await audit({
      admin,
      action: 'user_suspend',
      targetType: 'profile',
      targetId: id,
      targetLabel: target.handle,
      details: { reason: input.reason, until, hidePosts: input.hidePosts, hiddenPosts, mailSent },
      ip: req.ip,
    });

    return { ok: true, until, hiddenPosts, mailSent, mailError };
  });

  /** Пускане на спрян профил (връща и скритите му оферти). */
  app.post('/api/admin/users/:id/resume', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z.object({ restorePosts: z.boolean().default(true) }).parse(req.body ?? {});

    const target = await one<{ handle: string; suspended_at: string | null }>(
      'select handle, suspended_at from profiles where id = $1',
      [id]
    );
    if (!target) throw notFound('Профилът не е намерен.');
    if (!target.suspended_at) throw conflict('Профилът не е спрян.');

    await one(
      `update profiles set suspended_at = null, suspended_until = null, suspended_reason = null,
              suspended_by = null where id = $1 returning id`,
      [id]
    );

    let restored = 0;
    if (input.restorePosts) {
      const res = await one<{ n: number }>(
        `with upd as (
           update posts set status = 'published' where author_id = $1 and status = 'hidden' returning 1
         ) select count(*)::int as n from upd`,
        [id]
      );
      restored = Number(res?.n ?? 0);
    }

    await audit({
      admin,
      action: 'user_resume',
      targetType: 'profile',
      targetId: id,
      targetLabel: target.handle,
      details: { restoredPosts: restored },
      ip: req.ip,
    });

    return { ok: true, restoredPosts: restored };
  });

  /** Изтриване (меко) + имейл с причината. */
  app.delete('/api/admin/users/:id', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z
      .object({
        reason: z.string().trim().min(3, 'Напиши причина — тя отива в имейла до човека.').max(500),
        notify: z.boolean().default(true),
        confirm: z.string().optional(),
      })
      .parse(req.body ?? {});

    const target = await one<{ email: string; name: string; handle: string }>(
      'select email, name, handle from profiles where id = $1 and deleted_at is null',
      [id]
    );
    if (!target) throw notFound('Профилът не е намерен.');
    if (target.handle === admin.handle) throw badRequest('Не можеш да изтриеш собствения си профил.');
    if (input.confirm && input.confirm.toLowerCase() !== target.email.toLowerCase()) {
      throw badRequest('За потвърждение напиши точно имейла на профила.');
    }

    await one(
      `update profiles
          set deleted_at = now(), deleted_reason = $2, suspended_at = null, suspended_until = null
        where id = $1 returning id`,
      [id, input.reason]
    );
    await one(
      `with upd as (update posts set status = 'removed' where author_id = $1 and status <> 'removed' returning 1)
       select count(*)::int as n from upd`,
      [id]
    ).catch(() => undefined);
    await one(
      `with upd as (update comments set status = 'removed' where author_id = $1 and status <> 'removed' returning 1)
       select count(*)::int as n from upd`,
      [id]
    ).catch(() => undefined);

    let mailSent = false;
    let mailError: string | null = null;
    if (input.notify) {
      try {
        const res = await sendAccountDeletedEmail({
          to: target.email,
          name: target.name,
          reason: input.reason,
        });
        mailSent = true;
        await one(
          `insert into admin_email_log (to_email, subject, kind, provider_id, status, related_type, related_id)
           values ($1,$2,'account_deleted',$3,'sent','profile',$4) returning id`,
          [target.email, 'SmartPrice: профилът ти е изтрит', res.id, id]
        );
      } catch (err) {
        mailError = String(err).slice(0, 300);
        await one(
          `insert into admin_email_log (to_email, subject, kind, status, error, related_type, related_id)
           values ($1,$2,'account_deleted','failed',$3,'profile',$4) returning id`,
          [target.email, 'SmartPrice: профилът ти е изтрит', mailError, id]
        );
      }
    }

    await audit({
      admin,
      action: 'user_delete',
      targetType: 'profile',
      targetId: id,
      targetLabel: target.handle,
      details: { reason: input.reason, mailSent },
      ip: req.ip,
    });

    return { ok: true, mailSent, mailError };
  });

  /* ----------------------------------------------------------- оферти */

  app.get('/api/admin/posts', async (req) => {
    await requireAdminPanel(req);
    const q = z
      .object({
        search: z.string().max(120).optional(),
        status: z.enum(['all', 'published', 'hidden', 'removed']).default('all'),
        polarity: z.enum(['all', 'green', 'red']).default('all'),
        sellerType: z.enum(['all', 'business', 'private']).default('all'),
        ...paging,
      })
      .parse(req.query);

    const where: string[] = ['1=1'];
    const values: unknown[] = [];
    const bind = (v: unknown) => {
      values.push(v);
      return `$${values.length}`;
    };

    if (q.search) {
      const p = bind(like(q.search));
      where.push(`(sp_fold(p.title) like sp_fold(${p}) or sp_fold(p.place_name) like sp_fold(${p})
                   or sp_fold(p.city) like sp_fold(${p}) or upper(p.public_code) like upper(${p})
                   or sp_fold(pr.handle) like sp_fold(${p}) or p.id::text = ${bind(q.search.trim())})`);
    }
    if (q.status !== 'all') where.push(`p.status = ${bind(q.status)}`);
    if (q.polarity !== 'all') where.push(`p.polarity = ${bind(q.polarity)}`);
    if (q.sellerType !== 'all') where.push(`p.seller_type = ${bind(q.sellerType)}`);

    const rows = await many<Record<string, unknown>>(
      `select p.id, p.public_code, p.title, p.city, p.place_name, p.address,
              p.latitude, p.longitude, p.price_paid::float as price, p.status, p.polarity,
              p.category, p.seller_type, p.seller_note, p.helped_count, p.created_at,
              pr.handle as author_handle, pr.id as author_id, pr.email as author_email,
              (select count(*) from comments c where c.post_id = p.id)::int as comments_count,
              (select count(*) from post_bookmarks b where b.post_id = p.id)::int as favorites_count
         from posts p join profiles pr on pr.id = p.author_id
        where ${where.join(' and ')}
        order by p.created_at desc
        limit ${bind(q.limit)} offset ${bind(q.offset)}`,
      values
    );

    const total = await one<{ n: number }>(
      `select count(*)::int as n from posts p join profiles pr on pr.id = p.author_id
        where ${where.join(' and ')}`,
      values.slice(0, values.length - 2)
    );

    return { items: rows, total: Number(total?.n ?? 0), limit: q.limit, offset: q.offset };
  });

  app.patch('/api/admin/posts/:id', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z
      .object({
        status: z.enum(['published', 'hidden', 'removed']).optional(),
        title: z.string().trim().min(3).max(200).optional(),
        description: z.string().trim().max(4000).optional(),
        category: z
          .enum(['restaurants', 'hotels_airbnb', 'supermarket', 'cafes_bars', 'services_tech', 'other', 'private_sellers'])
          .optional(),
        sellerType: z.enum(['business', 'private']).optional(),
        sellerNote: z.string().trim().max(1000).nullable().optional(),
        sellerContact: z.string().trim().max(200).nullable().optional(),
        pricePaid: z.coerce.number().positive().max(1_000_000).optional(),
        city: z.string().trim().min(2).max(80).optional(),
        placeName: z.string().trim().min(1).max(200).optional(),
        address: z.string().trim().max(300).nullable().optional(),
        latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
        longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
        isFakePromo: z.boolean().optional(),
        isShrinkflation: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, val: unknown) => {
      values.push(val);
      sets.push(`${col} = $${values.length}`);
    };
    const map: Array<[keyof typeof input, string]> = [
      ['status', 'status'],
      ['title', 'title'],
      ['description', 'description'],
      ['category', 'category'],
      ['sellerType', 'seller_type'],
      ['sellerNote', 'seller_note'],
      ['sellerContact', 'seller_contact'],
      ['pricePaid', 'price_paid'],
      ['city', 'city'],
      ['placeName', 'place_name'],
      ['address', 'address'],
      ['latitude', 'latitude'],
      ['longitude', 'longitude'],
      ['isFakePromo', 'is_fake_promo'],
      ['isShrinkflation', 'is_shrinkflation'],
    ];
    for (const [key, col] of map) {
      if (input[key] !== undefined) push(col, input[key]);
    }
    if (!sets.length) throw badRequest('Няма какво да се обнови.');

    values.push(id);
    const updated = await one<{ public_code: string }>(
      `update posts set ${sets.join(', ')} where id = $${values.length} returning public_code`,
      values
    );
    if (!updated) throw notFound('Офертата не е намерена.');

    await audit({
      admin,
      action: 'post_update',
      targetType: 'post',
      targetId: id,
      targetLabel: updated.public_code,
      details: input,
      ip: req.ip,
    });

    return { ok: true };
  });

  app.delete('/api/admin/posts/:id', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = z.object({ hard: z.coerce.boolean().default(false) }).parse(req.query ?? {});

    const post = await one<{ public_code: string; title: string }>(
      'select public_code, title from posts where id = $1',
      [id]
    );
    if (!post) throw notFound('Офертата не е намерена.');

    if (q.hard) {
      await query('delete from posts where id = $1', [id]);
    } else {
      await one(`update posts set status = 'removed' where id = $1 returning id`, [id]);
    }

    await audit({
      admin,
      action: q.hard ? 'post_delete_hard' : 'post_delete',
      targetType: 'post',
      targetId: id,
      targetLabel: post.public_code,
      details: { title: post.title },
      ip: req.ip,
    });

    return { ok: true, hard: q.hard };
  });

  /* --------------------------------------------------------- коментари */

  app.get('/api/admin/comments', async (req) => {
    await requireAdminPanel(req);
    const q = z
      .object({
        search: z.string().max(120).optional(),
        status: z.enum(['all', 'published', 'hidden', 'removed']).default('all'),
        ...paging,
      })
      .parse(req.query);

    const where: string[] = ['1=1'];
    const values: unknown[] = [];
    const bind = (v: unknown) => {
      values.push(v);
      return `$${values.length}`;
    };
    if (q.search) {
      const p = bind(like(q.search));
      where.push(`(sp_fold(c.body) like sp_fold(${p}) or sp_fold(pr.handle) like sp_fold(${p})
                   or upper(p.public_code) like upper(${p}))`);
    }
    if (q.status !== 'all') where.push(`c.status = ${bind(q.status)}`);

    const rows = await many<Record<string, unknown>>(
      `select c.id, c.body, c.status, c.likes_count, c.created_at,
              pr.handle as author_handle, pr.email as author_email, pr.id as author_id,
              p.public_code, p.title as post_title, p.id as post_id
         from comments c
         join profiles pr on pr.id = c.author_id
         join posts p on p.id = c.post_id
        where ${where.join(' and ')}
        order by c.created_at desc
        limit ${bind(q.limit)} offset ${bind(q.offset)}`,
      values
    );

    const total = await one<{ n: number }>(
      `select count(*)::int as n from comments c
         join profiles pr on pr.id = c.author_id join posts p on p.id = c.post_id
        where ${where.join(' and ')}`,
      values.slice(0, values.length - 2)
    );

    return { items: rows, total: Number(total?.n ?? 0), limit: q.limit, offset: q.offset };
  });

  app.patch('/api/admin/comments/:id', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z
      .object({ status: z.enum(['published', 'hidden', 'removed']), body: z.string().trim().min(1).max(2000).optional() })
      .parse(req.body);

    const sets = ['status = $2'];
    const values: unknown[] = [id, input.status];
    if (input.body !== undefined) {
      values.push(input.body);
      sets.push(`body = $${values.length}`);
    }

    const updated = await one<{ id: string }>(
      `update comments set ${sets.join(', ')} where id = $1 returning id`,
      values
    );
    if (!updated) throw notFound('Коментарът не е намерен.');

    await audit({
      admin,
      action: 'comment_update',
      targetType: 'comment',
      targetId: id,
      details: input,
      ip: req.ip,
    });
    return { ok: true };
  });

  app.delete('/api/admin/comments/:id', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await query('delete from comments where id = $1', [id]);
    await audit({ admin, action: 'comment_delete', targetType: 'comment', targetId: id, ip: req.ip });
    return { ok: true };
  });

  /* ------------------------------------------------------------ сигнали */

  app.get('/api/admin/reports', async (req) => {
    await requireAdminPanel(req);
    const q = z
      .object({ status: z.enum(['all', 'open', 'reviewed', 'dismissed', 'actioned']).default('all'), ...paging })
      .parse(req.query);

    const rows = await many<Record<string, unknown>>(
      `select r.id, r.reason, r.details, r.status, r.created_at,
              rep.handle as reporter_handle,
              p.public_code, p.title as post_title, p.id as post_id,
              c.body as comment_body, c.id as comment_id
         from content_reports r
         join profiles rep on rep.id = r.reporter_id
         left join posts p on p.id = r.post_id
         left join comments c on c.id = r.comment_id
        where ($1 = 'all' or r.status = $1)
        order by r.created_at desc limit $2 offset $3`,
      [q.status, q.limit, q.offset]
    );
    return { items: rows, limit: q.limit, offset: q.offset };
  });

  app.patch('/api/admin/reports/:id', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z
      .object({ status: z.enum(['open', 'reviewed', 'dismissed', 'actioned']) })
      .parse(req.body);
    await one(`update content_reports set status = $2 where id = $1 returning id`, [id, input.status]);
    await audit({ admin, action: 'report_update', targetType: 'report', targetId: id, details: input, ip: req.ip });
    return { ok: true };
  });

  /* --------------------------------------------------------- категории */

  app.get('/api/admin/categories', async (req) => {
    await requireAdminPanel(req);
    const rows = await many<Record<string, unknown>>(
      `select cl.id, cl.title, cl.emoji, cl.synonyms, cl.sort_order, cl.updated_at,
              (select count(*) from posts p where p.category = cl.id and p.status = 'published')::int as posts
         from category_labels cl order by cl.sort_order, cl.id`
    );
    return { items: rows };
  });

  app.patch('/api/admin/categories/:id', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().trim().min(2).max(40) }).parse(req.params);
    const input = z
      .object({
        title: z.string().trim().min(2).max(60).optional(),
        emoji: z.string().trim().max(8).optional(),
        synonyms: z.string().trim().max(600).optional(),
        sortOrder: z.coerce.number().int().min(0).max(999).optional(),
      })
      .strict()
      .parse(req.body);

    const sets: string[] = [];
    const values: unknown[] = [id];
    const push = (col: string, val: unknown) => {
      values.push(val);
      sets.push(`${col} = $${values.length}`);
    };
    if (input.title !== undefined) push('title', input.title);
    if (input.emoji !== undefined) push('emoji', input.emoji);
    if (input.synonyms !== undefined) push('synonyms', input.synonyms);
    if (input.sortOrder !== undefined) push('sort_order', input.sortOrder);
    if (!sets.length) throw badRequest('Няма какво да се обнови.');
    sets.push('updated_at = now()');

    const updated = await one<{ id: string }>(
      `update category_labels set ${sets.join(', ')} where id = $1 returning id`,
      values
    );
    if (!updated) throw notFound('Категорията не е намерена.');

    await audit({ admin, action: 'category_update', targetType: 'category', targetId: id, details: input, ip: req.ip });
    return { ok: true };
  });

  /* ------------------------------------------- покани, любими, одит, аларми */

  app.get('/api/admin/referrals', async (req) => {
    await requireAdminPanel(req);
    const q = z.object({ ...paging }).parse(req.query);

    const [rows, summary] = await Promise.all([
      many<Record<string, unknown>>(
        `select r.id, r.status, r.created_at, r.rewarded_at,
                ref.handle as referrer_handle, ref.id as referrer_id, ref.referral_code,
                new.handle as referred_handle, new.id as referred_id
           from referrals r
           join profiles ref on ref.id = r.inviter_id
           join profiles new on new.id = r.invitee_id
          order by r.created_at desc limit $1 offset $2`,
        [q.limit, q.offset]
      ),
      one<Record<string, unknown>>(
        `select count(*)::int as total,
                count(*) filter (where status = 'rewarded')::int as rewarded,
                count(*) filter (where status = 'pending')::int as pending,
                count(*) filter (where status = 'void')::int as void
           from referrals`
      ),
    ]);

    return { items: rows, summary };
  });

  app.get('/api/admin/favorites', async (req) => {
    await requireAdminPanel(req);
    const q = z.object({ ...paging }).parse(req.query);
    const [top, summary] = await Promise.all([
      many<Record<string, unknown>>(
        `select p.id, p.public_code, p.title, p.city, p.place_name, p.latitude, p.longitude,
                count(b.user_id)::int as favorites
           from post_bookmarks b join posts p on p.id = b.post_id
          group by p.id, p.public_code, p.title, p.city, p.place_name, p.latitude, p.longitude
          order by favorites desc limit $1 offset $2`,
        [q.limit, q.offset]
      ),
      one<Record<string, unknown>>(
        `select count(*)::int as total,
                count(distinct user_id)::int as users,
                count(*) filter (where note is not null)::int as with_note
           from post_bookmarks`
      ),
    ]);
    return { items: top, summary };
  });

  app.get('/api/admin/audit', async (req) => {
    await requireAdminPanel(req);
    const q = z
      .object({ action: z.string().max(60).optional(), ...paging })
      .parse(req.query);
    const rows = await many<Record<string, unknown>>(
      `select id, admin_email, action, target_type, target_id, target_label, details, ip, created_at
         from admin_audit_log
        where ($1::text is null or action = $1)
        order by created_at desc limit $2 offset $3`,
      [q.action ?? null, q.limit, q.offset]
    );
    return { items: rows };
  });

  app.get('/api/admin/security', async (req) => {
    await requireAdminPanel(req);
    const q = z
      .object({ onlyOpen: z.coerce.boolean().default(false), ...paging })
      .parse(req.query);
    const rows = await many<Record<string, unknown>>(
      `select id, kind, severity, title, details, subject_type, subject_id, subject_label, ip,
              alerted_at, resolved_at, created_at
         from security_events
        where (not $1 or resolved_at is null)
        order by created_at desc limit $2 offset $3`,
      [q.onlyOpen, q.limit, q.offset]
    );
    return { items: rows };
  });

  /** Пуска проверката веднага (не чака 5-минутния цикъл). */
  app.post('/api/admin/security/scan', async (req) => {
    const admin = await requireAdminPanel(req);
    const res = await runSecurityScan();
    await audit({
      admin,
      action: 'security_scan',
      details: { found: res.found, alerted: res.alerted },
      ip: req.ip,
    });
    return res;
  });

  app.post('/api/admin/security/:id/resolve', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const updated = await one<{ id: string }>(
      `update security_events set resolved_at = now(), resolved_by = $2 where id = $1 and resolved_at is null
       returning id`,
      [id, admin.id]
    );
    if (!updated) throw notFound('Събитието не е намерено или вече е затворено.');
    await audit({ admin, action: 'security_resolve', targetType: 'security_event', targetId: String(id), ip: req.ip });
    return { ok: true };
  });

  /** Тестово писмо до ALERT_EMAIL, за да се провери, че алармите стигат. */
  app.post('/api/admin/security/test-alert', async (req) => {
    const admin = await requireAdminPanel(req);
    const { to } = z.object({ to: z.string().email().optional() }).parse(req.body ?? {});
    const email = to ?? ALERT_EMAIL;
    const res = await sendAdminAlertEmail({
      to: email,
      title: 'Тестова аларма от админ панела',
      severity: 'info',
      kind: 'test',
      details: { изпратено_от: admin.email, време: new Date().toISOString() },
    });
    await one(
      `insert into admin_email_log (to_email, subject, kind, provider_id, status, related_type, related_id)
       values ($1,'[SmartPrice алерт] Тестова аларма','security_alert_test',$2,'sent','profile',$3) returning id`,
      [email, res.id, admin.id]
    );
    await audit({ admin, action: 'security_test_alert', details: { to: email }, ip: req.ip });
    return { ok: true, to: email, providerId: res.id };
  });

  /* ------------------------------------------------------------- имейли */

  app.get('/api/admin/emails', async (req) => {
    await requireAdminPanel(req);
    const q = z.object({ ...paging }).parse(req.query);
    const rows = await many<Record<string, unknown>>(
      `select id, to_email, subject, kind, provider_id, status, error, related_type, related_id, created_at
         from admin_email_log order by created_at desc limit $1 offset $2`,
      [q.limit, q.offset]
    );
    return { items: rows };
  });

  /** Ръчно писмо до потребител (или до произволен адрес). */
  app.post('/api/admin/emails/send', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        userId: z.string().uuid().optional(),
        to: z.string().email().optional(),
        subject: z.string().trim().min(3).max(160),
        message: z.string().trim().min(3).max(5000),
      })
      .parse(req.body);

    let email = input.to ?? null;
    let name = '';
    if (input.userId) {
      const row = await one<{ email: string; name: string }>(
        'select email, name from profiles where id = $1',
        [input.userId]
      );
      if (!row) throw notFound('Профилът не е намерен.');
      email = row.email;
      name = row.name;
    }
    if (!email) throw badRequest('Посочи профил или имейл.');

    const safe = input.message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const res = await sendAdminAlertEmail({
      to: email,
      title: input.subject,
      severity: 'info',
      kind: 'admin_message',
      details: { до: name ? `${name} <${email}>` : email, съобщение: safe },
    });

    await one(
      `insert into admin_email_log (to_email, subject, kind, provider_id, status, related_type, related_id)
       values ($1,$2,'admin_message',$3,'sent',$4,$5) returning id`,
      [email, input.subject, res.id, input.userId ? 'profile' : null, input.userId ?? null]
    );
    await audit({ admin, action: 'email_send', targetType: 'profile', targetId: input.userId ?? null, details: { to: email, subject: input.subject }, ip: req.ip });

    return { ok: true, to: email, providerId: res.id };
  });
}

/** Помощна: взима IP-то от заявката (ползва се в одита). */
export function requestIp(req: FastifyRequest): string {
  return req.ip ?? '';
}
