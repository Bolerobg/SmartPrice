/**
 * 🤖 СЕДМИЧНО АВТОМАТИЧНО ПРОУЧВАНЕ НА TIKTOK/INSTAGRAM.
 *
 * Работи ВЪТРЕ в API-то (не иска crontab, токени и пароли на сървъра) — същият
 * модел като обучението на Ценко. Затова панелът може да го ВКЛЮЧИ и ИЗКЛЮЧИ с
 * едно копче, да покаже кога е следващото пускане и какво е станало на последното.
 *
 * Нарочно е „глупаво просто“: на всеки 5 минути проверява дали сме в уговорения
 * ден и час (българско време) и дали днес вече не е пускано. Така:
 *   • изключването от панела действа веднага (следващата проверка го вижда);
 *   • няма скрити състояния — всичко се пази в `app_settings`;
 *   • пускането се вижда в „📜 История“ като всички останали, с бележка „Автоматично“.
 */
import { getSetting, setSetting } from './settings.js';
import { startSocialScan, socialRunning } from './socialScrape.js';

const KEY = 'social_auto';
const LAST_KEY = 'social_auto_last';

export interface SocialAuto {
  /** Главен ключ — изключен = нищо не се пуска само. */
  enabled: boolean;
  /** 0 = неделя … 6 = събота (както е в JavaScript). */
  weekday: number;
  hour: number;
  minute: number;
  /** Кои платформи да се пускат. */
  tiktok: boolean;
  instagram: boolean;
  /** Как търсим: 'search' (думи) или 'hashtag'. */
  mode: string;
  /** Темите — по една на ред. */
  topics: string;
  minViews: number;
  maxResults: number;
  excludeAds: boolean;
  /** Пусни веднага едно проучване, щом сървърът тръгне (за проба). */
  runOnStart: boolean;
}

const DEFAULTS: SocialAuto = {
  enabled: false, // по подразбиране ИЗКЛЮЧЕНО — харчи пари, включва се от човека
  weekday: 0, // неделя
  hour: 20,
  minute: 0,
  tiktok: true,
  instagram: false, // иска вход, затова по подразбиране не
  mode: 'search',
  topics: 'цени в магазина\nскъпотия\nспестяване',
  minViews: 10000,
  maxResults: 30,
  excludeAds: false, // рекламите ни трябват — показват какво правят конкурентите
  runOnStart: false,
};

export async function getSocialAuto(): Promise<SocialAuto> {
  try {
    const raw = await getSetting(KEY, '');
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SocialAuto>) };
  } catch {
    return DEFAULTS;
  }
}

export async function setSocialAuto(patch: Partial<SocialAuto>): Promise<SocialAuto> {
  const next = { ...(await getSocialAuto()), ...patch };
  next.weekday = Math.max(0, Math.min(6, Math.floor(next.weekday)));
  next.hour = Math.max(0, Math.min(23, Math.floor(next.hour)));
  next.minute = Math.max(0, Math.min(59, Math.floor(next.minute)));
  next.maxResults = Math.max(5, Math.min(200, Math.floor(next.maxResults) || 30));
  next.minViews = Math.max(0, Math.floor(next.minViews) || 0);
  await setSetting(KEY, JSON.stringify(next));
  return next;
}

const WEEKDAYS_BG = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];

