import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, tx } from '../db.js';
import { env, features } from '../env.js';
import {
  assertPasswordStrength,
  hashPassword,
  normalizeHandle,
  requireUserId,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
} from '../lib/auth.js';
import { AppError, badRequest, conflict, unauthorized } from '../lib/errors.js';
import { loadFullProfile } from '../lib/profile.js';
import { consumeCode, issueCode } from '../lib/verification.js';
import { attachReferral } from '../lib/referrals.js';

const registerSchema = z.object({
  email: z.string().email('Невалиден имейл.').max(160),
  // Силата на паролата се проверява на едно място (assertPasswordStrength),
  // за да има един последователен отговор (400) вместо два различни кода.
  password: z.string().min(1, 'Паролата е задължителна.').max(200),
  name: z.string().trim().min(2, 'Името е задължително.').max(80),
  city: z.string().trim().min(2).max(80).optional(),
  // Код за покана от приятел (по избор). Невалиден код НЕ чупи регистрацията.
  ref: z.string().trim().max(32).optional(),
  // Откъде е дошъл (whatsapp/viber/story-card…) — за да знаем кой канал работи.
  refChannel: z.string().trim().max(32).optional(),
});

const loginSchema = z.object({
  email: z.string().email('Невалиден имейл.'),
  password: z.string().min(1, 'Паролата е задължителна.'),
});

