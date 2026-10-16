/**
 * САМООБУЧЕНИЕ НА ЦЕНКО.
 *
 * Ценко знае две неща:
 *   1. Наръчникът — големият файл `knowledge/cenko-narachnik.md` (43+ теми с
 *      обяснения на всеки екран, бутон и правило). Тук той се разчита и се
 *      записва в таблицата `assistant_knowledge` (source='file').
 *   2. ЖИВИТЕ ФАКТИ — какво има в приложението В МОМЕНТА: значките, категориите,
 *      активната томбола, настройките. Генерират се от базата при всяко
 *      самообучение (source='auto'), затова Ценко никога не остарява.
 *
 * Кога се пуска:
 *   • ръчно от админ панела — бутонът „🧠 Самообучение сега“;
 *   • автоматично — веднъж на ден (по подразбиране 03:30), плюс веднага след
 *     стартиране на сървъра, ако последното обучение е по-старо от 20 часа.
 *
 * Защо така, а не с cron: няма нужда от токени, пароли и crontab на сървъра —
 * обучението е част от API-то и се самолекува след рестарт. (Cron също работи:
 * `POST /api/admin/assistant/retrain` с админ токен.)
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { many, one, query } from '../db.js';
import { getSetting, setSetting } from './settings.js';
import { invalidateKnowledgeCache } from '../routes/assistant.js';

/** Къде живее наръчникът (първият съществуващ път се ползва). */
const CANDIDATE_PATHS = [
  process.env.CENKO_MANUAL ?? '',
  '/app/knowledge/cenko-narachnik.md',
  path.join(process.cwd(), 'knowledge', 'cenko-narachnik.md'),
  path.join(process.cwd(), 'server', 'knowledge', 'cenko-narachnik.md'),
  path.join(process.cwd(), '..', 'knowledge', 'cenko-narachnik.md'),
].filter(Boolean);

const CATEGORIES = new Set(['basics', 'points', 'receipts', 'raffles', 'safety', 'news']);

export interface ManualTopic {
  title: string;
  body: string;
  keywords: string[];
  category: string;
  priority: number;
}

export interface RetrainReport {
  ok: boolean;
  at: string;
  /** Колко теми дойдоха от файла-наръчник. */
  fromManual: number;
  /** Колко живи факта се обновиха от базата. */
  liveFacts: number;
  /** Колко теми са изключени (махнати от файла / стари „seed“ теми). */
  disabled: number;
  /** Общо активни теми след обучението. */
  active: number;
  /** Откъде е прочетен файлът (ако е намерен). */
  manualPath?: string;
  /** Съобщение за човека в панела. */
  note?: string;
}

/* ------------------------------------------------------------ разчитане */

/** Разчита наръчника: всяка тема започва с `## Заглавие`, после метаданни и `---`. */
export function parseManual(text: string): ManualTopic[] {
  // Махаме примерния формат (ограденото с ```), за да не влезе като тема.
  const clean = text.replace(/```[\s\S]*?```/g, '');
  const topics: ManualTopic[] = [];

  const blocks = clean.split(/^##\s+/m).slice(1);
  for (const block of blocks) {
    const lines = block.split('\n');
    const title = (lines[0] ?? '').trim();
    let body: string[] = [];
    let keywords: string[] = [];
    let category = 'basics';
    let priority = 5;
    let afterSep = false;

    for (const line of lines.slice(1)) {
      const low = line.trim();
      if (!afterSep) {
        if (low.toLowerCase().startsWith('ключови думи:')) {
          keywords = low
            .split(':')
            .slice(1)
            .join(':')
            .split(',')
            .map((w) => w.trim().toLowerCase())
            .filter(Boolean);
          continue;
        }
        if (low.toLowerCase().startsWith('категория:')) {
          const value = low.split(':').slice(1).join(':').trim().toLowerCase();
          category = CATEGORIES.has(value) ? value : 'basics';
          continue;
        }
        if (low.toLowerCase().startsWith('приоритет:')) {
          const digits = low.replace(/\D/g, '');
          priority = digits ? Math.max(1, Math.min(10, Number(digits))) : 5;
          continue;
        }
        if (low === '---') {
          afterSep = true;
          continue;
        }
      }
      body.push(line);
    }

    const bodyText = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!title || bodyText.length < 20) continue;
    topics.push({
      title: title.slice(0, 200),
      body: bodyText.slice(0, 4000),
      keywords: keywords.slice(0, 30),
      category,
      priority,
    });
  }
  return topics;
}

/* ------------------------------------------------- живи факти от базата */

/** Записва (или обновява) тема, като я маркира с подадения source. */
async function upsertTopic(t: ManualTopic, source: string): Promise<void> {
  await query(
    `delete from assistant_knowledge where source = $1 and lower(title) = lower($2)`,
    [source, t.title]
  );
  await query(
    `insert into assistant_knowledge (title, body, keywords, category, priority, is_active, source)
     values ($1, $2, $3::text[], $4, $5, true, $6)`,
    [t.title, t.body, t.keywords, t.category, t.priority, source]
  );
}

