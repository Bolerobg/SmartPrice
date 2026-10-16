/**
 * ДНЕВНИКЪТ НА ОБУЧЕНИЕТО — кога Ценко се самообучава сам.
 *
 * Работи вътре в API-то (не иска crontab, токени и пароли на сървъра):
 *   • при стартиране: ако последното обучение е по-старо от 20 часа (или никога
 *     не е било), обучава веднага — така след всеки деплой/рестарт знанието е
 *     прясно, дори някой да е забравил да натисне бутона;
 *   • после: всеки ден в 03:30 българско време.
 *
 * Ако предпочиташ класически cron на сървъра, върши същата работа:
 *   30 3 * * * curl -s -X POST https://smartprice.bg/api/admin/assistant/retrain \
 *     -H "Authorization: Bearer <админ токен>" > /dev/null
 */
import { lastRetrain, logRetrain, retrainCenko, ensureRetrainLog } from './cenkoKnowledge.js';

const HOUR_SOFIA = 3;
const MINUTE_SOFIA = 30;
/** Ако последното обучение е по-старо от това, обучаваме веднага при старт. */
const STALE_MS = 20 * 60 * 60 * 1000;

/** След колко милисекунди идва следващите 03:30 българско време. */
function msUntilNextRun(): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sofia',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .format(now)
    .split(':')
    .map(Number);
  const [h, m, s] = parts;
  let minutesLeft = HOUR_SOFIA * 60 + MINUTE_SOFIA - (h * 60 + m);
  if (minutesLeft <= 0) minutesLeft += 24 * 60;
  return (minutesLeft * 60 - s) * 1000;
}

export function startCenkoTrainer(log: (message: string) => void): void {
  void ensureRetrainLog();

  const run = async (trigger: 'auto' | 'manual') => {
    try {
      const report = await retrainCenko();
      await logRetrain(report, trigger);
      log(`🧠 Ценко се самообучи: ${report.note ?? ''}`);
    } catch (err) {
      log(`Ценко не успя да се самообучи: ${(err as Error)?.message ?? err}`);
    }
  };

  // 1) При старт — само ако знанието е старо.
  setTimeout(() => {
    void (async () => {
      const last = await lastRetrain();
      const age = last ? Date.now() - new Date(last.at).getTime() : Number.POSITIVE_INFINITY;
      if (age > STALE_MS) {
        log('Знанието на Ценко е старо — обучавам го сега.');
        await run('auto');
      }
      // 2) После всеки ден в 03:30 (българско време).
      const daily = async () => {
        await run('auto');
        setTimeout(() => void daily(), msUntilNextRun());
      };
      setTimeout(() => void daily(), msUntilNextRun());
      log(`Следващо самообучение на Ценко след ${Math.round(msUntilNextRun() / 60000)} мин.`);
    })();
  }, 90_000);
}
