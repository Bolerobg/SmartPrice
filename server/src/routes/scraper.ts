import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit, requireAdminPanel, requireFullAdmin } from '../lib/admin.js';
import { ENGINE_SWITCHES, engineStatus, setEngineSwitch } from '../lib/engines.js';
import { importExternalProducts } from '../lib/externalImport.js';
import { saveLocalShopPrices } from '../lib/shopPrice.js';
import {
  apifyBudgetAllows,
  apifyDailyLimit,
  apifyReady,
  apifySpent,
  setApifyDailyLimit,
} from '../lib/apifyBrowser.js';
import {
  CLASSIFIED_SOURCES,
  lastClassifiedsRun,
  startClassifiedsScan,
} from '../lib/classifieds.js';
import { enrichObjects, lastPlacesRun, placesInfo, recentEnriched, startPlacesEnrich } from '../lib/placesEnrich.js';
import { currentCursor, deleteCategoryMap, listCategoryMap, listCursors } from '../lib/scrapeCursor.js';
import {
  discoverShops,
  finishLocalScan,
  listCandidates,
  localQueueStats,
  pendingLocalScans,
  queueLocalScan,
  rejectCandidate,
  rememberJob,
  takeLocalScans,
} from '../lib/shopDiscovery.js';
import {
  alreadyImported,
  downloadImage,
  importProduct,
  normalizeStartUrl,
  optionsForSite,
  parseProductPage,
  planNextRun,
  politeFetch,
  runJob,
  runScheduleNow,
  scheduleStats,
  scrapeInfo,
  sofiaParts,
  SCRAPE_CATEGORIES,
} from '../lib/scraper.js';

/**
 * Скраперът — HTTP слоят (само за админ панела).
 *
 * Разделен е на две неща:
 *   • „Проби“ — веднага връща какво вижда в дадена страница. Служи за настройка
 *     на селектори, без да се чака цяла задача.
 *   • „Задачи“ — истинската обиколка: откриване → четене → AI → внасяне.
 *     Работи във фонов режим, панелът само гледа прогреса.
 */

const optionsSchema = z
  .object({
    count: z.coerce.number().int().min(1).max(2000).optional(),
    mode: z.enum(['preview', 'import']).optional(),
    useAi: z.coerce.boolean().optional(),
    downloadImages: z.coerce.boolean().optional(),
    maxImageMb: z.coerce.number().min(1).max(25).optional(),
    polarityMode: z.enum(['offer', 'compare', 'trap']).optional(),
    categoryMode: z.enum(['ai', 'breadcrumb', 'fixed']).optional(),
    fixedCategory: z.enum(SCRAPE_CATEGORIES).optional(),
    city: z.string().trim().max(80).optional(),
    delayMs: z.coerce.number().int().min(0).max(5000).optional(),
    respectRobots: z.coerce.boolean().optional(),
    maxPages: z.coerce.number().int().min(1).max(60).optional(),
    minPrice: z.coerce.number().min(0).max(1_000_000).optional(),
    maxPrice: z.coerce.number().min(0).max(1_000_000).optional(),
    skipWithoutImage: z.coerce.boolean().optional(),
    dedupe: z.enum(['url', 'title', 'off']).optional(),
    addShopTag: z.coerce.boolean().optional(),
    selectors: z.record(z.string().max(160)).optional(),
    saveProfile: z.coerce.boolean().optional(),
    allowPrivate: z.coerce.boolean().optional(),
  })
  .strict();

