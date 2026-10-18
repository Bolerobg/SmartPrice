/**
 * 👥 ПЪЛНА СТАТИСТИКА НА ПОТРЕБИТЕЛИТЕ.
 *
 * Какво отговаря:
 *   • кой, кога и колко пъти е влизал (цялата история, не само брояч);
 *   • къде отваря в приложението и колко време стои;
 *   • колко души са активни днес / тази седмица / този месец (DAU/WAU/MAU);
 *   • кой е вътре в момента;
 *   • от какво устройство и браузър влиза.
 *
 * ВАЖНО: не пишем на всяко отваряне по ред в базата — иначе таблицата расте
 * главоломно. Затова: сбор за деня по екран + хронология с отбив (същият екран
 * в рамките на 25 секунди не се брои пак).
 */
import { many, one, query } from '../db.js';

/* ============================================================ разчитане на браузъра */

export interface UaInfo {
  platform: string;
  browser: string;
  device: string;
}

export function uaInfo(userAgent: string | undefined | null, hint?: string | null): UaInfo {
  const ua = String(userAgent ?? '');
  let platform = 'other';
  let device = 'компютър';

  if (/iPhone|iPad|iPod/i.test(ua)) {
    platform = 'ios';
    device = /iPad/i.test(ua) ? 'таблет' : 'телефон';
  } else if (/Android/i.test(ua)) {
    platform = 'android';
    device = /Mobile/i.test(ua) ? 'телефон' : 'таблет';
  } else if (/Windows/i.test(ua)) {
    platform = 'windows';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    platform = 'mac';
    device = 'мак';
  } else if (/Linux/i.test(ua)) {
    platform = 'linux';
  }
  // Приложението (Expo) се представя иначе — ако клиентът казва, вярваме му.
  if (hint && /^(ios|android|web|windows|mac)$/i.test(hint)) platform = hint.toLowerCase();
  if (/Expo|okhttp|CFNetwork/i.test(ua) && platform === 'other') platform = 'app';

  let browser = 'other';
  if (/Edg\//i.test(ua)) browser = 'edge';
  else if (/OPR\//i.test(ua)) browser = 'opera';
  else if (/Firefox\//i.test(ua)) browser = 'firefox';
  else if (/Chrome\//i.test(ua)) browser = /Expo/i.test(ua) ? 'app' : 'chrome';
  else if (/Safari\//i.test(ua)) browser = 'safari';
  if (/Expo|okhttp/i.test(ua)) browser = 'app';

  return { platform, browser, device };
}

/* ============================================================ записване */

/** Записва вход / регистрация / изход / неуспешен опит. */
export async function recordAuthEvent(input: {
  userId?: string | null;
  email?: string | null;
  kind: 'login' | 'register' | 'logout' | 'failed' | 'refresh';
  ip?: string | null;
  userAgent?: string | null;
  platformHint?: string | null;
}): Promise<void> {
  const ua = uaInfo(input.userAgent, input.platformHint);
  await query(
    `insert into auth_events (user_id, email, kind, ip, user_agent, platform, browser)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.userId ?? null,
      String(input.email ?? '').slice(0, 200) || null,
      input.kind,
      String(input.ip ?? '').slice(0, 60) || null,
      String(input.userAgent ?? '').slice(0, 400) || null,
      ua.platform,
      ua.browser,
    ]
  ).catch(() => undefined);

  if (input.userId && input.kind === 'login') {
    await query(
      `update profiles set
         sessions_count = sessions_count + 1,
         last_ip = coalesce($2, last_ip),
         last_platform = $3,
         first_seen_at = coalesce(first_seen_at, now())
       where id = $1`,
      [input.userId, String(input.ip ?? '').slice(0, 60) || null, ua.platform]
    ).catch(() => undefined);
  }
}

/**
 * Отбелязва отваряне на екран.
 * Отбив: същият екран в рамките на 25 сек не се брои пак (иначе 100 отваряния
 * при превключване на табове).
 */
export async function recordScreenView(input: {
  userId: string;
  screen: string;
  ip?: string | null;
  userAgent?: string | null;
  platformHint?: string | null;
}): Promise<{ counted: boolean }> {
  const screen = String(input.screen ?? '').trim().slice(0, 120) || 'unknown';
  const ua = uaInfo(input.userAgent, input.platformHint);
  const platform = input.platformHint && /^(ios|android|web)$/i.test(input.platformHint)
    ? input.platformHint.toLowerCase()
    : ua.platform;

  // Отбив: гледаме последното записано отваряне на същия екран.
  const recent = await one<{ id: string }>(
    `select id from user_activity_log
      where user_id = $1 and screen = $2 and created_at > now() - interval '25 seconds'
      limit 1`,
    [input.userId, screen]
  ).catch(() => null);
  if (recent) return { counted: false };

  await query(
    `insert into user_screen_views (user_id, day, screen, views, last_at)
     values ($1, current_date, $2, 1, now())
     on conflict (user_id, day, screen) do update
       set views = user_screen_views.views + 1, last_at = now()`,
    [input.userId, screen]
  ).catch(() => undefined);

  await query(
    `insert into user_activity_log (user_id, screen, platform, ip) values ($1,$2,$3,$4)`,
    [input.userId, screen, platform, String(input.ip ?? '').slice(0, 60) || null]
  ).catch(() => undefined);

  await query(
    `insert into user_daily_activity (day, user_id, sessions, screens, actions)
     values (current_date, $1, 1, 1, 0)
     on conflict (day, user_id) do update
       set screens = user_daily_activity.screens + 1`,
    [input.userId]
  ).catch(() => undefined);

  await query(
    `update profiles set last_screen = $2, last_seen_at = now(), last_platform = $3 where id = $1`,
    [input.userId, screen, platform]
  ).catch(() => undefined);

  return { counted: true };
}

/* ============================================================ четене */

export interface Overview {
  users: { total: number; newToday: number; new7: number; new30: number; verified: number; suspended: number };
  active: { today: number; week: number; month: number; now: number };
  logins: { today: number; week: number; month: number; failed7: number };
  content: { posts: number; postsToday: number; listings: number; alerts: number; comments: number };
  timeline: Array<{ day: string; active: number; logins: number; newUsers: number; screens: number }>;
  topScreens: Array<{ screen: string; users: number; views: number }>;
  platforms: Array<{ platform: string; users: number; logins: number }>;
  hourly: Array<{ hour: number; logins: number }>;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

export async function analyticsOverview(): Promise<Overview> {
  const [u, a, l, c] = await Promise.all([
    one<Record<string, string>>(
      `select count(*)::text as total,
              count(*) filter (where created_at::date = current_date)::text as new_today,
              count(*) filter (where created_at > now() - interval '7 days')::text as new_7,
              count(*) filter (where created_at > now() - interval '30 days')::text as new_30,
              count(*) filter (where email_verified_at is not null)::text as verified,
              count(*) filter (where suspended_at is not null)::text as suspended
         from profiles`
    ),
    one<Record<string, string>>(
      `select
         (select count(distinct user_id) from user_daily_activity where day = current_date)::text as today,
         (select count(distinct user_id) from user_daily_activity where day > current_date - 7)::text as week,
         (select count(distinct user_id) from user_daily_activity where day > current_date - 30)::text as month,
         (select count(distinct user_id) from user_daily_activity where day = current_date
            and user_id in (select id from profiles where last_seen_at > now() - interval '15 minutes'))::text as now_`
    ),
    one<Record<string, string>>(
      `select
         count(*) filter (where kind = 'login' and created_at::date = current_date)::text as today,
         count(*) filter (where kind = 'login' and created_at > now() - interval '7 days')::text as week,
         count(*) filter (where kind = 'login' and created_at > now() - interval '30 days')::text as month,
         count(*) filter (where kind = 'failed' and created_at > now() - interval '7 days')::text as failed7
       from auth_events`
    ),
    one<Record<string, string>>(
      `select
         (select count(*) from posts)::text as posts,
         (select count(*) from posts where created_at::date = current_date)::text as posts_today,
         (select count(*) from listings)::text as listings,
         (select count(*) from price_alerts)::text as alerts,
         (select count(*) from comments)::text as comments`
    ),
  ]);

  const [timeline, screens, plats, hourly] = await Promise.all([
    many<Record<string, string>>(
      `select d.day::text as day,
              (select count(distinct user_id) from user_daily_activity x where x.day = d.day)::text as active,
              (select count(*) from auth_events e where e.kind = 'login' and e.created_at::date = d.day)::text as logins,
              (select count(*) from profiles p where p.created_at::date = d.day)::text as new_users,
              (select count(*) from user_screen_views v where v.day = d.day)::text as screens
         from (select generate_series(current_date - 13, current_date, interval '1 day')::date as day) d
        order by d.day asc`
    ).catch(() => []),
    many<Record<string, string>>(
      `select screen, count(distinct user_id)::text as users, sum(views)::text as views
         from user_screen_views where day > current_date - 30
        group by screen order by sum(views) desc limit 20`
    ).catch(() => []),
    many<Record<string, string>>(
      `select coalesce(platform,'other') as platform, count(distinct user_id)::text as users, count(*)::text as logins
         from auth_events where kind = 'login' and created_at > now() - interval '30 days'
        group by 1 order by count(*) desc limit 10`
    ).catch(() => []),
    many<Record<string, string>>(
      `select extract(hour from created_at)::int::text as hour, count(*)::text as logins
         from auth_events where kind = 'login' and created_at > now() - interval '30 days'
        group by 1 order by 1`
    ).catch(() => []),
  ]);

  return {
    users: {
      total: n(u?.total),
      newToday: n(u?.new_today),
      new7: n(u?.new_7),
      new30: n(u?.new_30),
      verified: n(u?.verified),
      suspended: n(u?.suspended),
    },
    active: { today: n(a?.today), week: n(a?.week), month: n(a?.month), now: n(a?.now_) },
    logins: { today: n(l?.today), week: n(l?.week), month: n(l?.month), failed7: n(l?.failed7) },
    content: {
      posts: n(c?.posts),
      postsToday: n(c?.posts_today),
      listings: n(c?.listings),
      alerts: n(c?.alerts),
      comments: n(c?.comments),
    },
    timeline: timeline.map((r) => ({
      day: r.day,
      active: n(r.active),
      logins: n(r.logins),
      newUsers: n(r.new_users),
      screens: n(r.screens),
    })),
    topScreens: screens.map((r) => ({ screen: r.screen, users: n(r.users), views: n(r.views) })),
    platforms: plats.map((r) => ({ platform: r.platform, users: n(r.users), logins: n(r.logins) })),
    hourly: hourly.map((r) => ({ hour: n(r.hour), logins: n(r.logins) })),
  };
}

export interface UserStatRow {
  id: string;
  email: string;
  name: string | null;
  city: string | null;
  role: string;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  login_count: number;
  sessions_count: number;
  last_screen: string | null;
  last_platform: string | null;
  last_ip: string | null;
  screens_30: number;
  logins_30: number;
  posts: number;
  listings: number;
  online: boolean;
}

/** Таблица с потребители + как са се държали. */
export async function analyticsUsers(params: {
  q?: string;
  sort?: 'recent' | 'logins' | 'new' | 'active';
  limit?: number;
  offset?: number;
  onlyActive?: boolean;
}): Promise<{ total: number; items: UserStatRow[] }> {
  const where: string[] = ['p.deleted_at is null'];
  const args: unknown[] = [];
  const p = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  if (params.q) {
    const like = `%${params.q}%`;
    const i = p(like);
    where.push(`(p.email ilike ${i} or coalesce(p.name,'') ilike ${i} or coalesce(p.city,'') ilike ${i})`);
  }
  if (params.onlyActive) where.push(`p.last_seen_at > now() - interval '30 days'`);

  const order =
    params.sort === 'logins'
      ? 'p.login_count desc nulls last'
      : params.sort === 'new'
        ? 'p.created_at desc'
        : params.sort === 'active'
          ? 'p.last_seen_at desc nulls last'
          : 'coalesce(p.last_login_at, p.created_at) desc';

  const limit = Math.max(1, Math.min(200, params.limit ?? 50));
  const offset = Math.max(0, Math.min(20000, params.offset ?? 0));

  const rows = await many<UserStatRow>(
    `select p.id, p.email, p.name, p.city, p.role,
            p.created_at::text, p.last_login_at::text, p.last_seen_at::text,
            p.login_count, coalesce(p.sessions_count,0) as sessions_count,
            p.last_screen, p.last_platform, p.last_ip,
            coalesce((select sum(v.views) from user_screen_views v where v.user_id = p.id and v.day > current_date - 30),0)::int as screens_30,
            coalesce((select count(*) from auth_events e where e.user_id = p.id and e.kind='login' and e.created_at > now() - interval '30 days'),0)::int as logins_30,
            coalesce((select count(*) from posts x where x.author_id = p.id),0)::int as posts,
            coalesce((select count(*) from listings l where l.user_id = p.id),0)::int as listings,
            (p.last_seen_at > now() - interval '15 minutes') as online
       from profiles p
      where ${where.join(' and ')}
      order by ${order}
      limit ${limit} offset ${offset}`,
    args
  );

  const total = await one<{ n: string }>(
    `select count(*)::text as n from profiles p where ${where.join(' and ')}`,
    args
  );
  return { total: n(total?.n), items: rows };
}

/** Всичко за един човек: входове, екрани, хронология, дни. */
export async function analyticsUserDetail(id: string) {
  const profile = await one<Record<string, unknown>>(
    `select id, email, name, city, role, created_at::text, email_verified_at::text,
            last_login_at::text, last_seen_at::text, login_count, coalesce(sessions_count,0) as sessions_count,
            last_screen, last_platform, last_ip, signup_ip, phone, referral_code,
            coalesce(is_demo,false) as is_demo, suspended_at::text
       from profiles where id = $1`,
    [id]
  );
  if (!profile) return null;

  const [logins, screens, screensDaily, activity, days] = await Promise.all([
    many<Record<string, unknown>>(
      `select kind, ip, platform, browser, left(coalesce(user_agent,''),120) as user_agent, created_at::text
         from auth_events where user_id = $1 order by created_at desc limit 100`,
      [id]
    ).catch(() => []),
    many<Record<string, unknown>>(
      `select screen, sum(views)::int as views, count(distinct day)::int as days, max(last_at)::text as last_at
         from user_screen_views where user_id = $1 group by screen order by sum(views) desc limit 60`,
      [id]
    ).catch(() => []),
    many<Record<string, unknown>>(
      `select day::text, screen, views, last_at::text from user_screen_views
        where user_id = $1 order by day desc, views desc limit 120`,
      [id]
    ).catch(() => []),
    many<Record<string, unknown>>(
      `select screen, platform, created_at::text from user_activity_log
        where user_id = $1 order by created_at desc limit 120`,
      [id]
    ).catch(() => []),
    many<Record<string, unknown>>(
      `select day::text, sessions, screens from user_daily_activity where user_id = $1 order by day desc limit 60`,
      [id]
    ).catch(() => []),
  ]);

  const counts = await one<Record<string, string>>(
    `select coalesce((select count(*) from posts where author_id = $1),0)::text as posts,
            coalesce((select count(*) from listings where user_id = $1),0)::text as listings,
            coalesce((select count(*) from comments where author_id = $1),0)::text as comments,
            coalesce((select count(*) from price_alerts where user_id = $1),0)::text as alerts`,
    [id]
  ).catch(() => null);

  return {
    profile,
    counts: {
      posts: n(counts?.posts),
      listings: n(counts?.listings),
      comments: n(counts?.comments),
      alerts: n(counts?.alerts),
    },
    logins,
    screens,
    screensDaily,
    activity,
    days,
  };
}

/** Класация на екраните: кой екран се отваря най-много и от колко души. */
export async function analyticsScreens(days = 30) {
  const rows = await many<Record<string, string>>(
    `select screen,
            sum(views)::text as views,
            count(distinct user_id)::text as users,
            count(distinct day)::text as days
       from user_screen_views
      where day > current_date - $1::int
      group by screen
      order by sum(views) desc
      limit 60`,
    [days]
  ).catch(() => []);
  return rows.map((r) => ({ screen: r.screen, views: n(r.views), users: n(r.users), days: n(r.days) }));
}

/** Почиства старата хронология (за да не расте безкрайно). */
export async function pruneActivity(keepDays = 180): Promise<number> {
  const res = await query(
    `delete from user_activity_log where created_at < now() - ($1 || ' days')::interval`,
    [String(keepDays)]
  ).catch(() => null);
  return Number((res as { rowCount?: number } | null)?.rowCount ?? 0);
}
