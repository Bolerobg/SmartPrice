/**
 * Гарантира, че админ профилът съществува и може да влезе.
 *
 * Защо: томболите се управляват от конкретен човек (ADMIN_EMAILS). Ако профилът
 * липсва или паролата е забравена, не искаме да разчитаме на имейл потвърждение —
 * затова скриптът (1) създава профила, ако го няма, (2) маркира имейла като потвърден,
 * (3) слага паролата, която е подадена, и (4) дава роля admin.
 *
 * Употреба (в контейнера):
 *   ADMIN_PASSWORD='...' node dist/scripts/ensure-admin.js
 */
import { env } from '../env.js';
import { one, query, closePool } from '../db.js';
import { hashPassword, normalizeHandle } from '../lib/auth.js';
import { isAdminEmail } from '../lib/raffles.js';

async function uniqueHandle(base: string): Promise<string> {
  const root = normalizeHandle(base).slice(0, 28);
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? root : `${root}${i + 1}`;
    const taken = await one('select 1 from profiles where handle = $1', [candidate]);
    if (!taken) return candidate;
  }
  return `${root}${Date.now().toString().slice(-5)}`;
}

async function main() {
  const emails = env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const password = process.env.ADMIN_PASSWORD || '';
  const name = process.env.ADMIN_NAME || 'Кольо Христов';

  if (!emails.length) {
    console.log('[ensure-admin] ADMIN_EMAILS е празен — няма какво да правя.');
    return;
  }

  for (const email of emails) {
    const existing = await one<{ id: string }>('select id from profiles where email = $1', [email]);
    if (existing) {
      const sets = ['email_verified_at = coalesce(email_verified_at, now())', "role = 'admin'"];
      const values: unknown[] = [existing.id];
      if (password) {
        values.push(await hashPassword(password));
        sets.push(`password_hash = $${values.length}`);
      }
      await query(`update profiles set ${sets.join(', ')} where id = $1`, values);
      // значките за томболи трябва да съществуват и за този профил
      await query(
        `insert into profile_badges (profile_id, badge_id)
         select $1, id from badges where id in ('badge-raffle-play','badge-raffle-win')
         on conflict (profile_id, badge_id) do nothing`,
        [existing.id]
      );
      console.log(`[ensure-admin] ${email}: админ права${password ? ' + нова парола' : ''} (съществуващ профил)`);
      continue;
    }

    const handle = await uniqueHandle(name);
    const hash = password ? await hashPassword(password) : await hashPassword(`Tmp${Date.now()}!a`);
    const created = await one<{ id: string }>(
      `insert into profiles (email, password_hash, name, handle, city, email_verified_at, role)
       values ($1, $2, $3, $4, 'София', now(), 'admin')
       returning id`,
      [email, hash, name, handle]
    );
    await query(
      `insert into profile_badges (profile_id, badge_id)
       select $1, id from badges on conflict (profile_id, badge_id) do nothing`,
      [created!.id]
    );
    console.log(`[ensure-admin] ${email}: създаден админ профил ${handle}`);
  }

  console.log(`[ensure-admin] готово. Админи: ${emails.join(', ')}`);
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[ensure-admin] ГРЕШКА:', (err as Error).message);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
