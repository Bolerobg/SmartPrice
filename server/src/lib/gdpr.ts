/**
 * 🧹 Право на забравяне (GDPR) — сървърна логика.
 *
 * Два режима:
 *   • `anonymizeUser` — обезличава профила (име, имейл, @handle, снимка) и трие
 *     личните настройки (ценови аларми). Постовете/цените остават, защото са
 *     общностни данни, но вече не сочат към човек.
 *   • `eraseUser` — пълно изтриване: обезличава + маха постовете, коментарите и
 *     качените файлове на човека, после и самия профил.
 *
 * Преди всяко действие се вади „преглед“ какво точно ще се изтрие — показва се
 * в панела, за да не се трие на сляпо.
 */
import { many, one, query } from '../db.js';

export interface GdprPreview {
  user: {
    id: string;
    name: string;
    email: string;
    handle: string;
    city: string;
    role: string;
    created_at: string | null;
    last_seen_at: string | null;
    anonymized_at: string | null;
    totp_enabled: boolean;
  };
  counts: {
    posts: number;
    comments: number;
    receipts: number;
    uploads: number;
    price_alerts: number;
    reactions: number;
    bookmarks: number;
    helped: number;
    donations: number;
    reports: number;
    referrals: number;
  };
}

export async function gdprPreview(userId: string): Promise<GdprPreview | null> {
  const user = await one<GdprPreview['user']>(
    `select id, name, email, handle, city, role,
            created_at::text, last_seen_at::text, anonymized_at::text,
            coalesce(totp_enabled, false) as totp_enabled
       from profiles where id = $1`,
    [userId]
  );
  if (!user) return null;

  const c = await one<Record<string, string>>(
    `select
       (select count(*) from posts where author_id = $1)::text                as posts,
       (select count(*) from comments where author_id = $1)::text             as comments,
       (select count(*) from receipts r join posts p on p.id = r.post_id
          where p.author_id = $1)::text                                      as receipts,
       (select count(*) from uploads where owner_id = $1)::text               as uploads,
       (select count(*) from price_alerts where user_id = $1)::text           as price_alerts,
       (select count(*) from post_reactions where user_id = $1)::text         as reactions,
       (select count(*) from post_bookmarks where user_id = $1)::text         as bookmarks,
       (select count(*) from post_helped_marks where user_id = $1)::text      as helped,
       (select count(*) from donations where user_id = $1)::text              as donations,
       (select count(*) from content_reports where reported_by = $1)::text    as reports,
       (select count(*) from referrals where inviter_id = $1 or invitee_id = $1)::text as referrals`,
    [userId]
  );

  const counts = Object.fromEntries(
    Object.entries(c ?? {}).map(([k, v]) => [k, Number(v) || 0])
  ) as GdprPreview['counts'];

  return { user, counts };
}

/** Обезличава профила (личните данни се махат, съдържанието остава). */
export async function anonymizeUser(userId: string): Promise<{ ok: boolean; alreadyAnonymized: boolean }> {
  const row = await one<{ anonymized_at: string | null }>(
    `select anonymized_at::text from profiles where id = $1`,
    [userId]
  );
  if (!row) throw new Error('Няма такъв профил.');
  if (row.anonymized_at) return { ok: true, alreadyAnonymized: true };

  const short = userId.replace(/-/g, '').slice(0, 8);
  await query(
    `update profiles
        set name = 'Анонимен потребител',
            email = $2,
            handle = $3,
            avatar_url = null,
            bio = '',
            totp_secret = null,
            totp_enabled = false,
            anonymized_at = now(),
            erasure_requested_at = coalesce(erasure_requested_at, now()),
            role = case when role = 'admin' then 'user' else role end
      where id = $1`,
    [userId, 'deleted-' + short + '@smartprice.invalid', '@anon' + short]
  );
  // Лични настройки, които нямат смисъл без човек.
  await query(`delete from price_alerts where user_id = $1`, [userId]).catch(() => undefined);
  return { ok: true, alreadyAnonymized: false };
}

/** Пълно изтриване: обезличаване + махане на съдържанието и профила. */
export async function eraseUser(userId: string): Promise<{ ok: boolean; removed: Record<string, number>; blocked: string[] }> {
  const preview = await gdprPreview(userId);
  if (!preview) throw new Error('Няма такъв профил.');
  const removed: Record<string, number> = {};
  const blocked: string[] = [];

  const step = async (name: string, sql: string): Promise<void> => {
    try {
      const res = await query(sql, [userId]);
      removed[name] = Number((res as { rowCount?: number }).rowCount ?? 0);
    } catch {
      blocked.push(name);
    }
  };

  await anonymizeUser(userId);

  // Първо дъщерните записи на постовете, после самите постове.
  await step('receipt_items', `delete from receipt_items where receipt_id in (select r.id from receipts r join posts p on p.id = r.post_id where p.author_id = $1)`);
  await step('receipts', `delete from receipts where post_id in (select id from posts where author_id = $1)`);
  await step('comments_on_posts', `delete from comments where post_id in (select id from posts where author_id = $1)`);
  await step('reactions_on_posts', `delete from post_reactions where post_id in (select id from posts where author_id = $1)`);
  await step('bookmarks_on_posts', `delete from post_bookmarks where post_id in (select id from posts where author_id = $1)`);
  await step('helped_on_posts', `delete from post_helped_marks where post_id in (select id from posts where author_id = $1)`);
  await step('price_history', `delete from price_history where post_id in (select id from posts where author_id = $1)`);
  await step('posts', `delete from posts where author_id = $1`);
  await step('comments', `delete from comments where author_id = $1`);
  await step('reactions', `delete from post_reactions where user_id = $1`);
  await step('bookmarks', `delete from post_bookmarks where user_id = $1`);
  await step('helped', `delete from post_helped_marks where user_id = $1`);
  await step('price_alerts', `delete from price_alerts where user_id = $1`);
  await step('badges', `delete from profile_badges where profile_id = $1`);
  await step('uploads', `delete from uploads where owner_id = $1`);
  await step('referrals', `delete from referrals where invitee_id = $1`);

  // Накрая самият профил (маркиран като изтрит, за да не се чупят връзки).
  await query(
    `update profiles
        set deleted_at = now(),
            suspended_at = now(),
            suspended_reason = 'Изтрит по GDPR (право на забравяне)',
            referral_code = null,
            email = 'erased-' || replace(id::text, '-', '') || '@smartprice.invalid',
            handle = '@erased' || left(replace(id::text, '-', ''), 7)
      where id = $1`,
    [userId]
  ).catch(() => {
    blocked.push('profiles');
  });

  void preview;
  return { ok: blocked.length === 0, removed, blocked };
}

/** Търсене на потребител за GDPR операция (по имейл или @handle). */
export async function searchUsersForGdpr(q: string, limit = 20): Promise<Array<Record<string, unknown>>> {
  const like = '%' + q.trim() + '%';
  return many<Record<string, unknown>>(
    `select id::text, name, email::text, handle, city, role,
            created_at::text, anonymized_at::text,
            (deleted_at is not null) as deleted,
            (select count(*) from posts p where p.author_id = profiles.id)::int as posts
       from profiles
      where email::text ilike $1 or handle::text ilike $1 or name ilike $1
      order by created_at desc
      limit $2`,
    [like, Math.max(1, Math.min(50, limit))]
  );
}