/**
 * ЖИВИТЕ ФАКТИ — теми, които се раждат от текущото състояние на приложението.
 * Тук „самообучението“ наистина научава нещо ново: нова значка, нова томбола,
 * променен бонус. Няма нищо зашито в кода освен заглавията.
 */
async function buildLiveFacts(): Promise<ManualTopic[]> {
  const topics: ManualTopic[] = [];

  const badges = await many<{ title: string; description: string }>(
    `select title, description from badges order by sort_order asc`
  ).catch(() => []);
  if (badges.length) {
    topics.push({
      title: 'Живи факти: значките в приложението (актуален списък)',
      body:
        'Това е актуалният списък със значки — обновява се автоматично от базата:\n' +
        badges.map((b) => `- **${b.title}** — ${b.description}`).join('\n'),
      keywords: ['значки', 'значка', 'списък значки', 'какви значки', 'медали', 'badge'],
      category: 'points',
      priority: 6,
    });
  }

  const cats = await many<{ category: string; n: number }>(
    `select category, count(*)::int as n
       from posts where status = 'published'
      group by category order by n desc`
  ).catch(() => []);
  const LABEL: Record<string, string> = {
    restaurants: 'ресторанти и заведения',
    hotels_airbnb: 'хотели и Airbnb',
    supermarket: 'магазини и продукти',
    cafes_bars: 'кафенета и барове',
    services_tech: 'услуги, техника и авто',
    other: 'други',
  };
  if (cats.length) {
    topics.push({
      title: 'Живи факти: какво има в приложението сега (категории и брой)',
      body:
        'Реалните числа в момента:\n' +
        cats.map((c) => `- ${LABEL[c.category] ?? c.category} — ${c.n} находки`).join('\n') +
        '\n\nИзползвай тези числа, когато някой пита „какво има“ или „има ли X“. Няма ли категория в списъка — значи още няма находки там и кани човека да качи първата.',
      keywords: ['какво има', 'категории', 'какви находки', 'има ли', 'колко находки', 'интересно'],
      category: 'basics',
      priority: 7,
    });
  }

  const raffle = await one<{
    title: string;
    prize_title: string;
    prize_value_eur: string | null;
    win_mode: string;
    condition_posts: number;
    condition_images_only: boolean;
    condition_distinct_days: number | null;
    min_account_age_days: number | null;
    ends_at: string;
    official_opens_at: string | null;
    delivery_note: string;
  }>(
    `select title, prize_title, prize_value_eur::text, win_mode, condition_posts,
            condition_images_only, condition_distinct_days, min_account_age_days,
            ends_at::text, official_opens_at::text, coalesce(delivery_note,'') as delivery_note
       from raffles
      where status in ('active', 'running') and ends_at > now()
      order by ends_at asc limit 1`
  ).catch(() => null);

  topics.push(
    raffle
      ? {
          title: 'Живи факти: АКТИВНАТА томбола в момента',
          body:
            `В момента върви: **${raffle.title}**\n` +
            `- Награда: ${raffle.prize_title}${raffle.prize_value_eur ? ` (${Number(raffle.prize_value_eur).toFixed(2)} €)` : ''}\n` +
            `- Как се печели: ${
              raffle.win_mode === 'first_to_complete'
                ? 'първият, който изпълни условието, печели ВЕДНАГА'
                : 'нареждане на пъзел в синхронен прозорец — най-бързият'
            }\n` +
            `- Условие: ${raffle.condition_posts} находки${raffle.condition_images_only ? ' със СНИМКА' : ''}${
              raffle.condition_distinct_days ? `, от поне ${raffle.condition_distinct_days} различни дни` : ''
            }\n` +
            `- Нужен стаж: ${raffle.min_account_age_days ?? 0} дни в приложението\n` +
            `- Край: ${new Date(raffle.ends_at).toLocaleString('bg-BG')}\n` +
            (raffle.official_opens_at
              ? `- Официален старт: ${new Date(raffle.official_opens_at).toLocaleString('bg-BG')}\n`
              : '') +
            (raffle.delivery_note ? `- Получаване на наградата: ${raffle.delivery_note}\n` : '') +
            '\nТова е актуалната томбола — кани човека да участва, ако отговаря на условието.',
          keywords: ['томбола', 'активна томбола', 'награда', 'какво се печели', 'участвам', 'жребий'],
          category: 'raffles',
          priority: 4,
        }
      : {
          title: 'Живи факти: АКТИВНАТА томбола в момента',
          body:
            'В момента НЯМА активна томбола — няма отворена игра за участие. Кажи го честно и предложи да види класацията или да си приготви находките за следващата томбола (ще се появи в „Общност“).',
          keywords: ['томбола', 'активна томбола', 'награда', 'кога томбола', 'няма ли томбола'],
          category: 'raffles',
          priority: 4,
        }
  );

  const founderOn = (await getSetting('founder_bonus', 'on')) === 'on';
  const founderMin = await getSetting('founder_window_min', '5');
  const founderPoints = await getSetting('founder_points', '100');
  const demo = await getSetting('demo_mode', 'off');
  topics.push({
    title: 'Живи факти: бонус „Основател“ и настройки в момента',
    body:
      `- Бонус „Основател“: ${founderOn ? `ВКЛЮЧЕН — първа находка до ${founderMin} минути след регистрация носи ${founderPoints} точки + значка „Основател“` : 'ИЗКЛЮЧЕН в момента'}\n` +
      `- Демо режим (измислен играч за проби): ${demo === 'on' ? 'включен (само за тестове, не се показва на хората)' : 'изключен'}\n` +
      'Използвай тези числа, когато обясняваш бонуса — не си ги измисляй.',
    keywords: ['основател', 'бонус', 'точки', 'колко точки', 'настройки', 'демо'],
    category: 'points',
    priority: 6,
  });

  return topics;
}

