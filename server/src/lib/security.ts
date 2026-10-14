import { many, one } from '../db.js';
import { env, features } from '../env.js';
import { sendAdminAlertEmail } from './email.js';

/**
 * Следене за ненормални активности.
 *
 * Идеята: сървърът сам проверява базата на всеки няколко минути и търси
 * модели, които при нормална работа не се случват (стотици грешни влизания от
 * един IP, един профил пуска 30 оферти за час, скок на сигнали…). Намереното
 * се записва в security_events и се праща имейл на ALERT_EMAIL.
 *
 * Имейлите са ограничени: най-много 1 на вид събитие на час, за да не се
 * препълни пощата при продължаваща атака.
 */

export type Severity = 'info' | 'warning' | 'critical';

export interface SecurityFinding {
  kind: string;
  severity: Severity;
  title: string;
  details: Record<string, unknown>;
  subjectType?: string;
  subjectId?: string | null;
  subjectLabel?: string | null;
  ip?: string | null;
}

export const ALERT_EMAIL = env.ALERT_EMAIL;

/* ------------------------------------------------------------ прагове */

const T = {
  failedLoginsPerIp: 10, // грешни влизания от един IP за 15 мин
  failedLoginsPerEmail: 6, // грешни влизания към един имейл за 15 мин
  postsPerHour: 12, // оферти от един профил за час
  commentsPerHour: 30, // коментари от един профил за час
  reportsPerDay: 5, // отворени сигнала за 24 ч
  signupsPerIp: 2, // нови профила от един IP за 24 ч (предупреждение — CGNAT!)
  reactionsPerHour: 300, // реакции от един профил за час
  hiddenRatioMin: 5, // минимално оферти, за да се смята съотношение
};

/* --------------------------------------------------- запис на събитие */

