import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, tx } from '../db.js';
import { requireUserId, optionalUserId } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { countPosts, loadPosts, type SortMode } from '../lib/feed.js';
import { loadFullProfile } from '../lib/profile.js';
import { getSetting } from '../lib/settings.js';

const CATEGORIES = [
  'restaurants',
  'hotels_airbnb',
  'supermarket',
  'cafes_bars',
  'services_tech',
  'other',
] as const;

const UNIT_TYPES = ['g', 'kg', 'ml', 'l', 'pcs'] as const;
const REACTION_KEYS = ['topDeal', 'worthIt', 'doubt', 'pureRobbery', 'avoid', 'exaggerated'] as const;
const GREEN_REACTIONS = new Set(['topDeal', 'worthIt', 'doubt']);
const RED_REACTIONS = new Set(['pureRobbery', 'avoid', 'exaggerated']);

const receiptItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().positive().max(10000).default(1),
  unitPrice: z.coerce.number().min(0).max(1_000_000),
  totalPrice: z.coerce.number().min(0).max(1_000_000).optional(),
  highlightReason: z.string().trim().max(200).optional(),
});

const receiptSchema = z.object({
  merchantName: z.string().trim().min(1).max(200),
  merchantTaxId: z.string().trim().max(40).optional(),
  date: z.string().trim().max(40).optional(),
  time: z.string().trim().max(20).optional(),
  totalAmount: z.coerce.number().min(0).max(1_000_000),
  currency: z.enum(['BGN', 'EUR']).default('EUR'),
  confidenceScore: z.coerce.number().min(0).max(1).default(0),
  verifiedByAi: z.boolean().default(false),
  source: z.enum(['manual', 'openrouter', 'openai']).default('manual'),
  model: z.string().trim().max(120).optional(),
  imageUrl: z.string().max(600).optional(),
  items: z.array(receiptItemSchema).max(200).default([]),
});

const createSchema = z.object({
  polarity: z.enum(['green', 'red']),
  category: z.enum(CATEGORIES),
  customCategoryLabel: z.string().trim().max(80).optional(),
  platformTag: z.string().trim().min(1).max(60),
  customPlatformLabel: z.string().trim().max(60).optional(),
  title: z.string().trim().min(3, 'Заглавието е задължително.').max(200),
  description: z.string().trim().max(4000).default(''),
  placeName: z.string().trim().min(1, 'Мястото е задължително.').max(200),
  city: z.string().trim().min(2).max(80),
  address: z.string().trim().max(300).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  googleMapsUrl: z.string().max(600).optional(),
  locationAutoDetected: z.boolean().default(false),
  pricePaid: z.coerce.number().positive('Цената трябва да е положителна.').max(1_000_000),
  referencePrice: z.coerce.number().positive().max(1_000_000).optional(),
  currency: z.enum(['BGN', 'EUR']).default('EUR'),
  unitQuantity: z.coerce.number().positive().max(1_000_000).optional(),
  unitType: z.enum(UNIT_TYPES).optional(),
  isShrinkflation: z.boolean().default(false),
  isFakePromo: z.boolean().default(false),
  imageUrl: z.string().min(1, 'Снимката е задължителна.').max(600),
  comparisonImageUrl: z.string().max(600).optional(),
  comparisonLabel: z.string().trim().max(120).optional(),
  // Частни продавачи: човек, който продава на определено място (сергия, камион,
  // пред блока). Типът е 'private', а sellerNote описва къде и кога да го намериш.
  sellerType: z.enum(['business', 'private']).default('business'),
  sellerNote: z.string().trim().max(1000).optional(),
  sellerContact: z.string().trim().max(200).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  receipt: receiptSchema.optional(),
});

