import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { mkdir } from 'node:fs/promises';

import { env, features, isProd } from './env.js';
import { prewarmBrowser } from './lib/render.js';
import { closePool, one } from './db.js';
import { runMigrations } from './migrate.js';
import { startCenkoTrainer } from './lib/cenkoScheduler.js';
import { startSocialScheduler } from './lib/socialScheduler.js';
import { sendError } from './lib/errors.js';

import authRoutes from './routes/auth.js';
import postRoutes from './routes/posts.js';
import commentRoutes from './routes/comments.js';
import mediaRoutes from './routes/media.js';
import donationRoutes from './routes/donations.js';
import communityRoutes from './routes/community.js';
import ogRoutes from './routes/og.js';
import raffleRoutes from './routes/raffles.js';
import referralRoutes from './routes/referrals.js';
import adminRoutes from './routes/admin.js';
import assistantRoutes from './routes/assistant.js';
import scraperRoutes from './routes/scraper.js';
import socialRoutes from './routes/social.js';
import listingRoutes from './routes/listings.js';
import fbReceiptRoutes from './routes/fbReceipts.js';
import objectRoutes from './routes/objects.js';
import publicDataRoutes from './routes/publicData.js';
import pushRoutes from './routes/push.js';
import { startScraperWorker } from './lib/scraper.js';
import { startSecurityMonitor } from './lib/security.js';
import { seedDemoData } from './seed.js';

export async function buildApp() {
  const app = Fastify({
    logger: isProd
      ? { level: 'info' }
      : { level: 'debug', transport: undefined },
    bodyLimit: 15 * 1024 * 1024,
    trustProxy: true,
  });

  // --- CORS ---------------------------------------------------------------
  const origins =
    env.CORS_ORIGINS.trim() === '*'
      ? true
      : env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  await app.register(cors, { origin: origins, credentials: false });

  // --- JWT ----------------------------------------------------------------
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { algorithm: 'HS256' },
  });

  // --- Rate limit ---------------------------------------------------------
  await app.register(rateLimit, {
    global: true,
    max: isProd ? 300 : 2000,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: { code: 'rate_limited', message: 'Твърде много заявки. Опитай отново след минута.' },
    }),
  });

  // --- Multipart (качване на снимки) --------------------------------------
  await app.register(multipart, {
    limits: {
      fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
      files: 1,
      fields: 10,
    },
  });

  // --- Сурово тяло за Stripe webhook-а ------------------------------------
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = body as Buffer;
      const text = (body as Buffer).toString('utf8');
      if (!text) return done(null, {});
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // --- Качените снимки ----------------------------------------------------
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  await app.register(fastifyStatic, {
    root: env.UPLOAD_DIR,
    prefix: '/uploads/',
    decorateReply: false,
    maxAge: '7d',
  });

  // --- Единен формат на грешките ------------------------------------------
  app.setErrorHandler((err, _req, reply) => {
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'rate_limited', message: 'Твърде много заявки. Опитай отново след минута.' },
      });
    }

    // Грешки на Fastify с клиентски статус (415, 413, 400...) се връщат както са,
    // вместо да се превръщат в 500. Така клиентът вижда истинската причина.
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const code = (err as { code?: string }).code ?? 'bad_request';
      const isFastifyInternal = typeof code === 'string' && code.startsWith('FST_ERR');

      // Вътрешните грешки на Fastify имат технически текст — даваме разбираемо съобщение.
      // Всички останали (напр. от Stripe) пазят истинската причина, за да може да се
      // диагностицира, вместо да се крие зад „Невалидна заявка“.
      const generic: Record<number, string> = {
        400: 'Невалидна заявка.',
        404: 'Няма такъв endpoint.',
        413: 'Тялото на заявката е твърде голямо.',
        415: 'Неподдържан тип съдържание. Изпрати Content-Type: application/json.',
        422: 'Подадените данни са невалидни.',
      };

      if (!isFastifyInternal) {
        // eslint-disable-next-line no-console
        console.error(`[api] ${status} ${code}: ${(err as Error).message}`);
      }

      return reply.status(status).send({
        error: {
          code,
          message: isFastifyInternal
            ? generic[status] ?? 'Невалидна заявка.'
            : (err as Error).message || generic[status] || 'Невалидна заявка.',
          // Детайлите се пазят: клиентът ги ползва (напр. кой имейл не е потвърден).
          ...((err as { details?: unknown }).details !== undefined
            ? { details: (err as { details?: unknown }).details }
            : {}),
        },
      });
    }

    return sendError(reply, err);
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'Няма такъв endpoint.' } })
  );

  // --- Здраве -------------------------------------------------------------
  app.get('/api/health', async () => {
    const db = await one<{ ok: number }>('select 1 as ok');
    return {
      status: 'ok',
      database: db?.ok === 1,
      features: {
        ocr: features.ocr,
        payments: features.payments,
        mail: features.mail,
        assistant: features.assistant,
      },
      time: new Date().toISOString(),
    };
  });

  // --- Маршрути -----------------------------------------------------------
  await app.register(authRoutes);
  await app.register(postRoutes);
  await app.register(commentRoutes);
  await app.register(mediaRoutes);
  await app.register(donationRoutes);
  await app.register(communityRoutes);
  // Преглед на споделени оферти (само за ботовете на WhatsApp/Facebook/…)
  await app.register(ogRoutes);
  // Поканален цикъл: код, покани и карта „Спестих X €“
  await app.register(referralRoutes);
  // Томболи: условие → пъзел за време → най-бързият печели
  await app.register(raffleRoutes);
  // Админ панелът (отделен дашборд): статистики, CRUD, спиране на профили,
  // аларми за ненормална активност
  await app.register(adminRoutes);
  // AI съветникът „Ценко“ — чат, който познава приложението и подканя към действие
  await app.register(assistantRoutes);
  // Скраперът на онлайн магазини (само от админ панела)
  await app.register(scraperRoutes);
  await app.register(socialRoutes);
  await app.register(listingRoutes);
  // Сваляне и AI разчитане на касови бележки от публични Facebook групи (с одобрение)
  await app.register(fbReceiptRoutes);
  await app.register(objectRoutes);
  await app.register(publicDataRoutes);
  await app.register(pushRoutes);

  /* ---------------------------------------------------------------------
   *  Спрени/изтрити профили и активност.
   *
   *  Всяка ПИШЕЩА заявка с валиден токен минава през проверка: спрян профил
   *  не може да пише, докато трае спирането (за вход има отделна проверка в
   *  /api/auth/login и /api/auth/refresh). Заедно с това отбелязваме кога
   *  човекът е бил за последно в приложението — това храни статистиката
   *  „колко души влязоха днес“ в админ панела.
   * ------------------------------------------------------------------- */
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;

    let userId: string;
    try {
      const payload = req.server.jwt.verify<{ sub?: string; typ?: string }>(header.slice(7).trim());
      if (payload.typ !== 'access' || !payload.sub) return;
      userId = payload.sub;
    } catch {
      return; // невалиден токен → маршрутът сам ще върне 401
    }

    const row = await one<{
      suspended_at: string | null;
      suspended_until: string | null;
      suspended_reason: string | null;
      deleted_at: string | null;
    }>('select suspended_at, suspended_until, suspended_reason, deleted_at from profiles where id = $1', [
      userId,
    ]);

    if (!row || row.deleted_at) {
      return reply.status(403).send({
        error: { code: 'account_deleted', message: 'Този профил е изтрит.' },
      });
    }
    if (row.suspended_at && (!row.suspended_until || new Date(row.suspended_until) > new Date())) {
      return reply.status(403).send({
        error: {
          code: 'account_suspended',
          message: `Профилът ти е спрян временно.${
            row.suspended_reason ? ` Причина: ${row.suspended_reason}` : ''
          }`,
          details: { reason: row.suspended_reason ?? null, until: row.suspended_until ?? null },
        },
      });
    }

    // Лека отметка за активност — пише се най-много веднъж на 5 минути на човек.
    void one(
      `update profiles set last_seen_at = now()
        where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '5 minutes')
        returning id`,
      [userId]
    ).catch(() => undefined);
  });

  return app;
}

