import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadPosts } from '../lib/feed.js';
import { env } from '../env.js';

/**
 * Преглед на споделена оферта (Open Graph).
 *
 * Защо съществува: WhatsApp, Viber, Facebook, Telegram и т.н. НЕ изпълняват
 * JavaScript — те само четат HTML-а на линка. Нашето приложение е SPA, т.е.
 * всеки линк връща един и същ index.html без информация за конкретната оферта
 * → прегледът излизаше празен/общ.
 *
 * Затова nginx праща само ботовете (по user-agent) тук, а този endpoint връща
 * малък HTML само с OG таговете. Хората продължават да получават SPA-то.
 */

const BASE = env.PUBLIC_BASE_URL.replace(/\/+$/, '');

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clamp(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function isAbsoluteImage(url: string | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

export default async function ogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/og/post/:id', async (req, reply) => {
    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);

    const notFoundHtml = `<!doctype html><html lang="bg"><head>
<meta charset="utf-8" />
<meta name="robots" content="noindex" />
<title>Офертата не е намерена — SmartPrice</title>
</head><body style="font-family:system-ui;background:#0B1424;color:#F8FAFC;padding:40px;text-align:center">
<h1 style="font-size:20px">Офертата не е намерена</h1>
<p style="color:#94A3B8">Възможно е да е изтрита.</p>
<p><a style="color:#22D3EE" href="${esc(BASE)}">Отвори SmartPrice</a></p>
</body></html>`;

    if (!parsed.success) {
      reply.type('text/html; charset=utf-8').code(404).send(notFoundHtml);
      return;
    }

    const id = parsed.data.id;
    const [post] = await loadPosts({ postId: id, limit: 1, offset: 0 }, null).catch(() => []);

    if (!post) {
      reply.type('text/html; charset=utf-8').code(404).send(notFoundHtml);
      return;
    }

    const verdict =
      post.polarity === 'green' ? '🟢 ТОП НАХОДКА' : '🔴 ЧЕРВЕН ФЛАГ — НЕ ХОДИ!';

    const title = `${verdict} · ${post.placeName}, ${post.city}`;

    const descriptionParts = [
      post.title,
      `Платено: ${post.pricePaid.toFixed(2)} ${post.currency}`,
    ];
    if (post.referencePrice && post.referencePrice > post.pricePaid) {
      descriptionParts.push(
        `Спестени: ${(post.referencePrice - post.pricePaid).toFixed(2)} ${post.currency}`
      );
    }
    if (post.receipt) descriptionParts.push('🧾 Доказано с касова бележка');
    if (post.description) descriptionParts.push(post.description);

    const description = clamp(descriptionParts.join(' · '), 300);
    const image = isAbsoluteImage(post.imageUri)
      ? post.imageUri
      : `${BASE}/icon-512.png`;
    const url = `${BASE}/post/${post.id}`;

    const html = `<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} — SmartPrice</title>
<meta name="description" content="${esc(description)}" />

<meta property="og:type" content="article" />
<meta property="og:site_name" content="SmartPrice" />
<meta property="og:locale" content="bg_BG" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:image:alt" content="${esc(clamp(post.title, 120))}" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(image)}" />

<meta name="theme-color" content="#0B1424" />
<link rel="icon" href="${esc(BASE)}/favicon.ico" sizes="any" />
<link rel="apple-touch-icon" href="${esc(BASE)}/apple-touch-icon.png" />
<link rel="canonical" href="${esc(url)}" />
</head>
<body style="font-family:system-ui;background:#0B1424;color:#F8FAFC;padding:32px;text-align:center">
<p style="color:#94A3B8;font-size:14px">Отваряме офертата в SmartPrice…</p>
<p><a style="color:#22D3EE;font-size:15px" href="${esc(url)}">Продължи към офертата</a></p>
<script>location.replace(${JSON.stringify(url)});</script>
</body>
</html>`;

    reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .send(html);
  });
}
