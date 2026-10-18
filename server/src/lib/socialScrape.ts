/**
 * 🎬 Социални мрежи — скрапване на TikTok и Instagram от админ панела.
 *
 * Защо съществува: рекламите ни (UGC) трябва да копират ДОКАЗАНО работещи
 * формати, а не да гадаем. Тук събираме най-гледаните видеа по наши теми и
 * показваме какво точно кара хората да гледат — куки, дължина, хаштагове,
 * кой е реклама (значи конкурент харчи пари) и кой продава продукт.
 *
 * Как: Apify актьори. TikTok `clockworks~tiktok-scraper` работи БЕЗ вход
 * (проверено на живо 18.10.2026: 10 видеа за $0.03, връща гледания/харесвания/
 * коментари/хаштагове/автор/дали е реклама). Instagram `apify~instagram-scraper`
 * БЕЗ вход връща празни записи — затова в Настройки има поле за `sessionid`
 * (бисквитка от влязъл профил); без нея резултатите са честно празни.
 *
 * Пари: минава през същия дневен лимит на Apify и записва разхода.
 */
import { many, one, query } from '../db.js';
import { getSetting, setSetting } from './settings.js';
import { addApifySpend, apifyBudgetAllows, apifyReady, apifyToken } from './apifyBrowser.js';

/* ============================================================ платформи */

export type SocialPlatform = 'tiktok' | 'instagram';

/** Една опция, която панелът рисува сам (затова са описани тук, не в HTML). */
export interface OptionDef {
  key: string;
  label: string;
  kind: 'number' | 'checkbox' | 'select' | 'text';
  /** Кратко обяснение под полето — за да не се гадае какво прави. */
  help?: string;
  def?: string | number | boolean;
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
  /** Опции, които се плащат на Apify (пускат се при самото обръщение). */
  actor?: boolean;
  /** Скрити под „Разширени“ — за да не плаши основният екран. */
  advanced?: boolean;
  /** Иска се само за даден режим (напр. само за профили). */
  onlyModes?: string[];
}

export interface SocialMode {
  id: 'hashtag' | 'search' | 'profile' | 'url';
  label: string;
  /** Какво пише човекът — по един на ред. */
  targetLabel: string;
  hint: string;
  example: string;
}

export interface PlatformMeta {
  id: SocialPlatform;
  label: string;
  icon: string;
  actor: string;
  note: string;
  /** Истина, ако без вход връща празно (Instagram). */
  needsLogin: boolean;
  modes: SocialMode[];
  options: OptionDef[];
}

/** Нашите филтри — не се плащат, прилагаме ги след като данните дойдат. */
const OUR_FILTERS: OptionDef[] = [
  {
    key: 'minViews',
    label: 'Минимум гледания',
    kind: 'number',
    def: 0,
    min: 0,
    help: 'Наш филтър — не се плаща. 10000 показва само видеата, които реално гърмят.',
  },
  {
    key: 'minLikes',
    label: 'Минимум харесвания',
    kind: 'number',
    def: 0,
    min: 0,
    advanced: true,
  },
  {
    key: 'postedWithinDays',
    label: 'Публикувано през последните (дни)',
    kind: 'number',
    def: 0,
    min: 0,
    max: 3650,
    help: '0 = без ограничение. 30 = само прясно съдържание.',
    advanced: true,
  },
  {
    key: 'excludeWords',
    label: 'Махай видеа, съдържащи думи',
    kind: 'text',
    help: 'Напр. „giveaway, томбола“ — ако не искаме такъв формат.',
    advanced: true,
  },
];