export default async function scraperRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------- помощни */

  async function jobOr404(id: string) {
    const job = await one<{
      id: string;
      url: string;
      domain: string;
      status: string;
      mode: string;
      options: Record<string, unknown>;
      target_count: number;
      discovered: number;
      parsed: number;
      imported: number;
      skipped: number;
      failed: number;
      pages_visited: number;
      source_kind: string;
      strategy: string | null;
      log: string[] | null;
      error: string | null;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
    }>(
      `select id, url, domain, status, mode, options, target_count,
              discovered, parsed, imported, skipped, failed, pages_visited, source_kind,
              strategy, log, error,
              created_at::text, started_at::text, finished_at::text
         from scrape_jobs where id = $1`,
      [id]
    );
    if (!job) throw notFound('Няма такава задача.');
    return job;
  }

  /* --------------------------------------------------------------- инфо */

  /**
   * 🔧 Двигатели на обиколката — какво работи в момента.
   * Всяко копче в панела идва оттук, заедно с обяснението какво прави, харчи ли
   * пари и какво се случва, ако се изключи (прозрачност, не „магия“).
   */
  app.get('/api/admin/scraper/engines', async (req) => {
    await requireAdminPanel(req);
    return { engines: await engineStatus() };
  });

  app.post('/api/admin/scraper/engines', async (req) => {
    const admin = await requireFullAdmin(req);
    const input = z
      .object({ key: z.string().trim().min(2).max(40), on: z.coerce.boolean() })
      .parse(req.body ?? {});
    const known = ENGINE_SWITCHES.some((s) => s.key === input.key);
    if (!known) throw badRequest('Няма такъв двигател.');
    const all = await setEngineSwitch(input.key, input.on);
    await audit({
      admin,
      action: 'scraper.engine_switch',
      targetType: 'engine',
      targetId: input.key,
      targetLabel: `${input.key}=${input.on ? 'вкл' : 'изкл'}`,
      ip: req.ip,
    }).catch(() => undefined);
    return { ok: true, on: all[input.key] !== false, engines: await engineStatus() };
  });

  app.get('/api/admin/scraper/info', async (req) => {
    await requireAdminPanel(req);
    const info = await scrapeInfo();
    const sites = await many<{
      domain: string;
      label: string | null;
      strategy: string | null;
      runs: number;
      last_ok_at: string | null;
    }>(
      `select domain, label, strategy, runs, last_ok_at::text
         from scrape_sites order by last_ok_at desc nulls last limit 30`
    );
    return { ...info, sites };
  });

  /* -------------------------------------------------- проба на един адрес */

  /**
   * Веднага чете един адрес и връща какво е намерил — без да създава задача.
   * Точно това трябва, когато настройваш селектори за труден сайт.
   */
  app.post('/api/admin/scraper/probe', async (req) => {
    await requireAdminPanel(req);
    const input = z
      .object({
        url: z.string().trim().min(4).max(1000),
        selectors: z.record(z.string().max(160)).optional(),
        delayMs: z.coerce.number().int().min(0).max(5000).optional(),
        respectRobots: z.coerce.boolean().optional(),
        allowPrivate: z.coerce.boolean().optional(),
      })
      .parse(req.body ?? {});

    const u = normalizeStartUrl(input.url);
    let res: Awaited<ReturnType<typeof politeFetch>>;
    try {
      res = await politeFetch(u.toString(), {
        delayMs: input.delayMs,
        respectRobots: input.respectRobots ?? true,
        allowPrivate: input.allowPrivate ?? false,
      });
    } catch (err) {
      // Причината трябва да се види в панела, а не като „вътрешна грешка“.
      throw badRequest((err as Error).message);
    }
    const parsed = parseProductPage(res.text, res.url, input.selectors ?? {});
    return {
      status: res.status,
      finalUrl: res.url,
      contentType: res.contentType,
      bytes: res.text.length,
      found: parsed,
      hasJsonLd: /application\/ld\+json/i.test(res.text),
      hasOpenGraph: /og:title/i.test(res.text),
      hasMicrodata: /itemprop=["']?price/i.test(res.text),
      hint:
        parsed.price && parsed.title
          ? 'Изглежда добре — има заглавие и цена.'
          : 'Липсва цена или заглавие. Пробвай с ръчни селектори (напр. title: „h1“, price: „.price@text“).',
    };
  });

  /* ------------------------------------------------------------ задачи */

  /**
   * Внасяне на продукти, обходени ОТВЪН сървъра.
   *
   * Някои магазини (remedium.bg, sopharmacy.bg, zora.bg…) са зад Cloudflare и
   * връщат 403 на датацентъра, но се отварят от потребителски IP. За тях
   * локалният скрипт `scripts/scrape_local.py` чете продуктите и ги праща тук.
   */
  app.post('/api/admin/scraper/import-external', async (req) => {
    await requireAdminPanel(req);
    const input = z
      .object({
        domain: z.string().trim().min(3).max(120),
        items: z
          .array(
            z.object({
              title: z.string().trim().min(2).max(300),
              url: z.string().trim().min(8).max(600),
              price: z.coerce.number().min(0).max(1_000_000),
              currency: z.string().trim().max(8).optional(),
              imageUrl: z.string().trim().max(600).optional(),
              description: z.string().trim().max(4000).optional(),
              listPrice: z.coerce.number().min(0).max(1_000_000).optional(),
            })
          )
          .min(1)
          .max(200),
      })
      .parse(req.body ?? {});

    const result = await importExternalProducts(input.domain, input.items);
    return { ok: true, ...result };
  });

  /**
   * Проверки на цените, направени от локалния робот (домашен IP).
   *
   * За магазините, които блокират сървъра (Cloudflare 403), цената се проверява
   * от машината на потребителя със `scripts/scrape_local.py --refresh` и се
   * записва тук — после приложението я показва като „проверена от нашия робот“,
   * вместо да дава грешка.
   */
  app.post('/api/admin/posts/shop-prices', async (req) => {
    await requireAdminPanel(req);
    const input = z
      .object({
        items: z
          .array(
            z.object({
              postId: z.string().uuid(),
              priceEur: z.coerce.number().min(0).max(1_000_000),
              listPriceEur: z.coerce.number().min(0).max(1_000_000).optional(),
            })
          )
          .min(1)
          .max(300),
      })
      .parse(req.body ?? {});

    const saved = await saveLocalShopPrices(input.items);
    return { ok: true, saved };
  });

  app.post('/api/admin/scraper/jobs', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        url: z.string().trim().min(4).max(1000),
        count: z.coerce.number().int().min(1).max(2000).default(20),
        options: optionsSchema.optional(),
      })
      .parse(req.body ?? {});

    const u = normalizeStartUrl(input.url);
    const domain = u.hostname.replace(/^www\./, '');

    // Откъде да започне обиколката: ако човекът не е казал, продължаваме от
    // запомнения курсор за този магазин (за да не връщаме същите продукти).
    const withCursor: Record<string, unknown> = { ...(input.options ?? {}), count: input.count };
    if (withCursor.startOffset === undefined) withCursor.startOffset = await currentCursor(domain);
    const options = await optionsForSite(domain, withCursor);

    const job = await one<{ id: string }>(
      `insert into scrape_jobs (created_by, url, domain, mode, options, target_count, status)
       values ($1,$2,$3,$4,$5::jsonb,$6,'queued') returning id::text`,
      [admin.id, u.toString(), domain, options.mode, JSON.stringify(options), Math.min(input.count, options.count)]
    );

    await audit({
      admin,
      action: 'scraper.job_create',
      targetType: 'scrape_job',
      targetId: job?.id ?? null,
      targetLabel: domain,
      details: { url: u.toString(), count: input.count, mode: options.mode, useAi: options.useAi },
      ip: req.ip,
    });

    // Пускаме я веднага (worker-ът я подхваща и сам, но така е по-бързо).
    void runJob(job!.id).catch(() => undefined);

    return { ok: true, jobId: job!.id, mode: options.mode, domain };
  });

  app.get('/api/admin/scraper/jobs', async (req) => {
    await requireAdminPanel(req);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query ?? {});
    const items = await many<Record<string, unknown>>(
      `select j.id, j.url, j.domain, j.status, j.mode, j.target_count, j.source_kind,
              j.discovered, j.parsed, j.imported, j.skipped, j.failed, j.pages_visited,
              j.strategy, j.error, j.schedule_id, j.created_at::text, j.finished_at::text,
              (select count(*)::int from scrape_items i where i.job_id = j.id and i.status = 'parsed') as pending
         from scrape_jobs j
        order by j.created_at desc
        limit $1`,
      [q.limit]
    );
    return { items };
  });

  app.get('/api/admin/scraper/jobs/:id', async (req) => {
    await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const job = await jobOr404(id);

    const q = z
      .object({
        status: z.enum(['all', 'parsed', 'imported', 'skipped', 'failed']).default('all'),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(req.query ?? {});

    const items = await many<Record<string, unknown>>(
      `select id::text, source_url, title, description, price, reference_price, currency,
              image_url, local_image_url, category, unit_quantity, unit_type, polarity,
              breadcrumb, tags, status, reason, post_id
         from scrape_items
        where job_id = $1 ${q.status === 'all' ? '' : 'and status = $3'}
        order by id asc
        limit $2`,
      q.status === 'all' ? [id, q.limit] : [id, q.limit, q.status]
    );

    const counts = await one<Record<string, number>>(
      `select
         count(*) filter (where status = 'parsed')::int as parsed,
         count(*) filter (where status = 'imported')::int as imported,
         count(*) filter (where status = 'skipped')::int as skipped,
         count(*) filter (where status = 'failed')::int as failed
       from scrape_items where job_id = $1`,
      [id]
    );

    const site = await one<{ selectors: Record<string, string> | null; defaults: Record<string, unknown> | null }>(
      `select selectors, defaults from scrape_sites where domain = $1`,
      [job.domain]
    );

    return { job, items, counts, site: site ?? null };
  });

  app.post('/api/admin/scraper/jobs/:id/cancel', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const job = await jobOr404(id);
    if (['done', 'failed', 'cancelled'].includes(job.status)) {
      return { ok: true, already: job.status };
    }
    await query(
      `update scrape_jobs
          set status = 'cancelled', finished_at = now(),
              log = log || to_jsonb($2::text)
        where id = $1`,
      [id, 'Спряно от админ панела.']
    );
    await audit({ admin, action: 'scraper.job_cancel', targetType: 'scrape_job', targetId: id, ip: req.ip });
    return { ok: true };
  });

  app.post('/api/admin/scraper/jobs/:id/retry', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const job = await jobOr404(id);
    await query(
      `update scrape_jobs set status = 'queued', error = null, finished_at = null,
              heartbeat_at = null, log = log || to_jsonb($2::text)
        where id = $1`,
      [id, 'Пусната отново.']
    );
    void runJob(job.id).catch(() => undefined);
    await audit({ admin, action: 'scraper.job_retry', targetType: 'scrape_job', targetId: id, ip: req.ip });
    return { ok: true };
  });

  /**
   * Внася избраните продукти от задача в режим „преглед“.
   *
   * Професионалният поток е точно този: първо ВИЖДАШ какво е извадено, махаш
   * боклука, и чак тогава внасяш. Нищо не влиза в приложението без решение на
   * човек. „all“ внася всичко, което е останало в статус parsed.
   */
  app.post('/api/admin/scraper/jobs/:id/import', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const input = z
      .object({
        ids: z.array(z.coerce.number().int().positive()).max(2000).optional(),
        all: z.coerce.boolean().default(false),
      })
      .parse(req.body ?? {});

    const job = await jobOr404(id);
    const o = await optionsForSite(job.domain, job.options as never);

    if (!input.all && (!input.ids || input.ids.length === 0)) {
      throw badRequest('Избери поне един продукт (или подай all: true).');
    }

    const items = await many<{
      id: string;
      source_url: string;
      title: string | null;
      description: string | null;
      price: string | null;
      reference_price: string | null;
      category: string | null;
      unit_quantity: string | null;
      unit_type: string | null;
      polarity: string | null;
      image_url: string | null;
      tags: string[] | null;
    }>(
      `select id::text, source_url, title, description, price, reference_price, category,
              unit_quantity, unit_type, polarity, image_url, tags
         from scrape_items
        where job_id = $1 and status = 'parsed' ${input.all ? '' : 'and id = any($2::bigint[])'}
        order by id asc`,
      input.all ? [id] : [id, input.ids]
    );

    let imported = 0;
    const failed: Array<{ title: string; reason: string }> = [];
    const shopLabel = job.domain.replace(/^www\./, '');

    for (const it of items) {
      const title = (it.title ?? '').slice(0, 200);
      const price = Number(it.price ?? 0);
      if (!title || title.length < 3 || !price) {
        failed.push({ title: it.title ?? '(без заглавие)', reason: 'Липсва заглавие или цена' });
        continue;
      }
      try {
        if (await alreadyImported({ sourceUrl: it.source_url, title, dedupe: o.dedupe })) {
          await query(`update scrape_items set status = 'skipped', reason = $2 where id = $1`, [
            it.id,
            'Вече го има в системата',
          ]);
          continue;
        }

        let imageUrl = it.image_url ?? '';
        if (o.downloadImages && it.image_url) {
          const local = await downloadImage(it.image_url, o.maxImageMb, o);
          if (local) imageUrl = local;
        }
        if (!imageUrl) {
          await query(`update scrape_items set status = 'skipped', reason = $2 where id = $1`, [
            it.id,
            'Няма снимка',
          ]);
          continue;
        }

        const res = await importProduct({
          jobId: id,
          itemId: it.id,
          title,
          description: (it.description ?? '').slice(0, 4000),
          price,
          referencePrice: it.reference_price ? Number(it.reference_price) : null,
          category: it.category ?? 'other',
          polarity: it.polarity === 'red' ? 'red' : 'green',
          city: o.city,
          placeName: shopLabel,
          imageUrl,
          unitQuantity: it.unit_quantity ? Number(it.unit_quantity) : null,
          unitType: it.unit_type ?? null,
          tags: it.tags ?? [],
          sourceUrl: it.source_url,
          domain: job.domain,
        });

        await query(
          `update scrape_items set status = 'imported', post_id = $2, local_image_url = $3, reason = null where id = $1`,
          [it.id, res.postId, imageUrl]
        );
        imported++;
      } catch (err) {
        failed.push({ title, reason: (err as Error).message.slice(0, 160) });
        await query(`update scrape_items set status = 'failed', reason = $2 where id = $1`, [
          it.id,
          (err as Error).message.slice(0, 200),
        ]);
      }
    }

    await query(
      `update scrape_jobs
          set imported = imported + $2,
              log = log || to_jsonb($3::text)
        where id = $1`,
      [id, imported, `Внесени от прегледа: ${imported}${failed.length ? `, неуспешни: ${failed.length}` : ''}`]
    );

    await audit({
      admin,
      action: 'scraper.import_selected',
      targetType: 'scrape_job',
      targetId: id,
      details: { imported, failed: failed.length },
      ip: req.ip,
    });

    return { ok: true, imported, skipped: items.length - imported - failed.length, failed };
  });

  /** Изтрива избрани редове от прегледа (боклукът, който не искаме). */
  app.post('/api/admin/scraper/jobs/:id/discard', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const input = z
      .object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(2000) })
      .parse(req.body ?? {});
    await query(`update scrape_items set status = 'skipped', reason = 'Отхвърлен в прегледа' where job_id = $1 and id = any($2::bigint[]) and status = 'parsed'`, [
      id,
      input.ids,
    ]);
    await audit({ admin, action: 'scraper.discard', targetType: 'scrape_job', targetId: id, ip: req.ip });
    return { ok: true };
  });

  /* ------------------------------------------------------- научени сайтове */

  app.get('/api/admin/scraper/sites', async (req) => {
    await requireAdminPanel(req);
    const items = await many<Record<string, unknown>>(
      `select domain, label, strategy, selectors, defaults, notes, runs, last_ok_at::text, updated_at::text
         from scrape_sites order by last_ok_at desc nulls last`
    );
    return { items };
  });

  app.patch('/api/admin/scraper/sites/:domain', async (req) => {
    const admin = await requireAdminPanel(req);
    const { domain } = z.object({ domain: z.string().min(3).max(200) }).parse(req.params);
    const input = z
      .object({
        label: z.string().trim().max(120).optional(),
        selectors: z.record(z.string().max(160)).optional(),
        defaults: optionsSchema.partial().optional(),
        notes: z.string().trim().max(2000).optional(),
      })
      .parse(req.body ?? {});

    const cols: string[] = [];
    const vals: string[] = [];
    const values: unknown[] = [domain];
    const castOf = (k: string) => (k === 'selectors' || k === 'defaults' ? '::jsonb' : '');
    const push = (k: string, v: unknown) => {
      values.push(k === 'selectors' || k === 'defaults' ? JSON.stringify(v) : v);
      cols.push(k);
      vals.push(`$${values.length}${castOf(k)}`);
    };
    if (input.label !== undefined) push('label', input.label);
    if (input.selectors !== undefined) push('selectors', input.selectors);
    if (input.defaults !== undefined) push('defaults', input.defaults);
    if (input.notes !== undefined) push('notes', input.notes);
    if (!cols.length) throw badRequest('Няма какво да се обнови.');

    const updates = cols.map((c, i) => `${c} = $${i + 2}${castOf(c)}`).join(', ');
    await query(
      `insert into scrape_sites (domain, ${cols.join(', ')}, updated_at)
       values ($1, ${vals.join(', ')}, now())
       on conflict (domain) do update set ${updates}, updated_at = now()`,
      values
    );
    await audit({
      admin,
      action: 'scraper.site_update',
      targetType: 'scrape_site',
      targetId: domain,
      details: { fields: Object.keys(input) },
      ip: req.ip,
    });
    return { ok: true };
  });

  app.delete('/api/admin/scraper/sites/:domain', async (req) => {
    const admin = await requireAdminPanel(req);
    const { domain } = z.object({ domain: z.string().min(3).max(200) }).parse(req.params);
    await query(`delete from scrape_sites where domain = $1`, [domain]);
    await audit({ admin, action: 'scraper.site_delete', targetType: 'scrape_site', targetId: domain, ip: req.ip });
    return { ok: true };
  });

  /* ------------------------------------------------------- разписания */

  // Основната схема е отделно, защото `.refine()` връща друг тип и няма
  // `.partial()` — а за редакцията ни трябва частична схема.
  const scheduleBase = z.object({
    url: z.string().trim().min(4).max(1000),
    label: z.string().trim().max(120).optional(),
    enabled: z.coerce.boolean().default(true),
    dailyQuota: z.coerce.number().int().min(1).max(2000).default(20),
    burstMin: z.coerce.number().int().min(1).max(200).default(3),
    burstMax: z.coerce.number().int().min(1).max(200).default(6),
    hourFrom: z.coerce.number().int().min(0).max(23).default(8),
    hourTo: z.coerce.number().int().min(1).max(24).default(22),
    minGapMin: z.coerce.number().int().min(0).max(1440).default(20),
    mode: z.enum(['preview', 'import']).default('import'),
    options: optionsSchema.optional(),
    /** Таван на внесеното от този сайт. NULL/0 = без таван. */
    maxTotal: z.coerce.number().int().min(0).max(100000).optional(),
    /** Спира се сам, когато сайтът се изчерпи (3 обиколки без нови продукти). */
    stopWhenDone: z.coerce.boolean().default(true),
    /** Всяка обиколка влиза от различно място в каталога. */
    rotate: z.coerce.boolean().default(true),
  });

  const scheduleSchema = scheduleBase
    .refine((v) => v.burstMax >= v.burstMin, { message: 'Горната граница на групата трябва да е ≥ долната.' })
    .refine((v) => v.hourTo !== v.hourFrom, { message: 'Началото и краят на активните часове не може да са еднакви.' });

  /** Квотата се разпределя през деня, затова тук връщаме и кога е следващото пускане. */
  app.post('/api/admin/scraper/schedules', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = scheduleSchema.parse(req.body ?? {});
    const u = normalizeStartUrl(input.url);
    const domain = u.hostname.replace(/^www\./, '');
    const options = (input.options ?? {}) as Record<string, unknown>;

    const s = await one<Record<string, unknown>>(
      `insert into scrape_schedules
         (created_by, domain, url, label, enabled, daily_quota, burst_min, burst_max,
          hour_from, hour_to, min_gap_min, mode, options, day_key, max_total, stop_when_done, rotate)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17)
       returning id::text, domain, url, label, enabled, daily_quota, burst_min, burst_max,
                 hour_from, hour_to, min_gap_min, mode, used_today, runs_today,
                 total_imported, total_crawled, total_jobs, last_run_at::text, next_run_at::text`,
      [
        admin.id,
        domain,
        u.toString(),
        input.label ?? null,
        input.enabled,
        input.dailyQuota,
        input.burstMin,
        input.burstMax,
        input.hourFrom,
        input.hourTo,
        input.minGapMin,
        input.mode,
        JSON.stringify(options),
        // Дневният ключ се слага още при създаването. Иначе първият тик на
        // работника (на всеки 4 сек) вижда „NULL ≠ днес“ и нулира броячите,
        // точно след като сме пуснали първата обиколка.
        sofiaParts().dateKey,
        input.maxTotal && input.maxTotal > 0 ? input.maxTotal : null,
        input.stopWhenDone,
        input.rotate,
      ]
    );

    // Първото пускане се разпределя на случаен момент в активните часове,
    // вместо да удря сайта веднага след като го добавиш.
    await query(
      `update scrape_schedules
          set next_run_at = $2, updated_at = now()
        where id = $1`,
      [s!.id, await nextRunFor(String(s!.id))]
    );

    await audit({
      admin,
      action: 'scraper.schedule_create',
      targetType: 'scrape_schedule',
      targetId: String(s!.id),
      targetLabel: domain,
      details: { dailyQuota: input.dailyQuota, burst: `${input.burstMin}-${input.burstMax}`, hours: `${input.hourFrom}-${input.hourTo}` },
      ip: req.ip,
    });
    return { ok: true, schedule: s };
  });

  /** Изчислява next_run_at според текущото състояние (изнесено, за да е на едно място). */
  async function nextRunFor(id: string): Promise<Date> {
    const row = await one<Record<string, unknown>>(`select * from scrape_schedules where id = $1`, [id]);
    return planNextRun(row as never);
  }

  app.get('/api/admin/scraper/schedules', async (req) => {
    await requireAdminPanel(req);
    const items = await many<Record<string, unknown>>(
      `select s.id::text, s.domain, s.url, s.label, s.enabled, s.daily_quota, s.burst_min, s.burst_max,
              s.hour_from, s.hour_to, s.min_gap_min, s.mode, s.used_today, s.runs_today,
              s.total_imported, s.total_crawled, s.total_jobs, s.last_run_at::text, s.next_run_at::text,
              s.dry_runs, s.max_total, s.stop_when_done, s.rotate, s.auto_stopped_at::text,
              s.last_status, s.last_message,
              (select count(*)::int from scrape_jobs j
                where j.schedule_id = s.id and j.status in ('queued','discovering','parsing','enriching','importing')) as running
         from scrape_schedules s
        order by s.enabled desc, s.created_at desc`
    );
    return { items };
  });

  app.patch('/api/admin/scraper/schedules/:id', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const input = scheduleBase.partial().parse(req.body ?? {});

    const map: Array<[string, unknown, string]> = [];
    const push = (col: string, val: unknown, cast = '') => map.push([col, val, cast]);
    if (input.url !== undefined) {
      const u = normalizeStartUrl(input.url);
      push('url', u.toString());
      push('domain', u.hostname.replace(/^www\./, ''));
    }
    if (input.label !== undefined) push('label', input.label);
    if (input.enabled !== undefined) push('enabled', input.enabled);
    if (input.dailyQuota !== undefined) push('daily_quota', input.dailyQuota);
    if (input.burstMin !== undefined) push('burst_min', input.burstMin);
    if (input.burstMax !== undefined) push('burst_max', input.burstMax);
    if (input.hourFrom !== undefined) push('hour_from', input.hourFrom);
    if (input.hourTo !== undefined) push('hour_to', input.hourTo);
    if (input.minGapMin !== undefined) push('min_gap_min', input.minGapMin);
    if (input.mode !== undefined) push('mode', input.mode);
    if (input.options !== undefined) push('options', JSON.stringify(input.options), '::jsonb');
    if (input.maxTotal !== undefined) push('max_total', input.maxTotal > 0 ? input.maxTotal : null);
    if (input.stopWhenDone !== undefined) push('stop_when_done', input.stopWhenDone);
    if (input.rotate !== undefined) push('rotate', input.rotate);
    // Включване след самоспиране = нов шанс: нулираме брояча на „сухите“ обиколки.
    if (input.enabled === true) {
      push('dry_runs', 0);
      push('auto_stopped_at', null, '::timestamptz');
      push('last_status', null);
      push('last_message', null);
    }
    if (!map.length) throw badRequest('Няма какво да се обнови.');

    const values: unknown[] = [id];
    const sets = map.map(([col, val, cast]) => {
      values.push(val);
      return `${col} = $${values.length}${cast}`;
    });

    await query(`update scrape_schedules set ${sets.join(', ')}, updated_at = now() where id = $1`, values);

    // Всяка промяна на квотата/часовете пре-планира следващото пускане.
    await query(`update scrape_schedules set next_run_at = $2 where id = $1`, [id, await nextRunFor(id)]);

    await audit({ admin, action: 'scraper.schedule_update', targetType: 'scrape_schedule', targetId: id, ip: req.ip });
    return { ok: true };
  });


  /**
   * Добавяне на НЯКОЛКО сайта наведнъж (напр. 10 магазина).
   *
   * Защо: добавянето един по един при 10 сайта е 10 модала и 10 пъти едни и същи
   * настройки. Тук се подава списък (текст с нов ред, запетая или интервал) и
   * всяко правило се прилага за всички. Дублираните адреси се прескачат, а
   * резултатът казва точно кой е влязъл и кой не — без тихо губене.
   */
  app.post('/api/admin/scraper/schedules/bulk', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        urls: z.union([z.string().max(20_000), z.array(z.string().max(1000)).max(200)]),
        label: z.string().trim().max(120).optional(),
        dailyQuota: z.coerce.number().int().min(1).max(2000).default(20),
        burstMin: z.coerce.number().int().min(1).max(200).default(3),
        burstMax: z.coerce.number().int().min(1).max(200).default(6),
        hourFrom: z.coerce.number().int().min(0).max(23).default(8),
        hourTo: z.coerce.number().int().min(1).max(24).default(22),
        minGapMin: z.coerce.number().int().min(0).max(1440).default(20),
        mode: z.enum(['preview', 'import']).default('import'),
        options: optionsSchema.optional(),
        maxTotal: z.coerce.number().int().min(0).max(100000).optional(),
        stopWhenDone: z.coerce.boolean().default(true),
        rotate: z.coerce.boolean().default(true),
      })
      .parse(req.body ?? {});

    const lines =
      typeof input.urls === 'string' ? input.urls.split(/[\s,;]+/).filter(Boolean) : input.urls;
    const options = (input.options ?? {}) as Record<string, unknown>;
    const seen = new Set<string>();
    const created: string[] = [];
    const skipped: Array<{ url: string; reason: string }> = [];

    for (const line of lines) {
      const raw = String(line).trim();
      if (!raw) continue;
      const key = raw.toLowerCase().replace(/\/+$/, '');
      if (seen.has(key)) {
        skipped.push({ url: raw, reason: 'повторен в списъка' });
        continue;
      }
      seen.add(key);

      let u: URL;
      try {
        u = normalizeStartUrl(raw);
      } catch {
        skipped.push({ url: raw, reason: 'невалиден адрес' });
        continue;
      }
      const domain = u.hostname.replace(/^www\./, '');

      const dup = await one<{ id: string }>(
        `select id::text from scrape_schedules where url = $1 or domain = $2 limit 1`,
        [u.toString(), domain]
      );
      if (dup) {
        skipped.push({ url: raw, reason: 'вече има разписание за този сайт' });
        continue;
      }

      const s = await one<{ id: string }>(
        `insert into scrape_schedules
           (created_by, domain, url, label, enabled, daily_quota, burst_min, burst_max,
            hour_from, hour_to, min_gap_min, mode, options, day_key, max_total, stop_when_done, rotate)
         values ($1,$2,$3,$4,true,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)
         returning id::text`,
        [
          admin.id,
          domain,
          u.toString(),
          input.label ?? null,
          input.dailyQuota,
          input.burstMin,
          input.burstMax,
          input.hourFrom,
          input.hourTo,
          input.minGapMin,
          input.mode,
          JSON.stringify(options),
          sofiaParts().dateKey,
          input.maxTotal && input.maxTotal > 0 ? input.maxTotal : null,
          input.stopWhenDone,
          input.rotate,
        ]
      );
      if (!s) {
        skipped.push({ url: raw, reason: 'не се записа' });
        continue;
      }
      // Първото пускане се разпръсва във времето, вместо 10 сайта да бъдат ударени наведнъж.
      await query(`update scrape_schedules set next_run_at = $2 where id = $1`, [s.id, await nextRunFor(s.id)]);
      created.push(s.id);
    }

    await audit({
      admin,
      action: 'scraper.schedule_bulk_create',
      targetType: 'scrape_schedule',
      targetId: created[0] ?? null,
      targetLabel: `${created.length} сайта`,
      details: { created: created.length, skipped: skipped.length, dailyQuota: input.dailyQuota },
      ip: req.ip,
    });
    return { ok: true, created: created.length, skipped, ids: created };
  });

  app.post('/api/admin/scraper/schedules/:id/run', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ force: z.coerce.boolean().default(true) }).parse(req.body ?? {});
    const jobId = await runScheduleNow(id, body.force);
    if (!jobId) throw badRequest('Дневната квота е изчерпана — изчакай утре или вдигни квотата.');
    void runJob(jobId).catch(() => undefined);
    await audit({ admin, action: 'scraper.schedule_run', targetType: 'scrape_schedule', targetId: id, ip: req.ip });
    return { ok: true, jobId };
  });

  app.delete('/api/admin/scraper/schedules/:id', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    await query(`delete from scrape_schedules where id = $1`, [id]);
    await audit({ admin, action: 'scraper.schedule_delete', targetType: 'scrape_schedule', targetId: id, ip: req.ip });
    return { ok: true };
  });

  /** Статистика за един сайт: общо, по дни, разписанията и последните обиколки. */
  app.get('/api/admin/scraper/sites/:domain/stats', async (req) => {
    await requireAdminPanel(req);
    const { domain } = z.object({ domain: z.string().min(3).max(200) }).parse(req.params);
    const stats = await scheduleStats(domain);
    const site = await one<Record<string, unknown>>(
      `select domain, label, strategy, selectors, notes, runs, last_ok_at::text from scrape_sites where domain = $1`,
      [domain]
    );
    return { domain, site: site ?? null, ...stats };
  });

  /* ------------------------------------------------------ Apify (платено) --- */

  /** Колко е похарчено и колко е лимитът — за да не изяде скенерът целия план. */
  app.get('/api/admin/scraper/apify', async (req) => {
    await requireAdminPanel(req);
    const [ready, limit, spent] = await Promise.all([apifyReady(), apifyDailyLimit(), apifySpent()]);
    return { ready, limit, spentToday: spent.today, spentMonth: spent.month };
  });

  app.post('/api/admin/scraper/apify/limit', async (req) => {
    const admin = await requireAdminPanel(req);
    const { usd } = z.object({ usd: z.coerce.number().min(0).max(19) }).parse(req.body ?? {});
    await setApifyDailyLimit(usd);
    await audit({ admin, action: 'scraper.apify_limit', targetLabel: String(usd), ip: req.ip });
    return { ok: true, limit: await apifyDailyLimit() };
  });

  /* ------------------------------------------- 🧭 курсори и 🏷️ категории --- */

  /** Докъде сме стигнали във всеки магазин (за панела). */
  app.get('/api/admin/scraper/cursors', async (req) => {
    await requireAdminPanel(req);
    return { items: await listCursors(60) };
  });

  /** Съответствия „категория на магазина → наша категория“. */
  app.get('/api/admin/scraper/categories', async (req) => {
    await requireAdminPanel(req);
    return { items: await listCategoryMap(300) };
  });

  app.delete('/api/admin/scraper/categories/:source', async (req) => {
    const admin = await requireAdminPanel(req);
    const { source } = z.object({ source: z.string().min(2).max(120) }).parse(req.params);
    await deleteCategoryMap(source);
    await audit({ admin, action: 'scraper.category_unmap', targetLabel: source, ip: req.ip });
    return { ok: true };
  });

  /* ------------------------------- 🏷️ обяви през Apify (OLX.bg / imot.bg / Alo.bg) --- */

  /**
   * Какви източници на обяви имаме и има ли бюджет.
   * Темите „частни продавачи“, „имоти“ и „авто“ идват оттук, не само от FB групи.
   */
  app.get('/api/admin/classifieds/info', async (req) => {
    await requireAdminPanel(req);
    const budget = await apifyBudgetAllows(0.05).catch(() => ({ allowed: false, today: 0, limit: 0 }));
    const imported = await many<Record<string, unknown>>(
      `select source, count(*)::int as n, max(created_at)::text as last
         from posts where source in ('olx','imot','alo','facebook')
        group by source order by source`
    );
    return {
      // Показваме само ВКЛЮЧЕНИТЕ източници (imot.bg е изключен по решение).
      sources: Object.entries(CLASSIFIED_SOURCES)
        .filter(([, m]) => !m.disabled)
        .map(([key, m]) => ({
          key,
          label: m.label,
          input: m.input,
          note: m.note ?? null,
          actor: m.actor,
        })),
      imported,
      apify: { allowed: budget.allowed, today: budget.today, limit: budget.limit },
    };
  });

  /**
   * Пуска актьор за обяви и внася намереното.
   * Харчи пари → иска ПЪЛЕН админ (модератор не може).
   */
  app.post('/api/admin/classifieds/scan', async (req) => {
    const admin = await requireFullAdmin(req);
    const input = z
      .object({
        source: z.enum(['olx', 'imot', 'alo', 'facebook']),
        query: z.string().trim().min(2).max(160),
        maxItems: z.coerce.number().int().min(1).max(200).default(20),
      })
      .parse(req.body ?? {});

    // ФОНОВО: nginx/Cloudflare режат заявката на ~100 сек, а imot.bg отнема ~113 сек.
    // Панелът пита `/classifieds/last`, докато обиколката свърши.
    const started = await startClassifiedsScan(input.source, input.query, input.maxItems);

    await audit({
      admin,
      action: 'classifieds.scan',
      targetLabel: `${input.source}: ${input.query}`.slice(0, 200),
      details: { started: started.started, maxItems: input.maxItems, reason: started.reason ?? null },
      ip: req.ip,
    });

    return { ok: started.started, started: started.started, reason: started.reason ?? null };
  });

  /** Какво стана с последната обиколка за обяви (панелът пита това, докато чака). */
  app.get('/api/admin/classifieds/last', async (req) => {
    await requireAdminPanel(req);
    return { run: await lastClassifiedsRun() };
  });

  /* ------------------------------- 🏪 обекти: обогатяване през Google Maps --- */

  /**
   * Какво знаем за обектите и колко чакат обогатяване.
   * Обект = място (магазин, сервиз, майстор) + град; Google Maps дава рейтинг,
   * отзиви, работно време, телефон, сайт и точни координати.
   */
  app.get('/api/admin/places/info', async (req) => {
    await requireAdminPanel(req);
    const [info, recent, last] = await Promise.all([
      placesInfo(),
      recentEnriched(20).catch(() => []),
      lastPlacesRun().catch(() => null),
    ]);
    const budget = await apifyBudgetAllows(0.1).catch(() => ({ allowed: false, today: 0, limit: 0 }));
    return { ...info, recent, last, apify: { allowed: budget.allowed, today: budget.today, limit: budget.limit } };
  });

  /** Обогатяване на обектите — ФОНОВО (Google Maps отнема 30–90 сек). Харчи пари. */
  app.post('/api/admin/places/enrich', async (req) => {
    const admin = await requireFullAdmin(req);
    const input = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(10) })
      .parse(req.body ?? {});
    const started = await startPlacesEnrich(input.limit);
    await audit({
      admin,
      action: 'places.enrich',
      targetLabel: `Google Maps: до ${input.limit} обекта`,
      details: { started: started.started, reason: started.reason ?? null },
      ip: req.ip,
    });
    return { ok: started.started, started: started.started, reason: started.reason ?? null };
  });

  /** Проверка на конкретен обект без чакане (за диагностика). */
  app.get('/api/admin/places/last', async (req) => {
    await requireAdminPanel(req);
    return { run: await lastPlacesRun() };
  });

  /* -------------------------------------------------- едновременно вървящи */


  app.get('/api/admin/scraper/running', async (req) => {
    await requireAdminPanel(req);
    const items = await many<Record<string, unknown>>(
      `select id::text, domain, status, mode, source_kind, target_count, parsed, imported, skipped,
              failed, pages_visited, strategy, created_at::text,
              (select count(*)::int from scrape_items i where i.job_id = scrape_jobs.id and i.status = 'parsed') as pending
         from scrape_jobs
        where status in ('queued','discovering','parsing','enriching','importing')
        order by created_at asc`
    );
    return { items };
  });

  /* ======================================= 🔎 търсене на сканируеми магазини */

  /**
   * Търси магазини по ключова дума и ПРОВЕРЯВА кой става за сканиране.
   *
   * Връща само тези, които наистина могат да се обходят (status 'ok'), плюс
   * тези, които чакат домашен IP ('local'), защото и те вършат работа — през
   * робота на домашната машина.
   */
  app.post('/api/admin/scraper/discover', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        query: z.string().trim().max(120).optional(),
        domains: z.array(z.string().trim().max(200)).max(25).optional(),
        limit: z.coerce.number().int().min(1).max(25).optional(),
        force: z.coerce.boolean().optional(),
      })
      .parse(req.body ?? {});

    const result = await discoverShops(input);
    await audit({
      admin,
      action: 'scraper.discover',
      targetType: 'shop_candidates',
      targetLabel: result.query,
      details: {
        checked: result.checked,
        ok: result.items.filter((i) => i.status === 'ok').length,
        local: result.items.filter((i) => i.status === 'local').length,
        ai: result.usedAi,
      },
      ip: req.ip,
    });
    return { ok: true, ...result, queue: await localQueueStats() };
  });

  /** Вече проверените магазини (за да не се проверяват пак). */
  app.get('/api/admin/scraper/candidates', async (req) => {
    await requireAdminPanel(req);
    const q = z
      .object({
        status: z.string().trim().max(20).optional(),
        q: z.string().trim().max(120).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(req.query ?? {});
    const items = await listCandidates(q);
    const spent = await apifySpent();
    return {
      items,
      queue: await localQueueStats(),
      apify: { ready: await apifyReady(), limit: await apifyDailyLimit(), spentToday: spent.today, spentMonth: spent.month },
    };
  });

  app.post('/api/admin/scraper/candidates/:domain/reject', async (req) => {
    const admin = await requireAdminPanel(req);
    const { domain } = z.object({ domain: z.string().min(3).max(200) }).parse(req.params);
    await rejectCandidate(domain);
    await audit({ admin, action: 'scraper.candidate_reject', targetType: 'shop_candidate', targetLabel: domain, ip: req.ip });
    return { ok: true };
  });

  /** Проверява пак един магазин (например след като е бил зад Cloudflare). */
  app.post('/api/admin/scraper/candidates/:domain/rescan', async (req) => {
    await requireAdminPanel(req);
    const { domain } = z.object({ domain: z.string().min(3).max(200) }).parse(req.params);
    const result = await discoverShops({ domains: [domain], limit: 1, force: true });
    return { ok: true, ...result };
  });

  /**
   * Пуска обиколка направо от намерения магазин.
   * Едно действие: създава задачата и запомня връзката към кандидата.
   */
  app.post('/api/admin/scraper/candidates/:domain/scan', async (req) => {
    const admin = await requireAdminPanel(req);
    const { domain } = z.object({ domain: z.string().min(3).max(200) }).parse(req.params);
    const input = z
      .object({
        count: z.coerce.number().int().min(1).max(2000).default(20),
        options: optionsSchema.optional(),
      })
      .parse(req.body ?? {});

    const u = normalizeStartUrl(`https://${domain}/`);
    const clean = u.hostname.replace(/^www\./, '');
    const withCursor2: Record<string, unknown> = { ...(input.options ?? {}), count: input.count };
    if (withCursor2.startOffset === undefined) withCursor2.startOffset = await currentCursor(clean);
    const options = await optionsForSite(clean, withCursor2);
    const job = await one<{ id: string }>(
      `insert into scrape_jobs (created_by, url, domain, mode, options, target_count, status)
       values ($1,$2,$3,$4,$5::jsonb,$6,'queued') returning id::text`,
      [admin.id, u.toString(), clean, options.mode, JSON.stringify(options), Math.min(input.count, options.count)]
    );
    await rememberJob(clean, job!.id);
    await audit({
      admin,
      action: 'scraper.candidate_scan',
      targetType: 'scrape_job',
      targetId: job!.id,
      targetLabel: clean,
      ip: req.ip,
    });
    void runJob(job!.id).catch(() => undefined);
    return { ok: true, jobId: job!.id, domain: clean, mode: options.mode };
  });

  /* ------------------------------ опашка за домашния робот (Cloudflare) --- */

  /** Заявка сайтът да бъде обходен от домашната машина. */
  app.post('/api/admin/scraper/local-queue', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        domain: z.string().trim().min(3).max(200),
        count: z.coerce.number().int().min(1).max(500).optional(),
        note: z.string().trim().max(200).optional(),
      })
      .parse(req.body ?? {});
    const row = await queueLocalScan({ ...input, userId: admin.id });
    await audit({
      admin,
      action: 'scraper.local_queue_add',
      targetType: 'local_scan_queue',
      targetId: row.id,
      targetLabel: row.domain,
      ip: req.ip,
    });
    return { ok: true, item: row };
  });

  app.get('/api/admin/scraper/local-queue', async (req) => {
    await requireAdminPanel(req);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query ?? {});
    return { items: await pendingLocalScans(q.limit), stats: await localQueueStats() };
  });

  /** Роботът маркира, че е поел заявките (за да не се обхождат два пъти). */
  app.post('/api/admin/scraper/local-queue/take', async (req) => {
    await requireAdminPanel(req);
    const { domains } = z
      .object({ domains: z.array(z.string().trim().min(3).max(200)).min(1).max(20) })
      .parse(req.body ?? {});
    const taken = await takeLocalScans(domains);
    return { ok: true, taken };
  });

  /** Роботът отчита какво е свършил. */
  app.post('/api/admin/scraper/local-queue/finish', async (req) => {
    await requireAdminPanel(req);
    const input = z
      .object({
        domain: z.string().trim().min(3).max(200),
        ok: z.coerce.boolean(),
        imported: z.coerce.number().int().min(0).max(10000).optional(),
        note: z.string().trim().max(300).optional(),
      })
      .parse(req.body ?? {});
    await finishLocalScan(input);
    return { ok: true };
  });
}