const listQuerySchema = z.object({
  polarity: z.enum(['green', 'red']).optional(),
  category: z.string().max(40).optional(),
  city: z.string().max(80).optional(),
  q: z.string().max(200).optional(),
  sellerType: z.enum(['business', 'private']).optional(),
  sort: z.enum(['newest', 'best_savings', 'lowest_price', 'highest_price', 'most_helped']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

function computePricePerUnit(
  pricePaid: number,
  unitQuantity?: number,
  unitType?: string
): number | undefined {
  if (!unitQuantity || !unitType || unitQuantity <= 0) return undefined;
  switch (unitType) {
    case 'g':
      return Number(((pricePaid / unitQuantity) * 1000).toFixed(4));
    case 'kg':
      return Number((pricePaid / unitQuantity).toFixed(4));
    case 'ml':
      return Number(((pricePaid / unitQuantity) * 1000).toFixed(4));
    case 'l':
      return Number((pricePaid / unitQuantity).toFixed(4));
    default:
      return Number((pricePaid / unitQuantity).toFixed(4));
  }
}

/** Зарежда един пост по id, с „моето“ състояние. Хвърля 404, ако не е публичен. */
async function loadOnePost(postId: string, userId: string | null) {
  const [post] = await loadPosts({ postId, limit: 1, offset: 0 }, userId);
  if (!post) throw notFound('Публикацията не е намерена.');
  return post;
}

export default async function postRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- Лента
  app.get('/api/posts', async (req) => {
    const q = listQuerySchema.parse(req.query);
    const userId = optionalUserId(req);
    const filters = {
      polarity: q.polarity,
      category: q.category,
      city: q.city,
      q: q.q,
      sellerType: q.sellerType,
      sort: q.sort as SortMode | undefined,
      limit: q.limit,
      offset: q.offset,
    };
    const [items, total] = await Promise.all([loadPosts(filters, userId), countPosts(filters)]);
    return { items, total, limit: q.limit, offset: q.offset, hasMore: q.offset + items.length < total };
  });

  // Любими (отметки) — със GPS мястото на всяка оферта, за да се стигне до нея
  app.get('/api/posts/bookmarks', async (req) => {
    const userId = requireUserId(req);
    const items = await loadPosts(
      { bookmarkedBy: userId, limit: 100, offset: 0, sort: 'newest' },
      userId
    );
    const marks = await many<{
      post_id: string;
      note: string | null;
      note_lat: number | null;
      note_lng: number | null;
      created_at: string;
    }>('select post_id, note, note_lat, note_lng, created_at from post_bookmarks where user_id = $1', [userId]);

    const byPost = new Map(marks.map((m) => [m.post_id, m]));
    return {
      items: items.map((post) => {
        const mark = byPost.get(post.id);
        return {
          ...post,
          favorite: {
            savedAt: mark ? new Date(mark.created_at).toISOString() : null,
            note: mark?.note ?? null,
            // Ако човекът е отбелязал собствено място, то е с предимство пред
            // мястото на офертата (напр. „тук я видях, но я продават ей там“).
            noteLat: mark?.note_lat ?? null,
            noteLng: mark?.note_lng ?? null,
          },
        };
      }),
      total: items.length,
    };
  });

  /** Търсене по ID на офертата (публичния код). Работи без вход. */
  app.get('/api/posts/by-code/:code', async (req) => {
    const { code } = z.object({ code: z.string().trim().min(3).max(24) }).parse(req.params);
    const userId = optionalUserId(req);
    const normalized = code.replace(/[^a-z0-9]/gi, '').toUpperCase();
    if (normalized.length < 3) throw badRequest('Кодът е твърде къс.');

    const row = await one<{ id: string }>(
      `select id from posts
        where upper(replace(public_code, '-', '')) = $1 and status = 'published'`,
      [normalized]
    );
    if (!row) throw notFound('Няма оферта с такъв ID. Провери кода и опитай пак.');
    return { post: await loadOnePost(row.id, userId) };
  });

  app.get('/api/posts/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const userId = optionalUserId(req);
    return { post: await loadOnePost(id, userId) };
  });

  // ---------------------------------------------------------------- Създаване
  app.post('/api/posts', async (req, reply) => {
    const userId = requireUserId(req);
    const input = createSchema.parse(req.body);

    if (input.unitQuantity && !input.unitType) {
      throw badRequest('Посочи мерна единица (гр./мл) заедно с грамажа.');
    }

    const pricePerUnit = computePricePerUnit(
      input.pricePaid,
      input.unitQuantity,
      input.unitType
    );

    const tags =
      input.tags.length > 0
        ? input.tags
        : [
            input.polarity === 'green' ? '#ТопНаходка' : '#ЧервенФлаг',
            `#${input.city.replace(/\s+/g, '')}`,
          ];

    // Значка „Основател“: първата находка, качена в рамките на няколко минути
    // след регистрацията. Настройките се четат преди транзакцията.
    const founderEnabled = (await getSetting('founder_bonus', 'on')) !== 'off';
    const founderWindowMin = Number(await getSetting('founder_window_min', '5')) || 5;
    const founderPoints = Number(await getSetting('founder_points', '100')) || 100;
    let founderBonus: { title: string; points: number } | null = null;

    const postId = await tx(async (client) => {
      const res = await client.query<{ id: string }>(
        `insert into posts (
           author_id, polarity, category, custom_category_label, platform_tag,
           custom_platform_label, title, description, place_name, city, address,
           latitude, longitude, google_maps_url, location_auto_detected,
           price_paid, reference_price, currency, unit_quantity, unit_type,
           price_per_unit, is_shrinkflation, is_fake_promo, image_url,
           comparison_image_url, comparison_label, tags,
           seller_type, seller_note, seller_contact
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
           $21,$22,$23,$24,$25,$26,$27,$28,$29,$30
         ) returning id`,
        [
          userId,
          input.polarity,
          input.category,
          input.customCategoryLabel ?? null,
          input.platformTag,
          input.customPlatformLabel ?? null,
          input.title,
          input.description,
          input.placeName,
          input.city,
          input.address ?? null,
          input.latitude ?? null,
          input.longitude ?? null,
          input.googleMapsUrl ?? null,
          input.locationAutoDetected,
          input.pricePaid,
          input.referencePrice ?? null,
          input.currency,
          input.unitQuantity ?? null,
          input.unitType ?? null,
          pricePerUnit ?? null,
          input.isShrinkflation,
          input.isFakePromo,
          input.imageUrl,
          input.comparisonImageUrl ?? null,
          input.comparisonLabel ?? null,
          tags,
          input.sellerType,
          input.sellerNote ?? null,
          input.sellerContact ?? null,
        ]
      );
      const id = res.rows[0]!.id;

      // Първата точка от историята на цената. Без нея новите оферти нямаха
      // „откъде тръгна цената“ и не можеше да се сметне поскъпнало ли е.
      await client.query(
        `insert into price_history (post_id, price, status, reported_by)
         values ($1,$2,'initial',$3)`,
        [id, input.pricePaid, userId]
      );

      if (input.receipt) {
        const r = input.receipt;
        const receiptRes = await client.query<{ id: string }>(
          `insert into receipts (
             post_id, merchant_name, merchant_tax_id, receipt_date, receipt_time,
             total_amount, currency, confidence, verified_by_ai, source, model, image_url
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
          [
            id,
            r.merchantName,
            r.merchantTaxId ?? null,
            r.date ?? null,
            r.time ?? null,
            r.totalAmount,
            r.currency,
            r.confidenceScore,
            r.verifiedByAi,
            r.source,
            r.model ?? null,
            r.imageUrl ?? null,
          ]
        );
        const receiptId = receiptRes.rows[0]!.id;

        for (const [index, item] of r.items.entries()) {
          const total = item.totalPrice ?? Number((item.quantity * item.unitPrice).toFixed(2));
          await client.query(
            `insert into receipt_items
               (receipt_id, position, name, quantity, unit_price, total_price, highlight_reason)
             values ($1,$2,$3,$4,$5,$6,$7)`,
            [receiptId, index, item.name, item.quantity, item.unitPrice, total, item.highlightReason ?? null]
          );
        }
      }

      const points = input.receipt ? 60 : 25;
      await client.query(
        `update profiles
            set reputation_points = reputation_points + $2,
                interactions_since_prompt = interactions_since_prompt + 1
          where id = $1`,
        [userId, points]
      );

      // Значка „Основател“. Брои се само ПЪРВАТА публикация и само ако е
      // качена до founderWindowMin минути след регистрацията. Тук броят на
      // публикациите вече е 1 (току-що вмъкнахме тази), затова проверката
      // „posts = 1“ хваща точно първата находка.
      if (founderEnabled) {
        const chk = await client.query<{ posts: string; age_min: string | null; already: boolean }>(
          `select
             (select count(*) from posts where author_id = $1)                                as posts,
             (select extract(epoch from (now() - created_at)) / 60 from profiles
               where id = $1)                                                                 as age_min,
             exists(select 1 from profile_badges
                     where profile_id = $1 and badge_id = 'badge-founder'
                       and unlocked_at is not null)                                          as already`,
          [userId]
        );
        const row = chk.rows[0];
        const ageMin = row?.age_min == null ? null : Number(row.age_min);
        if (row && !row.already && Number(row.posts) === 1 && ageMin !== null && ageMin <= founderWindowMin) {
          await client.query(
            `insert into profile_badges (profile_id, badge_id, unlocked_at)
             values ($1, 'badge-founder', now())
             on conflict (profile_id, badge_id)
             do update set unlocked_at = coalesce(profile_badges.unlocked_at, now())`,
            [userId]
          );
          await client.query(
            `update profiles set reputation_points = reputation_points + $2 where id = $1`,
            [userId, founderPoints]
          );
          founderBonus = { title: 'Основател', points: founderPoints };
        }
      }

      return id;
    });

    return reply.status(201).send({
      post: await loadOnePost(postId, userId),
      profile: await loadFullProfile(userId),
      // Казано изрично, за да може приложението да покаже поздрав веднага.
      founderBonus,
    });
  });

  // ---------------------------------------------------------------- Редакция / изтриване
  app.patch('/api/posts/:id', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z
      .object({
        title: z.string().trim().min(3).max(200).optional(),
        description: z.string().trim().max(4000).optional(),
        referencePrice: z.coerce.number().positive().max(1_000_000).nullable().optional(),
      })
      .strict()
      .parse(req.body);

    const owner = await one<{ author_id: string }>('select author_id from posts where id = $1', [id]);
    if (!owner) throw notFound('Публикацията не е намерена.');
    if (owner.author_id !== userId) throw forbidden('Само авторът може да редактира публикацията.');

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, val: unknown) => {
      values.push(val);
      sets.push(`${col} = $${values.length}`);
    };
    if (input.title !== undefined) push('title', input.title);
    if (input.description !== undefined) push('description', input.description);
    if (input.referencePrice !== undefined) push('reference_price', input.referencePrice);
    if (!sets.length) throw badRequest('Няма какво да се обнови.');

    values.push(id);
    await one(`update posts set ${sets.join(', ')} where id = $${values.length} returning id`, values);

    return { post: await loadOnePost(id, userId) };
  });

  app.delete('/api/posts/:id', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const owner = await one<{ author_id: string }>('select author_id from posts where id = $1', [id]);
    if (!owner) throw notFound('Публикацията не е намерена.');
    if (owner.author_id !== userId) throw forbidden('Само авторът може да изтрие публикацията.');
    await one(`update posts set status = 'removed' where id = $1 returning id`, [id]);
    return { ok: true };
  });

  // ---------------------------------------------------------------- Реакции
  app.post('/api/posts/:id/reactions', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reactionKey } = z.object({ reactionKey: z.enum(REACTION_KEYS) }).parse(req.body);

    const post = await one<{ polarity: 'green' | 'red' }>(
      `select polarity from posts where id = $1 and status = 'published'`,
      [id]
    );
    if (!post) throw notFound('Публикацията не е намерена.');

    const allowed = post.polarity === 'green' ? GREEN_REACTIONS : RED_REACTIONS;
    if (!allowed.has(reactionKey)) {
      throw badRequest(
        post.polarity === 'green'
          ? 'За зелени постове са позволени: 🔥 Топ удар, 👍 Струва си, 🤔 Съмнително.'
          : 'За червени постове са позволени: 🚨 Чист обир, 😤 Избягвай, ⚖️ Пресилено.'
      );
    }

    await tx(async (client) => {
      const existing = await client.query<{ reaction_key: string }>(
        'select reaction_key from post_reactions where post_id = $1 and user_id = $2',
        [id, userId]
      );
      const current = existing.rows[0]?.reaction_key;

      if (current === reactionKey) {
        await client.query('delete from post_reactions where post_id = $1 and user_id = $2', [id, userId]);
      } else {
        await client.query(
          `insert into post_reactions (post_id, user_id, reaction_key)
           values ($1,$2,$3)
           on conflict (post_id, user_id) do update set reaction_key = excluded.reaction_key`,
          [id, userId, reactionKey]
        );
      }
      await client.query(
        `update profiles set interactions_since_prompt = interactions_since_prompt + 1 where id = $1`,
        [userId]
      );
    });

    return { post: await loadOnePost(id, userId) };
  });

  // ---------------------------------------------------------------- „Спести ми пари“
  app.post('/api/posts/:id/helped', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const result = await tx(async (client) => {
      const postRes = await client.query<{
        price_paid: number;
        reference_price: number | null;
        polarity: string;
      }>(
        `select price_paid, reference_price, polarity from posts where id = $1 and status = 'published'`,
        [id]
      );
      const post = postRes.rows[0];
      if (!post) throw notFound('Публикацията не е намерена.');

      const existing = await client.query<{ saved_amount_bgn: number }>(
        'select saved_amount_bgn from post_helped_marks where post_id = $1 and user_id = $2',
        [id, userId]
      );

      if (existing.rowCount) {
        // повторно натискане = отмяна; връщаме вече отчетената сума
        const previous = existing.rows[0]!.saved_amount_bgn;
        await client.query('delete from post_helped_marks where post_id = $1 and user_id = $2', [
          id,
          userId,
        ]);
        await client.query(
          `update profiles set personal_saved_bgn = greatest(0, personal_saved_bgn - $2) where id = $1`,
          [userId, previous]
        );
        return { marked: false, savedAmount: 0 };
      }

      // Реална спестена сума: само от посочена референтна цена. НЕ се измисля.
      const saved =
        post.reference_price && post.reference_price > post.price_paid
          ? Number((post.reference_price - post.price_paid).toFixed(2))
          : 0;

      await client.query(
        `insert into post_helped_marks (post_id, user_id, saved_amount_bgn) values ($1,$2,$3)`,
        [id, userId, saved]
      );
      await client.query(
        `update profiles set personal_saved_bgn = personal_saved_bgn + $2,
                             reputation_points = reputation_points + 5
          where id = $1`,
        [userId, saved]
      );
      return { marked: true, savedAmount: saved };
    });

    return {
      ...result,
      post: await loadOnePost(id, userId),
      profile: await loadFullProfile(userId),
    };
  });

  // ---------------------------------------------------------------- Потвърди цената днес
  app.post('/api/posts/:id/confirm', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    await tx(async (client) => {
      const post = await client.query<{ price_paid: number }>(
        `select price_paid from posts where id = $1 and status = 'published'`,
        [id]
      );
      if (!post.rowCount) throw notFound('Публикацията не е намерена.');

      const dup = await client.query(
        `select 1 from price_history where post_id = $1 and reported_by = $2 and status = 'confirmed'
          and created_at > now() - interval '12 hours'`,
        [id, userId]
      );
      if (dup.rowCount) return;

      await client.query(
        `insert into price_history (post_id, price, status, reported_by) values ($1,$2,'confirmed',$3)`,
        [id, post.rows[0]!.price_paid, userId]
      );
      await client.query(
        `update posts
            set verified_valid_today_count = verified_valid_today_count + 1,
                last_verified_at = now()
          where id = $1`,
        [id]
      );
      await client.query(
        `update profiles set reputation_points = reputation_points + 10 where id = $1`,
        [userId]
      );
    });

    return { post: await loadOnePost(id, userId), profile: await loadFullProfile(userId) };
  });

  // ---------------------------------------------------------------- Променена цена
  app.post('/api/posts/:id/price', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { price } = z
      .object({ price: z.coerce.number().positive('Цената трябва да е положителна.').max(1_000_000) })
      .parse(req.body);

    await tx(async (client) => {
      const post = await client.query(
        `select id from posts where id = $1 and status = 'published'`,
        [id]
      );
      if (!post.rowCount) throw notFound('Публикацията не е намерена.');

      await client.query(
        `insert into price_history (post_id, price, status, reported_by) values ($1,$2,'changed',$3)`,
        [id, price, userId]
      );
      await client.query(
        `update posts
            set price_paid = $2,
                verified_valid_today_count = verified_valid_today_count + 1,
                last_verified_at = now()
          where id = $1`,
        [id, price]
      );
      await client.query(
        `update profiles set reputation_points = reputation_points + 15 where id = $1`,
        [userId]
      );
    });

    return { post: await loadOnePost(id, userId), profile: await loadFullProfile(userId) };
  });

  // ---------------------------------------------------------------- Отметка
  app.post('/api/posts/:id/bookmark', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const exists = await one(`select 1 from posts where id = $1 and status = 'published'`, [id]);
    if (!exists) throw notFound('Публикацията не е намерена.');

    const marked = await tx(async (client) => {
      const del = await client.query('delete from post_bookmarks where post_id = $1 and user_id = $2', [id, userId]);
      if (del.rowCount) return false;
      await client.query('insert into post_bookmarks (post_id, user_id) values ($1,$2)', [id, userId]);
      return true;
    });

    return { isBookmarked: marked };
  });

  /** Бележка и собствено място към любима оферта („тук я намерих“). */
  app.patch('/api/posts/:id/bookmark', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z
      .object({
        note: z.string().trim().max(500).nullable().optional(),
        lat: z.coerce.number().min(-90).max(90).nullable().optional(),
        lng: z.coerce.number().min(-180).max(180).nullable().optional(),
      })
      .strict()
      .parse(req.body);

    const mark = await one<{ post_id: string }>(
      'select post_id from post_bookmarks where post_id = $1 and user_id = $2',
      [id, userId]
    );
    if (!mark) throw badRequest('Първо добави офертата в любими.');

    await one(
      `update post_bookmarks set note = $3, note_lat = $4, note_lng = $5
        where post_id = $1 and user_id = $2 returning post_id`,
      [id, userId, input.note ?? null, input.lat ?? null, input.lng ?? null]
    );

    return { ok: true };
  });

  // ---------------------------------------------------------------- Сигнал за проблемно съдържание
  app.post('/api/posts/:id/report', async (req) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = z
      .object({
        reason: z.enum(['false_info', 'defamation', 'spam', 'personal_data', 'other']),
        details: z.string().trim().max(1000).optional(),
      })
      .parse(req.body);

    const exists = await one('select 1 from posts where id = $1', [id]);
    if (!exists) throw notFound('Публикацията не е намерена.');

    const dup = await one(
      `select 1 from content_reports where post_id = $1 and reporter_id = $2 and status = 'open'`,
      [id, userId]
    );
    if (dup) throw badRequest('Вече имаш подаден сигнал за тази публикация.');

    await one(
      `insert into content_reports (reporter_id, post_id, reason, details) values ($1,$2,$3,$4) returning id`,
      [userId, id, input.reason, input.details ?? null]
    );
    return { ok: true, message: 'Сигналът е приет и ще бъде прегледан от модератор.' };
  });
}
