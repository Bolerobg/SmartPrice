import { many, one } from '../db.js';
import { compareForPosts, type PriceCompareLight } from './priceDuel.js';
import { mapPost, type CommentRow, type PostRow, type PriceHistoryRow, type ReceiptItemRow, type ReceiptRow } from './mappers.js';

export type SortMode = 'newest' | 'best_savings' | 'lowest_price' | 'highest_price' | 'most_helped';

/** Слуг на обект = md5(lower(trim(място)) || '|' || lower(trim(град))). Същият
 *  израз се ползва и в `lib/objects.ts` (v_objects), затова е изнесен тук. */
export const PLACE_SLUG_SQL = `md5(lower(btrim(coalesce(p.place_name,'')) || '|' || lower(btrim(coalesce(p.city,'')))))`;
export const PLACE_SLUG_RE = /^[0-9a-f]{32}$/;

export interface FeedFilters {
  postId?: string;
  polarity?: 'green' | 'red';
  category?: string;
  city?: string;
  q?: string;
  /**
   * Таг на обект (слуг) — „всички оферти на този обект“.
   *
   * Защо и филтър по източник: класацията в Радара (черен списък / „Честно
   * място“) е за ОБЕКТИ с гласове от хора, затова тук също махаме внесените
   * стоки (scraper) и обявите (olx) — иначе при натискане на „Billa“ излизат
   * стотици продукти от онлайн магазин вместо докладите на хората.
   */
  placeSlug?: string;
  sellerType?: 'business' | 'private';
  /**
   * 🛒 Само офертите на една верига за супермаркети (Кауфланд България, Метро…).
   * Ползва се от чиповете „Всички вериги / Кауфланд / …“ над потока.
   */
  chain?: string;
  authorId?: string;
  bookmarkedBy?: string;
  sort?: SortMode;
  limit: number;
  offset: number;
}

const SORTS: Record<SortMode, string> = {
  newest: 'p.created_at desc',
  best_savings: 'abs(coalesce(p.reference_price, p.price_paid) - p.price_paid) desc nulls last',
  lowest_price: 'p.price_paid asc',
  highest_price: 'p.price_paid desc',
  most_helped: 'p.helped_count desc, p.created_at desc',
};

interface Where {
  clauses: string[];
  values: unknown[];
  /**
   * 🎯 Интелигентно подреждане при търсене: първо офертите, в чието ИМЕ е
   * търсеното, после тези с това име на КАТЕГОРИЯТА (Сирене, Прясно мляко…),
   * чак накрая всичко останало (съвпадение по описание, коментар, бележка).
   *
   * Защо: досега търсенето в потока вадеше „баничка със сирене“ преди самото
   * сирене, ако е по-ново — човекът искаше първо продукта.
   */
  rank?: string;
}

