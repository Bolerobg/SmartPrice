import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../env.js';

/**
 * Къде живеят снимките.
 *
 * По подразбиране — на диска на сървъра (както беше). При `STORAGE_DRIVER=s3`
 * отиват в S3-съвместимо хранилище (Cloudflare R2, MinIO, Backblaze, AWS S3).
 *
 * Защо това е важно: снимките са най-големият трафик в едно такова приложение.
 * Ако стоят на сървъра, всяко отваряне на оферта минава през него и яде порта
 * (200–600 Mbit/s при Contabo). Когато са в R2 зад Cloudflare, Cloudflare ги
 * кешира на ръба и сървърът почти не се товари.
 *
 * Старите снимки продължават да се сервират от диска — нищо не се чупи, ако
 * включиш S3 по-късно.
 */
export type StorageDriver = 'local' | 's3';

export const storageDriver: StorageDriver = env.STORAGE_DRIVER;
export const usesS3 = storageDriver === 's3';

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;

  client = new S3Client({
    // R2 иска да има region, но не го ползва. За AWS подай истинския регион.
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    // R2 работи с виртуален хост (bucket.endpoint). MinIO иска path-style —
    // затова е настройка, а не константа.
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });

  return client;
}

/** Пълният ключ в кофата, напр. `uploads/abc-123.jpg`. */
function keyOf(storedName: string): string {
  const prefix = env.S3_KEY_PREFIX.replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${storedName}` : storedName;
}

/** Публичният адрес, който приложението показва. */
export function publicUrl(storedName: string): string {
  if (usesS3) {
    return `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${keyOf(storedName)}`;
  }
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/uploads/${storedName}`;
}

/** Локалният път — ползва се само при драйвер `local`. */
export function localPath(storedName: string): string {
  return path.join(env.UPLOAD_DIR, storedName);
}

export async function putImage(
  storedName: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  if (!usesS3) {
    await writeFile(localPath(storedName), body);
    return;
  }

  await s3().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: keyOf(storedName),
      Body: body,
      ContentType: contentType,
      // Снимките никога не се променят (името е UUID) → кеширай смело.
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
}

/**
 * Чете снимка, независимо къде е. Ползва се от OCR-а, който трябва да
 * изпрати самите байтове към vision модела.
 */
export async function getImage(
  storedName: string,
  driver: StorageDriver = storageDriver
): Promise<Buffer> {
  if (driver === 's3') {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: keyOf(storedName) })
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Празен обект от S3: ${storedName}`);
    return Buffer.from(bytes);
  }

  return readFile(localPath(storedName));
}

export async function deleteImage(
  storedName: string,
  driver: StorageDriver = storageDriver
): Promise<void> {
  if (driver === 's3') {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await s3().send(
      new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: keyOf(storedName) })
    );
    return;
  }

  await unlink(localPath(storedName)).catch(() => undefined);
}