export const SOCIAL_PLATFORMS: PlatformMeta[] = [
  {
    id: 'tiktok',
    label: 'TikTok',
    icon: '🎵',
    actor: 'clockworks~tiktok-scraper',
    note: 'Работи БЕЗ вход. Проверено на живо: 10 видеа за ~$0.03.',
    needsLogin: false,
    modes: [
      {
        id: 'hashtag',
        label: 'По хаштаг',
        targetLabel: 'Хаштагове (без #)',
        hint: 'Най-точното за наши теми. По един на ред.',
        example: 'цени\nпазаруване\nспестяване',
      },
      {
        id: 'search',
        label: 'По търсене',
        targetLabel: 'Думи за търсене',
        hint: 'Търси в самото приложение — по-широко от хаштаг.',
        example: 'цени в магазина\nскъпотия',
      },
      {
        id: 'profile',
        label: 'По профил',
        targetLabel: 'Профили (@име)',
        hint: 'Взима последните видеа на конкретен профил — за да видим конкурентите.',
        example: 'mirelka.bg\npazaruvaj',
      },
    ],
    options: [
      {
        key: 'resultsPerPage',
        label: 'Видеа на заявка',
        kind: 'number',
        def: 30,
        min: 5,
        max: 200,
        actor: true,
        help: 'Плаща се на резултат (~$0.003 за видео).',
      },
      { key: 'excludePinned', label: 'Без закачените видеа', kind: 'checkbox', def: true, actor: true },
      {
        key: 'shouldDownloadVideos',
        label: 'Сваляй и самите видеа',
        kind: 'checkbox',
        def: false,
        actor: true,
        advanced: true,
        help: '⚠️ Скъпо и тежко — само ако ще преизползваш материала.',
      },
      {
        key: 'shouldDownloadCovers',
        label: 'Сваляй и кориците',
        kind: 'checkbox',
        def: false,
        actor: true,
        advanced: true,
      },
      {
        key: 'sortBy',
        label: 'Подреди резултатите по',
        kind: 'select',
        def: 'views',
        options: [
          { value: 'views', label: 'Гледания (какво гърми)' },
          { value: 'likes', label: 'Харесвания' },
          { value: 'comments', label: 'Коментари (спорове = интерес)' },
          { value: 'recent', label: 'Най-нови' },
        ],
      },
      { key: 'onlyAds', label: 'Само реклами', kind: 'checkbox', def: false, help: 'Виждаме какво пускат конкурентите.' },
      { key: 'excludeAds', label: 'Без реклами', kind: 'checkbox', def: true },
      { key: 'onlyShop', label: 'Само с продукт за продажба', kind: 'checkbox', def: false },
      ...OUR_FILTERS,
    ],
  },
  {
    id: 'instagram',
    label: 'Instagram',
    icon: '📸',
    actor: 'apify~instagram-scraper',
    note:
      'Иска вход: без бисквитка връща празно (проверено). Сложи sessionid в ⚙️ Настройки.',
    needsLogin: true,
    modes: [
      {
        id: 'hashtag',
        label: 'По хаштаг',
        targetLabel: 'Хаштагове (без #)',
        hint: 'Търси в explore по хаштаг.',
        example: 'цени\nпазаруване',
      },
      {
        id: 'profile',
        label: 'По профил',
        targetLabel: 'Профили (@име или име)',
        hint: 'Последните публикации на профил.',
        example: 'mirelka.bg',
      },
      {
        id: 'url',
        label: 'Конкретен адрес',
        targetLabel: 'Адреси (по един на ред)',
        hint: 'Една публикация или Reels по адрес.',
        example: 'https://www.instagram.com/p/XXXX/',
      },
    ],
    options: [
      {
        key: 'resultsLimit',
        label: 'Колко публикации',
        kind: 'number',
        def: 30,
        min: 1,
        max: 500,
        actor: true,
        help: 'Плаща се на резултат.',
      },
      {
        key: 'resultsType',
        label: 'Какво да върне',
        kind: 'select',
        def: 'posts',
        actor: true,
        options: [
          { value: 'posts', label: 'Публикации' },
          { value: 'details', label: 'Подробно за адрес' },
        ],
      },
      {
        key: 'onlyPostsNewerThan',
        label: 'Само по-нови от (напр. 6 months)',
        kind: 'text',
        actor: true,
        advanced: true,
        help: 'Както го пише Instagram: „6 months“, „2026-01-01“.',
      },
      {
        key: 'sortBy',
        label: 'Подреди резултатите по',
        kind: 'select',
        def: 'likes',
        options: [
          { value: 'likes', label: 'Харесвания' },
          { value: 'comments', label: 'Коментари' },
          { value: 'recent', label: 'Най-нови' },
          { value: 'views', label: 'Гледания' },
        ],
      },
      ...OUR_FILTERS,
    ],
  },
];

export function platformMeta(platform: string): PlatformMeta | undefined {
  return SOCIAL_PLATFORMS.find((p) => p.id === platform);
}

/* ============================================================ настройки */

const DEFAULTS_KEY = 'social_scrape_defaults';
const IG_COOKIE_KEY = 'social_instagram_sessionid';

