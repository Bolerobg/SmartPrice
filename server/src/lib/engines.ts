/**
 * 🔧 ПРЕВКЛЮЧВАТЕЛИ НА ДВИГАТЕЛИТЕ — вкл/изкл за всяка стъпка от веригата.
 *
 * Защо: досега кое кога се ползва беше „в кода“. Когато нещо харчи пари или
 * чупи нещо, човекът трябва да може да го СПРЕ от панела и да вижда какво точно
 * работи в момента. Всяко копче тук има ясно описание какво прави, колко струва
 * и какво се случва, ако се изключи.
 *
 * Стойностите се пазят в `app_settings` под ключ `engine_switches` (един JSON).
 * Ако ключът липсва — ползваме стойностите по подразбиране (всичко включено,
 * освен това, което е изрично изключено по подразбиране).
 */
import { getSetting, setSetting } from './settings.js';

export interface EngineSwitch {
  key: string;
  label: string;
  /** Какво прави — с думи, за да е прозрачно. */
  help: string;
  /** Включено ли е, ако никой не е пипал. */
  def: boolean;
  /** Харчи ли пари (Apify) — показва се като предупреждение в панела. */
  paid?: boolean;
  /** Какво се случва при изключване. */
  offEffect?: string;
  group: 'обиколка' | 'проверка на цена' | 'намиране на магазини';
}

export const ENGINE_SWITCHES: EngineSwitch[] = [
  {
    key: 'embedded_json',
    label: 'Вграден JSON в страницата',
    help: 'Четем цената от данните, които сайтът вече носи (__NEXT_DATA__, JSON-LD и др.). Безплатно и най-бързо.',
    def: true,
    offEffect: 'Сайтовете с модерна платформа ще се четат чак с браузър — по-бавно.',
    group: 'обиколка',
  },
  {
    key: 'server_browser',
    label: 'Истински браузър на нашия сървър (Chromium)',
    help: 'Отваря страницата като човек и изчаква JavaScript. Безплатно, но яде памет (една страница наведнъж).',
    def: true,
    offEffect: 'JS магазините (technomarket, jysk, praktis) ще падат към Apify — по-скъпо.',
    group: 'обиколка',
  },
  {
    key: 'apify_browser',
    label: 'Apify — истински браузър (+жилищно IP)',
    help: 'Върши същото, но от тяхна машина и с жилищно IP — минава Cloudflare, който не пуска нас.',
    def: true,
    paid: true,
    offEffect: 'Сайтовете зад Cloudflare ще отиват директно при универсалния обход или при домашния робот.',
    group: 'обиколка',
  },
  {
    key: 'apify_crawler',
    label: 'Apify — универсален обход (Website Content Crawler)',
    help: 'Последната автоматична стъпка преди „ръчно“. Точно това счупи ikea.bg, decathlon.bg и mr-bricolage.bg.',
    def: true,
    paid: true,
    offEffect: 'Тези сайтове ще излизат като „ръчно“ и ще чакат домашния робот.',
    group: 'обиколка',
  },
  {
    key: 'crawler_from_category',
    label: 'Обходът да тръгва от категорийна страница',
    help: 'Вместо от началната (маркетингова) страница, обходът влиза през категория — там има продукти с цени.',
    def: true,
    offEffect: 'Обходът ще тръгва от началната и често няма да намира продукти (както при IKEA).',
    group: 'обиколка',
  },
  {
    key: 'home_robot_fallback',
    label: 'Домашният робот като резерва',
    help: 'Ако нищо автоматично не мине, сайтът се записва за обхождане от твоя компютър (домашен IP).',
    def: true,
    offEffect: 'Упоритите сайтове просто ще излизат като „ръчно“ и няма да влизат в опашката.',
    group: 'обиколка',
  },
  {
    key: 'price_check_server_browser',
    label: 'Проверката на цената да ползва браузър',
    help: 'Бутонът „Провери цената в магазина“ отваря страницата в истински браузър (10–20 сек).',
    def: true,
    offEffect: 'Остават само бързите четения (HTML/JSON) — по-бързо, но по-често „не открих цена“.',
    group: 'проверка на цена',
  },
  {
    key: 'price_check_apify',
    label: 'Проверката на цената да ползва Apify',
    help: 'Последна инстанция с жилищно IP — за магазини зад Cloudflare.',
    def: true,
    paid: true,
    offEffect: 'При блокирани магазини ще показваме само последната запазена цена.',
    group: 'проверка на цена',
  },
  {
    key: 'discovery_google',
    label: 'Google търсене при намиране на магазини',
    help: 'Точното търсене (Apify). Безплатните търсачки връщат форуми и Reddit.',
    def: true,
    paid: true,
    offEffect: 'Остават Mojeek/DuckDuckGo/Bing — по-шумно, по-малко истински магазини.',
    group: 'намиране на магазини',
  },
];

const KEY = 'engine_switches';
const cache = new Map<string, boolean>();
let loadedAt = 0;
const TTL = 30_000; // 30 сек — толкова чакаме след промяна от панела

function defaults(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const s of ENGINE_SWITCHES) out[s.key] = s.def;
  return out;
}

/** Всички стойности (с кеш, за да не удряме базата при всяка страница). */
export async function engineSwitches(): Promise<Record<string, boolean>> {
  if (Date.now() - loadedAt < TTL && cache.size) {
    return Object.fromEntries(cache.entries());
  }
  let saved: Record<string, boolean> = {};
  try {
    const raw = await getSetting(KEY, '');
    if (raw) saved = JSON.parse(raw) as Record<string, boolean>;
  } catch {
    /* счупен JSON — ползваме подразбиранията */
  }
  const merged = { ...defaults(), ...saved };
  cache.clear();
  for (const [k, v] of Object.entries(merged)) cache.set(k, Boolean(v));
  loadedAt = Date.now();
  return merged;
}

/** Включен ли е един двигател. Грешка при четене = включен (по-безопасно). */
export async function engineOn(key: string): Promise<boolean> {
  const all = await engineSwitches().catch(() => defaults());
  return all[key] !== false;
}

export async function setEngineSwitch(key: string, on: boolean): Promise<Record<string, boolean>> {
  const all = await engineSwitches();
  all[key] = Boolean(on);
  await setSetting(KEY, JSON.stringify(all));
  cache.clear();
  loadedAt = 0; // следващото четене идва от базата веднага
  return all;
}

/** За панела: двигателите + текущото им състояние, групирани. */
export async function engineStatus() {
  const all = await engineSwitches();
  return ENGINE_SWITCHES.map((s) => ({
    ...s,
    on: all[s.key] !== false,
  }));
}
