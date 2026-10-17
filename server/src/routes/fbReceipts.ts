import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit, requireAdminPanel } from '../lib/admin.js';
import {
  approveFbReceiptItem,
  checkQueueImages,
  getFbGroups,
  getFbScraperConfig,
  runAllFbGroups,
  saveFbGroups,
  parseFbGroupUrl,
  processRawFbPosts,
  runFbGroupJob,
  saveFbScraperConfig,
  type ReceiptCategory,
} from '../lib/fbReceipts.js';

const CATEGORIES = [
  'restaurants',
  'hotels_airbnb',
  'supermarket',
  'cafes_bars',
  'services_tech',
  'other',
] as const;

const lineItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().positive().max(10000).default(1),
  unitPrice: z.coerce.number().min(0).max(1_000_000),
  totalPrice: z.coerce.number().min(0).max(1_000_000),
  highlightReason: z.string().trim().max(200).nullable().optional(),
});

const overridesSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().max(4000).optional(),
    polarity: z.enum(['green', 'red']).optional(),
    category: z.enum(CATEGORIES).optional(),
    placeName: z.string().trim().min(1).max(200).optional(),
    city: z.string().trim().min(2).max(80).optional(),
    address: z.string().trim().max(300).nullable().optional(),
    merchantName: z.string().trim().min(1).max(200).optional(),
    merchantTaxId: z.string().trim().max(40).nullable().optional(),
    receiptDate: z.string().trim().max(40).nullable().optional(),
    receiptTime: z.string().trim().max(20).nullable().optional(),
    totalAmount: z.coerce.number().positive().max(1_000_000).optional(),
    items: z.array(lineItemSchema).max(200).optional(),
  })
  .strict();

