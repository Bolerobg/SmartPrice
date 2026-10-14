import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { optionalUserId, requireUserId } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import {
  MAX_RUN_MS,
  MIN_RUN_MS,
  PRACTICE_ATTEMPTS,
  PROMO_MAX_VIEWS,
  PROMO_MAX_VIEWS as MAX_PROMO,
  buildPuzzle,
  checkQualification,
  countQualifyingPosts,
  drawWinner,
  effectiveStatus,
  loadEntry,
  loadRaffle,
  logEvent,
  officialWindow,
  promoState,
  raffleResults,
  scanRaffleForFraud,
  standings,
  winnersWall,
} from '../lib/raffles.js';
import { syncBadges } from '../lib/badges.js';
import { requireAdminAnyToken } from '../lib/admin.js';

/**
 * Томболи — HTTP слоят.
 *
 * Публично: списък, детайли, дъската на пъзела, класация, стена на печелившите.
 * Изисква вход: участие, тренировки, официално нареждане.
 * Само админ: създаване/редакция/статус/разиграване.
 */

const iso = (v: Date | string | null | undefined) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

/** „след 12 минути“ / „след 2 часа“ — за съобщението при синхронен старт. */
function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} секунди`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} минути`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} часа`;
  return `${Math.round(hours / 24)} дни`;
}

function mapRaffle(r: Awaited<ReturnType<typeof loadRaffle>>, extra: Record<string, unknown> = {}) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    prize: {
      title: r.prize_title,
      url: r.prize_url ?? '',
      image: r.prize_image_url ?? '',
      price: r.prize_price,
      currency: r.prize_currency,
    },
    conditionPosts: r.condition_posts,
    conditionImagesOnly: r.condition_images_only,
    conditionDistinctDays: r.condition_distinct_days,
    minAccountAgeDays: r.min_account_age_days,
    minVerifiedAgeDays: r.min_verified_age_days,
    officialWindowMin: r.official_window_min,
    officialWindow: officialWindow(r),
    minParticipants: r.min_participants,
    countFromStart: r.count_from_start,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    status: effectiveStatus(r),
    cancelReason: r.cancel_reason,
    winnerId: r.winner_id,
    winningTimeMs: r.winning_time_ms,
    qualifiedCount: r.qualified_count,
    finishedAt: iso(r.finished_at),
    secondsLeft: Math.max(0, Math.round((new Date(r.ends_at).getTime() - Date.now()) / 1000)),
    ...extra,
  };
}

/** Дата: приема „2026-11-01T20:00:00Z“ и „2026-11-01T20:00“ (без часова зона). */
const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Невалидна дата и час.');

// Полетата са отделно от проверката, защото PATCH ползва .partial() —
// а .refine() връща ZodEffects, върху който .partial() не съществува.
const createFields = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).default(''),
  prizeTitle: z.string().trim().min(2).max(200),
  prizeUrl: z.string().trim().max(600).optional(),
  prizeImageUrl: z.string().trim().max(600).optional(),
  prizePrice: z.coerce.number().min(0).max(1_000_000).optional(),
  conditionPosts: z.coerce.number().int().min(1).max(50).default(3),
  conditionImagesOnly: z.boolean().default(true),
  conditionDistinctDays: z.coerce.number().int().min(1).max(30).default(2),
  minAccountAgeDays: z.coerce.number().int().min(0).max(365).default(7),
  minVerifiedAgeDays: z.coerce.number().int().min(0).max(365).default(3),
  minParticipants: z.coerce.number().int().min(1).max(100_000).default(5),
  countFromStart: z.boolean().default(true),
  /** Синхронен старт: кога се отваря официалното нареждане за всички. */
  officialOpensAt: isoDate.optional(),
  officialWindowMin: z.coerce.number().int().min(1).max(1440).default(15),
  startsAt: isoDate.optional(),
  endsAt: isoDate,
  activate: z.boolean().default(true),
});

const createSchema = createFields.refine(
  (v) => !v.officialOpensAt || new Date(v.officialOpensAt).getTime() <= new Date(v.endsAt).getTime(),
  { message: 'Часът на официалното нареждане трябва да е преди края на томболата.', path: ['officialOpensAt'] }
);

export default async function raffleRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------ публично */

  app.get('/api/raffles', async (req) => {
    const userId = optionalUserId(req);
    const rows = await many<Awaited<ReturnType<typeof loadRaffle>>>(
      `select * from raffles
        where status in ('active','running','finished','cancelled')
        order by (status = 'finished') asc, ends_at desc
        limit 20`
    );

    const items = [];
    for (const r of rows) {
      const entry = userId ? await loadEntry(r.id, userId) : null;
      const progress = userId
        ? await countQualifyingPosts(r, userId)
        : 0;
      items.push(
        mapRaffle(r, {
          myProgress: progress,
          myEntry: entry
            ? {
                qualified: true,
                practiceUsed: entry.practice_used,
                practiceLeft: Math.max(0, PRACTICE_ATTEMPTS - entry.practice_used),
                bestPracticeMs: entry.best_practice_ms,
                runTimeMs: entry.run_time_ms,
                runStarted: Boolean(entry.run_started_at) && !entry.run_time_ms,
              }
            : null,
        })
      );
    }
    return { items };
  });

  app.get('/api/raffles/winners', async () => ({ items: await winnersWall(20) }));

  app.get('/api/raffles/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const userId = optionalUserId(req);
    const raffle = await loadRaffle(id);
    const entry = userId ? await loadEntry(id, userId) : null;
    const progress = userId ? await countQualifyingPosts(raffle, userId) : 0;

    return {
      raffle: mapRaffle(raffle, {
        myProgress: progress,
        practiceAttempts: PRACTICE_ATTEMPTS,
        myEntry: entry
          ? {
              qualified: true,
              practiceUsed: entry.practice_used,
              practiceLeft: Math.max(0, PRACTICE_ATTEMPTS - entry.practice_used),
              bestPracticeMs: entry.best_practice_ms,
              runTimeMs: entry.run_time_ms,
              runStarted: Boolean(entry.run_started_at) && !entry.run_time_ms,
              disqualified: entry.disqualified,
            }
          : null,
        // „още N находки“ — точното число, което мотивира
        postsNeeded: Math.max(0, raffle.condition_posts - progress),
      }),
      standings: await standings(id, 30),
      // Пълната прозрачност: всеки (и който не е участвал) вижда кой за колко
      // време се е справил, статистиките и одитния дневник — за да няма
      // усещане за измама. Без имейли, телефони и IP-та.
      results: await raffleResults(raffle),
    };
  });

  /**
   * Дъската на пъзела.
   *
   * Тренировъчната е РАЗЛИЧНА от официалната — иначе трите тренировки стават
   * наизустяване на дъската и печели този с най-добра памет, не най-бърза ръка.
   * Официалната дъска е една и съща за всички (затова времената са сравними) и се
   * показва САМО след стартирано нареждане — не може да се разгледа предварително.
   */
  app.get('/api/raffles/:id/puzzle', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { mode } = z
      .object({ mode: z.enum(['practice', 'official']).default('practice') })
      .parse(req.query);
    const raffle = await loadRaffle(id);

    let seed = raffle.id;
    if (mode === 'official') {
      const userId = requireUserId(req);
      const entry = await loadEntry(id, userId);
      if (!entry?.run_started_at || entry.run_time_ms != null) {
        throw badRequest('Официалната дъска се вижда само докато тече нареждането.');
      }
      seed = `${raffle.id}:official`;
    } else {
      const userId = optionalUserId(req);
      const entry = userId ? await loadEntry(id, userId) : null;
      seed = `${raffle.id}:practice:${entry?.practice_used ?? 0}`;
    }

    const tiles = await buildPuzzle(seed);
    const pairs = Array.from(new Set(tiles.map((t) => t.pairId).filter((p): p is string => Boolean(p))));
    return { tiles, pairs, mode, minRunMs: MIN_RUN_MS, maxRunMs: MAX_RUN_MS };
  });

  /* --------------------------------------------------------------- вход */

  app.post('/api/raffles/:id/join', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const raffle = await loadRaffle(id);
    const status = effectiveStatus(raffle);
    if (!['active', 'running'].includes(status)) {
      throw badRequest('Тази томбола вече не приема участия.');
    }

    // Всички условия на едно място: находки + различни дни + стаж на профила.
    // Идеята е фарменето да е бавно и скъпо, а не да е „3 снимки за 5 минути“.
    const check = await checkQualification(raffle, userId);
    if (!check.ok) throw badRequest(check.reason ?? 'Още не покриваш условието за участие.');
    const progress = check.posts;

    await query(
      `insert into raffle_entries (raffle_id, user_id, posts_count)
       values ($1, $2, $3)
       on conflict (raffle_id, user_id) do update set posts_count = $3`,
      [id, userId, progress]
    );
    await query(
      `insert into profile_badges (profile_id, badge_id, unlocked_at)
       values ($1, 'badge-raffle-play', now())
       on conflict (profile_id, badge_id) do update set unlocked_at = coalesce(profile_badges.unlocked_at, now())`,
      [userId]
    );
    await query('update raffles set qualified_count = (select count(*) from raffle_entries where raffle_id = $1) where id = $1', [id]);
    await logEvent(id, userId, 'joined', { posts: progress });
    await syncBadges(userId);

    return { ok: true, qualified: true, postsCount: progress, practiceAttempts: PRACTICE_ATTEMPTS };
  });

  /** Тренировка: 3 безплатни нареждания, не влизат в класацията. */
  app.post('/api/raffles/:id/practice', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ timeMs: z.coerce.number().int().min(200).max(MAX_RUN_MS) }).parse(req.body);

    const entry = await loadEntry(id, userId);
    if (!entry) throw badRequest('Първо се включи в томболата.');
    if (entry.practice_used >= PRACTICE_ATTEMPTS) {
      throw badRequest('Използва трите тренировки. Остава официалното нареждане.');
    }

    await query(
      `update raffle_entries
          set practice_used = practice_used + 1,
              best_practice_ms = least(coalesce(best_practice_ms, 999999999), $3)
        where raffle_id = $1 and user_id = $2`,
      [id, userId, body.timeMs]
    );
    const updated = await loadEntry(id, userId);
    return {
      ok: true,
      practiceUsed: updated!.practice_used,
      practiceLeft: Math.max(0, PRACTICE_ATTEMPTS - updated!.practice_used),
      bestPracticeMs: updated!.best_practice_ms,
    };
  });

  /* ---------------------------- официално нареждане (времето се мери тук) */

  app.post('/api/raffles/:id/run/start', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const raffle = await loadRaffle(id);
    if (effectiveStatus(raffle) !== 'running') {
      throw badRequest('Официалното нареждане още не е отворено (чакаме края на томболата).');
    }

    // СИНХРОНЕН СТАРТ: всички играят в един и същи прозорец. Точно затова
    // човек с 5 профила пак има само един чифт ръце — не може да нареди пет
    // пъзела едновременно, нито да научи дъската с втория профил.
    const win = officialWindow(raffle);
    if (!win.open) {
      if (win.opensInSeconds > 0) {
        throw badRequest(
          `Официалното нареждане се отваря след ${formatWait(win.opensInSeconds)}. ` +
            'Всички играят по едно и също време — така никой не може да си помага с втори профил.'
        );
      }
      throw badRequest('Официалният прозорец вече затвори. Следващата томбола ще има нов час.');
    }

    const entry = await loadEntry(id, userId);
    if (!entry) throw badRequest('Първо се включи в томболата.');
    if (entry.official_attempts >= 1) throw badRequest('Вече използва официалното си нареждане.');
    if (entry.run_started_at && !entry.run_time_ms) {
      // вече тече — връщаме същия старт, за да не се рестартира хронометърът
      return { ok: true, startedAt: iso(entry.run_started_at), minRunMs: MIN_RUN_MS };
    }

    await query(
      'update raffle_entries set run_started_at = now(), run_time_ms = null where raffle_id = $1 and user_id = $2',
      [id, userId]
    );
    await logEvent(id, userId, 'run_started');
    return { ok: true, startedAt: new Date().toISOString(), minRunMs: MIN_RUN_MS, maxRunMs: MAX_RUN_MS };
  });

  app.post('/api/raffles/:id/run/finish', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const raffle = await loadRaffle(id);
    const entry = await loadEntry(id, userId);
    if (!entry) throw badRequest('Първо се включи в томболата.');
    if (!entry.run_started_at) throw badRequest('Няма стартирано нареждане.');
    if (entry.run_time_ms != null) throw badRequest('Официалното нареждане вече е приключено.');

    // Прозорецът е затворен от повече от 2 минути → нареждането не се брои.
    // (2 минути са за закъснение в мрежата, не за игра.)
    const win = officialWindow(raffle);
    if (win.synced && win.closesAt && Date.now() > new Date(win.closesAt).getTime() + 120_000) {
      throw badRequest('Официалният прозорец затвори — това нареждане вече не се брои.');
    }

    // ВАЖНО: времето се смята на СЪРВЪРА — клиентът не може да поднесе „0,4 секунди“.
    const startedAt = new Date(entry.run_started_at).getTime();
    const timeMs = Date.now() - startedAt;

    if (timeMs < MIN_RUN_MS) {
      await query(
        `update raffle_entries set official_attempts = official_attempts + 1,
                disqualified = true, run_finished_at = now()
          where raffle_id = $1 and user_id = $2`,
        [id, userId]
      );
      await logEvent(id, userId, 'run_too_fast', { timeMs });
      throw badRequest('Времето е невъзможно бързо — нареждането не се брои.');
    }
    if (timeMs > MAX_RUN_MS) {
      await query('update raffle_entries set official_attempts = official_attempts + 1, run_finished_at = now() where raffle_id = $1 and user_id = $2', [id, userId]);
      throw badRequest('Времето изтече — опитай отново (официалното нареждане се брои веднъж).');
    }

    await query(
      `update raffle_entries
          set run_time_ms = $3, run_finished_at = now(), official_attempts = official_attempts + 1
        where raffle_id = $1 and user_id = $2`,
      [id, userId, timeMs]
    );
    await logEvent(id, userId, 'run_finished', { timeMs });

    const rankRow = await one<{ n: number }>(
      'select count(*) as n from raffle_entries where raffle_id = $1 and run_time_ms is not null and run_time_ms < $2',
      [id, timeMs]
    );
    return { ok: true, timeMs, place: Number(rankRow?.n ?? 0) + 1 };
  });

  /** Рекламата: показва се максимум 3 пъти на човек, който още не участва. */
  app.get('/api/raffles/:id/promo', async (req) => {
    const userId = optionalUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // Гост (без вход): няма как да участва, значи не е „вече участващ“ — рекламата
    // трябва да се показва. Броят показвания се държи локално в приложението,
    // защото няма профил, към който да се запише.
    if (!userId) return { shouldShow: true, views: 0, maxViews: PROMO_MAX_VIEWS, anonymous: true };
    return promoState(userId, id);
  });

  app.post('/api/raffles/:id/promo-view', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await query(
      `insert into raffle_promo_views (raffle_id, user_id, views, last_shown_at)
       values ($1, $2, 1, now())
       on conflict (raffle_id, user_id)
       do update set views = least(raffle_promo_views.views + 1, $3), last_shown_at = now()`,
      [id, userId, MAX_PROMO]
    );
    return promoState(userId, id);
  });

  /* ------------------------------------------------------------- админ */

  // Приема и токен от приложението, и от админ панела (дашборда), за да се
  // управляват томболите и от двете места без дублиране на логика.
  const adminGuard = async (req: FastifyRequest) => requireAdminAnyToken(req);

  app.get('/api/admin/raffles', async (req) => {
    await adminGuard(req);
    const rows = await many<Awaited<ReturnType<typeof loadRaffle>>>('select * from raffles order by created_at desc');
    const items = [];
    for (const r of rows) {
      const entries = await many<{ n: number }>('select count(*) as n from raffle_entries where raffle_id = $1', [r.id]);
      items.push(mapRaffle(r, { entries: Number(entries[0]?.n ?? 0) }));
    }
    return { items };
  });

  app.post('/api/admin/raffles', async (req, reply) => {
    const admin = await adminGuard(req);
    const input = createSchema.parse(req.body);
    const created = await one<{ id: string }>(
      `insert into raffles
         (title, description, prize_title, prize_url, prize_image_url, prize_price,
          condition_posts, condition_images_only, min_participants, count_from_start,
          condition_distinct_days, min_account_age_days, min_verified_age_days,
          official_opens_at, official_window_min,
          starts_at, ends_at, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15,
               coalesce($16::timestamptz, now()), $17::timestamptz, $18, $19)
       returning id`,
      [
        input.title,
        input.description,
        input.prizeTitle,
        input.prizeUrl ?? null,
        input.prizeImageUrl ?? null,
        input.prizePrice ?? null,
        input.conditionPosts,
        input.conditionImagesOnly,
        input.minParticipants,
        input.countFromStart,
        input.conditionDistinctDays,
        input.minAccountAgeDays,
        input.minVerifiedAgeDays,
        input.officialOpensAt ?? null,
        input.officialWindowMin,
        input.startsAt ?? null,
        input.endsAt,
        input.activate ? 'active' : 'draft',
        admin.id,
      ]
    );
    await logEvent(created!.id, admin.id, 'created', { by: admin.email });
    const raffle = await loadRaffle(created!.id);
    return reply.status(201).send({ raffle: mapRaffle(raffle) });
  });

  app.patch('/api/admin/raffles/:id', async (req) => {
    await adminGuard(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = createFields.partial().parse(req.body);

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, value: unknown) => {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    };
    if (input.title !== undefined) push('title', input.title);
    if (input.description !== undefined) push('description', input.description);
    if (input.prizeTitle !== undefined) push('prize_title', input.prizeTitle);
    if (input.prizeUrl !== undefined) push('prize_url', input.prizeUrl);
    if (input.prizeImageUrl !== undefined) push('prize_image_url', input.prizeImageUrl);
    if (input.prizePrice !== undefined) push('prize_price', input.prizePrice);
    if (input.conditionPosts !== undefined) push('condition_posts', input.conditionPosts);
    if (input.conditionDistinctDays !== undefined) push('condition_distinct_days', input.conditionDistinctDays);
    if (input.minAccountAgeDays !== undefined) push('min_account_age_days', input.minAccountAgeDays);
    if (input.minVerifiedAgeDays !== undefined) push('min_verified_age_days', input.minVerifiedAgeDays);
    if (input.officialOpensAt !== undefined) push('official_opens_at', input.officialOpensAt);
    if (input.officialWindowMin !== undefined) push('official_window_min', input.officialWindowMin);
    if (input.minParticipants !== undefined) push('min_participants', input.minParticipants);
    if (input.endsAt !== undefined) push('ends_at', input.endsAt);
    if (!sets.length) throw badRequest('Няма какво да се обнови.');

    values.push(id);
    await query(`update raffles set ${sets.join(', ')}, updated_at = now() where id = $${values.length}`, values);
    return { raffle: mapRaffle(await loadRaffle(id)) };
  });

  /** Смяна на статус: active → running → (draw) finished. */
  app.post('/api/admin/raffles/:id/status', async (req) => {
    await adminGuard(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status } = z.object({ status: z.enum(['draft', 'active', 'running', 'cancelled']) }).parse(req.body);
    await query(
      `update raffles set status = $2,
              started_running_at = case when $2 = 'running' then coalesce(started_running_at, now()) else started_running_at end,
              updated_at = now()
        where id = $1`,
      [id, status]
    );
    await logEvent(id, null, 'status', { status });
    return { raffle: mapRaffle(await loadRaffle(id)) };
  });

  app.post('/api/admin/raffles/:id/draw', async (req) => {
    await adminGuard(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await drawWinner(id);
    return { ...result, raffle: mapRaffle(await loadRaffle(id)) };
  });

  /**
   * Изтриване на томбола ЗАВИНАГИ.
   *
   * Заедно с нея падат и участията, класацията, одиторските ѝ събития и броят
   * показвания на рекламата (външни ключове с ON DELETE CASCADE). Затова
   * връщаме какво е заминало, а панелът пита за потвърждение преди това.
   */
  app.delete('/api/admin/raffles/:id', async (req) => {
    await adminGuard(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const raffle = await one<{ title: string; status: string }>(
      'select title, status from raffles where id = $1',
      [id]
    );
    if (!raffle) throw notFound('Томболата не е намерена.');

    const counts = await one<{ entries: number; events: number; views: number }>(
      `select
         (select count(*) from raffle_entries where raffle_id = $1)::int      as entries,
         (select count(*) from raffle_events where raffle_id = $1)::int       as events,
         (select count(*) from raffle_promo_views where raffle_id = $1)::int  as views`,
      [id]
    );

    await query('delete from raffles where id = $1', [id]);

    return {
      ok: true,
      removed: {
        title: raffle.title,
        status: raffle.status,
        entries: Number(counts?.entries ?? 0),
        events: Number(counts?.events ?? 0),
        promoViews: Number(counts?.views ?? 0),
      },
    };
  });

  /** Кой какво е правил — за спорове и за статистика. */
  app.get('/api/admin/raffles/:id/events', async (req) => {
    await adminGuard(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await many<{ kind: string; detail: Record<string, unknown>; created_at: Date; name: string | null }>(
      `select e.kind, e.detail, e.created_at, p.name
         from raffle_events e left join profiles p on p.id = e.user_id
        where e.raffle_id = $1 order by e.created_at desc limit 200`,
      [id]
    );
    return { items: rows.map((r) => ({ kind: r.kind, detail: r.detail, at: iso(r.created_at), user: r.name })) };
  });

  /**
   * Проверка за злоупотреба ПРЕДИ обявяване на победител.
   *
   * Връща всеки участник с отметките срещу него: същата касова бележка или
   * снимка като друг участник, един и същ реален имейл (алиас), споделено IP,
   * прекалено нов профил, невъзможно бързо нареждане. Решението е на админа —
   * затова тук няма автоматично наказание, само подреден по риск списък.
   */
  app.get('/api/admin/raffles/:id/suspicious', async (req) => {
    await adminGuard(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const raffle = await loadRaffle(id);
    const items = await scanRaffleForFraud(raffle);
    return {
      items,
      summary: {
        total: items.length,
        high: items.filter((i) => i.risk === 'high').length,
        medium: items.filter((i) => i.risk === 'medium').length,
        disqualified: items.filter((i) => i.disqualified).length,
      },
    };
  });

  /** Дисквалификация на участник (или връщане обратно) — само админ. */
  app.post('/api/admin/raffles/:id/entries/:userId/disqualify', async (req) => {
    await adminGuard(req);
    const { id, userId } = z
      .object({ id: z.string().uuid(), userId: z.string().uuid() })
      .parse(req.params);
    const { disqualified, reason } = z
      .object({
        disqualified: z.boolean().default(true),
        reason: z.string().trim().max(300).optional(),
      })
      .parse(req.body ?? {});

    const row = await one<{ user_id: string }>(
      `update raffle_entries set disqualified = $3
        where raffle_id = $1 and user_id = $2 returning user_id`,
      [id, userId, disqualified]
    );
    if (!row) throw notFound('Този участник не е в томболата.');

    await logEvent(id, userId, disqualified ? 'disqualified_by_admin' : 'requalified_by_admin', {
      reason: reason ?? null,
    });
    return { ok: true, disqualified };
  });
}
