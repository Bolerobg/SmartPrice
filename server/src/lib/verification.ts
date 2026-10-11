import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one } from '../db.js';
import { env } from '../env.js';
import { badRequest, tooManyRequests } from './errors.js';
import { sendPasswordResetEmail, sendVerificationEmail } from './email.js';

export type VerificationPurpose = 'email_verify' | 'password_reset';

const BCRYPT_ROUNDS = 10; // кодът живее 15 мин → 10 кръга са достатъчни и бързи

/** 6-цифрен код, без водещи нули да се губят. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Ограничава колко кода може да поиска един имейл за час. */
async function assertNotRateLimited(email: string): Promise<void> {
  const row = await one<{ count: string }>(
    `select count(*)::text as count
       from email_verifications
      where email = $1 and created_at > now() - interval '1 hour'`,
    [email]
  );
  const count = Number(row?.count ?? 0);
  if (count >= env.VERIFICATION_MAX_PER_HOUR) {
    throw tooManyRequests(
      'Поиска твърде много кодове. Изчакай малко преди да опиташ пак.'
    );
  }
}

/**
 * Създава нов код, обезсилва старите и го изпраща по имейл.
 * Връща кода само в development, за да може да се тества без поща.
 */
export async function issueCode(params: {
  email: string;
  purpose: VerificationPurpose;
  name: string;
}): Promise<{ sent: boolean; devCode?: string }> {
  await assertNotRateLimited(params.email);

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);

  // Старите неизползвани кодове за същата цел се обезсилят, за да е валиден само последният
  await one(
    `update email_verifications
        set consumed_at = now()
      where email = $1 and purpose = $2 and consumed_at is null`,
    [params.email, params.purpose]
  );

  await one(
    `insert into email_verifications (email, purpose, code_hash, expires_at)
     values ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [params.email, params.purpose, codeHash, String(env.VERIFICATION_CODE_TTL_MIN)]
  );

  if (params.purpose === 'email_verify') {
    await sendVerificationEmail({ to: params.email, code, name: params.name });
  } else {
    await sendPasswordResetEmail({ to: params.email, code, name: params.name });
  }

  // В development връщаме кода, за да не се блокира тестването. В продукция — никога.
  // Двойна защита: трябва И NODE_ENV != production, И изрично EXPOSE_DEV_CODES=true.
  // Така дори при грешно зададен NODE_ENV в продукция кодът не се показва.
  const exposeDevCode = env.NODE_ENV !== 'production' && env.EXPOSE_DEV_CODES;
  return { sent: true, devCode: exposeDevCode ? code : undefined };
}

/**
 * Проверява код. Хвърля при грешка. При успех маркира кода като използван.
 * Пази се броят грешни опити — след лимита кодът се обезсиля.
 */
export async function consumeCode(params: {
  email: string;
  purpose: VerificationPurpose;
  code: string;
}): Promise<void> {
  const row = await one<{
    id: string;
    code_hash: string;
    attempts: number;
    expired: boolean;
  }>(
    `select id, code_hash, attempts, (expires_at < now()) as expired
       from email_verifications
      where email = $1 and purpose = $2 and consumed_at is null
      order by created_at desc
      limit 1`,
    [params.email, params.purpose]
  );

  if (!row) {
    throw badRequest('Няма активен код за този имейл. Поискай нов.');
  }
  if (row.expired) {
    throw badRequest('Кодът е изтекъл. Поискай нов.');
  }
  if (row.attempts >= env.VERIFICATION_MAX_ATTEMPTS) {
    throw badRequest('Твърде много грешни опити. Поискай нов код.');
  }

  const matches = await bcrypt.compare(params.code, row.code_hash);
  if (!matches) {
    await one(`update email_verifications set attempts = attempts + 1 where id = $1`, [
      row.id,
    ]);
    const left = env.VERIFICATION_MAX_ATTEMPTS - (row.attempts + 1);
    throw badRequest(
      left > 0
        ? `Грешен код. Остават ти ${left} ${left === 1 ? 'опит' : 'опита'}.`
        : 'Грешен код. Кодът е обезсилен — поискай нов.'
    );
  }

  await one(`update email_verifications set consumed_at = now() where id = $1`, [row.id]);
}

/** Само за разработка: последният издаден код (за тестове без достъп до пощата). */
export async function peekLastCodeHash(email: string, purpose: VerificationPurpose) {
  return one<{ code_hash: string }>(
    `select code_hash from email_verifications
      where email = $1 and purpose = $2
      order by created_at desc limit 1`,
    [email, purpose]
  );
}
