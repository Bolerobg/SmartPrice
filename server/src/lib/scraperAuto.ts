/**
 * 🚀 АВТОПИЛОТ НА СКРАПЕРА — „дай само името на сайта, другото е наше“.
 *
 * Какво прави, когато му подадеш домейни (колкото искаш, по един на ред):
 *
 *   1. Проверява сайта сам — чете ли се от сървъра, или е зад Cloudflare.
 *   2. Уважава robots.txt. Ако сайтът забранява на ботове → НЕ го пипаме
 *      (освен ако човекът изрично не разреши) — точно това пази от „сайтът
 *      ни забрани“.
 *   3. Ако сайтът позволява → прави му разписание с УЧТИВИ настройки:
 *      по малко на ден, на случайни моменти, от различно място в каталога,
 *      с паузи и случаен браузър-подпис.
 *   4. Пуска ЕДНА ПРОБНА обиколка (само проучва, нищо не внася), за да
 *      разбере колко продукта има сайтът.
 *   5. Научава размера на каталога и си смята квотата така, че ЦЕЛИЯТ сайт да
 *      се обходи за ~14 дни. Таванът се слага на размера на каталога, значи
 *      разписанието спира само, като свърши.
 *   6. Ако сайтът не пуска сървъра (Cloudflare/403) → отива автоматично в
 *      опашката на домашния робот (обхожда се от домашния компютър).
 *
 * Нищо ръчно. Едно натискане за много сайтове.
 */
import { many, one, query } from '../db.js';
import { getSetting, setSetting } from './settings.js';
import { currentCursor } from './scrapeCursor.js';
import { discoverShops, queueLocalScan, rememberJob } from './shopDiscovery.js';
import { normalizeStartUrl, optionsForSite, planNextRun, runJob, sofiaParts } from './scraper.js';

/** За колко дни искаме да обходим целия каталог на сайта. */
export const AUTOPILOT_DAYS = 14;
/** Колко сайта се проверяват на едно пускане (една HTTP заявка през Cloudflare). */
export const AUTOPILOT_BATCH = 25;
/** С каква квота започва (после се пренастройва според размера на сайта). */
const START_QUOTA = 20;
/** Колко продукта пробваме в проучвателната обиколка. */
const PROBE_COUNT = 25;
const MIN_QUOTA = 15;
const MAX_QUOTA = 200;

const PENDING_KEY = 'autopilot_pending';

export interface AutopilotItem {
  domain: string;
  status: string;
  action: 'schedule' | 'robot' | 'skipped' | 'failed' | 'already';
  strategy: string | null;
  platform: string | null;
  productsFound: number;
  catalogSize: number | null;
  quota: number | null;
  reason: string;
}

export interface AutopilotResult {
  checked: number;
  remaining: number;
  createdSchedules: number;
  robotQueued: number;
  skippedRobots: number;
  items: AutopilotItem[];
  note?: string;
}

/* ------------------------------------------------------------------ помощни */

/** Приема текст (много редове), запетаи или списък → чисти уникални домейни. */
export function cleanDomains(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.map((x) => String(x ?? '')) : String(input ?? '').split(/[\s,;]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of raw) {
    const d = String(line)
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,8}$/.test(d)) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