export default async function fbReceiptRoutes(app: FastifyInstance) {
  /** Обща информация, настройки, статистика на опашката и списък за одобрение. */
  app.get('/api/admin/fb-receipts/info', async (req) => {
    await requireAdminPanel(req);
    const q = z
      .object({
        status: z.enum(['pending', 'approved', 'rejected', 'not_receipt', 'all']).default('pending'),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query ?? {});

    const [cfg, counts, jobs, queue] = await Promise.all([
      getFbScraperConfig(),
      one<{
        pending: number;
        approved: number;
        rejected: number;
        not_receipt: number;
      }>(
        `select
           count(*) filter (where status = 'pending')::int as pending,
           count(*) filter (where status = 'approved')::int as approved,
           count(*) filter (where status = 'rejected')::int as rejected,
           count(*) filter (where status = 'not_receipt')::int as not_receipt
         from fb_receipt_queue`
      ),
      many<Record<string, unknown>>(
        `select id::text, group_url, group_id, status, target_count,
                discovered, receipts_found, skipped, failed, strategy,
                log, error, created_at::text, finished_at::text
           from fb_receipt_jobs
          order by created_at desc
          limit 10`
      ),
      many<Record<string, unknown>>(
        `select q.id::text, q.job_id::text, q.group_url, q.fb_post_id, q.fb_post_url,
                q.fb_author_name, q.fb_posted_at, q.fb_post_text,
                q.original_image_url, q.local_image_url, q.status, q.skip_reason,
                q.polarity, q.category, q.title, q.description, q.place_name, q.city,
                q.address, q.merchant_name, q.merchant_tax_id, q.receipt_date, q.receipt_time,
                q.total_amount::float as total_amount,
                q.original_amount::float as original_amount,
                q.original_currency, q.confidence::float as confidence,
                q.ai_model, q.items, q.post_id, q.created_at::text, q.reviewed_at::text,
                p.public_code as post_code,
           p.signal_count::int as signal_count
           from fb_receipt_queue q
           left join posts p on p.id = q.post_id
          where ($1 = 'all' or q.status = $1)
          order by q.created_at desc
          limit $2`,
        [q.status, q.limit]
      ),
    ]);

    return {
      config: {
        hasApifyToken: cfg.hasApifyToken,
        apifyTokenMasked: cfg.apifyToken ? `${cfg.apifyToken.slice(0, 8)}••••${cfg.apifyToken.slice(-4)}` : '',
        hasFbCookie: cfg.hasFbCookie,
        ocrAvailable: cfg.ocrAvailable,
        ocrModel: cfg.ocrModel,
        commentsEnabled: cfg.commentsEnabled,
        autoApprove: cfg.autoApprove,
        autoApproveMin: cfg.autoApproveMin,
      },
      counts: counts ?? { pending: 0, approved: 0, rejected: 0, not_receipt: 0 },
      jobs,
      items: queue,
    };
  });

  /** Запис на Apify API токен и/или Facebook сесийна бисквитка от админ панела. */
  app.post('/api/admin/fb-receipts/settings', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        apifyToken: z.string().max(400).optional(),
        fbCookie: z.string().max(8000).optional(),
        commentsEnabled: z.boolean().optional(),
        autoApprove: z.boolean().optional(),
        autoApproveMin: z.coerce.number().min(0.1).max(1).optional(),
      })
      .parse(req.body ?? {});

    await saveFbScraperConfig(input);
    await audit({
      admin,
      action: 'fb_receipts.settings',
      details: {
        updatedApify: input.apifyToken !== undefined,
        updatedCookie: input.fbCookie !== undefined,
      },
      ip: req.ip,
    });
    return { ok: true };
  });

  /** Пуска нова задача за сваляне на касови бележки от публична Facebook група. */
  app.post('/api/admin/fb-receipts/jobs', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        groupUrl: z.string().trim().min(5).max(600),
        count: z.coerce.number().int().min(1).max(100).default(10),
        defaultCity: z.string().trim().max(80).default('София'),
      })
      .parse(req.body ?? {});

    let parsedUrl: { canonicalUrl: string; groupId: string };
    try {
      parsedUrl = parseFbGroupUrl(input.groupUrl);
    } catch (err) {
      throw badRequest((err as Error).message);
    }

    const job = await one<{ id: string }>(
      `insert into fb_receipt_jobs (group_url, group_id, status, target_count, created_by)
       values ($1, $2, 'running', $3, $4)
       returning id::text`,
      [parsedUrl.canonicalUrl, parsedUrl.groupId, input.count, admin.id]
    );

    await audit({
      admin,
      action: 'fb_receipts.job_start',
      targetType: 'fb_receipt_job',
      targetId: job?.id ?? null,
      targetLabel: parsedUrl.groupId,
      details: { groupUrl: parsedUrl.canonicalUrl, count: input.count },
      ip: req.ip,
    });

    void runFbGroupJob(job!.id, { defaultCity: input.defaultCity }).catch(() => undefined);

    return {
      ok: true,
      jobId: job!.id,
      groupUrl: parsedUrl.canonicalUrl,
      groupId: parsedUrl.groupId,
    };
  });

  /** Състояние на конкретна задача за следене в реално време. */
  app.get('/api/admin/fb-receipts/jobs/:id', async (req) => {
    await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const job = await one<Record<string, unknown>>(
      `select id::text, group_url, group_id, status, target_count,
              discovered, receipts_found, skipped, failed, strategy,
              log, error, created_at::text, finished_at::text
         from fb_receipt_jobs where id = $1`,
      [id]
    );
    if (!job) throw notFound('Задачата не е намерена.');
    return { job };
  });

  /**
   * Внасяне на един или няколко поста със снимки + текст за AI разчитане и одобрение.
   * Ползва се както от бутона „Добави пост / снимка на бележка“, така и от
   * 1-клик браузър колектора при отворена Facebook група.
   */
  app.post('/api/admin/fb-receipts/ingest', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        groupUrl: z.string().trim().max(600).default('https://www.facebook.com/groups/3111975342346393'),
        defaultCity: z.string().trim().max(80).default('София'),
        posts: z
          .array(
            z.object({
              postId: z.string().trim().max(120).optional(),
              postUrl: z.string().trim().max(600).default(''),
              text: z.string().trim().max(5000).default(''),
              imageUrls: z.array(z.string().trim().min(5)).min(1).max(5),
              authorName: z.string().trim().max(160).optional(),
              postedAt: z.string().trim().max(80).optional(),
            })
          )
          .min(1)
          .max(50),
      })
      .parse(req.body ?? {});

    const normalizedPosts = input.posts.map((p) => ({
      ...p,
      postUrl: p.postUrl || input.groupUrl,
    }));

    const res = await processRawFbPosts({
      groupUrl: input.groupUrl,
      posts: normalizedPosts,
      defaultCity: input.defaultCity,
      maxReceipts: 50,
    });

    await audit({
      admin,
      action: 'fb_receipts.ingest',
      details: {
        groupUrl: input.groupUrl,
        submitted: input.posts.length,
        queued: res.queued,
        skipped: res.skipped,
        failed: res.failed,
      },
      ip: req.ip,
    });

    return { ok: true, ...res };
  });

  /** Одобряване и публикуване на една бележка (с възможност за редакция преди публикуване). */
  app.post('/api/admin/fb-receipts/queue/:id/approve', async (req) => {
    const admin = await requireAdminPanel(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const overrides = req.body && Object.keys(req.body as object).length > 0
      ? overridesSchema.parse(req.body)
      : undefined;

    try {
      const result = await approveFbReceiptItem(id, admin.id, overrides);
      await audit({
        admin,
        action: 'fb_receipts.approve',
        targetType: 'post',
        targetId: result.postId,
        details: { queueId: id },
        ip: req.ip,
      });
      return { ok: true, postId: result.postId };
    } catch (err) {
      throw badRequest((err as Error).message);
    }
  });

  /** Масово одобряване на избрани (или всички чакащи) бележки от опашката. */
  app.post('/api/admin/fb-receipts/queue/approve-bulk', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        ids: z.array(z.coerce.number().int().positive()).max(200).optional(),
        allPending: z.coerce.boolean().default(false),
      })
      .parse(req.body ?? {});

    let targetIds = input.ids ?? [];
    if (input.allPending) {
      const rows = await many<{ id: string }>(
        `select id::text from fb_receipt_queue where status = 'pending' order by id asc limit 200`
      );
      targetIds = rows.map((r) => Number(r.id));
    }

    if (targetIds.length === 0) {
      throw badRequest('Избери поне една бележка за одобрение.');
    }

    let approved = 0;
    const failed: Array<{ id: number; reason: string }> = [];

    for (const qId of targetIds) {
      try {
        await approveFbReceiptItem(String(qId), admin.id);
        approved++;
      } catch (err) {
        failed.push({ id: qId, reason: (err as Error).message.slice(0, 160) });
      }
    }

    await audit({
      admin,
      action: 'fb_receipts.approve_bulk',
      details: { approved, failed: failed.length },
      ip: req.ip,
    });

    return { ok: true, approved, failed };
  });

  /** Отхвърляне на една или няколко бележки от опашката. */
  /** Запазените групи за автоматични обиколки. */
  app.get('/api/admin/fb-receipts/groups', async (req) => {
    await requireAdminPanel(req);
    return { groups: await getFbGroups() };
  });

  /** Запис на списъка с групи (един адрес на ред). */
  app.post('/api/admin/fb-receipts/groups', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z.object({ urls: z.array(z.string().max(600)).max(50) }).parse(req.body ?? {});
    const groups = await saveFbGroups(input.urls);
    await audit({
      admin,
      action: 'fb_receipts.groups',
      details: { count: groups.length },
      ip: req.ip,
    });
    return { ok: true, groups, skipped: input.urls.length - groups.length };
  });

  /** Пуска обиколка на ВСИЧКИ запазени групи (една след друга, с пауза между тях). */
  app.post('/api/admin/fb-receipts/run-all', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        count: z.coerce.number().int().min(1).max(100).default(20),
        defaultCity: z.string().trim().max(80).default('София'),
      })
      .parse(req.body ?? {});

    const res = await runAllFbGroups({
      adminId: admin.id,
      count: input.count,
      defaultCity: input.defaultCity,
    });

    void (async () => {
      for (const s of res.started) {
        try {
          await runFbGroupJob(s.jobId, { defaultCity: input.defaultCity });
        } catch {
          /* грешката се записва в самата задача */
        }
        await new Promise((resolve) => setTimeout(resolve, 20_000));
      }
    })();

    await audit({
      admin,
      action: 'fb_receipts.run_all',
      details: { started: res.started.length },
      ip: req.ip,
    });

    return { ok: true, started: res.started.length, skipped: res.skipped.length, groups: res.started };
  });

  /** Проверка на снимките в опашката за следи от Facebook (интерфейс, профили, лого). */
  app.post('/api/admin/fb-receipts/queue/check-images', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        ids: z.array(z.coerce.number().int().positive()).max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(req.body ?? {});

    const res = await checkQueueImages({ ids: input.ids, limit: input.limit });

    await audit({
      admin,
      action: 'fb_receipts.check_images',
      details: { checked: res.checked, dirty: res.dirty },
      ip: req.ip,
    });

    return { ok: true, ...res };
  });

  app.post('/api/admin/fb-receipts/queue/reject', async (req) => {
    const admin = await requireAdminPanel(req);
    const input = z
      .object({
        ids: z.array(z.coerce.number().int().positive()).min(1).max(200),
      })
      .parse(req.body ?? {});

    await query(
      `update fb_receipt_queue
          set status = 'rejected', reviewed_at = now(), reviewed_by = $2
        where id = any($1::bigint[]) and status in ('pending', 'not_receipt')`,
      [input.ids, admin.id]
    );

    await audit({
      admin,
      action: 'fb_receipts.reject',
      details: { count: input.ids.length, ids: input.ids },
      ip: req.ip,
    });

    return { ok: true, rejected: input.ids.length };
  });
}
