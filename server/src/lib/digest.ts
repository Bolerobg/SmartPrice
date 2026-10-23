/**
 * 📨 Седмичен дайджест по известия (Web Push).
 *
 * Идеята: човек вече е дал разрешение за известия (иначе не сме тук) — значи
 * иска да чуе когато има смисъл. Най-смисленото за него е „в моя град има нови
 * находки“. Затова:
 *   • събираме находките от последните 7 дни по градове;
 *   • всеки абониран получава само своя град (макс 1 известие на седмица);
 *   • ако в неговия град няма нищо — даваме най-доброто от страната, за да не
 *     мълчим съвсем (известие, което не идва, не задържа никого);
 *   • НЕ пипаме нищо, ако няма находки — по-добре нищо, отколкото празно.
 *
 * Само човешки находки: внесеното от скрапера и обявите от olx НЕ се броят.
 * Лентата и класацията работят по същото правило — няма да лъжем и тук.
 */
import { many, one } from '../db.js';
import { getSetting, setSetting } from './settings.js';
import { sendPushToUser, type PushPayload } from './push.js';

/** Толкова назад гледаме за находки. */
export const DIGEST_WINDOW_DAYS = 7;
/** Най-много толкова находки влизат в едно известие. */
const TOP_PER_CITY = 3;

export interface DigestFinding {
  id: string;
  title: string;
  place_name: string;
  city: string;
  price: number;
  polarity: string;
  helped_count: number;
}

export interface CityDigest {
  city: string;
  total: number;
  top: DigestFinding[];
}

/** Най-добрите находки за последните N дни, групирани по град. */
export async function buildCityDigests(days = DIGEST_WINDOW_DAYS): Promise<CityDigest[]> {
  const rows = await many<DigestFinding & { city_total: string }>(
    `select p.id::text,
            p.title,
            p.place_name,
            btrim(p.city)                                   as city,
            p.price_paid::float                             as price,
            p.polarity,
            coalesce(p.helped_count, 0)::int                as helped_count,
            count(*) over (partition by btrim(p.city))::text as city_total
       from posts p
      where p.status = 'published'
        and p.created_at > now() - ($1 || ' day')::interval
        and p.price_paid > 0
        and btrim(coalesce(p.city, '')) <> ''
        and coalesce(p.source, '') not in ('scraper', 'olx')
      order by coalesce(p.helped_count, 0) desc, p.created_at desc
      limit 4000`,
    [String(days)]
  );

  const byCity = new Map<string, CityDigest>();
  for (const r of rows) {
    const existing = byCity.get(r.city);
    const entry: CityDigest = existing ?? { city: r.city, total: Number(r.city_total ?? 0), top: [] };
    if (entry.top.length < TOP_PER_CITY) {
      entry.top.push({
        id: r.id,
        title: r.title,
        place_name: r.place_name,
        city: r.city,
        price: r.price,
        polarity: r.polarity,
        helped_count: r.helped_count,
      });
    }
    byCity.set(r.city, entry);
  }

  return [...byCity.values()].sort((a, b) => b.total - a.total);
}

/** Дайджест за един град (или null, ако там няма нищо). */
export function digestForCity(city: string | null | undefined, all: CityDigest[]): CityDigest | null {
  const wanted = String(city ?? '').trim().toLowerCase();
  if (!wanted) return null;
  return all.find((d) => d.city.trim().toLowerCase() === wanted) ?? null;
}

/** Най-добрите находки в страната — резервният вариант за нечий празен град. */
export function nationalDigest(all: CityDigest[], city = 'В България'): CityDigest | null {
  const top = all
    .flatMap((d) => d.top)
    .sort((a, b) => b.helped_count - a.helped_count)
    .slice(0, TOP_PER_CITY);
  if (top.length === 0) return null;
  return { city, total: all.reduce((s, d) => s + d.total, 0), top };
}