/** Ден и час в България — сървърът може да е на друго време. */
function sofiaNow(): { weekday: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sofia',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(parts.weekday));
  return { weekday: idx < 0 ? 0 : idx, hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** Кога е следващото пускане — за да го покажем в панела. */
export function nextRunAt(s: SocialAuto): string | null {
  if (!s.enabled) return null;
  const now = sofiaNow();
  let daysAhead = (s.weekday - now.weekday + 7) % 7;
  const nowMin = now.hour * 60 + now.minute;
  const wantMin = s.hour * 60 + s.minute;
  if (daysAhead === 0 && nowMin >= wantMin) daysAhead = 7;
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(s.hour, s.minute, 0, 0);
  return d.toISOString();
}

interface LastAuto {
  at: string;
  found: number;
  note: string;
}

async function lastAuto(): Promise<LastAuto | null> {
  try {
    const raw = await getSetting(LAST_KEY, '');
    return raw ? (JSON.parse(raw) as LastAuto) : null;
  } catch {
    return null;
  }
}

export async function socialAutoStatus() {
  const settings = await getSocialAuto();
  const last = await lastAuto();
  return {
    settings,
    weekdayLabel: `${WEEKDAYS_BG[settings.weekday]} в ${String(settings.hour).padStart(2, '0')}:${String(
      settings.minute
    ).padStart(2, '0')} (българско време)`,
    nextRunAt: nextRunAt(settings),
    last,
  };
}

/** Едно автоматично проучване: минава през включените платформи една по една. */
export async function runSocialAuto(trigger: 'auto' | 'manual'): Promise<{ started: number; results: string[] }> {
  const s = await getSocialAuto();
  const targets = s.topics
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
  const results: string[] = [];
  let started = 0;
  if (!targets.length) return { started, results: ['Няма теми за търсене (виж ⚙️ Настройки).'] };

  const platforms: Array<'tiktok' | 'instagram'> = [];
  if (s.tiktok) platforms.push('tiktok');
  if (s.instagram) platforms.push('instagram');

  for (const platform of platforms) {
    // Изчакваме предишното да свърши — иначе ще си пречат и ще харчат два пъти.
    for (let i = 0; i < 60 && (await socialRunning()); i += 1) {
      await new Promise((r) => setTimeout(r, 5_000));
    }
    const res = await startSocialScan({
      platform,
      mode: s.mode,
      targets,
      options: {
        resultsPerPage: s.maxResults,
        resultsLimit: s.maxResults,
        minViews: s.minViews,
        excludeAds: s.excludeAds,
        sortBy: 'views',
      },
      trigger: trigger === 'auto' ? 'Автоматично (седмично)' : 'Пуснато на ръка от панела',
    });
    if (res.started) started += 1;
    results.push(`${platform}: ${res.started ? 'пуснато' : res.reason ?? 'не тръгна'}`);
  }

  await setSetting(
    LAST_KEY,
    JSON.stringify({ at: new Date().toISOString(), found: started, note: results.join(' · ') })
  ).catch(() => undefined);
  return { started, results };
}

/**
 * Планировчикът. Проверява на всеки 5 минути. Изключването от панела действа
 * веднага, защото настройките се четат наново при всяка проверка.
 */
export function startSocialScheduler(log: (message: string) => void): void {
  const TICK_MS = 5 * 60 * 1000;
  let busy = false;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const s = await getSocialAuto();
      if (s.enabled) {
        const now = sofiaNow();
        const sameDay = now.weekday === s.weekday;
        // Прозорец от 5 минути — точността на проверката.
        const dueMinute = now.hour === s.hour && now.minute >= s.minute && now.minute < s.minute + 5;
        const last = await lastAuto();
        const ranToday =
          last && new Date(last.at).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
        if (sameDay && dueMinute && !ranToday) {
          log('🤖 Социални мрежи: автоматично седмично проучване започва.');
          const r = await runSocialAuto('auto');
          log(`🤖 Социални мрежи: ${r.results.join(' · ') || 'нищо не тръгна'}`);
        }
      }
    } catch (err) {
      log(`Планировчикът на социалните мрежи се спъна: ${(err as Error)?.message ?? err}`);
    } finally {
      busy = false;
    }
  };

  // Първа проверка след минута — за да не се бие със старта на сървъра.
  setTimeout(() => void tick(), 60_000);
  setInterval(() => void tick(), TICK_MS);

  // Пробно пускане при старт, ако човекът го е отметнал.
  setTimeout(
    () =>
      void (async () => {
        const s = await getSocialAuto();
        if (s.enabled && s.runOnStart) {
          log('🤖 Социални мрежи: пробно пускане при старт (отметка в панела).');
          await runSocialAuto('manual');
        }
      })(),
    2 * 60 * 1000
  );
}