export interface SocialDefaults {
  platform: SocialPlatform;
  resultsPerPage: number;
  minViews: number;
  excludeAds: boolean;
  hashtags: string;
}

const FALLBACK_DEFAULTS: SocialDefaults = {
  platform: 'tiktok',
  resultsPerPage: 30,
  minViews: 0,
  excludeAds: true,
  hashtags: 'цени\nпазаруване\nспестяване',
};

export async function getSocialDefaults(): Promise<SocialDefaults> {
  try {
    const raw = await getSetting(DEFAULTS_KEY, '');
    if (!raw) return FALLBACK_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<SocialDefaults>;
    return { ...FALLBACK_DEFAULTS, ...parsed };
  } catch {
    return FALLBACK_DEFAULTS;
  }
}

export async function setSocialDefaults(patch: Partial<SocialDefaults>): Promise<SocialDefaults> {
  const next = { ...(await getSocialDefaults()), ...patch };
  await setSetting(DEFAULTS_KEY, JSON.stringify(next));
  return next;
}

/** Бисквитката за Instagram — пази се отделно и никога не се връща към панела. */
export async function getInstagramCookie(): Promise<string> {
  return (await getSetting(IG_COOKIE_KEY, '')) || '';
}

export async function setInstagramCookie(value: string): Promise<void> {
  await setSetting(IG_COOKIE_KEY, String(value ?? '').trim().slice(0, 4000));
}

/* ============================================================ пускане */

export interface SocialScanInput {
  platform: SocialPlatform;
  mode: string;
  /** Думите/адресите, по един на ред (или масив). */
  targets: string[] | string;
  options?: Record<string, string | number | boolean>;
}

const RUN_KEY = 'social_scrape_last';

export interface SocialRunRow {
  id: string;
  platform: string;
  mode: string;
  targets: string[];
  options: Record<string, unknown>;
  status: string;
  found: number;
  usd: number;
  note: string | null;
  started_at: string;
  finished_at: string | null;
}