/** Текстът на известието — прост, човешки, с конкретни числа. */
export function digestPayload(d: CityDigest, scope: 'city' | 'country'): PushPayload {
  const best = d.top[0];
  const count = d.total;
  const title =
    scope === 'city'
      ? `🔥 ${count} находк${count === 1 ? 'а' : 'и'} в ${d.city} тази седмица`
      : `🔥 Най-добрите находки тази седмица`;

  /**
   * ВАЖНО: заглавието на оферта често вече съдържа цената и мястото
   * („Капки за нос Отривин Плюс с цена 7.37 € в аптека Ремидиум“). Ако ги
   * залепим пак, човекът чете „7.37 € … — 7.37 € · в Аптека Ремидиум“.
   * Затова добавяме цена/място САМО ако още ги няма в заглавието.
   */
  const base = best ? best.title.trim().slice(0, 90) : '';
  const extras: string[] = [];
  if (best && base && !/€/.test(base)) extras.push(`${best.price.toFixed(2)} €`);
  if (best?.place_name && !base.toLowerCase().includes(best.place_name.toLowerCase())) {
    extras.push(`в ${best.place_name}`);
  }
  const body = base
    ? extras.length
      ? `${base} · ${extras.join(' · ')}`
      : base
    : 'Виж какво намериха хората тази седмица.';

  return {
    title,
    body,
    url: '/?from=digest',
    tag: 'weekly-digest',
  };
}

/** Хората, които имат поне един абонамент за известия (и не са спрени/изтрити). */
async function subscribedUsers(limit = 5000): Promise<Array<{ user_id: string; city: string | null }>> {
  return many<{ user_id: string; city: string | null }>(
    `select s.user_id, pr.city
       from (select distinct user_id from push_subscriptions) s
       join profiles pr on pr.id = s.user_id
      where pr.suspended_at is null and pr.deleted_at is null
      limit $1`,
    [limit]
  );
}

export interface DigestResult {
  cities: number;
  findings: number;
  targeted: number;
  sent: number;
  gone: number;
  failed: number;
  note: string;
  sample?: Array<{ city: string; title: string; body: string }>;
}

/**
 * Изпраща седмичния дайджест.
 *
 * `dryRun: true` изчислява всичко и връща примерни текстове, БЕЗ да праща —
 * така може да се провери, че числата са истински, преди да стигне до хора.
 */
