import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, tx } from '../db.js';
import { optionalUserId, requireUserId } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { mapComment, type CommentRow } from '../lib/mappers.js';

const createSchema = z.object({
  text: z.string().trim().max(2000).default(''),
  imageUrl: z.string().max(600).optional(),
  reportedPrice: z.coerce.number().positive().max(1_000_000).optional(),
});

const COMMENT_SELECT = `
  select c.*, a.name as author_name, a.handle as author_handle,
         a.avatar_url as author_avatar, a.is_supporter as author_is_supporter
    from comments c
    join profiles a on a.id = c.author_id
`;

export default async function commentRoutes(app: FastifyInstance) {
  app.get('/api/posts/:id/comments', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await one<{ exists: boolean }>(
      `select true as exists from posts where id = $1 and status = 'published'`,
      [id]
    );
    if (!rows) throw notFound('Публикацията не е намерена.');

    const comments = await many<CommentRow>(
      `${COMMENT_SELECT} where c.post_id = $1 and c.status = 'published' order by c.created_at asc`,
      [id]
    );
    return { items: comments.map(mapComment) };
  });

  app.post('/api/posts/:id/comments', async (req, reply) => {
    const userId = requireUserId(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = createSchema.parse(req.body);

    const post = await one(`select 1 from posts where id = $1 and status = 'published'`, [id]);
    if (!post) throw notFound('Публикацията не е намерена.');

    const text =
      input.text.trim() ||
      (input.reportedPrice
        ? `Актуална снимка с цена: ${input.reportedPrice.toFixed(2)} €`
        : 'Прикачена снимка с цена');

    if (!text.trim() && !input.imageUrl) {
      throw badRequest('Коментарът не може да е празен.');
    }

    const created = await one<{ id: string }>(
      `insert into comments (post_id, author_id, body, image_url, reported_price)
       values ($1,$2,$3,$4,$5) returning id`,
      [id, userId, text, input.imageUrl ?? null, input.reportedPrice ?? null]
    );

    await one(
      `update profiles set interactions_since_prompt = interactions_since_prompt + 1,
                           reputation_points = reputation_points + 3
        where id = $1 returning id`,
      [userId]
    );

    const row = await one<CommentRow>(`${COMMENT_SELECT} where c.id = $1`, [created!.id]);
    return reply.status(201).send({ comment: mapComment(row!) });
  });

  app.post('/api/comments/:commentId/like', async (req) => {
    const userId = requireUserId(req);
    const { commentId } = z.object({ commentId: z.string().uuid() }).parse(req.params);

    const exists = await one(`select 1 from comments where id = $1 and status = 'published'`, [commentId]);
    if (!exists) throw notFound('Коментарът не е намерен.');

    const liked = await tx(async (client) => {
      const del = await client.query('delete from comment_likes where comment_id = $1 and user_id = $2', [
        commentId,
        userId,
      ]);
      if (del.rowCount) return false;
      await client.query('insert into comment_likes (comment_id, user_id) values ($1,$2)', [
        commentId,
        userId,
      ]);
      return true;
    });

    const row = await one<CommentRow>(`${COMMENT_SELECT} where c.id = $1`, [commentId]);
    return { liked, comment: row ? mapComment(row) : null };
  });

  app.delete('/api/comments/:commentId', async (req) => {
    const userId = requireUserId(req);
    const { commentId } = z.object({ commentId: z.string().uuid() }).parse(req.params);

    const comment = await one<{ author_id: string }>('select author_id from comments where id = $1', [
      commentId,
    ]);
    if (!comment) throw notFound('Коментарът не е намерен.');
    if (comment.author_id !== userId) throw forbidden('Само авторът може да изтрие коментара.');

    await one(`update comments set status = 'removed' where id = $1 returning id`, [commentId]);
    return { ok: true };
  });

  app.post('/api/comments/:commentId/report', async (req) => {
    const userId = requireUserId(req);
    const { commentId } = z.object({ commentId: z.string().uuid() }).parse(req.params);
    const input = z
      .object({
        reason: z.enum(['false_info', 'defamation', 'spam', 'personal_data', 'other']),
        details: z.string().trim().max(1000).optional(),
      })
      .parse(req.body);

    const exists = await one('select 1 from comments where id = $1', [commentId]);
    if (!exists) throw notFound('Коментарът не е намерен.');

    await one(
      `insert into content_reports (reporter_id, comment_id, reason, details)
       values ($1,$2,$3,$4) returning id`,
      [userId, commentId, input.reason, input.details ?? null]
    );
    return { ok: true, message: 'Сигналът е приет и ще бъде прегледан от модератор.' };
  });
}
