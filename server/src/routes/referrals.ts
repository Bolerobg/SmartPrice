import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { loadPosts } from '../lib/feed.js';
import { requireUserId } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import {
  claimReferral,
  findInviterByCode,
  loadReferralSummary,
  normalizeCode,
  referralLink,
} from '../lib/referrals.js';
import { renderStoryCard } from '../lib/storyCard.js';

/** Изчиства потребителски текст, който влиза в картинката. */
function clean(value: string | undefined, max: number): string {
  if (!value) return '';
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export default async function referralRoutes(app: FastifyInstance) {
  // ------------------------------------------------------- Моите покани + код
  app.get('/api/referrals/me', async (req) => {
    const userId = requireUserId(req);
    return loadReferralSummary(userId);
  });

  // ------------------------------------------------- Проверка на код (публично)
  // Ползва се на екрана за регистрация: „Кодът е на Иван“ вместо нищо.
  app.get('/api/referrals/check', async (req) => {
    const { code } = z.object({ code: z.string().trim().min(3).max(32) }).parse(req.query);
    const inviter = await findInviterByCode(code);
    if (!inviter) return { valid: false as const };
    return {
      valid: true as const,
      inviterName: inviter.name,
      inviterHandle: inviter.handle,
      inviterAvatar: inviter.avatar_url ?? '',
      link: referralLink(normalizeCode(code)),
    };
  });

  // ------------------------------- „Залепване“ на код за вече създаден профил
  app.post('/api/referrals/claim', async (req) => {
    const userId = requireUserId(req);
    const { code } = z.object({ code: z.string().trim().min(3).max(32) }).parse(req.body);
    return claimReferral({ userId, codeRaw: code });
  });

  // -------------------------------------------- Карта „Спестих X €“ (PNG 9:16)
  const cardQuery = z.object({
    /** Оферта, за която е картата (тогава сумата се смята от базата). */
    post: z.string().uuid().optional(),
    /** Или директна сума (общо спестени на потребителя). */
    total: z.coerce.number().min(0).max(10_000_000).optional(),
    name: z.string().max(120).optional(),
    code: z.string().max(32).optional(),
    posts: z.coerce.number().int().min(0).max(100000).optional(),
  });

  const cardHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = cardQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('Невалидни параметри за картата.');
    const q = parsed.data;

    const code = normalizeCode(q.code);
    let payload;

    if (q.post) {
      const [post] = await loadPosts({ postId: q.post, limit: 1, offset: 0 }, null).catch(() => []);
      if (!post) throw notFound('Офертата не е намерена.');
      const reference = post.referencePrice ?? 0;
      const paid = post.pricePaid ?? 0;
      const saved = reference > paid ? reference - paid : 0;
      payload = {
        kind: 'post' as const,
        amount: Math.round(saved * 100) / 100,
        title: post.title,
        place: post.placeName,
        city: post.city,
        polarity: post.polarity,
        paid,
        reference,
        code,
      };
    } else {
      const total = q.total ?? 0;
      payload = {
        kind: 'total' as const,
        amount: Math.round(total * 100) / 100,
        name: clean(q.name, 40),
        postsCount: q.posts,
        code,
      };
    }

    const png = await renderStoryCard(payload);
    return reply
      .type('image/png')
      .header('Cache-Control', 'public, max-age=600')
      .header('Content-Disposition', `inline; filename="smartprice-karta.png"`)
      .send(png);
  };

  // .png за красиви линкове в чатове; без разширение — за директна употреба.
  app.get('/api/referrals/card.png', cardHandler as never);
  app.get('/api/referrals/card', cardHandler as never);
}