export async function sendWeeklyDigest(
  options: {
    dryRun?: boolean;
    days?: number;
    trigger?: 'auto' | 'manual' | 'dry';
    /** true само при пуск след рестарт на сървъра (виж предпазната мярка долу). */
    startupGuard?: boolean;
  } = {}
): Promise<DigestResult> {
  const days = options.days ?? DIGEST_WINDOW_DAYS;
  const trigger = options.trigger ?? (options.dryRun ? 'dry' : 'auto');

  /**
   * 🛡️ Предпазна мярка срещу ПОВТОРЕНИЕ.
   *
   * Планировчикът пуска дайджест и при старт, ако последният е стар — но при
   * няколко рестарта (деплой) човек може да получи няколко известия за едно и
   * също нещо. Затова: пускът СЛЕД РЕСТАРТ не минава, ако последният дайджест е
   * преди по-малко от 5 дни. Редовният понеделнишки пуск НЕ се спира от това —
   * иначе тестов пуск би потиснал истинския за седмицата.
   */
  if (!options.dryRun && options.startupGuard === true) {
    const last = await getSetting('push_digest_last_run', '');
    const age = last ? Date.now() - new Date(last).getTime() : Number.POSITIVE_INFINITY;
    if (age < 5 * 24 * 60 * 60 * 1000) {
      return {
        cities: 0,
        findings: 0,
        targeted: 0,
        sent: 0,
        gone: 0,
        failed: 0,
        note: 'Твърде скоро след последния дайджест — прескачам (пази от повторение при рестарт).',
      };
    }
  }

  const all = await buildCityDigests(days);
  const fallback = nationalDigest(all);
  const findings = all.reduce((s, d) => s + d.total, 0);

  if (all.length === 0 || !fallback) {
    return {
      cities: 0,
      findings: 0,
      targeted: 0,
      sent: 0,
      gone: 0,
      failed: 0,
      note: 'Няма находки за последните дни — не пращам нищо (празно известие не задържа).',
    };
  }

  const users = await subscribedUsers();
  const sample: Array<{ city: string; title: string; body: string }> = [];
  for (const d of all.slice(0, 5)) {
    const p = digestPayload(d, 'city');
    sample.push({ city: d.city, title: p.title, body: p.body });
  }

  if (options.dryRun) {
    // Пробите също се записват в историята — за да се вижда кой какво е проверявал.
    await logDigestRow(trigger, days, {
      cities: all.length,
      findings,
      targeted: users.length,
      sent: 0,
      gone: 0,
      failed: 0,
      note: `Проба: ${all.length} града, ${findings} находки, ${users.length} абонирани души — нищо не е пратено.`,
    });
    return {
      cities: all.length,
      findings,
      targeted: users.length,
      sent: 0,
      gone: 0,
      failed: 0,
      note: `Проба: ${all.length} града, ${findings} находки, ${users.length} абонирани души — нищо не е пратено.`,
      sample,
    };
  }

  let sent = 0;
  let gone = 0;
  let failed = 0;
  for (const u of users) {
    const mine = digestForCity(u.city, all);
    const d = mine ?? fallback;
    const payload = digestPayload(d, mine ? 'city' : 'country');
    try {
      const res = await sendPushToUser(u.user_id, payload);
      sent += res.sent;
      gone += res.gone;
      failed += res.failed;
    } catch {
      failed += 1;
    }
  }

  const note =
    `Изпратено до ${users.length} души (${sent} устройства): ` +
    `${all.length} града, ${findings} находки.`;

  await logDigestRow(trigger, days, {
    cities: all.length,
    findings,
    targeted: users.length,
    sent,
    gone,
    failed,
    note,
  });

  await setSetting('push_digest_last_run', new Date().toISOString());

  return { cities: all.length, findings, targeted: users.length, sent, gone, failed, note, sample };
}

/**
 * ЕДИНСТВЕНОТО място, което пише в историята на пусковете.
 *
 * Защо е отделна функция: преди и `sendWeeklyDigest`, и админ маршрутът
 * пишеха ред — затова един пуск се виждаше ДВА пъти в панела ('auto' + 'manual').
 */
async function logDigestRow(
  trigger: 'auto' | 'manual' | 'dry',
  days: number,
  data: {
    cities: number;
    findings: number;
    targeted: number;
    sent: number;
    gone: number;
    failed: number;
    note: string;
  }
): Promise<void> {
  await one(
    `insert into push_digest_log (trigger, window_days, cities, findings, targeted, sent, gone, failed, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [trigger, days, data.cities, data.findings, data.targeted, data.sent, data.gone, data.failed, data.note]
  ).catch(() => undefined);
}

/** Статистика за панела: абонати, последен пуск, история. */
export async function digestInfo(): Promise<{
  devices: number;
  users: number;
  last_run: string | null;
  enabled: boolean;
  cities_ready: number;
  findings_ready: number;
  history: Array<Record<string, unknown>>;
}> {
  const [subs, last, enabled, history, ready] = await Promise.all([
    one<{ devices: string; users: string }>(
      `select count(*)::text as devices, count(distinct user_id)::text as users from push_subscriptions`
    ),
    getSetting('push_digest_last_run', ''),
    getSetting('push_digest_enabled', 'on'),
    many<Record<string, unknown>>(
      `select id, run_at, trigger, cities, findings, targeted, sent, gone, failed, note
         from push_digest_log order by run_at desc limit 12`
    ),
    buildCityDigests().catch(() => []),
  ]);

  return {
    devices: Number(subs?.devices ?? 0),
    users: Number(subs?.users ?? 0),
    last_run: last || null,
    enabled: enabled !== 'off',
    cities_ready: ready.length,
    findings_ready: ready.reduce((s, d) => s + d.total, 0),
    history,
  };
}

export async function setDigestEnabled(on: boolean): Promise<void> {
  await setSetting('push_digest_enabled', on ? 'on' : 'off');
}
