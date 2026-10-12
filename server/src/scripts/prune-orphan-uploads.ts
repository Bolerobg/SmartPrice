import { readdir, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { many } from '../db.js';
import { env } from '../env.js';

/**
 * Намира снимки на диска, които вече никой не ползва, и ги маха.
 *
 * Как се получават сираци: при изтрит профил или оферта редът в `uploads`
 * изчезва (on delete cascade), но файлът остава на диска завинаги. Така
 * плащаш за място на боклук, а при прехвърляне към R2 ще го качваш напразно.
 *
 * По подразбиране САМО ПОКАЗВА какво би изтрило. За да изтрие наистина:
 *   docker exec smartprice-api node dist/scripts/prune-orphan-uploads.js --delete
 */
async function main(): Promise<void> {
  const shouldDelete = process.argv.includes('--delete');

  let files: string[];
  try {
    files = await readdir(env.UPLOAD_DIR);
  } catch {
    // eslint-disable-next-line no-console
    console.log(`[prune-uploads] няма папка ${env.UPLOAD_DIR} — нищо за чистене.`);
    return;
  }

  const rows = await many<{ stored_name: string }>('select stored_name from uploads');
  const known = new Set(rows.map((r) => r.stored_name));

  const orphans = files.filter((f) => !known.has(f));
  let freed = 0;

  for (const name of orphans) {
    try {
      const info = await stat(path.join(env.UPLOAD_DIR, name));
      freed += info.size;
    } catch {
      /* вече го няма */
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[prune-uploads] файлове на диска: ${files.length}, познати в базата: ${known.size}, ` +
      `сираци: ${orphans.length} (${(freed / 1024 / 1024).toFixed(2)} MB)`
  );
  for (const name of orphans.slice(0, 50)) {
    // eslint-disable-next-line no-console
    console.log(`  • ${name}`);
  }
  if (orphans.length > 50) {
    // eslint-disable-next-line no-console
    console.log(`  … и още ${orphans.length - 50}`);
  }

  if (!shouldDelete) {
    // eslint-disable-next-line no-console
    console.log('[prune-uploads] пробен режим — нищо не е изтрито. Добави --delete.');
    return;
  }

  let removed = 0;
  for (const name of orphans) {
    await unlink(path.join(env.UPLOAD_DIR, name)).catch(() => undefined);
    removed += 1;
  }
  // eslint-disable-next-line no-console
  console.log(`[prune-uploads] изтрити ${removed} файла, освободени ${(freed / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[prune-uploads] грешка:', err);
  process.exit(1);
});