async function readPending(): Promise<string[]> {
  try {
    const raw = await getSetting(PENDING_KEY, '[]');
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

async function writePending(list: string[]): Promise<void> {
  await setSetting(PENDING_KEY, JSON.stringify(list.slice(0, 2000)));
}

/** Учтивите настройки по подразбиране за сайт, който автопилотът поема. */
function autoOptions(respectRobots: boolean): Record<string, unknown> {
  return {
    respectRobots,
    useAi: true,
    downloadImages: true,
    skipWithoutImage: true,
    addShopTag: true,
    dedupe: 'url',
    categoryMode: 'ai',
    polarityMode: 'compare',
    city: 'Онлайн',
    delayMs: 400,
    maxPages: 20,
  };
}

async function upsertRow(row: {
  domain: string;
  status: string;
  action: string;
  strategy: string | null;
  platform: string | null;
  productsFound: number;
  catalogSize?: number | null;
  quota?: number | null;
  scheduleId?: string | null;
  note: string;
}): Promise<void> {
  await query(
    `insert into scrape_autopilot
       (domain, status, action, strategy, platform, products_found, catalog_size, quota, schedule_id, note)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (domain) do update set
       status = excluded.status,
       action = excluded.action,
       strategy = excluded.strategy,
       platform = excluded.platform,
       products_found = excluded.products_found,
       catalog_size = coalesce(excluded.catalog_size, scrape_autopilot.catalog_size),
       quota = coalesce(excluded.quota, scrape_autopilot.quota),
       schedule_id = coalesce(excluded.schedule_id, scrape_autopilot.schedule_id),
       note = excluded.note,
       updated_at = now()`,
    [
      row.domain,
      row.status,
      row.action,
      row.strategy,
      row.platform,
      row.productsFound,
      row.catalogSize ?? null,
      row.quota ?? null,
      row.scheduleId ?? null,
      row.note.slice(0, 500),
    ]
  ).catch(() => undefined);
}

/** Създава разписание с учтиви настройки и връща id-то му. */
async function createAutoSchedule(input: {
  adminId: string;
  domain: string;
  url: string;
  mode: 'import' | 'preview';
  respectRobots: boolean;
  dailyQuota: number | null;
}): Promise<string | null> {
  const options = autoOptions(input.respectRobots);
  const quota = input.dailyQuota ?? START_QUOTA;

  const s = await one<{ id: string }>(
    `insert into scrape_schedules
       (created_by, domain, url, label, enabled, daily_quota, burst_min, burst_max,
        hour_from, hour_to, min_gap_min, mode, options, day_key, max_total, stop_when_done, rotate)
     values ($1,$2,$3,$4,true,$5,3,6,9,21,25,$6,$7::jsonb,$8,null,true,true)
     returning id::text`,
    [
      input.adminId,
      input.domain,
      input.url,
      null,
      quota,
      input.mode,
      JSON.stringify(options),
      sofiaParts().dateKey,
    ]
  ).catch(() => null);
  if (!s) return null;

  // Първото пускане не е веднага — разпределя се на случаен момент днес.
  await query(`update scrape_schedules set next_run_at = $2 where id = $1`, [
    s.id,
    planNextRun((await one(`select * from scrape_schedules where id = $1`, [s.id])) as never),
  ]).catch(() => undefined);
  return s.id;
}

/**
 * Пробна обиколка: само проучва (mode=preview), за да научим размера на
 * каталога. Връзва се към разписанието, за да може после да се пренастрои.
 */
async function probeSchedule(adminId: string, domain: string, scheduleId: string): Promise<void> {
  try {
    const u = normalizeStartUrl(`https://${domain}/`);
    const raw: Record<string, unknown> = {
      ...autoOptions(true),
      count: PROBE_COUNT,
      mode: 'preview',
      startOffset: await currentCursor(domain),
    };
    const options = await optionsForSite(domain, raw as never);
    const job = await one<{ id: string }>(
      `insert into scrape_jobs (created_by, url, domain, mode, options, target_count, status, schedule_id)
       values ($1,$2,$3,'preview',$4::jsonb,$5,'queued',$6) returning id::text`,
      [adminId, u.toString(), domain, JSON.stringify({ ...options, mode: 'preview' }), PROBE_COUNT, scheduleId]
    );
    if (!job) return;
    await rememberJob(domain, job.id);
    void runJob(job.id).catch(() => undefined);
  } catch {
    /* проучването не е критично — разписанието пак работи */
  }
}

/* ------------------------------------------------------------------ пускане */

/**
 * Главното действие: приема много сайтове и прави всичко сам.
 * Обработва до AUTOPILOT_BATCH сайта наведнъж; останалите чакат следващото
 * пускане (пазят се в настройките, за да не се губят).
 */
export async function runAutopilot(input: {
  adminId: string;
  sites: unknown;
  mode?: 'import' | 'preview';
  respectRobots?: boolean;
  dailyQuota?: number | null;
  limit?: number;
}): Promise<AutopilotResult> {
  const mode: 'import' | 'preview' = input.mode === 'preview' ? 'preview' : 'import';
  const respectRobots = input.respectRobots !== false;
  const dailyQuota = input.dailyQuota && input.dailyQuota > 0 ? Math.min(MAX_QUOTA, input.dailyQuota) : null;

  const added = cleanDomains(input.sites);
  const pending = await readPending();
  const queueAll = [...new Set([...pending, ...added])];
  const limit = Math.max(1, Math.min(AUTOPILOT_BATCH, input.limit ?? AUTOPILOT_BATCH));
  const batch = queueAll.slice(0, limit);
  const rest = queueAll.slice(limit);

  if (!batch.length) {
    await writePending(rest);
    return { checked: 0, remaining: rest.length, createdSchedules: 0, robotQueued: 0, skippedRobots: 0, items: [], note: 'Няма нови адреси за проверка.' };
  }

  await writePending(rest);

  // Проверяваме всички наведнъж (по 3 наведнъж, с паузи — учтиво).
  const found = await discoverShops({ domains: batch, limit: batch.length, force: false });

  const items: AutopilotItem[] = [];
  let createdSchedules = 0;
  let robotQueued = 0;
  let skippedRobots = 0;

  for (const c of found.items) {
    const domain = c.domain;
    const status = String(c.status ?? 'error');
    const strategy = c.strategy ?? null;
    const platform = c.platform ?? null;
    const productsFound = Number(c.products_found ?? 0);

    if (status === 'ok' || (status === 'robots' && !respectRobots)) {
      const existing = await one<{ id: string }>(
        `select id::text from scrape_schedules where domain = $1 limit 1`,
        [domain]
      );
      if (existing) {
        await upsertRow({
          domain, status, action: 'already', strategy, platform, productsFound,
          scheduleId: existing.id,
          note: 'Вече има разписание за този сайт — оставих го както си е.',
        });
        items.push({ domain, status, action: 'already', strategy, platform, productsFound, catalogSize: null, quota: null, reason: 'Вече има разписание.' });
        continue;
      }

      const u = normalizeStartUrl(`https://${domain}/`);
      const scheduleId = await createAutoSchedule({
        adminId: input.adminId,
        domain,
        url: u.toString(),
        mode,
        respectRobots,
        dailyQuota,
      });

      if (!scheduleId) {
        await upsertRow({ domain, status, action: 'failed', strategy, platform, productsFound, note: 'Разписанието не се записа.' });
        items.push({ domain, status, action: 'failed', strategy, platform, productsFound, catalogSize: null, quota: null, reason: 'Разписанието не се записа.' });
        continue;
      }

      // Проучване: само чете, за да научим колко е голям сайтът.
      await probeSchedule(input.adminId, domain, scheduleId);
      createdSchedules += 1;

      const note =
        status === 'robots'
          ? 'Сайтът забранява на ботове в robots.txt, но ти разреши — обхожда се внимателно (25-мин паузи, различен вход всеки път).'
          : mode === 'import'
            ? 'Готово: разписано е да внася по малко всеки ден. Проучвам размера, за да обходя целия сайт за ~14 дни.'
            : 'Готово: разписано е да показва по малко всеки ден (само преглед, без внасяне).';

      await upsertRow({
        domain, status, action: 'schedule', strategy, platform, productsFound,
        quota: dailyQuota ?? START_QUOTA, scheduleId, note,
      });
      items.push({
        domain, status, action: 'schedule', strategy, platform, productsFound,
        catalogSize: null, quota: dailyQuota ?? START_QUOTA, reason: note,
      });
      continue;
    }

    if (status === 'local') {
      const queued = await queueLocalScan({
        domain,
        count: 60,
        note: 'Автопилот: сайтът не пуска сървъра — обхожда се от домашния робот.',
        userId: input.adminId,
      }).catch(() => null);
      robotQueued += 1;
      await upsertRow({
        domain, status, action: 'robot', strategy, platform, productsFound,
        note: 'Зад Cloudflare/бот-защита — сложих го в опашката на домашния робот (пуска се 10:15 и 20:15).',
      });
      items.push({
        domain, status, action: 'robot', strategy, platform, productsFound,
        catalogSize: null, quota: null,
        reason: queued
          ? 'Не пуска сървъра → обхожда се от домашния робот (10:15 и 20:15).'
          : 'Не пуска сървъра → за домашния робот, но записът в опашката не мина.',
      });
      continue;
    }

    if (status === 'robots') {
      skippedRobots += 1;
      const note = 'robots.txt забранява автоматично обхождане — не го пипам (това пази и двама ни). Ако имаш изрично разрешение, пусни го с изключена отметка.';
      await upsertRow({ domain, status, action: 'skipped', strategy, platform, productsFound, note });
      items.push({ domain, status, action: 'skipped', strategy, platform, productsFound, catalogSize: null, quota: null, reason: note });
      continue;
    }

    // error / manual — не става автоматично
    const reason = String(c.reason ?? 'Не успях да го прочета автоматично.').slice(0, 300);
    await upsertRow({ domain, status, action: 'failed', strategy, platform, productsFound, note: reason });
    items.push({ domain, status, action: 'failed', strategy, platform, productsFound, catalogSize: null, quota: null, reason });
  }

  // Сайтовете, които проверката не е стигнала (лимит на времето) — връщаме ги
  // в началото на опашката, за да продължат при следващото пускане.
  const checkedDomains = new Set(found.items.map((i) => i.domain));
  const unprocessed = batch.filter((d) => !checkedDomains.has(d));
  if (unprocessed.length) await writePending([...unprocessed, ...(await readPending())]);

  const remaining = (await readPending()).length;
  return {
    checked: items.length,
    remaining,
    createdSchedules,
    robotQueued,
    skippedRobots,
    items,
    note: found.note
      ? found.note
      : remaining
        ? `Проверих ${items.length} сайта. Остават ${remaining} — натисни „Продължи“, за да ги довърша.`
        : undefined,
  };
}

/* ------------------------------------------------- самонастройка и преглед */

/**
 * Самонастройка: щом проучвателната обиколка свърши, разбираме колко продукта
 * има сайтът и си смятаме квотата така, че целият каталог да се обходи за
 * ~14 дни. Слагаме и таван = размера на каталога, значи разписанието спира
 * само, когато свърши (без да хаби заявки).
 */
export async function tuneAutopilot(): Promise<number> {
  const rows = await many<{ domain: string; schedule_id: string | null }>(
    `select domain, schedule_id::text from scrape_autopilot
      where schedule_id is not null and catalog_size is null and action = 'schedule'
      order by updated_at desc limit 20`
  ).catch(() => []);
  let tuned = 0;

  for (const r of rows) {
    if (!r.schedule_id) continue;
    const running = await one<{ n: string }>(
      `select count(*)::text as n from scrape_jobs
        where schedule_id = $1 and status in ('queued','discovering','parsing','enriching','importing')`,
      [r.schedule_id]
    ).catch(() => null);
    if (Number(running?.n ?? 0) > 0) continue;

    const job = await one<{ status: string; discovered: number }>(
      `select status, coalesce(discovered,0) as discovered from scrape_jobs
        where schedule_id = $1 order by created_at desc limit 1`,
      [r.schedule_id]
    ).catch(() => null);
    if (!job || job.status !== 'done') continue;

    const size = Number(job.discovered ?? 0);
    if (size <= 0) {
      await query(
        `update scrape_autopilot set catalog_size = 0,
           note = 'Проучването не намери продукти — оставих разписанието с малка квота. Погледни го в „История“.',
           updated_at = now()
          where domain = $1`,
        [r.domain]
      ).catch(() => undefined);
      tuned += 1;
      continue;
    }

    const quota = Math.max(MIN_QUOTA, Math.min(MAX_QUOTA, Math.ceil(size / AUTOPILOT_DAYS)));
    const sched = await one<Record<string, unknown>>(`select * from scrape_schedules where id = $1`, [r.schedule_id]).catch(() => null);
    if (!sched) continue;

    await query(
      `update scrape_schedules
          set daily_quota = $2, max_total = $3, stop_when_done = true, rotate = true,
              options = options || '{"dedupe":"url"}'::jsonb,
              next_run_at = $4, updated_at = now()
        where id = $1`,
      [r.schedule_id, quota, size, planNextRun({ ...sched, daily_quota: quota } as never)]
    ).catch(() => undefined);

    await query(
      `update scrape_autopilot
          set catalog_size = $2, quota = $3,
              note = 'Сайтът има ~' || $2::text || ' продукта. Разписано е по ' || $3::text || ' на ден → целият сайт за ~' || $4::text || ' дни, после спира сам.',
              updated_at = now()
        where domain = $1`,
      [r.domain, size, quota, AUTOPILOT_DAYS]
    ).catch(() => undefined);
    tuned += 1;
  }
  return tuned;
}

/** Какво е състоянието на автопилота (за таба). */
export async function autopilotStatus(): Promise<Record<string, unknown>> {
  await tuneAutopilot().catch(() => 0);

  const items = await many<Record<string, unknown>>(
    `select a.domain, a.status, a.action, a.strategy, a.platform, a.products_found,
            a.catalog_size, a.quota, a.note, a.updated_at::text, a.schedule_id::text,
            s.enabled, s.mode, s.daily_quota, s.used_today, s.total_imported, s.total_crawled,
            s.next_run_at::text, s.last_run_at::text, s.last_status, s.last_message, s.auto_stopped_at::text
       from scrape_autopilot a
       left join scrape_schedules s on s.id = a.schedule_id
      order by a.updated_at desc
      limit 150`
  ).catch(() => []);

  const totals = await one<Record<string, string>>(
    `select count(*)::text as total,
            count(*) filter (where action = 'schedule')::text as scheduled,
            count(*) filter (where action = 'robot')::text as robot,
            count(*) filter (where action = 'skipped')::text as skipped,
            count(*) filter (where action = 'failed')::text as failed,
            coalesce(sum(catalog_size),0)::text as catalog
       from scrape_autopilot`
  ).catch(() => null);

  const pending = (await readPending()).length;
  return {
    pending,
    items,
    stats: {
      total: Number(totals?.total ?? 0),
      scheduled: Number(totals?.scheduled ?? 0),
      robot: Number(totals?.robot ?? 0),
      skipped: Number(totals?.skipped ?? 0),
      failed: Number(totals?.failed ?? 0),
      catalog: Number(totals?.catalog ?? 0),
    },
    defaults: { days: AUTOPILOT_DAYS, batch: AUTOPILOT_BATCH, startQuota: START_QUOTA, minQuota: MIN_QUOTA, maxQuota: MAX_QUOTA },
  };
}

/** Махане от списъка на автопилота (не пипа разписанието). */
export async function forgetAutopilotSite(domain: string): Promise<void> {
  await query(`delete from scrape_autopilot where domain = $1`, [domain]).catch(() => undefined);
}