async function main() {
  await runMigrations();

  if (env.SEED_DEMO_DATA) {
    await seedDemoData();
  }

  const app = await buildApp();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(
    `SmartPrice API слуша на :${env.PORT} — OCR: ${features.ocr ? 'да' : 'НЕ'}, плащания: ${
      features.payments ? 'да' : 'НЕ'
    }`
  );

  // Браузърът, с който четем цените на JS магазините, се вдига ОЩЕ СЕГА (във
  // фона). Иначе първият човек, натиснал „Провери цената в магазина“, чака
  // 5–8 сек само за студеното стартиране на Chromium.
  void prewarmBrowser().then((ok) => {
    app.log.info(ok ? 'Браузърът за проверка на цени е вдигнат предварително' : 'Браузър за проверка на цени: няма');
  });

  // Следене за ненормална активност — проверява на всеки 5 минути и праща
  // имейл на ALERT_EMAIL, ако намери нещо (напр. подбиране на пароли).
  if (isProd) {
    startSecurityMonitor(5 * 60 * 1000);
    app.log.info(`Следене за ненормална активност: включено → ${env.ALERT_EMAIL}`);
  } else {
    startSecurityMonitor(10 * 60 * 1000);
  }

  // Скраперът: подхваща чакащи задачи от базата (и възстановява прекъснати).
  // Работи във всеки режим — иначе „пуснах задача“ щеше да виси завинаги.
  await startScraperWorker();
  app.log.info('Скрапер на магазини: работникът е включен');

  // Самообучението на Ценко (AI съветникът): наръчникът от файла + живите
  // факти от базата. Веднъж на ден в 03:30 и веднага, ако знанието е старо.
  startCenkoTrainer((message) => app.log.info(message));
  // 🤖 Седмичното проучване на TikTok/Instagram. Включва се от панела
  // (🎬 Социални мрежи → 🤖 Автоматизация) — по подразбиране е ИЗКЛЮЧЕНО.
  startSocialScheduler((message) => app.log.info(message));

  const shutdown = async (signal: string) => {
    app.log.info(`Получен ${signal} — затварям...`);
    await app.close().catch(() => undefined);
    await closePool().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[SmartPrice API] Фатална грешка при старт:', err);
  process.exit(1);
});
