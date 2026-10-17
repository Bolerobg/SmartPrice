/**
 * ⏱️ График на Facebook обиколките (по група).
 *
 * Идеята: за всяка група се задава колко поста да сваля на обиколка, колко пъти
 * на ден, в кои часове, колко поста максимум на ден, колко голяма пауза между
 * обиколките, приоритет и град по подразбиране. Умният диспечер (cron на всеки
 * 10 минути) пуска само групите, на които им е дошло времето, и то ако:
 *   - автоматиката не е спряна, няма „пауза до дата“ и не сме в нощна пауза;
 *   - не е достигнат дневният таван постове (общ или за групата);
 *   - опашката за одобрение не е прекалено дълга;
 *   - има бюджет за Apify.
 * Пускането има случайно закъснение (jitter), за да не изглежда като робот.
 */
import { many, one, query } from '../db.js';
import { getSetting, setSetting } from './settings.js';
import {
  fbBudgetAllows,
  getFbCost,
  getFbGroups,
  parseFbGroupUrl,
  runFbGroupJob,
  saveFbGroups,
} from './fbReceipts.js';

export interface GroupPlanRow {
  id: number;
  group_url: string;
  name: string | null;
  enabled: boolean;
  posts_per_run: number;
  max_posts_per_day: number;
  runs_per_day: number;
  hours: string;
  min_interval_min: number;
  priority: number;
  default_city: string | null;
  notes: string | null;
  posts_today: number;
  runs_today: number;
  counters_date: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  total_posts: number;
}

export interface PlanSettings {
  autoEnabled: boolean;
  dailyPostCap: number;
  nightPause: boolean;
  nightFrom: string;
  nightTo: string;
  jitterMin: number;
  maxPendingQueue: number;
  pausedUntil: string | null;
  pauseReason: string | null;
}

const DEFAULT_SETTINGS: PlanSettings = {
  autoEnabled: true,
  dailyPostCap: 150,
  nightPause: true,
  nightFrom: '23:00',
  nightTo: '07:00',
  jitterMin: 12,
  maxPendingQueue: 250,
  pausedUntil: null,
  pauseReason: null,
};

const SETTINGS_KEY = 'fb_plan_settings';

