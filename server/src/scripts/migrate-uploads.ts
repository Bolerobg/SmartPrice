import { many, query } from '../db.js';
import { env } from '../env.js';
import { getImage, putImage, usesS3 } from '../lib/storage.js';

/**
 * Прехвърля вече качените снимки от диска в S3 (Cloudflare R2).
 *
 * Пуска се веднъж, след като включиш STORAGE_DRIVER=s3:
 *   docker exec smartprice-api node dist/scripts/migrate-uploads.js
 *
 * Безопасно е да се пусне няколко пъти — прехвърля само редовете, които още
 * са със storage='local', и не пипа вече прехвърлените. Ако нещо се счупи
 * по средата, просто го пусни пак.
 */
async function main(): Promise<void> {
  if (!usesS3) {
    // eslint-disable-next-line no-console
    console.error(
      '[migrate-uploads] STORAGE_DRIVER не е s3 — няма къде да се прехвърля. Спри.'
    );
    process.exit(1);
  }

  const rows = await many<{ stored_name: string; mime_type: string }>(
    `select stored_name, mime_type from uploads
      where storage = 'local'
      order by created_at`
  );

  // eslint-disable-next-line no-console
  console.log(`[migrate-uploads] за прехвърляне: ${rows.length} файла → ${env.S3_BUCKET}`);

  let done = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // driver='local' нарочно: четем от диска, където още е файлът.
      const buffer = await getImage(row.stored_name, 'local');
      await putImage(row.stored_name, buffer, row.mime_type);
      await query(`update uploads set storage = 's3' where stored_name = $1`, [
        row.stored_name,
      ]);
      done += 1;
      if (done % 25 === 0) {
        // eslint-disable-next-line no-console
        console.log(`  … ${done}/${rows.length}`);
      }
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`  ✗ ${row.stored_name}: ${(err as Error).message}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[migrate-uploads] готово: ${done} прехвърлени, ${failed} неуспешни`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[migrate-uploads] фатална грешка:', err);
  process.exit(1);
});
