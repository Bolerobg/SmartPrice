import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { many, one, query, tx } from '../db.js';
import { env } from '../env.js';
import { badRequest, conflict, notFound, tooLarge, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/auth.js';
import { putImage, publicUrl, storageDriver } from '../lib/storage.js';
import {
  adminEmails,
  audit,
  isAdminProfile,
  loadAdminById,
  loadDashboardStats,
  requireAdminPanel,
  requireFullAdmin,
  signAdminToken,
} from '../lib/admin.js';
import { generateTotpSecret, totpUri, verifyTotp } from '../lib/totp.js';
import { anonymizeUser, eraseUser, gdprPreview, searchUsersForGdpr } from '../lib/gdpr.js';
import { runSecurityScan, ALERT_EMAIL } from '../lib/security.js';
import { invalidateKnowledgeCache } from './assistant.js';
import { retrainCenko, lastRetrain, logRetrain } from '../lib/cenkoKnowledge.js';
import { getSetting, setSetting } from '../lib/settings.js';
import {
  digestInfo,
  sendWeeklyDigest,
  setDigestEnabled,
} from '../lib/digest.js';
import {
  addLead,
  deleteLead,
  leadsBudget,
  leadsCsv,
  leadsReport,
  listLeads,
  listSearchRuns,
  planDayRoute,
  refreshLeadFlags,
  setLeadStatus,
  startLeadsSearch,
} from '../lib/leads.js';
import { sendPushToAll } from '../lib/push.js';
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
      .object({
        email: z.string().trim().email(),
        password: z.string().min(1).max(200),
        /** Код от приложението-автентикатор, ако е включена двуфакторна защита. */
        code: z.string().trim().max(10).optional(),
      })
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

    // Двуфакторна защита (TOTP): ако е включена, без верен код не пускаме.
    const totpRow = await one<{ totp_secret: string | null; totp_enabled: boolean }>(
      `select totp_secret, coalesce(totp_enabled, false) as totp_enabled from profiles where id = $1`,
      [row.id]
    );
    if (totpRow?.totp_enabled && totpRow.totp_secret) {
      const code = String(input.code ?? '').replace(/\D/g, '');
      if (!code) throw unauthorized('Въведи кода от приложението за двуфакторна защита.');
      if (!verifyTotp(totpRow.totp_secret, code)) {
        await one(`insert into login_attempts (email, ip, ok, reason) values ($1,$2,false,$3) returning id`, [
          input.email,
          ip,
          'wrong_totp',
        ]).catch(() => undefined);
        throw unauthorized('Грешен код за двуфакторна защита.');
      }
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

  /**
   * ⏳ Колко чака одобрение — на едно място.
   *
   * Защо: одобрението живее на три различни места (оферти от сайтовете в Скрапера,
   * бележки от Фейсбук и нови групи за преглед). Човек трябваше да обикаля
   * табовете, за да види има ли нещо за него. Тук връщаме едно число за всяко
   * място, а панелът ги показва като значки и карта на началния екран.
   */
  app.get('/api/admin/pending/summary', async (req) => {
    await requireAdminPanel(req);
    const [offers, receipts, groups, robot] = await Promise.all([
      one<{ n: number }>(
        `select count(*)::int as n from scrape_items where status = 'parsed'`
      ).catch(() => null),
      one<{ n: number }>(
        `select count(*)::int as n from fb_receipt_queue where status = 'pending'`
      ).catch(() => null),
      one<{ n: number }>(
        `select count(*)::int as n from fb_group_candidates where status = 'pending'`
      ).catch(() => null),
      one<{ n: number }>(
        `select count(*)::int as n from local_scan_queue where status in ('pending', 'taken')`
      ).catch(() => null),
    ]);
    const o = offers?.n ?? 0;
    const r = receipts?.n ?? 0;
    const g = groups?.n ?? 0;
    const b = robot?.n ?? 0;
    return { offers: o, receipts: r, groups: g, robot: b, total: o + r + g };
  });

  /* ------------------------------------------- бонус за основатели */

  /**
   * Значка „Основател“: първата находка, качена до N минути след регистрацията.
   * Настройките стоят в app_settings, за да може бонусът да се спре, щом
   * базата се напълни с реални данни.
   */
  app.get('/api/admin/founder', async (req) => {
    await requireAdminPanel(req);
    const [enabled, windowMin, points, awarded] = await Promise.all([
      getSetting('founder_bonus', 'on'),
      getSetting('founder_window_min', '5'),
      getSetting('founder_points', '100'),
      one<{ n: string }>(
        `select count(*) as n from profile_badges
          where badge_id = 'badge-founder' and unlocked_at is not null`
      ),
    ]);
    return {
      enabled: enabled !== 'off',
      windowMin: Number(windowMin) || 5,
      points: Number(points) || 100,
      awarded: Number(awarded?.n ?? 0),
    };
  });

  app.post('/api/admin/founder', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        enabled: z.boolean().optional(),
        windowMin: z.coerce.number().int().min(1).max(120).optional(),
        points: z.coerce.number().int().min(0).max(10000).optional(),
      })
      .parse(req.body ?? {});

    if (input.enabled !== undefined) await setSetting('founder_bonus', input.enabled ? 'on' : 'off');
    if (input.windowMin !== undefined) await setSetting('founder_window_min', String(input.windowMin));
    if (input.points !== undefined) await setSetting('founder_points', String(input.points));

    await audit({ admin, action: 'founder.settings', details: input });
    return { ok: true };
  });

  /* ------------- внасяне на реални бонове (кошче на касата) и брошури */

  /**
   * Маскира лични данни, преди да влязат в базата.
   *
   * По боновете редовно има неща, които НЕ ни трябват и не бива да публикуваме:
   * последни цифри на карта, IBAN, номера на карти за лоялност. Човекът, който
   * е изхвърлил бона, не е давал съгласие да ги вижда целият интернет.
   */
  const maskSensitive = (value?: string | null): string | null => {
    if (!value) return null;
    return value
      .replace(/\bBG\d{2}[A-Z0-9]{14,20}\b/gi, '••••')
      .replace(/\b(?:\d[ -]?){12,19}\b/g, '••••')
      .replace(/\b\d{10,}\b/g, '••••');
  };

  /** Редакционният профил, под който излизат внасяните бонове. */
  async function officialProfileId(): Promise<string> {
    const existing = await one<{ id: string }>(
      `select id from profiles where is_official order by created_at asc limit 1`
    );
    if (existing) return existing.id;

    const created = await one<{ id: string }>(
      `insert into profiles
         (email, email_key, password_hash, name, handle, city, bio,
          reputation_points, is_official)
       values ($1::citext, normalize_email($1::text), 'no-login', $2, $3, $4, $5, 0, true)
       on conflict (email) do update set is_official = true
       returning id`,
      [
        'redakcia@smartprice.bg',
        'SmartPrice Редакция',
        'smartprice_bg',
        'София',
        'Внасяме реални цени от изхвърлени касови бонове и официални брошури. Не сме потребител — казваме го честно, за да знаеш откъде идва всяка цена.',
      ]
    );
    await query(
      `insert into profile_badges (profile_id, badge_id)
       select $1, id from badges on conflict do nothing`,
      [created!.id]
    );
    return created!.id;
  }

  app.get('/api/admin/import/info', async (req) => {
    await requireAdminPanel(req);
    const authorId = await officialProfileId();
    const official = await one<{ name: string; handle: string }>(
      `select name, handle from profiles where id = $1`,
      [authorId]
    );
    const bySource = await many<{ source: string; n: string }>(
      `select coalesce(source, 'user') as source, count(*) as n
         from posts group by 1 order by 2 desc`
    );
    return {
      official,
      bySource: bySource.map((r) => ({ source: r.source, count: Number(r.n) })),
    };
  });

  const importItemSchema = z.object({
    name: z.string().trim().min(1).max(200),
    quantity: z.coerce.number().positive().max(10000).default(1),
    unitPrice: z.coerce.number().min(0).max(1_000_000),
    totalPrice: z.coerce.number().min(0).max(1_000_000).optional(),
    highlightReason: z.string().trim().max(200).optional(),
  });

  const importPostSchema = z.object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).default(''),
    merchantName: z.string().trim().min(1).max(200),
    merchantTaxId: z.string().trim().max(40).optional(),
    placeName: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(80),
    address: z.string().trim().max(200).optional(),
    category: z
      .enum(['restaurants', 'hotels_airbnb', 'supermarket', 'cafes_bars', 'services_tech', 'other'])
      .default('supermarket'),
    polarity: z.enum(['green', 'red']).default('green'),
    pricePaid: z.coerce.number().positive().max(1_000_000),
    referencePrice: z.coerce.number().positive().max(1_000_000).optional(),
    currency: z.enum(['BGN', 'EUR']).default('EUR'),
    unitQuantity: z.coerce.number().positive().max(10000).optional(),
    unitType: z.enum(['g', 'kg', 'ml', 'l', 'pcs']).optional(),
    receiptDate: z.string().trim().max(40).optional(),
    receiptTime: z.string().trim().max(20).optional(),
    imageUrl: z.string().trim().max(600).optional(),
    sourceNote: z.string().trim().max(300).optional(),
    items: z.array(importItemSchema).max(200).default([]),
  });

  /** Държави/градове извън България — такива сравнения не се публикуват. */
  const FOREIGN_LOCATION_RE =
    /(Милано|Италия|Рим|Болоня|Наполи|Торино|Венеция|Гърция|Атина|Солун|Румъния|Букурещ|Сърбия|Белград|Турция|Истанбул|Анкара|Германия|Берлин|Мюнхен|Хамбург|Австрия|Виена|Франция|Париж|Испания|Мадрид|Барселона|Португалия|Лисабон|Нидерландия|Амстердам|Белгия|Брюксел|Полша|Варшава|Унгария|Будапеща|Чехия|Прага|Словакия|Братислава|Хърватия|Загреб|Словения|Любляна|Лондон|Великобритания|Англия|Швеция|Стокхолм|Дания|Копенхаген|Финландия|Хелзинки|Норвегия|Осло|Швейцария|Цюрих|Женева|САЩ|Америка|Ню Йорк|Чикаго|Канада|Торонто|Дубай|Абу Даби|ОАЕ|Кипър|Малта|Ирландия|Сингапур|Китай|Япония|Токио|Корея|Сидни|Австралия|чужбина|в чужбина)/i;

  app.post('/api/admin/import/receipts', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        source: z.enum(['receipt_basket', 'brochure', 'tiktok_signal', 'import']).default('receipt_basket'),
        sourceNote: z.string().trim().max(300).optional(),
        posts: z.array(importPostSchema).min(1).max(200),
      })
      .parse(req.body ?? {});

    const authorId = await officialProfileId();
    const created: string[] = [];
    const skipped: Array<{ title: string; reason: string }> = [];

    for (const p of input.posts) {
      try {
        /**
         * 🌍 СРАВНЕНИЯ САМО В БЪЛГАРИЯ (заявка 22.10.2026).
         *
         * Роботът/ИИ понякога правеше „Сравнение на цени… в Милано и … в София“
         * — сравнение с чужда държава, което няма смисъл за потребителя тук и
         * подвежда (различни пазари, ДДС, грамаж). Затова такива постове НЕ се
         * публикуват: отпадат с причина, за да се вижда в дневника на вноса.
         */
        const haystack = `${p.title} ${p.description ?? ''}`;
        if (FOREIGN_LOCATION_RE.test(haystack)) {
          skipped.push({
            title: p.title,
            reason: 'сравнение извън България — не се публикува (само български вериги и градове)',
          });
          continue;
        }

        const perUnit =
          p.unitQuantity && p.unitType
            ? Number(((p.pricePaid / p.unitQuantity) * (p.unitType === 'kg' || p.unitType === 'l' ? 1000 : 1)).toFixed(4))
            : null;

        const id = await tx(async (client) => {
          const res = await client.query<{ id: string }>(
            `insert into posts (
               author_id, polarity, category, platform_tag, title, description,
               place_name, city, address, price_paid, reference_price, currency,
               unit_quantity, unit_type, price_per_unit, image_url, tags,
               seller_type, source, source_note
             ) values (
               $1,$2,$3,'На място',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               'business',$17,$18
             ) returning id`,
            [
              authorId,
              p.polarity,
              p.category,
              p.title,
              p.description,
              p.placeName,
              p.city,
              p.address ?? null,
              p.pricePaid,
              p.referencePrice ?? null,
              p.currency,
              p.unitQuantity ?? null,
              p.unitType ?? null,
              perUnit,
              p.imageUrl ?? '',
              [p.polarity === 'green' ? '#ТопНаходка' : '#ЧервенФлаг', `#${p.city.replace(/\s+/g, '')}`],
              input.source,
              maskSensitive(p.sourceNote ?? input.sourceNote ?? null),
            ]
          );
          const postId = res.rows[0]!.id;

          await client.query(
            `insert into price_history (post_id, price, status, reported_by)
             values ($1,$2,'initial',$3)`,
            [postId, p.pricePaid, authorId]
          );

          const receipt = await client.query<{ id: string }>(
            `insert into receipts (
               post_id, merchant_name, merchant_tax_id, receipt_date, receipt_time,
               total_amount, currency, confidence, verified_by_ai, source, image_url
             ) values ($1,$2,$3,$4,$5,$6,$7,0,false,'manual',$8) returning id`,
            [
              postId,
              p.merchantName,
              maskSensitive(p.merchantTaxId ?? null),
              p.receiptDate ?? null,
              p.receiptTime ?? null,
              p.pricePaid,
              p.currency,
              p.imageUrl ?? null,
            ]
          );
          const receiptId = receipt.rows[0]!.id;

          for (const [index, item] of p.items.entries()) {
            const total = item.totalPrice ?? Number((item.quantity * item.unitPrice).toFixed(2));
            await client.query(
              `insert into receipt_items
                 (receipt_id, position, name, quantity, unit_price, total_price, highlight_reason)
               values ($1,$2,$3,$4,$5,$6,$7)`,
              [receiptId, index, item.name, item.quantity, item.unitPrice, total, item.highlightReason ?? null]
            );
          }
          return postId;
        });
        created.push(id);
      } catch (err) {
        skipped.push({ title: p.title, reason: (err as Error).message.slice(0, 200) });
      }
    }

    await audit({
      admin,
      action: 'import.receipts',
      details: { source: input.source, created: created.length, skipped: skipped.length },
    });
    return { created: created.length, skipped };
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
              pr.phone, pr.signup_ip,
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

  /* ------------------------------------------------- качване на снимка */

  /**
   * Качване на снимка от панела (напр. снимка на наградата за томбола).
   * Ползва същото хранилище като приложението (диск или S3), но с токена на
   * дашборда. Връща публичния адрес, който се слага в полето за снимка.
   */
  app.post('/api/admin/upload', async (req, reply) => {
    const admin = await requireAdminPanel(req);

    const file = await req.file();
    if (!file) throw badRequest('Не е изпратен файл.');

    const allowed = new Map<string, string>([
      ['image/jpeg', 'jpg'],
      ['image/jpg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
    ]);
    const extension = allowed.get(file.mimetype);
    if (!extension) throw badRequest('Позволени формати: JPEG, PNG, WebP.');

    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    const chunks: Buffer[] = [];
    let bytes = 0;
    let tooBig = false;

    for await (const chunk of file.file) {
      const buf = chunk as Buffer;
      bytes += buf.length;
      if (bytes > maxBytes) {
        tooBig = true;
        file.file.destroy();
        break;
      }
      chunks.push(buf);
    }
    if (tooBig) throw tooLarge(`Снимката е твърде голяма (макс. ${env.MAX_UPLOAD_MB} MB).`);
    if (bytes === 0) throw badRequest('Файлът е празен.');

    const storedName = `${randomUUID()}.${extension}`;
    await putImage(storedName, Buffer.concat(chunks), file.mimetype);
    await one(
      `insert into uploads (owner_id, stored_name, mime_type, byte_size, storage)
       values ($1,$2,$3,$4,$5) returning id`,
      [admin.id, storedName, file.mimetype, bytes, storageDriver]
    );

    const url = publicUrl(storedName);
    await audit({
      admin,
      action: 'upload_image',
      targetType: 'upload',
      targetId: storedName,
      details: { bytes, mime: file.mimetype, url },
      ip: req.ip,
    });

    return reply.status(201).send({ url, byteSize: bytes, mimeType: file.mimetype });
  });

  /* ==========================================================================
   *  AI СЪВЕТНИКЪТ „ЦЕНКО“ — знанието и статистиката
   *
   *  Ценко чете наръчника от базата (assistant_knowledge) при всеки въпрос.
   *  Затова КОГАТО ВЛЕЗЕ НОВО НЕЩО В ПРИЛОЖЕНИЕТО, тук се добавя нов ред —
   *  и Ценко веднага започва да го обяснява на хората. Без нов билд.
   * ========================================================================== */

  const knowledgeInput = z.object({
    title: z.string().trim().min(3, 'Заглавието е задължително.').max(200),
    body: z.string().trim().min(3, 'Обяснението е задължително.').max(4000),
    // Думите могат да дойдат като текст, разделен със запетаи (така ги пише човек).
    keywords: z
      .union([z.array(z.string()), z.string()])
      .optional()
      .transform((v) =>
        Array.isArray(v)
          ? v.map((s) => s.trim()).filter(Boolean)
          : String(v ?? '')
              .split(/[,;\n]/)
              .map((s) => s.trim())
              .filter(Boolean)
      ),
    category: z.string().trim().max(40).default('basics'),
    priority: z.coerce.number().int().min(1).max(10).default(5),
    isActive: z.boolean().default(true),
  });

  app.get('/api/admin/assistant/knowledge', async (req) => {
    await requireAdminPanel(req);
    const q = z
      .object({ q: z.string().trim().max(120).optional() })
      .parse(req.query ?? {});
    const rows = await many<{
      id: string;
      title: string;
      body: string;
      keywords: string[] | null;
      category: string;
      priority: number;
      is_active: boolean;
      source: string;
      updated_at: string;
    }>(
      q.q
        ? `select id::text, title, body, keywords, category, priority, is_active, source, updated_at::text
             from assistant_knowledge
            where title ilike $1 or body ilike $1
            order by priority asc, updated_at desc`
        : `select id::text, title, body, keywords, category, priority, is_active, source, updated_at::text
             from assistant_knowledge
            order by priority asc, updated_at desc`,
      q.q ? [`%${q.q}%`] : []
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        keywords: r.keywords ?? [],
        category: r.category,
        priority: r.priority,
        isActive: r.is_active,
        source: r.source,
        updatedAt: r.updated_at,
      })),
      /** Кога Ценко се самообучи последно (за бутона в панела). */
      lastRetrain: await lastRetrain(),
    };
  });

  /**
   * САМООБУЧЕНИЕ НА ЦЕНКО — „научи новото сега“.
   *
   * Чете наръчника от файла (knowledge/cenko-narachnik.md) и живите факти от
   * базата (значки, категории, активна томбола, настройки), записва ги като теми
   * и обявява новото на Ценко веднага. Същото се пуска и само веднъж на ден.
   */
  app.post('/api/admin/assistant/retrain', async (req) => {
    const admin = await requireAdminPanel(req);
    const report = await retrainCenko();
    await logRetrain(report, 'manual');
    await audit({
      admin,
      action: 'assistant.retrain',
      targetType: 'assistant_knowledge',
      targetId: null,
    });
    return report;
  });

  /** История на самообучението — за да се вижда, че работи и какво е научил. */
  app.get('/api/admin/assistant/retrain', async (req) => {
    await requireAdminPanel(req);
    const rows = await many<{
      at: string;
      trigger: string;
      from_manual: number;
      live_facts: number;
      disabled: number;
      active: number;
      note: string | null;
    }>(
      `select at::text, trigger, from_manual, live_facts, disabled, active, note
         from assistant_retrain_log
        order by at desc
        limit 20`
    ).catch(() => []);
    return {
      last: await lastRetrain(),
      log: rows.map((r) => ({
        at: r.at,
        trigger: r.trigger,
        fromManual: r.from_manual,
        liveFacts: r.live_facts,
        disabled: r.disabled,
        active: r.active,
        note: r.note,
      })),
    };
  });

  app.post('/api/admin/assistant/knowledge', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = knowledgeInput.parse(req.body ?? {});
    const row = await one<{ id: string }>(
      `insert into assistant_knowledge (title, body, keywords, category, priority, is_active, source)
       values ($1,$2,$3::text[],$4,$5,$6,'admin') returning id::text`,
      [input.title, input.body, input.keywords, input.category, input.priority, input.isActive]
    );
    await audit({
      admin,
      action: 'assistant_knowledge_create',
      targetType: 'assistant_knowledge',
      targetId: row?.id ?? null,
      targetLabel: input.title,
      details: { category: input.category, priority: input.priority },
      ip: req.ip,
    });
    // Кешът на знанието е 2 минути → чистим го, за да влезе веднага.
    invalidateKnowledgeCache();
    return { ok: true, id: row?.id ?? null };
  });

  app.patch('/api/admin/assistant/knowledge/:id', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const input = knowledgeInput.partial().parse(req.body ?? {});
    const sets: string[] = [];
    const values: unknown[] = [];
    const put = (sql: string, v: unknown) => {
      values.push(v);
      sets.push(sql.replace('?', `$${values.length}`));
    };
    if (input.title !== undefined) put('title = ?', input.title);
    if (input.body !== undefined) put('body = ?', input.body);
    if (input.keywords !== undefined) put('keywords = ?::text[]', input.keywords);
    if (input.category !== undefined) put('category = ?', input.category);
    if (input.priority !== undefined) put('priority = ?', input.priority);
    if (input.isActive !== undefined) put('is_active = ?', input.isActive);
    if (!sets.length) throw badRequest('Няма какво да се обнови.');
    values.push(id);
    await one(
      `update assistant_knowledge set ${sets.join(', ')}, updated_at = now()
        where id = $${values.length}::bigint returning id`,
      values
    );
    await audit({
      admin,
      action: 'assistant_knowledge_update',
      targetType: 'assistant_knowledge',
      targetId: id,
      targetLabel: input.title ?? null,
      details: { fields: Object.keys(input) },
      ip: req.ip,
    });
    invalidateKnowledgeCache();
    return { ok: true };
  });

  app.delete('/api/admin/assistant/knowledge/:id', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    await one('delete from assistant_knowledge where id = $1::bigint returning id', [id]);
    await audit({
      admin,
      action: 'assistant_knowledge_delete',
      targetType: 'assistant_knowledge',
      targetId: id,
      ip: req.ip,
    });
    invalidateKnowledgeCache();
    return { ok: true };
  });

  /** Какво питат хората — за да знаем какво да добавим в наръчника. */
  app.get('/api/admin/assistant/questions', async (req) => {
    await requireAdminPanel(req);
    const [recent, top, stats] = await Promise.all([
      many<{
        question: string;
        user_name: string | null;
        is_greeting: boolean;
        latency_ms: number | null;
        created_at: string;
      }>(
        `select m.question, p.name as user_name, m.is_greeting, m.latency_ms, m.created_at::text
           from assistant_messages m
           left join profiles p on p.id = m.user_id
          where m.is_greeting = false
          order by m.created_at desc
          limit 40`
      ),
      many<{ question: string; n: number }>(
        `select lower(question) as question, count(*)::int as n
           from assistant_messages
          where is_greeting = false and char_length(question) > 6
          group by lower(question)
          having count(*) > 1
          order by n desc
          limit 15`
      ),
      one<{
        total: number;
        today: number;
        users: number;
        guests: number;
        avg_ms: number | null;
        prompt_tokens: number | null;
        answer_tokens: number | null;
      }>(
        `select count(*)::int as total,
                count(*) filter (where created_at > now() - interval '24 hours')::int as today,
                count(distinct user_id) filter (where user_id is not null)::int as users,
                count(*) filter (where user_id is null)::int as guests,
                round(avg(latency_ms))::int as avg_ms,
                coalesce(sum(prompt_tokens),0)::int as prompt_tokens,
                coalesce(sum(answer_tokens),0)::int as answer_tokens
           from assistant_messages`
      ),
    ]);
    return { recent, top, stats };
  });
  /* ------------------------------------------- двуфакторна защита (2FA) */

  app.get('/api/admin/2fa/status', async (req) => {
    const admin = await requireAdminPanel(req);
    const row = await one<{ totp_enabled: boolean; totp_secret: string | null }>(
      `select coalesce(totp_enabled, false) as totp_enabled, totp_secret from profiles where id = $1`,
      [admin.id]
    );
    return {
      enabled: Boolean(row?.totp_enabled),
      pendingSetup: Boolean(row?.totp_secret) && !row?.totp_enabled,
    };
  });

  app.post('/api/admin/2fa/setup', async (req) => {
    const admin = await requireFullAdmin(req);
    const secret = generateTotpSecret();
    await query(`update profiles set totp_secret = $2, totp_enabled = false where id = $1`, [admin.id, secret]);
    return { ok: true, secret, uri: totpUri(admin.email, secret), issuer: 'SmartPrice' };
  });

  app.post('/api/admin/2fa/enable', async (req) => {
    const admin = await requireFullAdmin(req);
    const input = z.object({ code: z.string().trim().min(6).max(10) }).parse(req.body ?? {});
    const row = await one<{ totp_secret: string | null }>(`select totp_secret from profiles where id = $1`, [admin.id]);
    if (!row?.totp_secret) throw badRequest('Първо натисни „Настрой двуфакторна защита“.');
    if (!verifyTotp(row.totp_secret, input.code)) {
      throw badRequest('Кодът не съвпада. Провери часовника на телефона и опитай пак.');
    }
    await query(`update profiles set totp_enabled = true, totp_confirmed_at = now() where id = $1`, [admin.id]);
    await audit({ admin, action: 'admin.2fa_enable', ip: req.ip });
    return { ok: true };
  });

  app.post('/api/admin/2fa/disable', async (req) => {
    const admin = await requireFullAdmin(req);
    const input = z
      .object({ code: z.string().trim().max(10).optional(), password: z.string().max(200).optional() })
      .parse(req.body ?? {});
    const row = await one<{ totp_secret: string | null; password_hash: string }>(
      `select totp_secret, password_hash from profiles where id = $1`,
      [admin.id]
    );
    const byPassword = input.password ? await verifyPassword(input.password, row?.password_hash ?? '') : false;
    const byCode = input.code && row?.totp_secret ? verifyTotp(row.totp_secret, input.code) : false;
    if (!byPassword && !byCode) throw badRequest('Въведи паролата си (или код от приложението), за да спреш защитата.');
    await query(`update profiles set totp_secret = null, totp_enabled = false, totp_confirmed_at = null where id = $1`, [
      admin.id,
    ]);
    await audit({ admin, action: 'admin.2fa_disable', ip: req.ip });
    return { ok: true };
  });

  /* ------------------------------------------- екип и роли */

  app.get('/api/admin/team', async (req) => {
    await requireAdminPanel(req);
    const team = await many<Record<string, unknown>>(
      `select id::text, name, email::text, handle, role, coalesce(totp_enabled, false) as totp_enabled,
              created_at::text, last_login_at::text
         from profiles
        where role in ('admin', 'moderator') and deleted_at is null
        order by role, created_at`
    );
    return { team, adminEmails: adminEmails() };
  });

  app.post('/api/admin/team', async (req) => {
    const admin = await requireFullAdmin(req);
    const input = z
      .object({ email: z.string().trim().email(), role: z.enum(['moderator', 'admin']) })
      .parse(req.body ?? {});
    const row = await one<{ id: string; name: string; role: string }>(
      `update profiles set role = $2
        where email = $1 and deleted_at is null
        returning id::text, name, role`,
      [input.email, input.role]
    );
    if (!row) throw notFound('Няма регистриран потребител с този имейл.');
    await audit({
      admin,
      action: 'admin.team_role',
      targetType: 'profile',
      targetId: row.id,
      targetLabel: input.email,
      details: { role: input.role },
      ip: req.ip,
    });
    return { ok: true, member: row };
  });

  app.delete('/api/admin/team/:id', async (req) => {
    const admin = await requireFullAdmin(req);
    const params = z.object({ id: z.string().uuid() }).parse(req.params ?? {});
    if (params.id === admin.id) throw badRequest('Не можеш да си махнеш правата сам.');
    await query(`update profiles set role = 'user' where id = $1`, [params.id]);
    await audit({ admin, action: 'admin.team_remove', targetType: 'profile', targetId: params.id, ip: req.ip });
    return { ok: true };
  });

  /* ------------------------------------------- GDPR: право на забравяне */

  app.get('/api/admin/gdpr/search', async (req) => {
    await requireFullAdmin(req);
    const q = z.object({ q: z.string().trim().min(2).max(120) }).parse(req.query ?? {});
    return { users: await searchUsersForGdpr(q.q) };
  });

  app.get('/api/admin/gdpr/preview/:id', async (req) => {
    await requireFullAdmin(req);
    const params = z.object({ id: z.string().uuid() }).parse(req.params ?? {});
    const preview = await gdprPreview(params.id);
    if (!preview) throw notFound('Няма такъв профил.');
    return preview;
  });

  app.post('/api/admin/gdpr/anonymize', async (req) => {
    const admin = await requireFullAdmin(req);
    const input = z.object({ userId: z.string().uuid() }).parse(req.body ?? {});
    const res = await anonymizeUser(input.userId);
    await audit({ admin, action: 'gdpr.anonymize', targetType: 'profile', targetId: input.userId, ip: req.ip });
    return res;
  });

  app.post('/api/admin/gdpr/erase', async (req) => {
    const admin = await requireFullAdmin(req);
    const input = z.object({ userId: z.string().uuid() }).parse(req.body ?? {});
    const preview = await gdprPreview(input.userId);
    if (preview?.user?.email) {
      await sendAccountDeletedEmail({
        to: preview.user.email,
        name: preview.user.name,
        reason: 'Изтриване на профила по GDPR (право на забравяне)',
      }).catch(() => undefined);
    }
    const res = await eraseUser(input.userId);
    await audit({
      admin,
      action: 'gdpr.erase',
      targetType: 'profile',
      targetId: input.userId,
      details: res.removed,
      ip: req.ip,
    });
    return res;
  });

  /* ------------------------------------------------- 🏢 Бизнеси („Търговец в SmartPrice“)
   * Проверката на търговци е човешко решение: ЕИК може да съвпадне с касова
   * бележка (тогава системата одобрява сама), но всичко останало минава оттук.
   * Оттук се пуска и абонаментът (ръчно, докато не влезе плащането през Stripe).
   */

  app.get('/api/admin/businesses', async (req) => {
    await requireAdminPanel(req);
    const q = z
      .object({
        status: z.enum(['pending', 'verified', 'rejected', 'all']).default('pending'),
        q: z.string().trim().max(80).optional(),
        ...paging,
      })
      .parse(req.query ?? {});

    const like2 = q.q ? like(q.q) : null;
    const [rows, summary] = await Promise.all([
      many<Record<string, unknown>>(
        `select b.id, b.venue_slug, b.place_name, b.city, b.legal_name, b.tax_id,
                b.contact_email, b.contact_phone, b.proof_url, b.status, b.tier,
                b.paid_until, b.auto_approved, b.reject_reason, b.created_at, b.reviewed_at,
                p.email as owner_email, p.name as owner_name,
                (select count(*)::int from business_replies br where br.business_id = b.id) as replies_count,
                (select count(*)::int from business_offers bo where bo.business_id = b.id) as offers_count,
                (select count(*)::int from business_offers bo
                  where bo.business_id = b.id and bo.status = 'active'
                    and (bo.valid_until is null or bo.valid_until >= current_date)) as offers_live,
                (select count(*)::int from posts po
                  where po.status = 'published'
                    and md5(lower(btrim(po.place_name)) || '|' || lower(btrim(po.city))) = b.venue_slug) as signals_count
           from business_accounts b
           left join profiles p on p.id = b.owner_user_id
          where ($1 = 'all' or b.status = $1)
            and ($2::text is null
                 or b.place_name ilike $2 or b.city ilike $2
                 or b.legal_name ilike $2 or b.tax_id ilike $2 or b.contact_email ilike $2)
          order by (b.status = 'pending') desc, b.created_at desc
          limit $3 offset $4`,
        [q.status, like2, q.limit, q.offset]
      ),
      one<Record<string, unknown>>(
        `select count(*)::int as total,
                count(*) filter (where status = 'pending')::int  as pending,
                count(*) filter (where status = 'verified')::int as verified,
                count(*) filter (where status = 'rejected')::int as rejected,
                count(*) filter (where status = 'verified' and paid_until > now())::int as paid
           from business_accounts`
      ),
    ]);
    return { items: rows, summary };
  });

  app.post('/api/admin/businesses/:id/approve', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().regex(/^\d+$/) }).parse(req.params);
    const before = await one<Record<string, unknown>>(
      'select id, place_name, legal_name, status from business_accounts where id = $1',
      [id]
    );
    if (!before) throw notFound('Няма такава заявка.');

    await query(
      `update business_accounts
          set status = 'verified', reject_reason = null,
              reviewed_at = now(), reviewed_by = $2, updated_at = now()
        where id = $1`,
      [id, admin.email]
    );
    await audit({
      admin,
      action: 'business.approve',
      targetType: 'business',
      targetId: id,
      targetLabel: String(before.legal_name ?? ''),
      details: { place: before.place_name, was: before.status },
      ip: req.ip,
    });
    return { ok: true, message: `„${before.legal_name}“ вече е Проверен търговец.` };
  });

  app.post('/api/admin/businesses/:id/reject', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().regex(/^\d+$/) }).parse(req.params);
    const input = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body ?? {});

    const before = await one<Record<string, unknown>>(
      'select id, legal_name from business_accounts where id = $1',
      [id]
    );
    if (!before) throw notFound('Няма такава заявка.');

    await query(
      `update business_accounts
          set status = 'rejected', reject_reason = $2,
              reviewed_at = now(), reviewed_by = $3, updated_at = now()
        where id = $1`,
      [id, input.reason, admin.email]
    );
    await audit({
      admin,
      action: 'business.reject',
      targetType: 'business',
      targetId: id,
      targetLabel: String(before.legal_name ?? ''),
      details: { reason: input.reason },
      ip: req.ip,
    });
    return { ok: true };
  });

  /** Абонаментът се води ръчно, докато не влезе Stripe (Фаза 2). */
  app.post('/api/admin/businesses/:id/plan', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().regex(/^\d+$/) }).parse(req.params);
    const input = z
      .object({
        tier: z.enum(['free', 'verified']),
        months: z.coerce.number().int().min(0).max(60).default(0),
      })
      .parse(req.body ?? {});

    const paidUntil =
      input.tier === 'verified' && input.months > 0
        ? `now() + interval '${input.months} month'` // брой месеци е валидиран цяло число
        : 'null';

    await query(
      `update business_accounts
          set tier = $2, paid_until = ${paidUntil}, updated_at = now()
        where id = $1`,
      [id, input.tier]
    );
    await audit({
      admin,
      action: 'business.plan',
      targetType: 'business',
      targetId: id,
      details: { tier: input.tier, months: input.months },
      ip: req.ip,
    });
    return { ok: true };
  });

  /** Официалните отговори на един търговец (за преглед от екипа). */
  app.get('/api/admin/businesses/:id/replies', async (req) => {
    await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().regex(/^\d+$/) }).parse(req.params);
    const rows = await many<Record<string, unknown>>(
      `select br.id, br.body, br.created_at, br.post_id::text,
              po.title as post_title, po.place_name, po.city
         from business_replies br
         join posts po on po.id = br.post_id
        where br.business_id = $1
        order by br.created_at desc limit 50`,
      [id]
    );
    return { items: rows };
  });

  /** Маха бизнес профила (например заявка, пусната за чужда фирма). */
  app.delete('/api/admin/businesses/:id', async (req) => {
    const admin = await requireFullAdmin(req);
    const { id } = z.object({ id: z.string().regex(/^\d+$/) }).parse(req.params);
    const before = await one<Record<string, unknown>>(
      'select id, legal_name, place_name from business_accounts where id = $1',
      [id]
    );
    if (!before) throw notFound('Няма такава заявка.');
    await query('delete from business_accounts where id = $1', [id]);
    await audit({
      admin,
      action: 'business.delete',
      targetType: 'business',
      targetId: id,
      targetLabel: String(before.legal_name ?? ''),
      details: { place: before.place_name },
      ip: req.ip,
    });
    return { ok: true };
  });

  /* --------------------------------------- 📨 Известия (седмичен дайджест)
   * Двигателят за задържане: хората, които са разрешили известия, получават
   * веднъж седмично „най-добрите находки в твоя град“. Тук се вижда кой колко
   * е получил, пуска се на ръка (проба или истинско) и се включва/изключва.
   */

  app.get('/api/admin/digest/info', async (req) => {
    await requireAdminPanel(req);
    return await digestInfo();
  });

  app.post('/api/admin/digest/run', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        dryRun: z.boolean().default(true),
        days: z.coerce.number().int().min(1).max(30).default(7),
      })
      .parse(req.body ?? {});

    // Историята се пише вътре в sendWeeklyDigest (едно място — иначе един пуск
    // се виждаше два пъти в панела: 'auto' + 'manual').
    const res = await sendWeeklyDigest({
      dryRun: input.dryRun,
      days: input.days,
      trigger: input.dryRun ? 'dry' : 'manual',
    });
    await audit({
      admin,
      action: input.dryRun ? 'digest.dry' : 'digest.send',
      targetType: 'push',
      details: { cities: res.cities, findings: res.findings, targeted: res.targeted, sent: res.sent },
      ip: req.ip,
    });
    return res;
  });

  app.post('/api/admin/digest/toggle', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z.object({ enabled: z.boolean() }).parse(req.body ?? {});
    await setDigestEnabled(input.enabled);
    await audit({
      admin,
      action: 'digest.toggle',
      targetType: 'push',
      details: { enabled: input.enabled },
      ip: req.ip,
    });
    return { ok: true, enabled: input.enabled };
  });

  /** Ръчно известие до всички (напр. „пуснахме нова версия“). */
  app.post('/api/admin/push/broadcast', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        title: z.string().trim().min(3).max(80),
        body: z.string().trim().min(3).max(200),
        url: z.string().trim().max(300).optional(),
      })
      .parse(req.body ?? {});

    const res = await sendPushToAll({
      title: input.title,
      body: input.body,
      url: input.url || '/',
      tag: 'admin-broadcast',
    });
    await audit({
      admin,
      action: 'push.broadcast',
      targetType: 'push',
      targetLabel: input.title,
      details: res,
      ip: req.ip,
    });
    return { ...res, message: `Пратено до ${res.sent} устройства (мъртви: ${res.gone}).` };
  });

  /* ================== 🧭 ОБИКОЛКИ — обекти извън приложението ==================
   * Работен списък за терен: кои обекти НЕ са в SmartPrice, с телефон и адрес,
   * плюс статус на посещението. Обектите се намират през Google Maps (Apify,
   * харчи пари) — затова има оценка ПРЕДИ пускане и дневен лимит.
   */

  /** Списък + статистика. Преди връщане преизчислява кой вече е в приложението. */
  app.get('/api/admin/leads', async (req) => {
    await requireAdminPanel(req);
    /**
     * ⚠️ НЕ ползвай z.coerce.boolean() тук: той превръща НИЗА „false“ в true
     * (Boolean('false') === true), тоест филтърът се включва точно когато е
     * изключен. Затова четем изрично като текст.
     */
    const boolish = z
      .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
      .optional()
      .transform((v) => v === true || v === 'true' || v === '1');
    const q = z
      .object({
        status: z.string().trim().max(20).optional(),
        city: z.string().trim().max(80).optional(),
        q: z.string().trim().max(80).optional(),
        onlyNotInApp: boolish,
        onlyWithPhone: boolish,
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query ?? {});

    // Автоматичните признаци се опресняват, за да не пращаме човек при
    // обект, който вече е в приложението или вече е станал търговец.
    const flags = await refreshLeadFlags();
    const { items, stats } = await listLeads(q);
    const budget = await leadsBudget(30);
    return { items, stats, flags, budget };
  });

  /** Добавяне на обект на ръка (видян на улицата). */
  app.post('/api/admin/leads', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        name: z.string().trim().min(2).max(200),
        city: z.string().trim().max(80).optional(),
        address: z.string().trim().max(300).optional(),
        phone: z.string().trim().max(40).optional(),
        website: z.string().trim().max(300).optional(),
        category: z.string().trim().max(80).optional(),
        note: z.string().trim().max(1000).optional(),
        latitude: z.coerce.number().min(-90).max(90).optional(),
        longitude: z.coerce.number().min(-180).max(180).optional(),
        mapsUrl: z.string().trim().max(500).optional(),
      })
      .parse(req.body ?? {});

    const lead = await addLead(input, admin.email);
    await refreshLeadFlags();
    await audit({
      admin,
      action: 'leads.add',
      targetType: 'lead',
      targetId: String(lead.id),
      targetLabel: lead.name,
      ip: req.ip,
    });
    return { lead, message: `„${lead.name}“ е в списъка за обиколки.` };
  });

  /** Смяна на статуса след посещение/обаждане. */
  app.post('/api/admin/leads/status', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        id: z.coerce.number().int().positive(),
        status: z.enum(['new', 'contacted', 'interested', 'refused', 'joined']),
        note: z.string().trim().max(1000).optional(),
      })
      .parse(req.body ?? {});

    const lead = await setLeadStatus(input.id, input.status, input.note);
    if (!lead) throw notFound('Няма такъв обект в списъка.');
    await audit({
      admin,
      action: 'leads.status',
      targetType: 'lead',
      targetId: String(lead.id),
      targetLabel: `${lead.name} → ${lead.status}`,
      ip: req.ip,
    });
    return { lead };
  });

  app.delete('/api/admin/leads/:id', async (req) => {
    const admin = await requireFullAdmin(req);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params ?? {});
    const ok = await deleteLead(id);
    await audit({
      admin,
      action: 'leads.delete',
      targetType: 'lead',
      targetId: String(id),
      ip: req.ip,
    });
    return { ok };
  });

  /** Търсене на нови обекти в Google Maps — харчи пари, затова е с оценка. */
  app.post('/api/admin/leads/search', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        city: z.string().trim().min(2).max(80),
        term: z.string().trim().min(2).max(80),
        limit: z.coerce.number().int().min(1).max(120).default(30),
      })
      .parse(req.body ?? {});

    const { run, budget, message } = await startLeadsSearch({ ...input, requestedBy: admin.email });
    await audit({
      admin,
      action: 'leads.search',
      targetType: 'leads_run',
      targetId: String(run.id),
      targetLabel: `${input.term} в ${input.city}`,
      details: { estUsd: budget.estUsd, allowed: budget.allowed },
      ip: req.ip,
    });
    return {
      run,
      budget,
      message:
        message ??
        `Търсенето тръгна („${input.term}“ в ${input.city}, до ${input.limit} обекта). Отнема 1-3 минути — панелът ще покаже готовото.`,
    };
  });

  /** История на търсенията (всяко е харчило пари — да се вижда). */
  app.get('/api/admin/leads/runs', async (req) => {
    await requireAdminPanel(req);
    const runs = await listSearchRuns(10);
    const budget = await leadsBudget(30);
    return { runs, budget };
  });

  /** CSV за разпечатване (връщаме го като текст — панелът го сваля). */
  app.get('/api/admin/leads.csv', async (req) => {
    await requireAdminPanel(req);
    return { csv: await leadsCsv() };
  });

  /** 🗺️ Маршрут за един ден — подредени спирки + готов линк в Google Maps. */
  app.post('/api/admin/leads/route', async (req) => {
    await requireAdminPanel(req);
    const input = z
      .object({
        city: z.string().trim().min(2).max(80),
        maxStops: z.coerce.number().int().min(1).max(10).default(8),
        startLat: z.coerce.number().min(-90).max(90).optional(),
        startLng: z.coerce.number().min(-180).max(180).optional(),
        onlyNotInApp: z
          .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
          .optional()
          .transform((v) => v === true || v === 'true' || v === '1'),
      })
      .parse(req.body ?? {});
    return await planDayRoute({
      city: input.city,
      maxStops: input.maxStops,
      startLat: input.startLat ?? null,
      startLng: input.startLng ?? null,
      onlyNotInApp: input.onlyNotInApp,
    });
  });

  /** 📊 Докладът за обиколките (ползва се и от седмичния доклад в Telegram). */
  app.get('/api/admin/leads/report', async (req) => {
    await requireAdminPanel(req);
    return await leadsReport();
  });

}

/** Помощна: взима IP-то от заявката (ползва се в одита). */
export function requestIp(req: FastifyRequest): string {
  return req.ip ?? '';
}