export async function getPlanSettings(): Promise<PlanSettings> {
  try {
    const raw = await getSetting(SETTINGS_KEY, '');
    if (!raw) return { ...DEFAULT_SETTINGS };
    const obj = JSON.parse(raw) as Partial<PlanSettings>;
    return { ...DEFAULT_SETTINGS, ...(obj && typeof obj === 'object' ? obj : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function savePlanSettings(patch: Partial<PlanSettings>): Promise<PlanSettings> {
  const cur = await getPlanSettings();
  const next: PlanSettings = { ...cur };
  if (patch.autoEnabled !== undefined) next.autoEnabled = Boolean(patch.autoEnabled);
  if (patch.nightPause !== undefined) next.nightPause = Boolean(patch.nightPause);
  if (patch.dailyPostCap !== undefined) next.dailyPostCap = clampInt(patch.dailyPostCap, 0, 5000);
  if (patch.jitterMin !== undefined) next.jitterMin = clampInt(patch.jitterMin, 0, 60);
  if (patch.maxPendingQueue !== undefined) next.maxPendingQueue = clampInt(patch.maxPendingQueue, 0, 5000);
  if (patch.nightFrom !== undefined) next.nightFrom = normTime(patch.nightFrom) ?? cur.nightFrom;
  if (patch.nightTo !== undefined) next.nightTo = normTime(patch.nightTo) ?? cur.nightTo;
  if (patch.pausedUntil !== undefined) next.pausedUntil = patch.pausedUntil ? String(patch.pausedUntil).slice(0, 20) : null;
  if (patch.pauseReason !== undefined) next.pauseReason = patch.pauseReason ? String(patch.pauseReason).slice(0, 200) : null;
  await setSetting(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normTime(v: unknown): string | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

/** Списък с часове от текстово поле „07:30, 19:30“. */
export function parseHours(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(/[,;\n]/)
    .map((s) => normTime(s))
    .filter((s): s is string => Boolean(s));
}

function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Нулира дневните броячи, ако е нов ден. */
async function resetCountersIfNeeded(): Promise<void> {
  await query(
    `update fb_group_plans
        set posts_today = 0, runs_today = 0, counters_date = current_date
      where counters_date is null or counters_date <> current_date`
  );
}

/** Вкарва в плана групите от стария списък, които още нямат запис. */
export async function importPlansFromGroups(): Promise<number> {
  const groups = await getFbGroups();
  let added = 0;
  for (const g of groups) {
    let canonical = String(g).trim();
    try {
      canonical = parseFbGroupUrl(g).canonicalUrl;
    } catch {
      continue;
    }
    const row = await one<{ id: number }>(
      `insert into fb_group_plans (group_url) values ($1) on conflict (group_url) do nothing returning id`,
      [canonical]
    );
    if (row) added += 1;
  }
  return added;
}

export async function listPlans(): Promise<GroupPlanRow[]> {
  await resetCountersIfNeeded();
  await importPlansFromGroups();
  return many<GroupPlanRow>(
    `select id, group_url, name, enabled, posts_per_run, max_posts_per_day, runs_per_day, hours,
            min_interval_min, priority, default_city, notes, posts_today, runs_today,
            counters_date::text, last_run_at::text, last_status, last_error, total_posts
       from fb_group_plans
      order by enabled desc, priority desc, coalesce(last_run_at, '1970-01-01'::timestamptz) asc`
  );
}

/** Синхронизира стария списък за обиколки (`fb_groups`) с включените планове. */
export async function syncPlansToGroups(): Promise<string[]> {
  const rows = await many<{ group_url: string }>(
    `select group_url from fb_group_plans where enabled = true order by priority desc, id`
  );
  const urls = rows.map((r) => r.group_url);
  if (urls.length > 0) await saveFbGroups(urls);
  return urls;
}

export interface PlanInput {
  group_url?: string;
  name?: string | null;
  enabled?: boolean;
  posts_per_run?: number;
  max_posts_per_day?: number;
  runs_per_day?: number;
  hours?: string;
  min_interval_min?: number;
  priority?: number;
  default_city?: string | null;
  notes?: string | null;
}

export async function upsertPlan(input: PlanInput): Promise<GroupPlanRow> {
  const url = String(input.group_url ?? '').trim();
  if (!url) throw new Error('Липсва адрес на група.');
  const parsed = parseFbGroupUrl(url);
  const hoursList = parseHours(input.hours ?? '07:30, 19:30');
  const runsPerDay = clampInt(input.runs_per_day ?? 2, 1, 12);
  const hours = (hoursList.length ? hoursList : ['07:30', '19:30']).slice(0, 12).join(', ');

  const row = await one<GroupPlanRow>(
    `insert into fb_group_plans (group_url, name, enabled, posts_per_run, max_posts_per_day, runs_per_day,
                                 hours, min_interval_min, priority, default_city, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (group_url) do update
        set name = coalesce(excluded.name, fb_group_plans.name),
            enabled = excluded.enabled,
            posts_per_run = excluded.posts_per_run,
            max_posts_per_day = excluded.max_posts_per_day,
            runs_per_day = excluded.runs_per_day,
            hours = excluded.hours,
            min_interval_min = excluded.min_interval_min,
            priority = excluded.priority,
            default_city = excluded.default_city,
            notes = excluded.notes,
            updated_at = now()
     returning id, group_url, name, enabled, posts_per_run, max_posts_per_day, runs_per_day, hours,
               min_interval_min, priority, default_city, notes, posts_today, runs_today,
               counters_date::text, last_run_at::text, last_status, last_error, total_posts`,
    [
      parsed.canonicalUrl,
      input.name ? String(input.name).slice(0, 200) : null,
      input.enabled === undefined ? true : Boolean(input.enabled),
      clampInt(input.posts_per_run ?? 10, 1, 100),
      clampInt(input.max_posts_per_day ?? 0, 0, 2000),
      runsPerDay,
      hours,
      clampInt(input.min_interval_min ?? 180, 5, 1440),
      clampInt(input.priority ?? 5, 1, 10),
      input.default_city ? String(input.default_city).slice(0, 80) : null,
      input.notes ? String(input.notes).slice(0, 500) : null,
    ]
  );
  await syncPlansToGroups();
  if (!row) throw new Error('Планът не беше записан.');
  return row;
}

export async function deletePlan(id: number): Promise<{ ok: boolean }> {
  await query(`delete from fb_group_plans where id = $1`, [id]);
  await syncPlansToGroups();
  return { ok: true };
}

export async function setPlanEnabled(id: number, enabled: boolean): Promise<{ ok: boolean }> {
  await query(`update fb_group_plans set enabled = $2, updated_at = now() where id = $1`, [id, enabled]);
  await syncPlansToGroups();
  return { ok: true };
}

/** Минути от „ЧЧ:ММ“. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => Number(x));
  return (h || 0) * 60 + (m || 0);
}

/** Стабилно „случайно“ закъснение 0..jitterMin за дадена група, ден и пореден час. */
function jitterFor(planId: number, day: string, index: number, jitterMin: number): number {
  if (jitterMin <= 0) return 0;
  const s = planId + '|' + day + '|' + index;
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h % (jitterMin + 1);
}

export interface DueInfo {
  due: boolean;
  reason: string;
  nextAt: string | null;
}

/** Дошло ли е време за обиколка на тази група. */
export function planDueStatus(plan: GroupPlanRow, settings: PlanSettings, now = new Date()): DueInfo {
  if (!plan.enabled) return { due: false, reason: 'изключена е', nextAt: null };

  const day = todayKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const hours = parseHours(plan.hours).slice(0, Math.max(1, plan.runs_per_day));

  if (plan.max_posts_per_day > 0 && plan.posts_today >= plan.max_posts_per_day) {
    return { due: false, reason: 'достигнат дневен таван (' + plan.posts_today + '/' + plan.max_posts_per_day + ')', nextAt: null };
  }
  if (plan.runs_today >= Math.max(1, plan.runs_per_day)) {
    return { due: false, reason: 'изпълнени обиколки за днес (' + plan.runs_today + '/' + plan.runs_per_day + ')', nextAt: null };
  }
  if (plan.last_run_at) {
    const last = new Date(plan.last_run_at);
    const diffMin = (now.getTime() - last.getTime()) / 60000;
    if (diffMin < plan.min_interval_min) {
      const left = Math.ceil(plan.min_interval_min - diffMin);
      return { due: false, reason: 'пауза между обиколките (' + left + ' мин)', nextAt: null };
    }
  }

  const index = Math.min(plan.runs_today, hours.length - 1);
  const slot = hours[index] ?? hours[0] ?? '07:30';
  const slotMin = toMinutes(slot) + jitterFor(plan.id, day, index, settings.jitterMin);

  const nightFrom = toMinutes(settings.nightFrom);
  const nightTo = toMinutes(settings.nightTo);
  const inNight =
    settings.nightPause &&
    (nightFrom > nightTo ? nowMin >= nightFrom || nowMin < nightTo : nowMin >= nightFrom && nowMin < nightTo);
  if (inNight) return { due: false, reason: 'нощна пауза', nextAt: null };

  if (nowMin < slotMin) {
    const left = slotMin - nowMin;
    return { due: false, reason: 'чака ' + slot + (settings.jitterMin > 0 ? ' +-' + settings.jitterMin + ' мин' : ''), nextAt: slot };
  }
  return { due: true, reason: 'време е (' + slot + ')', nextAt: null };
}

export interface PlanView extends GroupPlanRow {
  due: boolean;
  reason: string;
  nextAt: string | null;
}

export async function listPlanViews(): Promise<{ plans: PlanView[]; settings: PlanSettings }> {
  const [plans, settings, queueRow] = await Promise.all([
    listPlans(),
    getPlanSettings(),
    one<{ n: string }>(`select count(*)::text as n from fb_receipt_queue where status = 'pending'`),
  ]);
  void queueRow;
  const now = new Date();
  return {
    plans: plans.map((p) => {
      const d = planDueStatus(p, settings, now);
      return { ...p, due: d.due, reason: d.reason, nextAt: d.nextAt };
    }),
    settings,
  };
}

/* ================= Диспечер ================= */

let dispatchRunning = false;

export function isDispatchRunning(): boolean {
  return dispatchRunning;
}

interface DispatchResult {
  ok: boolean;
  reason?: string;
  started: Array<{ planId: number; groupUrl: string; jobId: string; count: number }>;
  skipped: Array<{ groupUrl: string; reason: string }>;
  postsToday: number;
  usd: number;
}

/** Глобални проверки: спиране, нощна пауза, таван, дълга опашка, бюджет. */
async function globalBlock(settings: PlanSettings, postsToday: number): Promise<string | null> {
  if (!settings.autoEnabled) return 'автоматиката е спряна от панела';
  if (settings.pausedUntil) {
    const until = new Date(settings.pausedUntil);
    if (!Number.isNaN(until.getTime()) && until.getTime() > Date.now()) {
      return 'пауза до ' + settings.pausedUntil + (settings.pauseReason ? ' (' + settings.pauseReason + ')' : '');
    }
  }
  if (settings.dailyPostCap > 0 && postsToday >= settings.dailyPostCap) {
    return 'достигнат дневен таван постове (' + postsToday + '/' + settings.dailyPostCap + ')';
  }
  if (settings.maxPendingQueue > 0) {
    const q = await one<{ n: string }>(`select count(*)::text as n from fb_receipt_queue where status = 'pending'`);
    const n = Number(q?.n ?? 0) || 0;
    if (n >= settings.maxPendingQueue) return 'твърде дълга опашка за одобрение (' + n + ')';
  }
  const budget = await fbBudgetAllows();
  if (!budget.allowed) return budget.reason ?? 'дневният лимит за Apify е достигнат';
  return null;
}

/**
 * Поне един път на ден пускаме групите, дори да сме изпуснали часа им
 * (catch-up) — но само ако са останали неизпълнени обиколки за деня.
 */
export async function dispatchDueGroups(params: { adminId: string; force?: boolean; maxGroups?: number }): Promise<DispatchResult> {
  const settings = await getPlanSettings();
  const cost = await getFbCost();
  const plans = await listPlans();
  const postsToday = plans.reduce((a, p) => a + (p.counters_date === todayKey() ? p.posts_today : 0), 0);

  const block = params.force ? null : await globalBlock(settings, postsToday);
  if (block) {
    return { ok: false, reason: block, started: [], skipped: [], postsToday, usd: cost.todayUsd };
  }

  const started: DispatchResult['started'] = [];
  const skipped: DispatchResult['skipped'] = [];
  const maxGroups = clampInt(params.maxGroups ?? 6, 1, 20);
  const now = new Date();

  for (const plan of plans) {
    if (started.length >= maxGroups) break;
    if (!plan.enabled) continue;
    const due = plans.length && params.force ? { due: true, reason: 'ръчно пускане' } : planDueStatus(plan, settings, now);
    if (!due.due) {
      skipped.push({ groupUrl: plan.group_url, reason: due.reason });
      continue;
    }
    // Дневен таван на общо ниво: не пускаме, ако вече сме над него.
    if (settings.dailyPostCap > 0 && postsToday >= settings.dailyPostCap) {
      skipped.push({ groupUrl: plan.group_url, reason: 'дневен таван постове' });
      continue;
    }
    try {
      const parsed = parseFbGroupUrl(plan.group_url);
      const job = await one<{ id: string }>(
        `insert into fb_receipt_jobs (group_url, group_id, status, target_count, created_by)
         values ($1, $2, 'running', $3, $4) returning id::text`,
        [parsed.canonicalUrl, parsed.groupId, plan.posts_per_run, params.adminId]
      );
      if (!job) {
        skipped.push({ groupUrl: plan.group_url, reason: 'задачата не се създаде' });
        continue;
      }
      started.push({ planId: plan.id, groupUrl: parsed.canonicalUrl, jobId: job.id, count: plan.posts_per_run });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      skipped.push({ groupUrl: plan.group_url, reason: msg.slice(0, 120) });
    }
  }

  return { ok: true, started, skipped, postsToday, usd: cost.todayUsd };
}

/** Изпълнява създадените задачи една след друга и обновява броячите на плановете. */
export async function runDispatchedJobs(
  jobs: Array<{ planId: number; jobId: string; groupUrl: string; count: number }>,
  options: { defaultCity?: string; pauseMs?: number } = {}
): Promise<void> {
  const pause = options.pauseMs ?? 20_000;
  for (const j of jobs) {
    try {
      await runFbGroupJob(j.jobId, { defaultCity: options.defaultCity });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await query(`update fb_group_plans set last_status = 'failed', last_error = $2, last_run_at = now() where id = $1`, [
        j.planId,
        msg.slice(0, 400),
      ]);
    }
    // Колко нови записа влязоха в опашката от тази задача.
    const cnt = await one<{ n: string }>(
      `select count(*)::text as n from fb_receipt_queue where job_id = $1`,
      [j.jobId]
    );
    const added = Number(cnt?.n ?? 0) || 0;
    await query(
      `update fb_group_plans
          set posts_today = posts_today + $2,
              runs_today = runs_today + 1,
              counters_date = current_date,
              total_posts = total_posts + $2,
              last_run_at = now(),
              last_status = 'done',
              last_error = null
        where id = $1`,
      [j.planId, added]
    );
    if (pause > 0) await new Promise((r) => setTimeout(r, pause));
  }
}

/** Фоново пускане на диспечера (заявката през Cloudflare не чака толкова дълго). */
export async function dispatchDueGroupsInBackground(params: {
  adminId: string;
  force?: boolean;
  maxGroups?: number;
  pauseMs?: number;
}): Promise<DispatchResult & { background: boolean }> {
  if (dispatchRunning) {
    const cost = await getFbCost();
    return { ok: false, reason: 'диспечерът вече върви', started: [], skipped: [], postsToday: 0, usd: cost.todayUsd, background: true };
  }
  dispatchRunning = true;
  const startedAt = new Date().toISOString();
  try {
    const res = await dispatchDueGroups({ adminId: params.adminId, force: params.force, maxGroups: params.maxGroups });
    if (res.ok && res.started.length > 0) {
      void runDispatchedJobs(res.started, { pauseMs: params.pauseMs }).finally(() => {
        dispatchRunning = false;
      });
    } else {
      dispatchRunning = false;
    }
    await setSetting('fb_dispatch_last', JSON.stringify({ ...res, startedAt, finishedAt: new Date().toISOString() })).catch(() => undefined);
    return { ...res, background: true };
  } catch (e) {
    dispatchRunning = false;
    const msg = e instanceof Error ? e.message : String(e);
    const cost = await getFbCost();
    return { ok: false, reason: msg.slice(0, 200), started: [], skipped: [], postsToday: 0, usd: cost.todayUsd, background: true };
  }
}

/** Последен резултат от диспечера + броячи. */
export async function getDispatchStatus(): Promise<{
  running: boolean;
  last: Record<string, unknown> | null;
  postsToday: number;
  runsToday: number;
  plansToday: number;
}> {
  const raw = await getSetting('fb_dispatch_last', '');
  let last: Record<string, unknown> | null = null;
  try {
    last = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    last = null;
  }
  await resetCountersIfNeeded();
  const row = await one<{ posts: string; runs: string; plans: string }>(
    `select coalesce(sum(posts_today),0)::text as posts,
            coalesce(sum(runs_today),0)::text as runs,
            count(*)::text as plans
       from fb_group_plans where enabled = true`
  );
  return {
    running: dispatchRunning,
    last,
    postsToday: Number(row?.posts ?? 0) || 0,
    runsToday: Number(row?.runs ?? 0) || 0,
    plansToday: Number(row?.plans ?? 0) || 0,
  };
}

/** Ръчно пускане на една група веднага (заобикаля часовете, но пази бюджета). */
export async function runPlanNow(id: number, adminId: string): Promise<{ ok: boolean; jobId?: string; reason?: string }> {
  const plan = await one<GroupPlanRow>(
    `select id, group_url, name, enabled, posts_per_run, max_posts_per_day, runs_per_day, hours,
            min_interval_min, priority, default_city, notes, posts_today, runs_today,
            counters_date::text, last_run_at::text, last_status, last_error, total_posts
       from fb_group_plans where id = $1`,
    [id]
  );
  if (!plan) return { ok: false, reason: 'Няма такава група.' };
  const budget = await fbBudgetAllows();
  if (!budget.allowed) return { ok: false, reason: budget.reason ?? 'Дневният лимит за Apify е достигнат.' };
  const parsed = parseFbGroupUrl(plan.group_url);
  const job = await one<{ id: string }>(
    `insert into fb_receipt_jobs (group_url, group_id, status, target_count, created_by)
     values ($1, $2, 'running', $3, $4) returning id::text`,
    [parsed.canonicalUrl, parsed.groupId, plan.posts_per_run, adminId]
  );
  if (!job) return { ok: false, reason: 'Задачата не се създаде.' };
  void runDispatchedJobs(
    [{ planId: plan.id, jobId: job.id, groupUrl: parsed.canonicalUrl, count: plan.posts_per_run }],
    { defaultCity: plan.default_city ?? undefined, pauseMs: 0 }
  ).catch(() => undefined);
  return { ok: true, jobId: job.id };
}
