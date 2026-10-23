/**
 * ⏰ КОГА СЕ ПРАЩА СЕДМИЧНИЯТ ДАЙДЖЕСТ.
 *
 * Работи вътре в API-то (като обучението на Ценко) — не иска crontab на сървъра
 * и не зависи от Hermes да е буден:
 *   • всеки ПОНЕДЕЛНИК в 09:00 българско време — когато хората са на работа и
 *     планират пазаруването за седмицата (петък вечер е твърде късно);
 *   • ако известието е закъсняло с повече от 7 дни (сървърът е бил спрян),
 *     пращаме го веднага при старт, за да не се губи седмица.
 *
 * Ако предпочиташ класически cron:
 *   0 9 * * 1 curl -s -X POST https://smartprice.bg/api/admin/digest/run -H "Authorization: Bearer <токен>"
 */
import { getSetting } from './settings.js';
import { sendWeeklyDigest } from './digest.js';

const HOUR_SOFIA = 9;
const MINUTE_SOFIA = 0;
/** Ако последният дайджест е по-стар от това, пращаме при старт. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Колко милисекунди до следващия понеделник 09:00 българско време. */
function msUntilNextMonday(): number {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sofia',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const weekday = get('weekday'); // Mon, Tue…
  const h = Number(get('hour'));
  const m = Number(get('minute'));
  const s = Number(get('second'));

  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const today = Math.max(0, order.indexOf(weekday));
  let daysAhead = (0 - today + 7) % 7; // 0 = днес е понеделник
  const nowMinutes = h * 60 + m;
  const targetMinutes = HOUR_SOFIA * 60 + MINUTE_SOFIA;
  if (daysAhead === 0 && nowMinutes >= targetMinutes) daysAhead = 7;

  const minutesLeft = daysAhead * 24 * 60 + (targetMinutes - nowMinutes);
  return Math.max(60_000, (minutesLeft * 60 - s) * 1000);
}

export function startDigestScheduler(log: (message: string) => void): void {
  const run = async (why: string, startupGuard = false) => {
    try {
      const enabled = (await getSetting('push_digest_enabled', 'on')) !== 'off';
      if (!enabled) {
        log('📨 Седмичният дайджест е изключен от панела — прескачам.');
        return;
      }
      const res = await sendWeeklyDigest({ startupGuard });
      log(`📨 ${why}: ${res.note}`);
    } catch (err) {
      log(`Дайджестът не мина: ${(err as Error)?.message ?? err}`);
    }
  };

  // 1) При старт — само ако е закъснял повече от седмица.
  setTimeout(() => {
    void (async () => {
      const last = await getSetting('push_digest_last_run', '');
      const age = last ? Date.now() - new Date(last).getTime() : Number.POSITIVE_INFINITY;
      if (age > STALE_MS) {
        // startupGuard: не пращаме, ако последният дайджест е бил преди <5 дни
        // (пази от повторение при няколко рестарта/деплоя един след друг).
        await run('Закъснял дайджест — пращам сега', true);
      }
      scheduleNext();
    })();
  }, 90_000);

  function scheduleNext(): void {
    const wait = msUntilNextMonday();
    log(`📨 Следващ седмичен дайджест след ${Math.round(wait / 3_600_000)} ч (понеделник 09:00).`);
    setTimeout(() => {
      void (async () => {
        await run('Седмичен дайджест (понеделник 09:00)');
        scheduleNext();
      })();
    }, wait);
  }
}