const codeSchema = z.object({
  email: z.string().email('Невалиден имейл.'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Кодът е 6 цифри.'),
});

const resendSchema = z.object({
  email: z.string().email('Невалиден имейл.'),
  purpose: z.enum(['email_verify', 'password_reset']).default('email_verify'),
});

const resetSchema = z.object({
  email: z.string().email('Невалиден имейл.'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Кодът е 6 цифри.'),
  newPassword: z.string().min(1, 'Новата парола е задължителна.').max(200),
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

function sessionPayload(app: FastifyInstance, userId: string, profile: unknown) {
  return {
    accessToken: signAccessToken(app, userId),
    refreshToken: signRefreshToken(app, userId),
    expiresIn: env.JWT_ACCESS_TTL,
    profile,
  };
}

export default async function authRoutes(app: FastifyInstance) {
  /**
   * Регистрация. Профилът се създава НЕпотвърден и НЕ връща токени —
   * потребителят трябва първо да въведе кода от имейла си.
   */
  app.post('/api/auth/register', async (req, reply) => {
    const input = registerSchema.parse(req.body);
    assertPasswordStrength(input.password);

    const email = input.email.toLowerCase();
    const existing = await one<{ email_verified_at: string | null }>(
      'select email_verified_at from profiles where email = $1',
      [email]
    );

    if (existing && existing.email_verified_at) {
      throw conflict('Вече има потвърден профил с този имейл. Влез или смени паролата.');
    }

    let userId: string;

    if (existing) {
      // Има недовършена регистрация — обновяваме данните и пращаме нов код,
      // вместо да блокираме потребителя с „имейлът е зает“.
      const passwordHash = await hashPassword(input.password);
      await one(
        `update profiles set password_hash = $2, name = $3, city = $4 where email = $1 returning id`,
        [email, passwordHash, input.name, input.city ?? 'София']
      );
      const row = await one<{ id: string }>('select id from profiles where email = $1', [email]);
      userId = row!.id;
    } else {
      const handle = await uniqueHandle(input.name || email.split('@')[0] || 'user');
      const passwordHash = await hashPassword(input.password);

      userId = await tx(async (client) => {
        const res = await client.query<{ id: string }>(
          `insert into profiles (email, password_hash, name, handle, city, email_verified_at)
           values ($1, $2, $3, $4, $5, null)
           returning id`,
          [email, passwordHash, input.name, handle, input.city ?? 'София']
        );
        const id = res.rows[0]!.id;
        await client.query(
          `insert into profile_badges (profile_id, badge_id)
           select $1, id from badges on conflict do nothing`,
          [id]
        );
        return id;
      });
    }

    // Поканата се записва сега, но точките се дават чак при потвърден имейл
    // (иначе един човек може да си направи 100 профила и да трупа точки).
    const referral = await attachReferral({
      inviteeId: userId,
      codeRaw: input.ref,
      channel: input.refChannel ?? 'link',
    }).catch(() => ({ applied: false } as const));

    const { devCode } = await issueCode({
      email,
      purpose: 'email_verify',
      name: input.name,
    });

    return reply.status(201).send({
      requiresVerification: true,
      email,
      referralApplied: referral.applied,
      referralInviterName: referral.applied ? referral.inviterName : undefined,
      emailSent: features.mail,
      message: features.mail
        ? 'Изпратихме 6-цифрен код на имейла ти. Въведи го, за да активираш профила.'
        : 'Профилът е създаден, но изпращането на имейли не е конфигурирано на сървъра.',
      devCode,
    });
  });

  /** Потвърждаване на имейл с кода от писмото. При успех влиза директно. */
  app.post('/api/auth/verify-email', async (req) => {
    const input = codeSchema.parse(req.body);
    const email = input.email.toLowerCase();

    await consumeCode({ email, purpose: 'email_verify', code: input.code });

    const row = await one<{ id: string }>(
      `update profiles set email_verified_at = now()
        where email = $1 returning id`,
      [email]
    );
    if (!row) throw badRequest('Няма профил с този имейл.');

    return sessionPayload(app, row.id, await loadFullProfile(row.id));
  });

  /** Повторно изпращане на код (с ограничение за честота). */
  app.post('/api/auth/resend-code', async (req) => {
    const input = resendSchema.parse(req.body);
    const email = input.email.toLowerCase();

    const row = await one<{ name: string; email_verified_at: string | null }>(
      'select name, email_verified_at from profiles where email = $1',
      [email]
    );

    // Не издаваме кодове за непознати имейли (освен за смяна на парола, където
    // отговаряме еднакво, за да не издаваме кой имейл съществува).
    if (!row) {
      if (input.purpose === 'password_reset') {
        return { sent: true, emailSent: features.mail, message: 'Ако имаш профил, изпратихме код.' };
      }
      throw badRequest('Няма профил с този имейл.');
    }

    if (input.purpose === 'email_verify' && row.email_verified_at) {
      return { sent: false, alreadyVerified: true, message: 'Този имейл вече е потвърден.' };
    }

    const { devCode } = await issueCode({
      email,
      purpose: input.purpose,
      name: row.name,
    });

    return {
      sent: true,
      emailSent: features.mail,
      message: 'Изпратихме нов код. Провери имейла си (и папка „Спам“).',
      devCode,
    };
  });

  /** Заявка за нова парола. Отговаря еднакво, независимо дали имейлът съществува. */
  app.post('/api/auth/forgot-password', async (req) => {
    const input = resendSchema.pick({ email: true }).parse(req.body);
    const email = input.email.toLowerCase();

    const row = await one<{ name: string }>('select name from profiles where email = $1', [email]);

    let devCode: string | undefined;
    if (row) {
      try {
        const res = await issueCode({ email, purpose: 'password_reset', name: row.name });
        devCode = res.devCode;
      } catch (err) {
        // Твърде много заявки — не казваме нищо различно, за да не издадем,
        // че имейлът съществува. Просто не пращаме нов код.
        if (!(err instanceof AppError && err.statusCode === 429)) throw err;
      }
    }

    return {
      ok: true,
      emailSent: features.mail,
      message:
        'Ако имаш профил с този имейл, изпратихме код за нова парола. Провери и папка „Спам“.',
      devCode,
    };
  });

  /** Задаване на нова парола с кода от писмото. */
  app.post('/api/auth/reset-password', async (req) => {
    const input = resetSchema.parse(req.body);
    assertPasswordStrength(input.newPassword);

    const email = input.email.toLowerCase();
    await consumeCode({ email, purpose: 'password_reset', code: input.code });

    const passwordHash = await hashPassword(input.newPassword);
    const row = await one<{ id: string }>(
      `update profiles set password_hash = $2, email_verified_at = coalesce(email_verified_at, now())
        where email = $1 returning id`,
      [email, passwordHash]
    );
    if (!row) throw badRequest('Няма профил с този имейл.');

    // Смяната на паролата влиза директно — кодът вече е доказателство за самоличност.
    return sessionPayload(app, row.id, await loadFullProfile(row.id));
  });

  app.post('/api/auth/login', async (req) => {
    const input = loginSchema.parse(req.body);
    const email = input.email.toLowerCase();

    const row = await one<{ id: string; password_hash: string; email_verified_at: string | null }>(
      'select id, password_hash, email_verified_at from profiles where email = $1',
      [email]
    );

    // Еднакво съобщение за грешен имейл и грешна парола (без изтичане на информация)
    if (!row || !(await verifyPassword(input.password, row.password_hash))) {
      throw unauthorized('Грешен имейл или парола.');
    }

    // Паролата е вярна, но имейлът не е потвърден → казваме точно това,
    // за да може приложението да заведе потребителя на екрана с кода.
    if (!row.email_verified_at) {
      throw new AppError(
        403,
        'email_not_verified',
        'Профилът още не е потвърден. Въведи кода от имейла си.',
        { email }
      );
    }

    return sessionPayload(app, row.id, await loadFullProfile(row.id));
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

    return sessionPayload(app, userId, await loadFullProfile(userId));
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
