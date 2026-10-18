/**
 * 🖥️ Рендиране с истински браузър — за магазини, които се „рисуват“ с JavaScript.
 *
 * Защо съществува: големите вериги (technomarket.bg, technopolis.bg, bauhaus.bg…)
 * връщат HTML, в който цената я НЯМА — тя се появява чак когато браузърът изпълни
 * JavaScript-а. Затова всичките ни HTTP стратегии дават „заглавие без цена“ и
 * магазинът изглежда несканируем. С истински браузър същата страница идва с
 * JSON-LD Product, в който има и цена, и снимка.
 *
 * Как е направено (за да не яде сървъра):
 *   • браузърът се вдига ЛЕНИВО — само когато някой магазин наистина го поиска;
 *   • пуска се САМО ЕДНА страница наведнъж (семафор) — VPS-ът има ~850 MB свободна
 *     памет и е пълен с други услуги;
 *   • снимки, шрифтове и видео се блокират (не ни трябват, а тежат най-много);
 *   • не се чака „мрежата да утихне“ до безкрай: `domcontentloaded` + кратка пауза;
 *   • браузърът се затваря сам след 2 минути без работа (`IDLE_MS`).
 *
 * Ако браузърът липсва (напр. локална разработка без Chromium), функциите връщат
 * `null` и скраперът просто продължава със следващата стратегия — нищо не се чупи.
 */
import { existsSync } from 'node:fs';
import { env } from '../env.js';

type AnyBrowser = { close(): Promise<void>; newContext(o?: unknown): Promise<AnyContext> };
type AnyContext = {
  newPage(): Promise<AnyPage>;
  close(): Promise<void>;
  route?(pattern: string, handler: (r: AnyRoute) => void): Promise<void>;
};
type AnyRoute = { request(): { resourceType(): string }; abort(): Promise<void>; continue(): Promise<void> };
type AnyPage = {
  goto(url: string, o?: unknown): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  waitForLoadState(state?: string, o?: unknown): Promise<void>;
  content(): Promise<string>;
  url(): string;
  close(): Promise<void>;
};

let browser: AnyBrowser | null = null;
let launching: Promise<AnyBrowser | null> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let busy = false;

// Колко дълго пазим браузъра топъл след последното ползване. Студеното
// вдигане на Chromium струва ~5 сек — на потребител, който натиска „Провери
// цената“, това е половината от изчакването. Затова 10 минути.
const IDLE_MS = 600_000;

/** Има ли с какво да рендираме. */
export function browserAvailable(): boolean {
  if (!env.SCRAPER_BROWSER) return false;
  return existsSync(env.CHROMIUM_PATH);
}

function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void closeBrowser();
  }, IDLE_MS);
  // Не държим процеса буден заради таймера.
  idleTimer.unref?.();
}

export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (b) {
    try {
      await b.close();
    } catch {
      /* вече е затворен */
    }
  }
}

async function getBrowser(): Promise<AnyBrowser | null> {
  if (browser) {
    scheduleIdleClose();
    return browser;
  }
  if (launching) return launching;
  launching = (async () => {
    try {
      // Импортът е динамичен: ако `playwright-core` не е инсталиран, приложението
      // пак тръгва — просто без рендиране.
      const mod = (await import('playwright-core')) as unknown as {
        chromium: { launch(o: unknown): Promise<AnyBrowser> };
      };
      const b = await mod.chromium.launch({
        executablePath: env.CHROMIUM_PATH,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--blink-settings=imagesEnabled=false',
          '--disable-background-networking',
          '--no-first-run',
          '--mute-audio',
        ],
      });
      browser = b;
      scheduleIdleClose();
      return b;
    } catch (err) {
      // Логът е важен: иначе „не работи“ изглежда загадъчно.
      // eslint-disable-next-line no-console
      console.warn(`[render] браузърът не тръгна: ${(err as Error).message}`);
      return null;
    } finally {
      launching = null;
    }
  })();
  return launching;
}

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
];

/**
 * Вдига браузъра още при старта на сървъра, за да не плаща първият човек, който
 * натисне „Провери цената в магазина“, студеното стартиране на Chromium.
 * Грешката не е фатална — просто няма да има предварително вдигане.
 */
export async function prewarmBrowser(): Promise<boolean> {
  if (!browserAvailable()) return false;
  try {
    const b = await getBrowser();
    scheduleIdleClose();
    return Boolean(b);
  } catch {
    return false;
  }
}

export interface RenderResult {
  html: string;
  url: string;
  ms: number;
}

/**
 * Отваря адреса в истински браузър и връща HTML-а СЛЕД като JavaScript-ът е
 * свършил работата си (там вече има цени и JSON-LD).
 *
 * Връща `null`, ако браузър няма или страницата не се отвори — викащият решава
 * какво да прави, вместо да получава изключение в средата на обиколка.
 */
export async function renderHtml(
  url: string,
  opts: { timeoutMs?: number; waitMs?: number; idleMs?: number } = {}
): Promise<RenderResult | null> {
  if (!browserAvailable()) return null;
  if (busy) return null; // една страница наведнъж — сървърът има малко памет

  const t0 = Date.now();
  busy = true;
  let ctx: AnyContext | null = null;
  let page: AnyPage | null = null;
  try {
    const b = await getBrowser();
    if (!b) return null;
    ctx = await b.newContext({
      userAgent: UA_POOL[Math.floor(Math.random() * UA_POOL.length)],
      locale: 'bg-BG',
      viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: { 'Accept-Language': 'bg-BG,bg;q=0.9,en;q=0.8' },
    });
    // Снимките/шрифтовете/видеото само тежат — не ги теглим.
    if (ctx.route) {
      await ctx.route('**/*', (route) => {
        const t = route.request().resourceType();
        if (t === 'image' || t === 'media' || t === 'font') return route.abort();
        return route.continue();
      });
    }
    page = await ctx.newPage();
    const timeout = opts.timeoutMs ?? env.SCRAPER_RENDER_TIMEOUT_MS;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    // Даваме шанс на заявките за данни да пристигнат, без да чакаме вечно.
    await page
      .waitForLoadState('networkidle', { timeout: opts.idleMs ?? 6000 })
      .catch(() => undefined);
    await page.waitForTimeout(opts.waitMs ?? 1200);
    const html = await page.content();
    return { html, url: page.url(), ms: Date.now() - t0 };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[render] ${url} не се отвори: ${(err as Error).message}`);
    return null;
  } finally {
    try {
      await page?.close();
    } catch {
      /* ignore */
    }
    try {
      await ctx?.close();
    } catch {
      /* ignore */
    }
    busy = false;
    scheduleIdleClose();
  }
}
