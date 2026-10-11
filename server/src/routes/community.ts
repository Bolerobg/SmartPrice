import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one } from '../db.js';
import { requireUserId } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { loadFullProfile, loadPublicProfile } from '../lib/profile.js';

// Преди беше 3 действия и пауза от 90 СЕКУНДИ — твърде натрапчиво.
// Сега: 8 действия И поне 3 дни между две подсещания.
const INTERACTIONS_THRESHOLD = 8;
const NUDGE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 дни

/**
 * Прагове на спестени пари, при които има СМИСЪЛ да поискаме подкрепа:
 * потребителят вече е усетил ползата. Всеки праг се отбелязва веднъж.
 */
const SAVED_MILESTONES = [25, 50, 100, 250, 500, 1000];

const alertSchema = z.object({
  keyword: z.string().trim().min(2, 'Ключовата дума е твърде кратка.').max(80),
  maxPrice: z.coerce.number().positive().max(1_000_000).optional(),
  city: z.string().trim().min(2).max(80).default('Всички градове'),
  polarity: z.enum(['green', 'red', 'any']).default('any'),
});

export default async function communityRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------ Класация (реални данни)
  app.get('/api/community/leaderboard', async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);

    const rows = await many<{
      id: string;
      name: string;
      handle: string;
      avatar_url: string | null;
      is_supporter: boolean;
      verified_receipts: number;
      community_saved_bgn: number;
      green_posts: number;
      red_flags: number;
      posts_count: number;
      reputation_points: number;
    }>(
      `select id, name, handle, avatar_url, is_supporter, verified_receipts,
              community_saved_bgn, green_posts, red_flags, posts_count, reputation_points
         from v_leaderboard
        where posts_count > 0
        order by community_saved_bgn desc, verified_receipts desc, reputation_points desc
        limit $1`,
      [q.limit]
    );

    return {
      items: rows.map((r, index) => ({
        id: r.id,
        rank: index + 1,
        name: r.name,
        handle: r.handle,
        avatar: r.avatar_url ?? '',
        isSupporter: r.is_supporter,
        verifiedReceipts: r.verified_receipts,
        communitySavedBgn: r.community_saved_bgn,
        greenPosts: r.green_posts,
        redFlagsExposed: r.red_flags,
        badgeTitle: r.is_supporter ? 'Пазител на Общността' : 'Ловец на цени',
      })),
    };
  });

  // ------------------------------------------------------------ Реални статистики на общността
  app.get('/api/community/stats', async () => {
    const row = await one<{
      total_posts: number;
      green_posts: number;
      red_posts: number;
      verified_receipts: number;
      community_saved: number;
      contributors: number;
      raised_this_month: number;
      supporters: number;
    }>(
      `select
         (select count(*) from posts where status = 'published')                                        as total_posts,
         (select count(*) from posts where status = 'published' and polarity = 'green')                 as green_posts,
         (select count(*) from posts where status = 'published' and polarity = 'red')                   as red_posts,
         (select count(*) from posts p join receipts r on r.post_id = p.id
           where p.status = 'published' and r.verified_by_ai)                                           as verified_receipts,
         (select coalesce(sum(community_saved_bgn), 0) from posts where status = 'published')           as community_saved,
         (select count(distinct author_id) from posts where status = 'published')                       as contributors,
         (select coalesce(sum(amount_bgn), 0) from donations
           where status = 'succeeded' and created_at >= date_trunc('month', now()))                     as raised_this_month,
         (select count(*) from profiles where is_supporter)                                             as supporters`
    );

    return {
      totalPosts: row?.total_posts ?? 0,
      greenPosts: row?.green_posts ?? 0,
      redPosts: row?.red_posts ?? 0,
      verifiedReceipts: row?.verified_receipts ?? 0,
      communitySavedBgn: row?.community_saved ?? 0,
      contributors: row?.contributors ?? 0,
      raisedThisMonthBgn: row?.raised_this_month ?? 0,
      supporters: row?.supporters ?? 0,
    };
  });

  // ------------------------------------------------------------ Публичен профил
  app.get('/api/community/users/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return { profile: await loadPublicProfile(id) };
  });

  // ------------------------------------------------------------ Ценови аларми
  app.get('/api/alerts', async (req) => {
    const userId = requireUserId(req);
    const rows = await many<{
      id: string;
      keyword: string;
      max_price: number | null;
      city: string;
      polarity: 'green' | 'red' | 'any';
      is_active: boolean;
      created_at: Date;
    }>(
      `select id, keyword, max_price, city, polarity, is_active, created_at
         from price_alerts where user_id = $1 order by created_at desc`,
      [userId]
    );

    // Съвпаденията се смятат на сървъра, с реални данни
    const items = await Promise.all(
      rows.map(async (a) => {
        const matches = await many<{ id: string; title: string; price_paid: number; polarity: string }>(
          `select p.id, p.title, p.price_paid, p.polarity
             from posts p
             join profiles au on au.id = p.author_id
            where p.status = 'published'
              and ($1::text = 'any' or p.polarity = $1::text)
              and ($2::text = 'Всички градове' or lower(p.city) = lower($2::text))
              and ($3::numeric is null or p.price_paid <= $3::numeric)
              and (
                p.title ilike '%' || $4::text || '%' or p.description ilike '%' || $4::text || '%'
                or p.place_name ilike '%' || $4::text || '%' or p.city ilike '%' || $4::text || '%'
                or array_to_string(p.tags, ' ') ilike '%' || $4::text || '%'
                or au.name ilike '%' || $4::text || '%'
              )
            order by p.created_at desc
            limit 10`,
          [a.polarity, a.city, a.max_price, a.keyword]
        );

        return {
          id: a.id,
          keyword: a.keyword,
          maxPrice: a.max_price ?? undefined,
          city: a.city,
          polarity: a.polarity,
          isActive: a.is_active,
          createdAt: a.created_at instanceof Date ? a.created_at.toISOString() : String(a.created_at),
          matches: matches.map((m) => ({
            id: m.id,
            title: m.title,
            pricePaid: m.price_paid,
            polarity: m.polarity,
          })),
        };
      })
    );

    return { items };
  });

  app.post('/api/alerts', async (req, reply) => {
    const userId = requireUserId(req);
    const input = alertSchema.parse(req.body);

    const activeCount = await one<{ count: number }>(
      'select count(*) as count from price_alerts where user_id = $1 and is_active',
      [userId]
    );
    if ((activeCount?.count ?? 0) >= 20) {
      throw badRequest('Достигна лимита от 20 активни аларми.');
    }

    const created = await one<{ id: string }>(
      `insert into price_alerts (user_id, keyword, max_price, city, polarity)
       values ($1,$2,$3,$4,$5) returning id`,
      [userId, input.keyword, input.maxPrice ?? null, input.city, input.polarity]
    );

    return reply.status(201).send({ id: created!.id });
  });

  app.patch('/api/alerts/:id', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z
      .object({
        isActive: z.boolean().optional(),
        keyword: z.string().trim().min(2).max(80).optional(),
        maxPrice: z.coerce.number().positive().max(1_000_000).nullable().optional(),
        city: z.string().trim().min(2).max(80).optional(),
        polarity: z.enum(['green', 'red', 'any']).optional(),
      })
      .strict()
      .parse(req.body);

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, val: unknown) => {
      values.push(val);
      sets.push(`${col} = $${values.length}`);
    };
    if (input.isActive !== undefined) push('is_active', input.isActive);
    if (input.keyword !== undefined) push('keyword', input.keyword);
    if (input.maxPrice !== undefined) push('max_price', input.maxPrice);
    if (input.city !== undefined) push('city', input.city);
    if (input.polarity !== undefined) push('polarity', input.polarity);
    if (!sets.length) throw badRequest('Няма какво да се обнови.');

    values.push(id, userId);
    const updated = await one<{ id: string }>(
      `update price_alerts set ${sets.join(', ')}
        where id = $${values.length - 1} and user_id = $${values.length} returning id`,
      values
    );
    if (!updated) throw notFound('Алармата не е намерена.');

    return { ok: true };
  });

  app.delete('/api/alerts/:id', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const deleted = await one<{ id: string }>(
      'delete from price_alerts where id = $1 and user_id = $2 returning id',
      [id, userId]
    );
    if (!deleted) throw notFound('Алармата не е намерена.');
    return { ok: true };
  });

  // ------------------------------------------------------------ Състояние на напомнянето за дарение
  app.post('/api/me/interaction', async (req) => {
    const userId = requireUserId(req);
    const input = z.object({ reasonHint: z.string().trim().max(300).optional() }).parse(req.body ?? {});

    const profile = await one<{
          is_supporter: boolean;
          interactions_since_prompt: number;
          last_donation_prompt_at: Date | null;
          nudge_snoozed_until: Date | null;
          personal_saved_bgn: number;
          saved_milestone_step: number;
          name: string;
        }>(
          `select is_supporter, interactions_since_prompt, last_donation_prompt_at,
                  nudge_snoozed_until, personal_saved_bgn, saved_milestone_step, name
             from profiles where id = $1`,
          [userId]
        );
        if (!profile) throw notFound('Профилът не е намерен.');

        if (profile.is_supporter) {
          return { shouldPrompt: false, interactionsSincePrompt: profile.interactions_since_prompt };
        }

        const now = Date.now();
        const next = profile.interactions_since_prompt + 1;
        const snoozedUntil = profile.nudge_snoozed_until?.getTime() ?? 0;
        const lastPrompt = profile.last_donation_prompt_at?.getTime() ?? 0;

        const cooldownPassed = now - lastPrompt >= NUDGE_COOLDOWN_MS;
        const notSnoozed = now > snoozedUntil;

        // --- Смислено подсещане: минал ли е нов праг на спестени пари? -------------
        // Вместо да подсещаме „просто ей така“, чакаме потребителят да е спестил
        // реална сума благодарение на общността. Тогава молбата има контекст.
        const saved = Number(profile.personal_saved_bgn ?? 0);
        const reachedStep = SAVED_MILESTONES.filter((m) => saved >= m).length;
        const milestoneReached =
          reachedStep > profile.saved_milestone_step && cooldownPassed && notSnoozed;

        // Обикновеното подсещане иска и достатъчно действия.
        const enoughInteractions = next >= INTERACTIONS_THRESHOLD;
        const shouldPrompt = (milestoneReached || enoughInteractions) && cooldownPassed && notSnoozed;

        await one(
          `update profiles
              set interactions_since_prompt = $2,
                  last_donation_prompt_at = case when $3 then now() else last_donation_prompt_at end,
                  saved_milestone_step = case when $4 then $5 else saved_milestone_step end
            where id = $1 returning id`,
          [
            userId,
            shouldPrompt ? 0 : next,
            shouldPrompt,
            milestoneReached,
            Math.max(reachedStep, profile.saved_milestone_step),
          ]
        );

        // Текстът зависи от причината: спестена сума или просто активност.
        let reasonHint = input.reasonHint;
        if (milestoneReached) {
          const firstName = profile.name.split(' ')[0] || 'приятел';
          reasonHint =
            `${firstName}, с помощта на общността вече си спестил ${saved.toFixed(2)} €! ` +
            `SmartPrice е без реклами и без платени ревюта. Ако ти е полезно, ` +
            `подкрепи развитието му с малко дарение.`;
        }

        return {
          shouldPrompt,
          interactionsSincePrompt: shouldPrompt ? 0 : next,
          reasonHint,
          firstName: profile.name.split(' ')[0],
          personalSavedBgn: saved,
          milestoneReached,
          savedMilestoneStep: Math.max(reachedStep, profile.saved_milestone_step),
        };
      });

  app.post('/api/me/snooze', async (req) => {
    const userId = requireUserId(req);
    await one(
      `update profiles
          set nudge_snoozed_until = now() + ($2 || ' milliseconds')::interval,
              last_donation_prompt_at = now(),
              interactions_since_prompt = 0
        where id = $1 returning id`,
      [userId, String(NUDGE_COOLDOWN_MS)]
    );
    return { ok: true, snoozedForMs: NUDGE_COOLDOWN_MS };
  });
}
