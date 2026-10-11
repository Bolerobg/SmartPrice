import { createWriteStream } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one } from '../db.js';
import { env, features } from '../env.js';
import { requireUserId } from '../lib/auth.js';
import { badRequest, tooLarge, unavailable } from '../lib/errors.js';
import { currencyLabel } from '../lib/mappers.js';

const ALLOWED_MIME = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const ocrSchema = z.object({
  imageUrl: z.string().min(1).max(600),
  categoryHint: z.string().max(40).optional(),
  polarityHint: z.enum(['green', 'red']).optional(),
});

interface RawOcrItem {
  name?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  totalPrice?: unknown;
  highlightReason?: unknown;
}

interface RawOcrResult {
  merchantName?: unknown;
  merchantTaxId?: unknown;
  date?: unknown;
  time?: unknown;
  totalAmount?: unknown;
  currency?: unknown;
  confidenceScore?: unknown;
  items?: unknown;
}

const num = (value: unknown, fallback = 0): number => {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const str = (value: unknown, max = 200): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

/**
 * Извиква реален vision модел през OpenRouter и връща структурирани данни.
 * Няма „демо“ fallback — ако няма ключ, endpoint-ът казва честно, че OCR не е наличен.
 */
async function callOpenRouter(imageDataUrl: string, categoryHint?: string, polarityHint?: string) {
  const response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': env.PUBLIC_BASE_URL,
      'X-Title': 'SmartPrice BG',
    },
    body: JSON.stringify({
      model: env.OCR_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'Ти си OCR двигател за български фискални касови бележки и фактури.',
            'Прочети САМО това, което реално виждаш на снимката. НИКОГА не измисляй търговец, ЕИК, дата или артикули.',
            'Ако нещо не се чете, върни null за него (или празен масив за артикули).',
            'Върни СТРИКТНО JSON с тази форма:',
            '{"merchantName":string|null,"merchantTaxId":string|null,"date":"DD.MM.YYYY"|null,"time":"HH:MM"|null,',
            '"totalAmount":number,"currency":"BGN"|"EUR","confidenceScore":number,',
            '"items":[{"name":string,"quantity":number,"unitPrice":number,"totalPrice":number,"highlightReason":string|null}]}',
            'highlightReason попълвай само при реално видима аномалия (напр. „Скрита такса куверт“, „Намален грамаж“).',
            'confidenceScore е между 0 и 1 и отразява колко сигурно е разчитането.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Разчети касовата бележка. Категория на контекста: ${categoryHint ?? 'обща'}. Тип: ${polarityHint ?? 'green'}.`,
            },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw unavailable(
      `Vision моделът върна грешка (${response.status}). ${body.slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw unavailable('Vision моделът не върна съдържание.');

  let parsed: RawOcrResult;
  try {
    parsed = JSON.parse(content) as RawOcrResult;
  } catch {
    throw unavailable('Vision моделът не върна валиден JSON.');
  }

  const rawItems = Array.isArray(parsed.items) ? (parsed.items as RawOcrItem[]) : [];
  const items = rawItems
    .map((item) => {
      const name = str(item.name, 200);
      if (!name) return null;
      const quantity = num(item.quantity, 1) || 1;
      const unitPrice = num(item.unitPrice, 0);
      const totalPrice = num(item.totalPrice, Number((quantity * unitPrice).toFixed(2)));
      return {
        id: randomUUID(),
        name,
        quantity,
        unitPrice: Number(unitPrice.toFixed(2)),
        totalPrice: Number(totalPrice.toFixed(2)),
        highlightReason: str(item.highlightReason, 200),
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null);

  const itemsTotal = Number(items.reduce((acc, i) => acc + i.totalPrice, 0).toFixed(2));
  const totalAmount = num(parsed.totalAmount, itemsTotal);

  return {
    merchantName: str(parsed.merchantName, 200) ?? 'Неразчетен търговец',
    merchantTaxId: str(parsed.merchantTaxId, 40),
    date: str(parsed.date, 40),
    time: str(parsed.time, 20),
    totalAmount: Number(totalAmount.toFixed(2)),
    // Валутата по подразбиране е EUR — България е в еврозоната.
    currency: currencyLabel(parsed.currency === 'BGN' ? 'BGN' : 'EUR'),
    currencyCode: parsed.currency === 'BGN' ? 'BGN' : 'EUR',
    confidenceScore: Math.min(1, Math.max(0, num(parsed.confidenceScore, 0))),
    verifiedByAi: true,
    items,
    model: env.OCR_MODEL,
  };
}

export default async function mediaRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------- Качване на снимка
  app.post('/api/uploads', async (req, reply) => {
    const userId = requireUserId(req);

    const file = await req.file();
    if (!file) throw badRequest('Не е изпратен файл.');

    const extension = ALLOWED_MIME.get(file.mimetype);
    if (!extension) {
      throw badRequest('Позволени формати: JPEG, PNG, WebP.');
    }

    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    const storedName = `${randomUUID()}.${extension}`;
    const target = path.join(env.UPLOAD_DIR, storedName);

    await mkdir(env.UPLOAD_DIR, { recursive: true });

    let bytes = 0;
    let aborted = false;
    file.file.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        aborted = true;
        file.file.destroy(new Error('too_large'));
      }
    });

    try {
      await pipeline(file.file, createWriteStream(target));
    } catch (err) {
      await unlink(target).catch(() => undefined);
      if (aborted || (err as Error).message === 'too_large') {
        throw tooLarge(`Снимката е твърде голяма (макс. ${env.MAX_UPLOAD_MB} MB).`);
      }
      throw err;
    }

    if (bytes === 0) {
      await unlink(target).catch(() => undefined);
      throw badRequest('Файлът е празен.');
    }

    await one(
      `insert into uploads (owner_id, stored_name, mime_type, byte_size)
       values ($1,$2,$3,$4) returning id`,
      [userId, storedName, file.mimetype, bytes]
    );

    return reply.status(201).send({
      url: `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/uploads/${storedName}`,
      byteSize: bytes,
      mimeType: file.mimetype,
    });
  });

  // ------------------------------------------------------------- Реален OCR
  app.post('/api/ocr/receipt', async (req) => {
    requireUserId(req);
    const input = ocrSchema.parse(req.body);

    if (!features.ocr) {
      throw unavailable(
        'OCR не е конфигуриран: липсва OPENROUTER_API_KEY. Добави ключ в .env и рестартирай API-то.'
      );
    }

    let imageDataUrl = input.imageUrl;
    if (!imageDataUrl.startsWith('data:')) {
      // Приемаме само наши собствени качени файлове (без SSRF към произволни адреси)
      const prefix = `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/uploads/`;
      if (!imageDataUrl.startsWith(prefix)) {
        throw badRequest('Снимката трябва да е качена през /api/uploads.');
      }
      const storedName = imageDataUrl.slice(prefix.length);
      const upload = await one<{ mime_type: string }>(
        'select mime_type from uploads where stored_name = $1',
        [storedName]
      );
      if (!upload) throw badRequest('Файлът не е намерен.');

      const buffer = await readFile(path.join(env.UPLOAD_DIR, storedName));
      imageDataUrl = `data:${upload.mime_type};base64,${buffer.toString('base64')}`;
    }

    const result = await callOpenRouter(imageDataUrl, input.categoryHint, input.polarityHint);
    return { receipt: result };
  });

  app.get('/api/health/features', async () => ({
    ocr: features.ocr,
    payments: features.payments,
    mail: features.mail,
    ocrModel: features.ocr ? env.OCR_MODEL : null,
  }));
}