function buildWhere(filters: FeedFilters): Where {
  const clauses: string[] = [`p.status = 'published'`];
  const values: unknown[] = [];

  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filters.postId) clauses.push(`p.id = ${bind(filters.postId)}`);
  if (filters.polarity) clauses.push(`p.polarity = ${bind(filters.polarity)}`);
  if (filters.category && filters.category !== 'all') {
    clauses.push(`p.category = ${bind(filters.category)}`);
  }
  if (filters.city && filters.city !== 'Всички градове') {
    clauses.push(`lower(p.city) = lower(${bind(filters.city)})`);
  }

  // Таг на обект: всички оферти на точно този обект (място + град) — както ги
  // групира и класацията на Радара. Внесените стоки и обявите не са обекти.
  if (filters.placeSlug && PLACE_SLUG_RE.test(filters.placeSlug)) {
    clauses.push(`${PLACE_SLUG_SQL} = ${bind(filters.placeSlug)}`);
    clauses.push(`coalesce(p.source, '') not in ('scraper', 'olx')`);
  }
  if (filters.chain) {
    // Веригата се сравнява сгъната (кирилица, C колация) — „кауфланд“ = „Кауфланд България“.
    clauses.push(`sp_fold(p.place_name) like ${bind('%' + filters.chain.trim().toLowerCase() + '%')}`);
  }
  if (filters.authorId) clauses.push(`p.author_id = ${bind(filters.authorId)}`);
  if (filters.sellerType) clauses.push(`p.seller_type = ${bind(filters.sellerType)}`);

  /**
   * ⚠️ Тук ИМАШЕ отделен клон за търсене по публичен код (ID на офертата) —
   * и той беше ТВЪРДО `and` условие, което убиваше търсенето по марка.
   *
   * Защо: `/^(sp)?[-\s]?[a-z0-9]{4,12}$/i` приема и „ansmann“ (7 букви), затова
   * заявка за марка получаваше допълнително условие „публичният код да съдържа
   * ansmann“ — което никога не е вярно → 0 резултата. Проверено на живо:
   * q=ANSMANN, q=bauhaus, q=Wera → 0, а q=батерия (кирилица, не минава този
   * regex) → 33. Клонът е ИЗЛИШЕН: кодът вече се търси в голямата OR група по-долу
   * (`upper(replace(p.public_code,'-','')) like upper(pattern)`).
   */

  if (filters.q && filters.q.trim().length > 0) {
      // Разделяме заявката на думи и изискваме ВСЯКА дума да съвпадне в НЯКОЕ
      // поле. Така „вода созопол“ намира поста дори думите да са в различни
      // полета, а търсенето обхваща цялата база, не само заредената страница.
      const words = filters.q
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 6); // таван, за да не се строят огромни заявки

      for (const word of words) {
            // sp_fold() вместо ilike: базата е с C колация и вградената lower() не
            // сгъва кирилица, затова ilike не намираше „София“ по „софия“.
            const p = bind(`%${word}%`);
            clauses.push(`(
              sp_fold(p.title) like ${p}
              or sp_fold(p.description) like ${p}
              or sp_fold(p.place_name) like ${p}
              or sp_fold(p.city) like ${p}
              or sp_fold(p.address) like ${p}
              or sp_fold(p.platform_tag) like ${p}
              or sp_fold(p.custom_platform_label) like ${p}
              or sp_fold(p.custom_category_label) like ${p}
              or sp_fold(array_to_string(p.tags, ' ')) like ${p}
              or sp_fold(a.name) like ${p}
              or sp_fold(a.handle) like ${p}
              or p.price_paid::text like ${p}
              or upper(replace(p.public_code, '-', '')) like upper(replace(${p}, '-', ''))
              or sp_fold(p.category) like ${p}
              -- ЛАТИНСКИ ТЕКСТ (марки, домейни): sp_fold() сгъва кирилица, но НЕ
              -- пипа латиницата, затова „ANSMANN“, „bauhaus“, „Deichmann“ не се
              -- намираха (проверено 20.10.2026: q=ANSMANN → 0 резултата).
              -- ilike работи за ASCII и в C колация — затова е отделен клон.
              or p.title ilike ${p}
              or p.place_name ilike ${p}
              or p.description ilike ${p}
              or p.custom_platform_label ilike ${p}
              or p.custom_category_label ilike ${p}
              or a.name ilike ${p}
              -- Етикетите на категориите са в клиента, затова ги въвеждаме тук,
              -- за да намериш „кафе“ или „хотел“, без да знаеш вътрешния id.
              -- Синонимите вече се редактират от админ панела (category_labels).
              or sp_fold(sp_category_synonyms(p.category)) like ${p}
              or sp_fold(coalesce(p.seller_note, '')) like ${p}
              -- Смислови синоними: „капан“ намира всички червени флагове.
              or (p.polarity = 'green'
                  and 'оферта находка евтино изгодно намаление промоция топ'
                      like ${p})
              or (p.polarity = 'red'
                  and 'червен флаг капан скъпо измама обир такса шринкфлация'
                      like ${p})
              or exists (
                select 1 from receipts rc
                join receipt_items ri on ri.receipt_id = rc.id
                where rc.post_id = p.id
                  and (sp_fold(ri.name) like ${p} or sp_fold(ri.highlight_reason) like ${p})
              )
              or exists (
                select 1 from receipts rc
                where rc.post_id = p.id and sp_fold(rc.merchant_name) like ${p}
              )
              or exists (
                select 1 from comments c
                where c.post_id = p.id and c.status = 'published'
                  and sp_fold(c.body) like ${p}
              )
            )`);
          }
    }

  if (filters.bookmarkedBy) {
    clauses.push(
      `exists (select 1 from post_bookmarks b where b.post_id = p.id and b.user_id = ${bind(filters.bookmarkedBy)})`
    );
  }

  /**
   * 🎯 Рангът (само когато има търсене): какво е качеството на съвпадението.
   * 0 = търсеното е в ИМЕТО на продукта, 1 = в името на КАТЕГОРИЯТА,
   * 2 = в името на веригата/магазина, 3 = другаде (описание, коментар, бележка).
   */
  let rank: string | undefined;
  if (filters.q && filters.q.trim()) {
    /**
     * ⚠️ Фразата влиза в SQL като ТЕКСТ, не като параметър — иначе `countPosts`
     * (който строи същите условия, но брои без `order by`) получаваше неизползван
     * параметър и Postgres връщаше 500 при всяко търсене. Кавичките се удвояват
     * (валидно за SQL низ), за да не може заявката да „избяга“ от низа.
     */
    const phraseText = filters.q.trim().toLowerCase().replace(/'/g, "''");
    const phrase = `'%${phraseText}%'`;
    rank = `case
              -- Най-напред продуктите, чиято КАТЕГОРИЯ е това, което търсиш:
              -- при „сирене“ човек иска сирената, не баничките „със сирене“.
              when sp_fold(coalesce(p.custom_category_label, '')) like ${phrase}
                   or sp_fold(sp_category_synonyms(p.category)) like ${phrase} then 0
              when sp_fold(p.title) like ${phrase} then 1
              -- Верига/магазин: „кауфланд“ вади първо офертите на Кауфланд.
              when sp_fold(p.place_name) like ${phrase} then 2
              else 3
            end`;
  }

  return { clauses, values, rank };
}