/* ------------------------------------------------------------ обучението */

/** Чете наръчника от файла (първият наличен път). */
async function readManual(): Promise<{ text: string; path: string } | null> {
  for (const candidate of CANDIDATE_PATHS) {
    try {
      const text = await readFile(candidate, 'utf8');
      if (text && text.length > 500) return { text, path: candidate };
    } catch {
      /* пробваме следващия път */
    }
  }
  return null;
}

/**
 * Самообучението. Идемпотентно — може да се пуска колкото искаш пъти.
 * Връща отчет какво е станало (за бутона в панела и за дневника).
 */
export async function retrainCenko(): Promise<RetrainReport> {
  const at = new Date().toISOString();

  // 1) Наръчникът от файла.
  const manual = await readManual();
  const manualTopics = manual ? parseManual(manual.text) : [];
  for (const t of manualTopics) await upsertTopic(t, 'file');

  // 2) Живите факти от базата.
  const liveTopics = await buildLiveFacts().catch(() => []);
  for (const t of liveTopics) await upsertTopic(t, 'auto');

  // 3) Изключваме теми, които вече не съществуват (махнати от файла) и старите
  //    начални теми (source='seed') — оттук нататък файлът е единственият
  //    източник на истината. Ръчно писаните от панела (source='admin') остават.
  const titles = manualTopics.map((t) => t.title);
  const offFile = await query(
    `update assistant_knowledge set is_active = false, updated_at = now()
      where source = 'file' and is_active and not (title = any($1::text[]))`,
    [titles]
  );
  const offSeed = await query(
    `update assistant_knowledge set is_active = false, updated_at = now()
      where source = 'seed' and is_active`
  );

  // 4) Ценко трябва да научи новото ВЕДНАГА (кешът на наръчника пада).
  invalidateKnowledgeCache();

  const activeRow = await one<{ n: number }>(
    `select count(*)::int as n from assistant_knowledge where is_active`
  );
  const active = activeRow?.n ?? 0;

  const report: RetrainReport = {
    ok: true,
    at,
    fromManual: manualTopics.length,
    liveFacts: liveTopics.length,
    disabled: (offFile.rowCount ?? 0) + (offSeed.rowCount ?? 0),
    active,
    manualPath: manual?.path,
    note: manual
      ? `Научих ${manualTopics.length} теми от наръчника и ${liveTopics.length} живи факта. Общо знам ${active} теми.`
      : `Не намерих файла с наръчника — обнових само живите факти (${liveTopics.length}). Общо знам ${active} теми.`,
  };

  // Пазим кога е станало последното обучение — за панела и за дневния график.
  await setSetting('cenko_last_retrain', JSON.stringify(report)).catch(() => undefined);
  return report;
}

/** Последното обучение (за показване в админ панела). */
export async function lastRetrain(): Promise<RetrainReport | null> {
  try {
    const raw = await getSetting('cenko_last_retrain', '');
    if (!raw) return null;
    return JSON.parse(raw) as RetrainReport;
  } catch {
    return null;
  }
}

/**
 * Дневник на самообучението — за да се вижда в панела, че работи и какво е научил.
 * (Иначе човек не може да провери дали автоматичното обучение въобще се случва.)
 */
export async function ensureRetrainLog(): Promise<void> {
  await query(
    `create table if not exists assistant_retrain_log (
       id bigserial primary key,
       at timestamptz not null default now(),
       trigger text not null default 'manual',
       from_manual integer not null default 0,
       live_facts integer not null default 0,
       disabled integer not null default 0,
       active integer not null default 0,
       note text
     )`
  ).catch(() => undefined);
}

export async function logRetrain(report: RetrainReport, trigger: 'manual' | 'auto'): Promise<void> {
  await ensureRetrainLog();
  await query(
    `insert into assistant_retrain_log (trigger, from_manual, live_facts, disabled, active, note)
     values ($1, $2, $3, $4, $5, $6)`,
    [trigger, report.fromManual, report.liveFacts, report.disabled, report.active, report.note ?? null]
  ).catch(() => undefined);
}
