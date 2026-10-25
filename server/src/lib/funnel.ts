/**
 * 📈 ПЪТЯТ НА ПОТРЕБИТЕЛЯ — събития и фуния, ВКЛЮЧИТЕЛНО ГОСТИ.
 *
 * Защо съществува (25.10.2026):
 * статистиката на потребителите искаше вход, а профили имаше 5. Значи 99% от
 * хората, които отварят приложението, бяха невидими — точно тези, които трябва да
 * спечелим. Без тях не може да се види КЪДЕ отпадат хората.
 *
 * Как броим:
 *   • всеки браузър праща свой случаен `visitor` (не е имейл, не е вход);
 *   • `visit` се брои веднъж на ден за един браузър — иначе презарежданията надуват;
 *   • всичко останало (`install`, `first_view`, …) се брои ВЕДНЪЖ ЗАВИНАГИ за браузър:
 *     човек не „инсталира за първи път“ втори път.
 *
 * Фунията показва само уникални хора на всяка стъпка — числата падат надолу.
 */
import { many, one, query } from '../db.js';

export const FUNNEL_KINDS = [
  'visit',
  'install',
  'first_view',
  'signup',
  'verified',
  'contribution',
  'invite_sent',
  'invite_accepted',
  'push_on',
] as const;

export type FunnelKind = (typeof FUNNEL_KINDS)[number];

/** Събития, които за един браузър се броят само веднъж завинаги. */
const ONCE_EVER: readonly FunnelKind[] = [
  'install',
  'first_view',
  'signup',
  'verified',
  'contribution',
  'invite_sent',
  'invite_accepted',
  'push_on',
];

export function isFunnelKind(v: unknown): v is FunnelKind {
  return typeof v === 'string' && (FUNNEL_KINDS as readonly string[]).includes(v);
}

export interface FunnelEventInput {
  visitor: string;
  kind: FunnelKind;
  userId?: string | null;
  platform?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
}

/**
 * Записва събитие. Тиха е при проблем (статистиката не бива да чупи приложението).
 * Връща `counted: false`, ако събитието вече е било отчетено за този браузър.
 */