function toList(targets: string[] | string): string[] {
  const raw = Array.isArray(targets) ? targets : String(targets ?? '').split(/[\n,]+/);
  return raw
    .map((t) => String(t).trim().replace(/^#/, '').replace(/^@/, ''))
    .filter((t) => t.length > 0)
    .slice(0, 12);
}

/** Превръща нашите опции във вход за актьора. */
function actorInput(meta: PlatformMeta, mode: string, targets: string[], o: Record<string, unknown>) {
  if (meta.id === 'tiktok') {
    const base: Record<string, unknown> = {
      resultsPerPage: Number(o.resultsPerPage ?? 30) || 30,
      excludePinnedPosts: o.excludePinned !== false,
      shouldDownloadVideos: o.shouldDownloadVideos === true,
      shouldDownloadCovers: o.shouldDownloadCovers === true,
      proxyConfiguration: { useApifyProxy: true },
    };
    if (mode === 'hashtag') base.hashtags = targets;
    else if (mode === 'search') {
      base.searchQueries = targets;
      base.searchSection = '/video';
    } else base.profiles = targets;
    return base;
  }

  // Instagram: адресите се строят от това какво е дал човекът.
  const urls = targets.map((t) => {
    if (/^https?:/i.test(t)) return t;
    if (mode === 'hashtag') return `https://www.instagram.com/explore/tags/${encodeURIComponent(t)}/`;
    return `https://www.instagram.com/${encodeURIComponent(t.replace(/^@/, ''))}/`;
  });
  const base: Record<string, unknown> = {
    directUrls: urls,
    resultsType: String(o.resultsType ?? 'posts'),
    resultsLimit: Number(o.resultsLimit ?? 30) || 30,
    proxyConfiguration: { useApifyProxy: true },
  };
  if (o.onlyPostsNewerThan) base.onlyPostsNewerThan = String(o.onlyPostsNewerThan);
  return base;
}

/** Пази входа на актьора като JSON (за проверки и за да се види какво сме пратили). */
function actorJson(actor: string, input: Record<string, unknown>): string {
  return JSON.stringify({ actor, input }).slice(0, 4000);
}

interface RawItem {
  [k: string]: unknown;
}

/** Едно видео/публикация → наш ред. Честно: липсващото остава null, не се измисля. */
function mapItem(platform: SocialPlatform, it: RawItem) {
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };
  const tags = Array.isArray(it.hashtags)
    ? (it.hashtags as Array<Record<string, unknown>>).map((h) => String(h?.name ?? '')).filter(Boolean)
    : [];

  if (platform === 'tiktok') {
    return {
      external_id: String(it.id ?? ''),
      url: String(it.webVideoUrl ?? ''),
      author: String((it.authorMeta as Record<string, unknown>)?.name ?? ''),
      caption: String(it.text ?? '').slice(0, 1500),
      views: num(it.playCount),
      likes: num(it.diggCount),
      comments: num(it.commentCount),
      shares: num(it.shareCount),
      duration: num((it.videoMeta as Record<string, unknown>)?.duration),
      hashtags: tags,
      posted_at: it.createTimeISO ? String(it.createTimeISO) : null,
      is_ad: Boolean(it.isAd || it.isSponsored),
      has_shop: Boolean(it.hasTikTokShopProduct),
    };
  }

  return {
    external_id: String(it.id ?? it.shortCode ?? ''),
    url: String(it.url ?? it.inputUrl ?? ''),
    author: String(it.ownerUsername ?? it.ownerFullName ?? ''),
    caption: String(it.caption ?? '').slice(0, 1500),
    views: num(it.videoViewCount ?? it.videoPlayCount ?? it.viewsCount),
    likes: num(it.likesCount),
    comments: num(it.commentsCount),
    shares: null,
    duration: num(it.videoDuration),
    hashtags: tags.length
      ? tags
      : Array.isArray(it.hashtags)
        ? (it.hashtags as unknown[]).map((h) => String(h)).filter(Boolean)
        : [],
    posted_at: it.timestamp ? String(it.timestamp) : null,
    is_ad: Boolean(it.isSponsored),
    has_shop: false,
  };
}

/** Нашите филтри (безплатни) — прилагат се след като данните дойдат. */
function passesFilters(item: ReturnType<typeof mapItem>, o: Record<string, unknown>): boolean {
  const n = (v: unknown) => Number(v) || 0;
  const cap = (v: unknown, max: number) => Math.max(0, Math.min(max, n(v)));
  if (item.views !== null && item.views < cap(o.minViews, 100_000_000)) return false;
  if ((item.likes ?? 0) < cap(o.minLikes, 10_000_000)) return false;
  if (o.onlyAds === true && !item.is_ad) return false;
  if (o.excludeAds === true && item.is_ad) return false;
  if (o.onlyShop === true && !item.has_shop) return false;

  const days = cap(o.postedWithinDays, 3650);
  if (days > 0 && item.posted_at) {
    const at = Date.parse(item.posted_at);
    if (Number.isFinite(at) && Date.now() - at > days * 86_400_000) return false;
  }
  const bad = String(o.excludeWords ?? '')
    .split(/[,;]+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  if (bad.length) {
    const text = `${item.caption} ${item.hashtags.join(' ')}`.toLowerCase();
    if (bad.some((w) => text.includes(w))) return false;
  }
  return true;
}

/** Сортиране според избора в панела. */
function sortItems(items: ReturnType<typeof mapItem>[], sortBy: string) {
  const key = sortBy === 'likes' ? 'likes' : sortBy === 'comments' ? 'comments' : sortBy === 'recent' ? 'posted_at' : 'views';
  return items.sort((a, b) => {
    if (key === 'posted_at') return String(b.posted_at ?? '').localeCompare(String(a.posted_at ?? ''));
    return (Number((b as Record<string, unknown>)[key]) || 0) - (Number((a as Record<string, unknown>)[key]) || 0);
  });
}

/** Има ли пуснато сканиране в момента (за да не пускаме две). */
export async function socialRunning(): Promise<boolean> {
  try {
    const row = await one<{ n: string }>(
      `select count(*)::text as n from social_scrape_runs
        where status = 'running' and started_at > now() - interval '15 minutes'`
    );
    return Number(row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Пуска сканиране във фона и записва резултата. Връща веднага — панелът чака
 * чрез „последно пускане“ (иначе заявката щеше да виси минути).
 */
export async function startSocialScan(input: SocialScanInput): Promise<{ started: boolean; runId?: string; reason?: string }> {
  const meta = platformMeta(input.platform);
  if (!meta) return { started: false, reason: 'Непозната платформа.' };
  const mode = meta.modes.some((m) => m.id === input.mode) ? input.mode : meta.modes[0].id;
  const targets = toList(input.targets);
  if (!targets.length) return { started: false, reason: 'Напиши поне една дума, хаштаг или профил.' };
  if (await socialRunning()) return { started: false, reason: 'Вече върви сканиране — изчакай да свърши.' };

  const options = (input.options ?? {}) as Record<string, unknown>;
  const token = await apifyToken().catch(() => '');
  if (!token) return { started: false, reason: 'Няма Apify токен (виж Скрапер → настройки).' };
  if (!(await apifyReady().catch(() => false))) return { started: false, reason: 'Apify не е готов.' };
  const estimate = Math.max(0.05, (Number(options.resultsPerPage ?? options.resultsLimit ?? 30) || 30) * 0.004);
  const budget = await apifyBudgetAllows(estimate).catch(() => ({ allowed: false, today: 0, limit: 0 }));
  if (!budget.allowed) {
    return {
      started: false,
      reason: `Дневният лимит за Apify е стигнат (${budget.today.toFixed(2)} / ${budget.limit.toFixed(2)} $).`,
    };
  }

  const actorInputJson = actorJson(meta.actor, actorInput(meta, mode, targets, options));
  const row = await one<{ id: string }>(
    `insert into social_scrape_runs (platform, mode, targets, options, status, note)
     values ($1, $2, $3::jsonb, $4::jsonb, 'running', $5)
     returning id`,
    [
      meta.id,
      mode,
      JSON.stringify(targets),
      JSON.stringify({ ...options, __actorInput: actorInputJson }),
      `Пуснато от панела: ${meta.label} · ${mode}`,
    ]
  );
  const runId = row?.id;
  if (!runId) return { started: false, reason: 'Не успях да запиша пускането.' };

  void runSocialScan(runId, meta, mode, targets, options).catch(async (err: Error) => {
    await finishRun(runId, 'failed', 0, 0, `Неочаквана грешка: ${err.message}`.slice(0, 400)).catch(() => undefined);
  });

  return { started: true, runId };
}

async function finishRun(runId: string, status: string, found: number, usd: number, note: string | null) {
  await query(
    `update social_scrape_runs
        set status = $2, found = $3, usd = $4, note = $5, finished_at = now()
      where id = $1`,
    [runId, status, found, usd, note]
  );
  await setSetting(RUN_KEY, JSON.stringify({ at: new Date().toISOString(), runId, status, found, usd })).catch(
    () => undefined
  );
}

async function runSocialScan(
  runId: string,
  meta: PlatformMeta,
  mode: string,
  targets: string[],
  options: Record<string, unknown>
): Promise<void> {
  const token = (await apifyToken().catch(() => '')) || '';
  const input = actorInput(meta, mode, targets, options);

  // Instagram без бисквитка връща празно — казваме го веднага, не хабим пари.
  if (meta.needsLogin && !(await getInstagramCookie())) {
    await finishRun(
      runId,
      'failed',
      0,
      0,
      'Instagram иска вход. Сложи sessionid в ⚙️ Настройки (иначе актьорът връща празно).'
    );
    return;
  }

  const api = async (path: string, method = 'GET', body?: unknown): Promise<unknown> => {
    const res = await fetch(`https://api.apify.com/v2${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`apify ${res.status}`);
    return res.json();
  };

  try {
    const started = (await api(
      `/acts/${meta.actor}/runs?token=${encodeURIComponent(token)}`,
      'POST',
      input
    )) as { data?: { id?: string } };
    const apifyRunId = started?.data?.id;
    if (!apifyRunId) {
      await finishRun(runId, 'failed', 0, 0, 'Актьорът не върна пускане.');
      return;
    }

    // Чакаме до 5 минути (TikTok отговаря за 20–60 сек).
    const deadline = Date.now() + 300_000;
    let status = 'RUNNING';
    let datasetId = '';
    let spend = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 6_000));
      const run = (await api(`/actor-runs/${apifyRunId}`)) as {
        data?: { status?: string; defaultDatasetId?: string; usageTotalUsd?: number };
      };
      status = run?.data?.status ?? 'RUNNING';
      datasetId = run?.data?.defaultDatasetId ?? '';
      spend = run?.data?.usageTotalUsd ?? 0;
      if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) break;
    }
    if (spend > 0) {
      await addApifySpend(spend, `социални: ${meta.label}`).catch(() => undefined);
    }
    if (status !== 'SUCCEEDED' || !datasetId) {
      await finishRun(runId, 'failed', 0, spend, `Актьорът свърши с „${status}“.`);
      return;
    }

    const limit = Math.min(200, Number(options.resultsPerPage ?? options.resultsLimit ?? 30) * 2 + 20);
    const items = (await api(`/datasets/${datasetId}/items?limit=${limit}`)) as RawItem[];
    const mapped = (Array.isArray(items) ? items : [])
      .map((it) => mapItem(meta.id, it))
      .filter((it) => it.url && it.caption !== undefined)
      .filter((it) => passesFilters(it, options));
    const sorted = sortItems(mapped, String(options.sortBy ?? 'views'));

    let saved = 0;
    for (const it of sorted) {
      await query(
        `insert into social_scrape_items
           (run_id, platform, external_id, url, author, caption, views, likes, comments, shares,
            duration, hashtags, posted_at, is_ad, has_shop, raw)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16::jsonb)`,
        [
          runId,
          meta.id,
          it.external_id,
          it.url,
          it.author,
          it.caption,
          it.views,
          it.likes,
          it.comments,
          it.shares,
          it.duration,
          JSON.stringify(it.hashtags ?? []),
          it.posted_at,
          it.is_ad,
          it.has_shop,
          JSON.stringify(it).slice(0, 6000),
        ]
      ).catch(() => undefined);
      saved += 1;
    }

    const note =
      saved === 0
        ? `Актьорът върна ${Array.isArray(items) ? items.length : 0} записа, но нито един не мина филтрите. Разхлаби филтрите или махни „без реклами“.`
        : `Готово: ${saved} видеа/публикации. ${meta.needsLogin ? 'С бисквитка за Instagram.' : 'Без вход.'}`;
    await finishRun(runId, 'done', saved, spend, note);
  } catch (err) {
    await finishRun(runId, 'failed', 0, 0, `Грешка: ${(err as Error).message}`.slice(0, 400));
  }
}

/* ============================================================ четене */

export async function listSocialRuns(limit = 30): Promise<SocialRunRow[]> {
  return many<SocialRunRow>(
    `select id, platform, mode, targets, options, status, found, usd::float as usd, note,
            started_at::text, finished_at::text
       from social_scrape_runs
      order by started_at desc
      limit $1`,
    [Math.max(1, Math.min(100, limit))]
  );
}

export async function lastSocialRun(): Promise<SocialRunRow | null> {
  const rows = await listSocialRuns(1);
  return rows[0] ?? null;
}

export interface SocialItemRow {
  id: string;
  run_id: string;
  platform: string;
  url: string;
  author: string;
  caption: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  duration: number | null;
  hashtags: string[] | null;
  posted_at: string | null;
  is_ad: boolean;
  has_shop: boolean;
}

export async function listSocialItems(params: {
  platform?: string;
  runId?: string;
  q?: string;
  minViews?: number;
  onlyAds?: boolean;
  onlyShop?: boolean;
  sort?: string;
  limit?: number;
}): Promise<SocialItemRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  // Всяко попълване връща номера на параметъра си. ВАЖНО: при търсене по текст
  // един и същ параметър се ползва ДВА пъти — затова не пипаме „?“ на сляпо,
  // а взимаме номера веднъж и го слагаме и на двете места.
  const p = (value: unknown): string => {
    args.push(value);
    return `$${args.length}`;
  };
  if (params.platform) where.push(`platform = ${p(params.platform)}`);
  if (params.runId) where.push(`run_id = ${p(params.runId)}`);
  if (params.q) {
    const like = `%${params.q}%`;
    const idx = p(like);
    where.push(`(caption ilike ${idx} or author ilike ${idx})`);
  }
  if (params.minViews) where.push(`coalesce(views,0) >= ${p(Number(params.minViews))}`);
  if (params.onlyAds) where.push('is_ad = true');
  if (params.onlyShop) where.push('has_shop = true');

  const whereSql = where.join(' and ');

  const sort = params.sort === 'likes' ? 'likes desc nulls last'
    : params.sort === 'comments' ? 'comments desc nulls last'
    : params.sort === 'recent' ? 'posted_at desc nulls last'
    : 'views desc nulls last';

  const limit = Math.max(1, Math.min(300, params.limit ?? 60));
  return many<SocialItemRow>(
    `select id, run_id, platform, url, author, caption, views, likes, comments, shares,
            duration, hashtags, posted_at::text, is_ad, has_shop
       from social_scrape_items
      ${whereSql ? `where ${whereSql}` : ''}
      order by ${sort}
      limit ${limit}`,
    args
  );
}

export async function socialInfo() {
  const [runs, totals, byPlatform, ideas, cookie, defaults] = await Promise.all([
    one<{ n: string }>(`select count(*)::text as n from social_scrape_runs`),
    one<{ n: string; usd: string }>(
      `select count(*)::text as n, coalesce(sum(usd),0)::text as usd from social_scrape_items`
    ),
    many<{ platform: string; n: string; top_views: string | null }>(
      `select platform, count(*)::text as n, max(views)::text as top_views
         from social_scrape_items group by platform order by 2 desc`
    ),
    one<{ n: string }>(`select count(*)::text as n from social_script_ideas`),
    getInstagramCookie(),
    getSocialDefaults(),
  ]);
  const spend = await one<{ usd: string }>(
    `select coalesce(sum(usd),0)::text as usd from social_scrape_runs where started_at::date = current_date`
  );
  return {
    platforms: SOCIAL_PLATFORMS,
    defaults,
    hasInstagramCookie: Boolean(cookie),
    running: await socialRunning(),
    stats: {
      runs: Number(runs?.n ?? 0),
      items: Number(totals?.n ?? 0),
      ideas: Number(ideas?.n ?? 0),
      usdToday: Number(spend?.usd ?? 0),
    },
    byPlatform: byPlatform.map((r) => ({
      platform: r.platform,
      count: Number(r.n),
      topViews: r.top_views ? Number(r.top_views) : null,
    })),
  };
}

/* ============================================================ идеи */

export async function saveIdea(input: {
  itemId?: string;
  note?: string;
  hook?: string;
}): Promise<{ ok: boolean; id?: string; reason?: string }> {
  if (!input.itemId) return { ok: false, reason: 'Липсва видео.' };
  const item = await one<SocialItemRow>(
    `select id, run_id, platform, url, author, caption, views, likes, comments, shares,
            duration, hashtags, posted_at::text, is_ad, has_shop
       from social_scrape_items where id = $1`,
    [input.itemId]
  );
  if (!item) return { ok: false, reason: 'Няма такова видео.' };
  const row = await one<{ id: string }>(
    `insert into social_script_ideas (item_id, platform, url, author, caption, views, note, hook)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [
      item.id,
      item.platform,
      item.url,
      item.author,
      item.caption,
      item.views,
      (input.note ?? '').slice(0, 1000) || null,
      (input.hook ?? '').slice(0, 1000) || null,
    ]
  );
  return { ok: Boolean(row?.id), id: row?.id };
}

export async function listIdeas(limit = 100) {
  return many<{
    id: string;
    platform: string;
    url: string;
    author: string;
    caption: string;
    views: number | null;
    note: string | null;
    hook: string | null;
    created_at: string;
  }>(
    `select id, platform, url, author, caption, views, note, hook, created_at::text
       from social_script_ideas order by created_at desc limit $1`,
    [Math.max(1, Math.min(300, limit))]
  );
}

export async function deleteIdea(id: string): Promise<void> {
  await query(`delete from social_script_ideas where id = $1`, [id]);
}

/** Износ за Excel/Sheets — човекът ще работи с него, не с базата. */
export function itemsToCsv(items: SocialItemRow[]): string {
  const head = [
    'платформа',
    'автор',
    'гледания',
    'харесвания',
    'коментари',
    'дължина(сек)',
    'реклама',
    'с продукт',
    'публикувано',
    'адрес',
    'текст',
    'хаштагове',
  ];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const rows = items.map((i) =>
    [
      i.platform,
      i.author,
      i.views ?? '',
      i.likes ?? '',
      i.comments ?? '',
      i.duration ?? '',
      i.is_ad ? 'да' : '',
      i.has_shop ? 'да' : '',
      i.posted_at ?? '',
      i.url,
      i.caption,
      (i.hashtags ?? []).join(' '),
    ]
      .map(esc)
      .join(',')
  );
  return '\uFEFF' + [head.map(esc).join(','), ...rows].join('\r\n');
}