export async function recordSecurityEvent(finding: SecurityFinding): Promise<number | null> {
  try {
    const row = await one<{ id: string }>(
      `insert into security_events
         (kind, severity, title, details, subject_type, subject_id, subject_label, ip)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [
        finding.kind,
        finding.severity,
        finding.title,
        JSON.stringify(finding.details),
        finding.subjectType ?? null,
        finding.subjectId ?? null,
        finding.subjectLabel ?? null,
        finding.ip ?? null,
      ]
    );
    return row ? Number(row.id) : null;
  } catch {
    return null;
  }
}

/** Има ли вече пратен имейл за този вид събитие в последния час? */
async function alertedRecently(kind: string): Promise<boolean> {
  const row = await one<{ n: number }>(
    `select count(*)::int as n from security_events
      where kind = $1 and alerted_at > now() - interval '1 hour'`,
    [kind]
  );
  return Number(row?.n ?? 0) > 0;
}

/**
 * Записва намереното и (ако е позволено) праща имейл до ALERT_EMAIL.
 * Връща true, ако е пратен имейл.
 */
export async function raiseAlert(finding: SecurityFinding): Promise<boolean> {
  const id = await recordSecurityEvent(finding);
  if (id == null) return false;

  if (!features.mail || !ALERT_EMAIL) return false;
  if (await alertedRecently(finding.kind)) return false;

  try {
    const result = await sendAdminAlertEmail({
      to: ALERT_EMAIL,
      title: finding.title,
      severity: finding.severity,
      kind: finding.kind,
      details: finding.details,
    });
    await one(
      `update security_events set alerted_at = now() where id = $1 returning id`,
      [id]
    );
    await one(
      `insert into admin_email_log (to_email, subject, kind, provider_id, status, related_type, related_id)
       values ($1,$2,'security_alert',$3,'sent','security_event',$4) returning id`,
      [ALERT_EMAIL, `[SmartPrice] ${finding.title}`, result.id, String(id)]
    );
    return true;
  } catch (err) {
    await one(
      `insert into admin_email_log (to_email, subject, kind, status, error, related_type, related_id)
       values ($1,$2,'security_alert','failed',$3,'security_event',$4) returning id`,
      [ALERT_EMAIL, `[SmartPrice] ${finding.title}`, String(err).slice(0, 300), String(id)]
    );
    return false;
  }
}

/* ------------------------------------------------------------- проверки */

/** Всички проверки наведнъж. Връща намерените проблеми. */
export async function scanForAnomalies(): Promise<SecurityFinding[]> {
  const findings: SecurityFinding[] = [];

  // 1) Грешни влизания от един IP
  const badIp = await many<{ ip: string; n: number; emails: number }>(
    `select coalesce(ip,'неизвестен') as ip, count(*)::int as n,
            count(distinct email)::int as emails
       from login_attempts
      where not ok and created_at > now() - interval '15 minutes'
      group by ip having count(*) >= $1
      order by n desc limit 5`,
    [T.failedLoginsPerIp]
  );
  for (const r of badIp) {
    findings.push({
      kind: 'brute_force_ip',
      severity: 'critical',
      title: `Много грешни влизания от IP ${r.ip}`,
      details: {
        ip: r.ip,
        attempts: Number(r.n),
        distinctEmails: Number(r.emails),
        window: '15 минути',
        съвет: 'Провери дали не се подбира парола. Може да спреш профилите, към които се цели.',
      },
      ip: r.ip,
    });
  }

  // 2) Грешни влизания към един профил
  const badEmail = await many<{ email: string; n: number }>(
    `select email, count(*)::int as n
       from login_attempts
      where not ok and email is not null and created_at > now() - interval '15 minutes'
      group by email having count(*) >= $1
      order by n desc limit 5`,
    [T.failedLoginsPerEmail]
  );
  for (const r of badEmail) {
    const profile = await one<{ id: string; handle: string; suspended_at: string | null }>(
      'select id, handle, suspended_at from profiles where email = $1',
      [r.email]
    );
    findings.push({
      kind: 'brute_force_account',
      severity: 'warning',
      title: `Подбиране на парола за ${r.email}`,
      details: { email: r.email, attempts: Number(r.n), window: '15 минути' },
      subjectType: 'profile',
      subjectId: profile?.id ?? null,
      subjectLabel: r.email,
    });
  }

  // 3) Един профил пуска много оферти
  const floodPosts = await many<{ author_id: string; handle: string; name: string; n: number }>(
    `select p.author_id, pr.handle, pr.name, count(*)::int as n
       from posts p join profiles pr on pr.id = p.author_id
      where p.created_at > now() - interval '1 hour'
      group by p.author_id, pr.handle, pr.name having count(*) >= $1
      order by n desc limit 5`,
    [T.postsPerHour]
  );
  for (const r of floodPosts) {
    findings.push({
      kind: 'post_flood',
      severity: 'warning',
      title: `${r.handle} пусна ${r.n} оферти за един час`,
      details: { handle: r.handle, name: r.name, posts: Number(r.n), window: '1 час' },
      subjectType: 'profile',
      subjectId: r.author_id,
      subjectLabel: r.handle,
    });
  }

  // 4) Един профил пише много коментари
  const floodComments = await many<{ author_id: string; handle: string; n: number }>(
    `select c.author_id, pr.handle, count(*)::int as n
       from comments c join profiles pr on pr.id = c.author_id
      where c.created_at > now() - interval '1 hour'
      group by c.author_id, pr.handle having count(*) >= $1
      order by n desc limit 5`,
    [T.commentsPerHour]
  );
  for (const r of floodComments) {
    findings.push({
      kind: 'comment_flood',
      severity: 'warning',
      title: `${r.handle} написа ${r.n} коментара за един час`,
      details: { handle: r.handle, comments: Number(r.n), window: '1 час' },
      subjectType: 'profile',
      subjectId: r.author_id,
      subjectLabel: r.handle,
    });
  }

  // 5) Много реакции от един профил (надуване на рейтинг)
  const floodReactions = await many<{ user_id: string; handle: string; n: number }>(
    `select r.user_id, pr.handle, count(*)::int as n
       from post_reactions r join profiles pr on pr.id = r.user_id
      where r.created_at > now() - interval '1 hour'
      group by r.user_id, pr.handle having count(*) >= $1
      order by n desc limit 5`,
    [T.reactionsPerHour]
  );
  for (const r of floodReactions) {
    findings.push({
      kind: 'reaction_flood',
      severity: 'warning',
      title: `${r.handle} натисна ${r.n} реакции за един час`,
      details: { handle: r.handle, reactions: Number(r.n), window: '1 час' },
      subjectType: 'profile',
      subjectId: r.user_id,
      subjectLabel: r.handle,
    });
  }

  // 6) Скок на сигнали от потребители
  const reports = await one<{ n: number; open: number }>(
    `select count(*)::int as n, count(*) filter (where status = 'open')::int as open
       from content_reports where created_at > now() - interval '24 hours'`
  );
  if (Number(reports?.n ?? 0) >= T.reportsPerDay) {
    findings.push({
      kind: 'report_spike',
      severity: 'warning',
      title: `${reports?.n} сигнала от потребители за 24 часа`,
      details: { reports: Number(reports?.n ?? 0), open: Number(reports?.open ?? 0) },
    });
  }

  // 7) Няколко нови профила от един IP (фалшиви акаунти)
  const multiSignup = await many<{ signup_ip: string; n: number }>(
    `select signup_ip, count(*)::int as n
       from profiles
      where signup_ip is not null and created_at > now() - interval '24 hours'
      group by signup_ip having count(*) >= $1
      order by n desc limit 5`,
    [T.signupsPerIp]
  );
  for (const r of multiSignup) {
    findings.push({
      kind: 'multi_signup_ip',
      severity: 'warning',
      title: `${r.n} нови профила от IP ${r.signup_ip} за 24 часа`,
      details: { ip: r.signup_ip, profiles: Number(r.n) },
      ip: r.signup_ip,
    });
  }

  // 8) Профил, чиито оферти почти всички са скрити от модерация
  const badActors = await many<{ id: string; handle: string; total: number; hidden: number }>(
    `select pr.id, pr.handle,
            count(p.id)::int as total,
            count(*) filter (where p.status <> 'published')::int as hidden
       from profiles pr join posts p on p.author_id = pr.id
      group by pr.id, pr.handle
     having count(p.id) >= $1 and count(*) filter (where p.status <> 'published')::int::float
            / count(p.id) >= 0.5
      order by hidden desc limit 5`,
    [T.hiddenRatioMin]
  );
  for (const r of badActors) {
    findings.push({
      kind: 'mostly_hidden_author',
      severity: 'info',
      title: `${r.handle}: ${r.hidden} от ${r.total} оферти са скрити`,
      details: { handle: r.handle, total: Number(r.total), hidden: Number(r.hidden) },
      subjectType: 'profile',
      subjectId: r.id,
      subjectLabel: r.handle,
    });
  }

  return findings;
}

/** Пуска проверката и праща имейлите. Връща колко имейла са тръгнали. */
export async function runSecurityScan(): Promise<{ found: number; alerted: number; findings: SecurityFinding[] }> {
  const findings = await scanForAnomalies();
  let alerted = 0;
  for (const f of findings) {
    if (await raiseAlert(f)) alerted += 1;
  }
  return { found: findings.length, alerted, findings };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Стартира периодичната проверка (по подразбиране на всеки 5 минути). */
export function startSecurityMonitor(intervalMs = 5 * 60 * 1000): void {
  if (timer) return;
  const tick = async () => {
    try {
      const res = await runSecurityScan();
      if (res.found) {
        // eslint-disable-next-line no-console
        console.log(
          `[security] намерени ${res.found} събития, пратени ${res.alerted} имейла до ${ALERT_EMAIL}`
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[security] проверката се провали:', err);
    }
  };
  timer = setInterval(() => void tick(), intervalMs);
  // Първата проверка малко след старта, за да не се бие с миграциите.
  setTimeout(() => void tick(), 60 * 1000);
}
