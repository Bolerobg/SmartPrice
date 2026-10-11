import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import { badRequest, unauthorized } from './errors.js';

const BCRYPT_ROUNDS = 12;

export interface AccessTokenPayload {
  sub: string;
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  typ: 'refresh';
  ver: number;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function signAccessToken(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId, typ: 'access' } satisfies AccessTokenPayload, {
    expiresIn: env.JWT_ACCESS_TTL,
  });
}

export function signRefreshToken(app: FastifyInstance, userId: string, ver = 1): string {
  return app.jwt.sign(
    { sub: userId, typ: 'refresh', ver } satisfies RefreshTokenPayload,
    { expiresIn: env.JWT_REFRESH_TTL }
  );
}

/** Чете Bearer токена и връща id на потребителя. Хвърля 401 при липса/невалидност. */
export function requireUserId(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized('Липсва токен за достъп.');
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = req.server.jwt.verify<AccessTokenPayload>(token);
    if (payload.typ !== 'access' || !payload.sub) throw new Error('грешен тип токен');
    return payload.sub;
  } catch {
    throw unauthorized('Токенът е невалиден или е изтекъл.');
  }
}

/** Връща id на потребителя или null, без да хвърля (за публични endpoint-и с „моите“ данни). */
export function optionalUserId(req: FastifyRequest): string | null {
  try {
    return requireUserId(req);
  } catch {
    return null;
  }
}

/**
 * Транслитерация кирилица → латиница.
 * Задължителна е, защото @handle-овете са само с латински букви (виж
 * constraint profiles_handle_format), а потребителите пишат имена на кирилица.
 */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
  т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht',
  ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};

export function transliterate(input: string): string {
  return input
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('');
}

export function normalizeHandle(input: string): string {
  const latin = transliterate(input);
  const cleaned = latin
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_.]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');

  const safe = cleaned.length >= 3 ? cleaned : `user_${Date.now().toString(36).slice(-4)}`;
  return `@${safe.slice(0, 28)}`;
}

export function assertPasswordStrength(password: string): void {
  if (password.length < 8) {
    throw badRequest('Паролата трябва да е поне 8 символа.');
  }
  if (!/[A-Za-zА-Яа-я]/.test(password) || !/[0-9]/.test(password)) {
    throw badRequest('Паролата трябва да съдържа поне една буква и една цифра.');
  }
}
