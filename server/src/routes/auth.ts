import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, tx } from '../db.js';
import { env } from '../env.js';
import {
  assertPasswordStrength,
  hashPassword,
  normalizeHandle,
  requireUserId,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
} from '../lib/auth.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { loadFullProfile } from '../lib/profile.js';

const registerSchema = z.object({
  email: z.string().email('Невалиден имейл.').max(160),
  // Силата на паролата се проверява на едно място (assertPasswordStrength),
  // за да има един последователен отговор (400) вместо два различни кода.
  password: z.string().min(1, 'Паролата е задължителна.').max(200),
  name: z.string().trim().min(2, 'Името е задължително.').max(80),
  city: z.string().trim().min(2).max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().email('Невалиден имейл.'),
  password: z.string().min(1, 'Паролата е задължителна.'),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    bio: z.string().trim().max(400).optional(),
    city: z.string().trim().min(2).max(80).optional(),
    avatarUrl: z.string().url().max(600).optional(),
  })
  .strict();

const refreshSchema = z.object({ refreshToken: z.string().min(10) });

/** Прави уникален @handle от име/имейл, добавяйки число при заетост. */
async function uniqueHandle(base: string): Promise<string> {
  const root = normalizeHandle(base).slice(0, 28);
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? root : `${root}${i + 1}`;
    const taken = await one('select 1 from profiles where handle = $1', [candidate]);
    if (!taken) return candidate;
  }
  return `${root}${Date.now().toString().slice(-5)}`;
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (req, reply) => {
    const input = registerSchema.parse(req.body);
    assertPasswordStrength(input.password);

    const email = input.email.toLowerCase();
    const existing = await one('select 1 from profiles where email = $1', [email]);
    if (existing) throw conflict('Вече има регистрация с този имейл.');

    const handle = await uniqueHandle(input.name || email.split('@')[0] || 'user');
    const passwordHash = await hashPassword(input.password);

    const created = await tx(async (client) => {
      const res = await client.query<{ id: string }>(
        `insert into profiles (email, password_hash, name, handle, city)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [email, passwordHash, input.name, handle, input.city ?? 'София']
      );
      const id = res.rows[0]!.id;
      // начални значки — заключени, отключват се с активност
      await client.query(
        `insert into profile_badges (profile_id, badge_id)
         select $1, id from badges on conflict do nothing`,
        [id]
      );
      return id;
    });

    const profile = await loadFullProfile(created);
    return reply.status(201).send({
      accessToken: signAccessToken(app, created),
      refreshToken: signRefreshToken(app, created),
      expiresIn: env.JWT_ACCESS_TTL,
      profile,
    });
  });

  app.post('/api/auth/login', async (req) => {
    const input = loginSchema.parse(req.body);
    const email = input.email.toLowerCase();

    const row = await one<{ id: string; password_hash: string }>(
      'select id, password_hash from profiles where email = $1',
      [email]
    );

    // Еднакво съобщение за грешен имейл и грешна парола (без изтичане на информация)
    if (!row || !(await verifyPassword(input.password, row.password_hash))) {
      throw unauthorized('Грешен имейл или парола.');
    }

    const profile = await loadFullProfile(row.id);
    return {
      accessToken: signAccessToken(app, row.id),
      refreshToken: signRefreshToken(app, row.id),
      expiresIn: env.JWT_ACCESS_TTL,
      profile,
    };
  });

  app.post('/api/auth/refresh', async (req) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    let userId: string;
    try {
      const payload = app.jwt.verify<{ sub: string; typ: string }>(refreshToken);
      if (payload.typ !== 'refresh') throw new Error('грешен тип');
      userId = payload.sub;
    } catch {
      throw unauthorized('Сесията е изтекла. Влез отново.');
    }

    const exists = await one('select 1 from profiles where id = $1', [userId]);
    if (!exists) throw unauthorized('Профилът вече не съществува.');

    return {
      accessToken: signAccessToken(app, userId),
      refreshToken: signRefreshToken(app, userId),
      expiresIn: env.JWT_ACCESS_TTL,
      profile: await loadFullProfile(userId),
    };
  });

  app.get('/api/auth/me', async (req) => {
    const userId = requireUserId(req);
    return { profile: await loadFullProfile(userId) };
  });

  app.patch('/api/auth/me', async (req) => {
    const userId = requireUserId(req);
    const input = updateSchema.parse(req.body);

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (input.name !== undefined) push('name', input.name);
    if (input.bio !== undefined) push('bio', input.bio);
    if (input.city !== undefined) push('city', input.city);
    if (input.avatarUrl !== undefined) push('avatar_url', input.avatarUrl);

    if (!sets.length) throw badRequest('Няма какво да се обнови.');

    values.push(userId);
    await one(
      `update profiles set ${sets.join(', ')} where id = $${values.length} returning id`,
      values
    );

    return { profile: await loadFullProfile(userId) };
  });
}