const RECEIPT_SELECT = `
  select rc.*, p.image_url as receipt_image_url
    from receipts rc
    join posts p on p.id = rc.post_id
   where rc.post_id = any($1::uuid[])
`;

/**
 * Зарежда постове + цялата им свързана информация наведнъж (без N+1),
 * добавяйки „моето“ състояние (реакция, отметка, потвърждение, helped).
 */
export async function loadPosts(filters: FeedFilters, userId: string | null) {
  const where = buildWhere(filters);
  const sortSql = SORTS[filters.sort ?? 'newest'];
  // При търсене най-важно е КАКВО съвпада (име на продукт преди описание),
  // чак после избраното подреждане (най-нови/най-евтини).
  const orderSql = where.rank ? `${where.rank} asc, ${sortSql}` : sortSql;

  /**
   * 🔴 LIMIT/OFFSET НЕ се подават като параметри!
   *
   * Проверено на живо 21.10.2026: със `limit $16` планировчикът не знае колко
   * реда ще върне и избира план, който сортира целия каталог — заявката на
   * лентата падаше от 60 ms на 4 285 ms („зарежда няколко стоки и увисва“).
   * Като литерали числата са валидирани вече (zod в маршрута), затова ги слагаме
   * директно и планировчикът вижда `limit 15` и ползва индекса.
   */
  const limitLiteral = Math.max(1, Math.min(60, Number(filters.limit) || 15));
  const offsetLiteral = Math.max(0, Math.min(1_000_000, Number(filters.offset) || 0));

  /**
   * ⚠️ Редът на заявката е важен за скоростта (проверено на живо 21.10.2026):
   * `v_posts_full` е ТЕЖКА изгледа (обединява реакции, коментари, отличия), а
   * предишната заявка първо я материализираше и после я съединяваше с `posts`
   * → „Nested Loop ... Rows Removed by Join Filter: 788282“ и лентата отговаряше
   * 7–9 секунди, тоест на телефона „зарежда няколко и увисва“.
   *
   * Сега: СТРАНИЦАТА първо (само `posts` + `profiles`, с индексите) → 15 id-та,
   * и чак после обогатяваме точно тези 15 реда от изгледа. CTE-то е MATERIALIZED,
   * за да не го „разплете“ планировчикът пак в скъпия вариант.
   */
  /**
   * 🔴 `v_posts_full` НЕ се ползва в лентата (проверено 21.10.2026).
   *
   * Защо: изгледът прави `HashAggregate` върху ВСИЧКИ публикувани оферти (56 011
   * реда — реакции, коментари, отличия) и чак после се съединява с нашите 15.
   * Планировчикът не подтиска филтъра вътре в агрегацията (пробвано и с
   * `join lateral`) → лентата отговаряше 4–6 секунди, тоест на телефона „зарежда
   * няколко стоки и увисва“.
   *
   * Затова: взимаме само 15-те оферти, автора им (една дребна подзаявка за
   * отличието) и после — с още две кратки заявки по id — реакциите и броя
   * коментари. Същите данни, само че за 15 реда, не за 56 000.
   */
  const rows = await many<PostRow>(
    `with page as materialized (
       select p.*
         from posts p
         join profiles a on a.id = p.author_id
        where ${where.clauses.join(' and ')}
        order by ${orderSql}
        limit ${limitLiteral} offset ${offsetLiteral}
     )
     select p.*,
            p.signal_count::int as signal_count,
            jsonb_build_object(
              'id', a.id,
              'name', a.name,
              'handle', a.handle,
              'avatar', a.avatar_url,
              'isSupporter', a.is_supporter,
              'badgeTitle', coalesce((
                select b.title from profile_badges pb
                  join badges b on b.id = pb.badge_id
                 where pb.profile_id = a.id and pb.unlocked_at is not null
                 order by b.sort_order limit 1
              ), 'Нов в общността')
            ) as author
       from page p
       join profiles a on a.id = p.author_id`,
    where.values
  );

  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];

  /**
   * Реакциите и броят коментари за СТРАНИЦАТА (преди идваха от тежката изгледа).
   * Две кратки заявки вместо агрегация на целия каталог.
   */
  const [reactionRows, commentCountRows] = await Promise.all([
    many<{ post_id: string; reaction_key: string; cnt: number }>(
      `select post_id, reaction_key, count(*)::int as cnt
         from post_reactions
        where post_id = any($1::uuid[])
        group by 1, 2`,
      [ids]
    ),
    many<{ post_id: string; n: number }>(
      `select post_id, count(*)::int as n
         from comments
        where post_id = any($1::uuid[]) and status = 'published'
        group by 1`,
      [ids]
    ),
  ]);
  const reactionsByPost = new Map<string, Record<string, number>>();
  for (const r of reactionRows) {
    const bucket = reactionsByPost.get(r.post_id) ?? {};
    bucket[r.reaction_key] = Number(r.cnt) || 0;
    reactionsByPost.set(r.post_id, bucket);
  }
  const commentsCountByPost = new Map(commentCountRows.map((c) => [c.post_id, Number(c.n) || 0]));
  for (const row of rows) {
    row.reactions = reactionsByPost.get(row.id) ?? {};
    row.comments_count = commentsCountByPost.get(row.id) ?? 0;
  }

  /**
   * ⚔️ Ценова проверка за ВСИЧКИ оферти на страницата с една заявка.
   *
   * Питаме веднъж за цялата страница (не по карта), за да не се превръща
   * лентата в 30 заявки. Ако проверката се провали, лентата пак работи —
   * просто без чипа „същият продукт другаде“.
   */
  const compares = await compareForPosts(ids).catch(() => new Map());

  const [history, receipts, items, comments] = await Promise.all([
    many<PriceHistoryRow>(
      `select ph.*, pr.name as reporter_name
         from price_history ph
         left join profiles pr on pr.id = ph.reported_by
        where ph.post_id = any($1::uuid[])
        order by ph.created_at asc`,
      [ids]
    ),
    many<ReceiptRow & { receipt_image_url: string | null }>(RECEIPT_SELECT, [ids]),
    many<ReceiptItemRow & { receipt_id: string }>(
      `select ri.*
         from receipt_items ri
         join receipts rc on rc.id = ri.receipt_id
        where rc.post_id = any($1::uuid[])
        order by ri.position asc`,
      [ids]
    ),
    many<CommentRow>(
      `select c.*, a.name as author_name, a.handle as author_handle,
              a.avatar_url as author_avatar, a.is_supporter as author_is_supporter
         from comments c
         join profiles a on a.id = c.author_id
        where c.post_id = any($1::uuid[]) and c.status = 'published'
        order by c.created_at asc`,
      [ids]
    ),
  ]);

  let myReactions = new Map<string, string>();
  let myHelped = new Set<string>();
  let myBookmarks = new Set<string>();
  let myConfirmed = new Set<string>();

  if (userId) {
    const [reactions, helped, bookmarks, confirmed] = await Promise.all([
      many<{ post_id: string; reaction_key: string }>(
        'select post_id, reaction_key from post_reactions where user_id = $1 and post_id = any($2::uuid[])',
        [userId, ids]
      ),
      many<{ post_id: string }>(
        'select post_id from post_helped_marks where user_id = $1 and post_id = any($2::uuid[])',
        [userId, ids]
      ),
      many<{ post_id: string }>(
        'select post_id from post_bookmarks where user_id = $1 and post_id = any($2::uuid[])',
        [userId, ids]
      ),
      many<{ post_id: string }>(
        `select distinct post_id from price_history
          where reported_by = $1 and status = 'confirmed' and post_id = any($2::uuid[])`,
        [userId, ids]
      ),
    ]);
    myReactions = new Map(reactions.map((r) => [r.post_id, r.reaction_key]));
    myHelped = new Set(helped.map((r) => r.post_id));
    myBookmarks = new Set(bookmarks.map((r) => r.post_id));
    myConfirmed = new Set(confirmed.map((r) => r.post_id));
  }

  function groupBy<T>(list: T[], key: (item: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const row of list) {
      const k = key(row);
      const bucket = map.get(k);
      if (bucket) bucket.push(row);
      else map.set(k, [row]);
    }
    return map;
  }

  const historyByPost = groupBy(history, (h) => h.post_id);
  const receiptByPost = new Map(receipts.map((r) => [r.post_id, r]));
  const itemsByReceipt = groupBy(items, (i) => i.receipt_id);
  const commentsByPost = groupBy(comments, (c) => c.post_id);

  return rows.map((post) => {
    const receipt = receiptByPost.get(post.id) ?? null;
    const cmp = compares.get(post.id) as (PriceCompareLight | undefined);
    return mapPost({
      post,
      priceHistory: historyByPost.get(post.id) ?? [],
      receipt,
      receiptItems: receipt ? itemsByReceipt.get(receipt.id) ?? [] : [],
      comments: commentsByPost.get(post.id) ?? [],
      userReaction: myReactions.get(post.id) ?? null,
      userMarkedHelped: myHelped.has(post.id),
      isBookmarked: myBookmarks.has(post.id),
      userConfirmedValidToday: myConfirmed.has(post.id),
      compare: cmp
        ? {
            twinCount: cmp.twinCount,
            cheapestPrice: cmp.cheapestPrice,
            cheapestPlace: cmp.cheapestPlace,
            cheapestId: cmp.cheapestId,
            saving: cmp.saving,
            savingPct: cmp.savingPct,
            verdict: cmp.verdict,
          }
        : null,
    });
  });
}

export async function countPosts(filters: FeedFilters): Promise<number> {
  const where = buildWhere(filters);
  const row = await one<{ total: number }>(
    `select count(*) as total
       from posts p
       join profiles a on a.id = p.author_id
      where ${where.clauses.join(' and ')}`,
    where.values
  );
  return row?.total ?? 0;
}
