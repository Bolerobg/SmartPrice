import { z } from 'zod';

/**
 * Всички настройки се валидират при старт. Ако нещо липсва или е невалидно,
 * сървърът пада веднага с ясно съобщение, вместо да тръгне „полу-работещ“.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL е задължителен'),

  JWT_SECRET: z.string().min(24, 'JWT_SECRET трябва да е поне 24 символа'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),

  PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
  UPLOAD_DIR: z.string().default('/data/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(50).default(12),
  CORS_ORIGINS: z.string().default('*'),

  OPENROUTER_API_KEY: z.string().optional().default(''),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OCR_MODEL: z.string().default('google/gemini-2.5-flash'),

  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  STRIPE_CURRENCY: z.string().default('eur'),

  // Имейли (кодове за потвърждение и забравена парола) през Resend
  RESEND_API_KEY: z.string().optional().default(''),
  MAIL_FROM: z.string().default('SmartPrice <info@human.lookthis.online>'),
  // Колко минути е валиден един код
  VERIFICATION_CODE_TTL_MIN: z.coerce.number().int().positive().max(120).default(15),
  // Колко кода може да поиска един имейл за 1 час
  VERIFICATION_MAX_PER_HOUR: z.coerce.number().int().positive().max(20).default(5),
  // Колко грешни опита се толерират преди кодът да се обезсили
  VERIFICATION_MAX_ATTEMPTS: z.coerce.number().int().positive().max(20).default(5),
  // САМО ЗА РАЗРАБОТКА: връща кода в отговора, за да се тества без поща.
  // Работи само ако NODE_ENV != production. В продукция е забранено.
  EXPOSE_DEV_CODES: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  SEED_DEMO_DATA: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n[SmartPrice API] Невалидна конфигурация:\n${details}\n`);
  process.exit(1);
}

export const env = parsed.data;

export const features = {
  ocr: Boolean(env.OPENROUTER_API_KEY),
  payments: Boolean(env.STRIPE_SECRET_KEY),
  mail: Boolean(env.RESEND_API_KEY),
} as const;

export const isProd = env.NODE_ENV === 'production';
