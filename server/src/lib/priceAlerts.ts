import { many, one, query } from '../db.js';
import { sendPriceAlertEmail } from './email.js';
import { sendPushToUser } from './push.js';
import { env } from '../env.js';

/**
 * Ценови аларми: потребителят казва „кажи ми, когато <нещо> падне под X €“.
 *
 * Досега таблицата `price_alerts` се пълнеше от приложението, но нищо не я проверяваше.
 * Тази функция минава през активните аларми, търси най-евтината публикувана оферта,
 * която отговаря на ключовата дума/града/полярността и е под зададената цена, и
 * праща имейл. Пази се в `price_alert_log`, а алармата не се повтаря 3 дни (или докато
 * не се появи по-евтина оферта от последно уведомената).
 *
 * Ползва `sp_fold()` за търсене — Postgres е с locale C и `lower()` не сгъва кирилица.
 */
const COOLDOWN_DAYS = 3;

export interface PriceAlertMatch {
  alertId: string;
  userEmail: string;
  keyword: string;
  city: string;
  price: number;
  postTitle: string;
  postCode: string | null;
  postId: string;
}

export async function runPriceAlerts(options: { force?: boolean; limit?: number } = {}): Promise<{
  checked: number;
  matched: number;
  emailed: number;
  skipped: number;
  matches: PriceAlertMatch[];
  errors: string[];
}> {
  const limit = Math.max(1, Math.min(500, options.limit ?? 200));
  const force = Boolean(options.force);

  const alerts = await many<{
    id: string;
    user_id: string;
    keyword: string;
    max_price: string | null;
    city: string;
    polarity: string;
    email: string | null;
    name: string | null;
    last_notified_at: string | null;
    notified_post_id: string | null;
  }>(
    `select a.id::text, a.user_id::text, a.keyword, a.max_price::text, a.city, a.polarity,
            p.email, p.name,
            a.last_notified_at::text, a.notified_post_id::text
       from price_alerts a
       join profiles p on p.id = a.user_id
      where a.is_active and p.deleted_at is null and p.email is not null
      order by a.created_at asc
      limit $1`,
    [limit]
  );

  let matched = 0;
  let emailed = 0;
  let skipped = 0;
  const matches: PriceAlertMatch[] = [];
  const errors: string[] = [];
  const now = Date.now();

  for (const a of alerts) {
    // Не спамим: една аларма се уведомява най-много веднъж на 3 дни.
    if (!force && a.last_notified_at) {
      const age = now - Date.parse(a.last_notified_at);
      if (Number.isFinite(age) && age < COOLDOWN_DAYS * 24 * 3600 * 1000) {
        skipped++;
        continue;
      }
    }

    let best: {
      id: string;
      title: string;
      city: string;
      place_name: string;
      price: number;
      code: string | null;
    } | null = null;
    try {
      best = await one<{
        id: string;
        title: string;
        city: string;
        place_name: string;
        price: number;
        code: string | null;
      }>(
        `select p.id::text, p.title, p.city, p.place_name, p.price_paid::float as price,
                p.public_code as code
           from posts p
          where p.price_paid > 0
            and ($1 = 'Всички градове' or p.city = $1)
            and ($2 = 'any' or p.polarity = $2)
            and (sp_fold(p.title) like '%' || sp_fold($3) || '%'
                 or sp_fold(coalesce(p.description, '')) like '%' || sp_fold($3) || '%')
            and ($4::numeric is null or p.price_paid <= $4)
          order by p.price_paid asc
          limit 1`,
        [a.city, a.polarity, a.keyword, a.max_price ? Number(a.max_price) : null]
      );
    } catch (err) {
      errors.push('Аларма ' + a.id.slice(0, 8) + ': ' + (err as Error).message.slice(0, 120));
      continue;
    }

    if (!best) continue;
    matched++;

    // Ако вече сме уведомили за същата оферта — няма смисъл да повтаряме.
    if (!force && a.notified_post_id === best.id) {
      skipped++;
      continue;
    }

    const match: PriceAlertMatch = {
      alertId: a.id,
      userEmail: a.email ?? '',
      keyword: a.keyword,
      city: a.city,
      price: best.price,
      postTitle: best.title,
      postCode: best.code,
      postId: best.id,
    };
    matches.push(match);

    try {
      await sendPriceAlertEmail({
        to: a.email!,
        name: a.name ?? 'здравей',
        keyword: a.keyword,
        maxPrice: a.max_price ? Number(a.max_price) : null,
        city: a.city,
        price: best.price,
        postTitle: best.title,
        placeName: best.place_name,
        postCity: best.city,
        postCode: best.code,
        postId: best.id,
        baseUrl: env.PUBLIC_BASE_URL,
      });

      await query(
        `update price_alerts
            set last_notified_at = now(), notified_post_id = $2, notify_count = notify_count + 1
          where id = $1`,
        [a.id, best.id]
      );
      await query(
        `insert into price_alert_log (alert_id, post_id, price, channel) values ($1,$2,$3,'email')`,
        [a.id, best.id, best.price]
      );
      emailed++;

      // Push известие до браузъра/PWA (ако човекът има абонамент).
      try {
        const push = await sendPushToUser(a.user_id, {
          title: '💰 По-ниска цена: ' + a.keyword,
          body:
            best.price.toFixed(2).replace('.', ',') +
            ' € в ' +
            (best.place_name || best.city || 'обект') +
            (best.city ? ', ' + best.city : '') +
            (a.max_price ? ' (търсиш до ' + Number(a.max_price).toFixed(2).replace('.', ',') + ' €)' : ''),
          url: env.PUBLIC_BASE_URL + '/post/' + best.id,
          tag: 'alert-' + a.id,
        });
        if (push.sent > 0) {
          await query(
            `insert into price_alert_log (alert_id, post_id, price, channel) values ($1,$2,$3,'push')`,
            [a.id, best.id, best.price]
          ).catch(() => undefined);
        }
      } catch {
        /* push-ът не бива да чупи имейла */
      }
    } catch (err) {
      errors.push('Имейл за аларма ' + a.id.slice(0, 8) + ': ' + (err as Error).message.slice(0, 140));
    }
  }

  return { checked: alerts.length, matched, emailed, skipped, matches, errors };
}

/** Статистика за панела: колко аларми има, колко са уведомени, последни известия. */
export async function getPriceAlertStats(): Promise<{
  active: number;
  total: number;
  notifiedToday: number;
  lastSent: Array<{ when: string; keyword: string; price: number; title: string }>;
}> {
  const [counts, lastSent] = await Promise.all([
    one<{ active: number; total: number; notified_today: number }>(
      `select count(*) filter (where is_active)::int as active,
              count(*)::int as total,
              (select count(*)::int from price_alert_log where sent_at > now() - interval '24 hours') as notified_today
         from price_alerts`
    ),
    many<{ when: string; keyword: string; price: number; title: string }>(
      `select to_char(l.sent_at at time zone 'Europe/Sofia', 'DD.MM HH24:MI') as when,
              a.keyword, l.price::float as price, coalesce(p.title, '') as title
         from price_alert_log l
         join price_alerts a on a.id = l.alert_id
         left join posts p on p.id = l.post_id
        order by l.sent_at desc
        limit 10`
    ),
  ]);

  return {
    active: counts?.active ?? 0,
    total: counts?.total ?? 0,
    notifiedToday: counts?.notified_today ?? 0,
    lastSent: lastSent.map((r) => ({ when: r.when, keyword: r.keyword, price: Number(r.price), title: r.title })),
  };
}
