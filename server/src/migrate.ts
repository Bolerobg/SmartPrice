import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Работи както в dev (tsx src/), така и в компилиран dist/ и в Docker образ. */
function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(here, '../migrations'), // dist/migrate.js → server/migrations
    path.resolve(here, '../../migrations'), // src/migrate.ts → server/migrations
    path.resolve(process.cwd(), 'migrations'),
    '/app/migrations',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `Не намирам папка migrations. Пробвани пътища:\n${candidates.join('\n')}`
  );
}

export async function runMigrations(log = true): Promise<string[]> {
  const dir = resolveMigrationsDir();
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  await pool.query(`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await pool.query<{ filename: string }>('select filename from schema_migrations')).rows.map(
      (r) => r.filename
    )
  );

  const justApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (filename) values ($1)', [file]);
      await client.query('commit');
      justApplied.push(file);
      if (log) console.log(`[migrate] приложена: ${file}`);
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw new Error(`Миграцията ${file} се провали: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  if (log) {
    console.log(
      justApplied.length
        ? `[migrate] готово (${justApplied.length} нови)`
        : '[migrate] няма нови миграции'
    );
  }
  return justApplied;
}

// Директно изпълнение: `npm run migrate`
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  runMigrations()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[migrate] ГРЕШКА:', err.message);
      await pool.end().catch(() => undefined);
      process.exit(1);
    });
}