export async function recordFunnelEvent(e: FunnelEventInput): Promise<{ counted: boolean }> {
  const onceEver = ONCE_EVER.includes(e.kind);

  const existing = await one<{ id: string }>(
    onceEver
      ? `select id from funnel_events where visitor = $1 and kind = $2 limit 1`
      : `select id from funnel_events
           where visitor = $1 and kind = $2 and created_at > now() - interval '1 day'
           limit 1`,
    [e.visitor, e.kind]
  ).catch(() => null);

  if (existing) return { counted: false };

  await query(
    `insert into funnel_events (visitor, kind, user_id, platform, meta, ip)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      e.visitor,
      e.kind,
      e.userId ?? null,
      e.platform ?? null,
      e.meta ? JSON.stringify(e.meta) : null,
      e.ip ?? null,
    ]
  ).catch(() => undefined);

  return { counted: true };
}

/** Когато човекът влезе/потвърди имейла — свързваме предишните му гостувания с профила. */
export async function linkVisitorToUser(visitor: string, userId: string): Promise<void> {
  await query(
    `update funnel_events set user_id = $2 where visitor = $1 and user_id is null`,
    [visitor, userId]
  ).catch(() => undefined);
}

export interface FunnelStage {
  key: string;
  label: string;
  /** Уникални хора на тази стъпка. */
  users: number;
  /** Колко идват от предишната стъпка (%), за да се вижда къде е отливът. */
  rateFromPrev: number;
  /** Колко са от първата стъпка (%). */
  rateFromTop: number;
  /** Само за първите три стъпки — от там идват гостите. */
  guestsOnly?: boolean;
}

/** Уникални браузъри, стигнали до всяко събитие. */
async function countsByKind(): Promise<Map<string, number>> {
  const rows = await many<{ kind: string; users: string }>(
    `select kind, count(distinct visitor)::text as users
       from funnel_events
      group by 1`
  ).catch(() => [] as { kind: string; users: string }[]);
  return new Map(rows.map((r) => [r.kind, Number(r.users) || 0]));
}

/**
 * Пълната фуния: от анонимен посетител до пусната обява.
 * Първите три стъпки идват от `funnel_events` (броят гостите), следващите — от
 * реалните таблици (профили, находки, аларми, обяви).
 */
export async function funnelWithGuests(): Promise<{ steps: FunnelStage[] }> {
  const c = await countsByKind();

  const prof = await one<Record<string, string>>(
    `select
       (select count(*) from profiles where deleted_at is null)::text as registered,
       (select count(*) from profiles where deleted_at is null
          and email_verified_at is not null)::text as verified,
       (select count(distinct author_id) from posts)::text as posted,
       (select count(distinct user_id) from price_alerts)::text as alert,
       (select count(distinct user_id) from listings where user_id is not null)::text as listing`
  ).catch(() => null);

  const num = (v: string | undefined): number => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  const raw: { key: string; label: string; users: number; guestsOnly?: boolean }[] = [
    { key: 'visit', label: 'Отворили приложението (вкл. гости)', users: c.get('visit') ?? 0, guestsOnly: true },
    { key: 'install', label: 'Сложили го на телефона си', users: c.get('install') ?? 0, guestsOnly: true },
    { key: 'first_view', label: 'Отворили оферта — първа полза', users: c.get('first_view') ?? 0, guestsOnly: true },
    { key: 'signup', label: 'Регистрирали се', users: Math.max(num(prof?.registered), c.get('signup') ?? 0) },
    { key: 'verified', label: 'Потвърдили имейл', users: Math.max(num(prof?.verified), c.get('verified') ?? 0) },
    { key: 'contribution', label: 'Дали находка или бележка', users: Math.max(num(prof?.posted), c.get('contribution') ?? 0) },
    { key: 'push_on', label: 'Включили известия', users: c.get('push_on') ?? 0 },
    { key: 'alert', label: 'Сложили си ценова аларма', users: num(prof?.alert) },
    { key: 'listing', label: 'Пуснали обява за продажба', users: num(prof?.listing) },
  ];

  const top = raw[0]?.users ?? 0;
  let prev = 0;
  const steps: FunnelStage[] = raw.map((s, i) => {
    const rateFromPrev = i === 0 ? 100 : prev > 0 ? Math.round((s.users / prev) * 100) : 0;
    if (i > 0) prev = s.users;
    else prev = s.users;
    return {
      ...s,
      rateFromPrev,
      rateFromTop: top > 0 ? Math.round((s.users / top) * 100) : 0,
    };
  });

  return { steps };
}

/** Кратка разбивка по устройство и по дни — за горната част на страницата. */
export async function funnelOverview(days = 30): Promise<{
  byPlatform: { platform: string; visitors: number }[];
  byDay: { day: string; visitors: number; installs: number }[];
  totals: { visitors: number; installs: number; firstViews: number; today: number };
}> {
  const byPlatform = await many<{ platform: string; visitors: string }>(
    `select coalesce(platform, 'неизвестно') as platform,
            count(distinct visitor)::text as visitors
       from funnel_events
      where kind = 'visit' and created_at > now() - ($1 || ' days')::interval
      group by 1 order by 2 desc`,
    [String(days)]
  ).catch(() => [] as { platform: string; visitors: string }[]);

  const byDay = await many<{ day: string; visitors: string; installs: string }>(
    `select to_char(d, 'YYYY-MM-DD') as day,
            (select count(distinct visitor) from funnel_events f
              where f.kind = 'visit' and f.created_at::date = d)::text as visitors,
            (select count(distinct visitor) from funnel_events f
              where f.kind = 'install' and f.created_at::date = d)::text as installs
       from generate_series(current_date - ($1 || ' days')::interval, current_date, '1 day') as d
      order by d desc`,
    [String(days)]
  ).catch(() => [] as { day: string; visitors: string; installs: string }[]);

  const t = await one<Record<string, string>>(
    `select
       (select count(distinct visitor) from funnel_events where kind = 'visit')::text as visitors,
       (select count(distinct visitor) from funnel_events where kind = 'install')::text as installs,
       (select count(distinct visitor) from funnel_events where kind = 'first_view')::text as first_views,
       (select count(distinct visitor) from funnel_events
          where kind = 'visit' and created_at::date = current_date)::text as today`
  ).catch(() => null);

  return {
    byPlatform: byPlatform.map((r) => ({ platform: r.platform, visitors: Number(r.visitors) || 0 })),
    byDay: byDay.map((r) => ({
      day: r.day,
      visitors: Number(r.visitors) || 0,
      installs: Number(r.installs) || 0,
    })),
    totals: {
      visitors: Number(t?.visitors ?? 0) || 0,
      installs: Number(t?.installs ?? 0) || 0,
      firstViews: Number(t?.first_views ?? 0) || 0,
      today: Number(t?.today ?? 0) || 0,
    },
  };
}
