import { CategoryInfo, PlatformTag } from '@/types';

export const LIGHT_COLORS = {
  // Spesti & Otkriy — Modern Utilitarian & Community-Centric Light Design System
  surface: '#f8f9ff',
  surfaceDim: '#cbdbf5',
  surfaceBright: '#f8f9ff',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#eff4ff',
  surfaceContainer: '#e5eeff',
  surfaceContainerHigh: '#dce9ff',
  surfaceContainerHighest: '#d3e4fe',
  onSurface: '#0b1c30',
  onSurfaceVariant: '#3c4a42',
  inverseSurface: '#213145',
  inverseOnSurface: '#eaf1ff',
  outline: '#6c7a71',
  outlineVariant: '#bbcabf',
  surfaceTint: '#006c49',
  primary: '#006c49',
  onPrimary: '#ffffff',
  primaryContainer: '#10b981',
  onPrimaryContainer: '#00422b',
  inversePrimary: '#4edea3',
  primaryFixed: '#6ffbbe',
  primaryFixedDim: '#4edea3',
  onPrimaryFixed: '#002113',
  onPrimaryFixedVariant: '#005236',
  secondary: '#565e74',
  onSecondary: '#ffffff',
  secondaryContainer: '#dae2fd',
  onSecondaryContainer: '#5c647a',
  secondaryFixed: '#dae2fd',
  secondaryFixedDim: '#bec6e0',
  onSecondaryFixed: '#131b2e',
  onSecondaryFixedVariant: '#3f465c',
  tertiary: '#855300',
  onTertiary: '#ffffff',
  tertiaryContainer: '#e29100',
  onTertiaryContainer: '#523200',
  tertiaryFixed: '#ffddb8',
  tertiaryFixedDim: '#ffb95f',
  onTertiaryFixed: '#2a1700',
  onTertiaryFixedVariant: '#653e00',
  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',

  // Семантични токени за всички екрани и компоненти (Light Utilitarian Theme)
  bgPrimary: '#f8f9ff',
  bgSecondary: '#eff4ff',
  bgCard: '#ffffff',
  bgCardElevated: '#e5eeff',
  bgGlass: 'rgba(248, 249, 255, 0.90)',
  borderSubtle: '#e2e8f0',
  borderStrong: '#cbdbf5',

  // Текст (Plus Jakarta Sans висококонтрастна скала)
  textPrimary: '#0b1c30',
  textSecondary: '#3c4a42',
  textMuted: '#6c7a71',

  // 🟢 Зелена зона: Топ Оферти, Икономии, Потвърдени бележки (Emerald)
  greenPrimary: '#006c49',
  greenBright: '#006c49',
  greenDark: '#005236',
  greenSoftBg: '#ecfdf5',
  greenBorder: '#a7f3d0',

  // 🔴 Червена зона: Ценови Капани, Надценки, Отстъпки % (Coral Red)
  redPrimary: '#ba1a1a',
  redBright: '#ba1a1a',
  redDark: '#93000a',
  redSoftBg: '#ffdad6',
  redBorder: '#fecaca',

  // ✨ Промоции, Клубни карти & Значки (Warm Amber)
  goldPrimary: '#e29100',
  goldBright: '#855300',
  goldSoftBg: '#ffddb8',
  goldBorder: '#fde68a',

  // Интерактивни акценти
  accentIndigo: '#006c49',
  accentCyan: '#006c49',
  accentPurple: '#565e74',
  accentCyanSoftBg: '#eff4ff',
  accentCyanBorder: '#cbdbf5',
  indigoSoftBg: '#eff4ff',

  white: '#FFFFFF',
  black: '#0b1c30',
};
/**
 * 🌙 ТЪМНА ТЕМА (22.10.2026) — същите ключове, но в тъмните тонове на
 * Material 3 (зелената схема). Изборът се пази в localStorage (`sp_theme`)
 * и се прилага при ЗАРЕЖДАНЕ на приложението: затова смяната на темата
 * презарежда страницата — така всички StyleSheet-ове се пресъздават с новите
 * цветове (иначе старите стилове остават със старите стойности).
 */
export const DARK_COLORS = {
  surface: '#0f1413',
  surfaceDim: '#0f1413',
  surfaceBright: '#353b39',
  surfaceContainerLowest: '#0a0f0e',
  surfaceContainerLow: '#171d1b',
  surfaceContainer: '#1b211f',
  surfaceContainerHigh: '#262c2a',
  surfaceContainerHighest: '#313735',
  onSurface: '#dfe4e1',
  onSurfaceVariant: '#bfc9c5',
  inverseSurface: '#dfe4e1',
  inverseOnSurface: '#2c3130',
  outline: '#8a938f',
  outlineVariant: '#3f4946',
  surfaceTint: '#4edea3',
  primary: '#4edea3',
  onPrimary: '#003826',
  primaryContainer: '#006c49',
  onPrimaryContainer: '#b9f0d7',
  inversePrimary: '#006c49',
  primaryFixed: '#6ffbbe',
  primaryFixedDim: '#4edea3',
  onPrimaryFixed: '#002113',
  onPrimaryFixedVariant: '#005236',
  secondary: '#bcc7dc',
  onSecondary: '#263143',
  secondaryContainer: '#3c4658',
  onSecondaryContainer: '#d8e3f9',
  secondaryFixed: '#d8e3f9',
  secondaryFixedDim: '#bcc7dc',
  onSecondaryFixed: '#111c2c',
  onSecondaryFixedVariant: '#3c4658',
  tertiary: '#ffb95f',
  onTertiary: '#472a00',
  tertiaryContainer: '#653e00',
  onTertiaryContainer: '#ffddb8',
  tertiaryFixed: '#ffddb8',
  tertiaryFixedDim: '#ffb95f',
  onTertiaryFixed: '#2a1700',
  onTertiaryFixedVariant: '#653e00',
  error: '#ffb4ab',
  onError: '#690005',
  errorContainer: '#93000a',
  onErrorContainer: '#ffdad6',
  bgPrimary: '#0f1413',
  bgSecondary: '#171d1b',
  bgCard: '#1b211f',
  bgCardElevated: '#262c2a',
  bgGlass: 'rgba(15, 20, 19, 0.90)',
  borderSubtle: 'rgba(255, 255, 255, 0.10)',
  borderStrong: 'rgba(255, 255, 255, 0.22)',
  textPrimary: '#dfe4e1',
  textSecondary: '#bfc9c5',
  textMuted: '#8a938f',
  greenPrimary: '#4edea3',
  greenBright: '#4edea3',
  greenDark: '#6ffbbe',
  greenSoftBg: 'rgba(78, 222, 163, 0.14)',
  greenBorder: 'rgba(78, 222, 163, 0.35)',
  redPrimary: '#ffb4ab',
  redBright: '#ffb4ab',
  redDark: '#ffdad6',
  redSoftBg: 'rgba(255, 180, 171, 0.14)',
  redBorder: 'rgba(255, 180, 171, 0.35)',
  goldPrimary: '#ffb95f',
  goldBright: '#ffb95f',
  goldSoftBg: 'rgba(255, 185, 95, 0.14)',
  goldBorder: 'rgba(255, 185, 95, 0.35)',
  accentIndigo: '#4edea3',
  accentCyan: '#4edea3',
  accentPurple: '#bcc7dc',
  accentCyanSoftBg: 'rgba(78, 222, 163, 0.14)',
  accentCyanBorder: 'rgba(78, 222, 163, 0.35)',
  indigoSoftBg: 'rgba(188, 199, 220, 0.12)',
  white: '#FFFFFF',
  black: '#0a0f0e',
};

const THEME_KEY = 'sp_theme';

/** Кой режим е избран: 'dark' | 'light' (по подразбиране — светлата). */
function readThemeMode(): 'light' | 'dark' {
  try {
    const g: any = globalThis as any;
    const ls = g?.localStorage;
    const saved = ls ? String(ls.getItem(THEME_KEY) || '') : '';
    if (saved === 'dark' || saved === 'light') return saved;
    if (g?.matchMedia && g.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {
    /* няма localStorage (нативно) — остава светлата */
  }
  return 'light';
}

/** Избраният режим за ТОВА зареждане на приложението. */
export const THEME_MODE: 'light' | 'dark' = readThemeMode();

/** Активната палитра — всички екрани я ползват през COLORS. */
export const COLORS = THEME_MODE === 'dark' ? DARK_COLORS : LIGHT_COLORS;

/**
 * Смяна на темата. На уеб презарежда страницата — единственият сигурен начин
 * всички вече създадени стилове (StyleSheet.create) да получат новите цветове.
 */
export function setThemeMode(mode: 'light' | 'dark'): void {
  try {
    const g: any = globalThis as any;
    g?.localStorage?.setItem(THEME_KEY, mode);
  } catch {
    /* ignore */
  }
  try {
    const g: any = globalThis as any;
    if (g?.location?.reload) g.location.reload();
  } catch {
    /* ignore */
  }
}


/**
 * Стандартизирани цветови тагове за търговските вериги според DESIGN.md и code.html
 */
export function getRetailChainStyle(chainName: string): {
  bg: string;
  text: string;
  border: string;
  label: string;
} {
  const norm = (chainName || '').toLowerCase();
  if (norm.includes('kaufland') || norm.includes('кауфланд')) {
    return {
      bg: 'rgba(255, 218, 214, 0.45)',
      text: '#ba1a1a',
      border: '#ffe4e6',
      label: 'KAUFLAND',
    };
  }
  if (norm.includes('lidl') || norm.includes('лидл')) {
    return {
      bg: '#dae2fd',
      text: '#131b2e',
      border: '#dbeafe',
      label: 'LIDL',
    };
  }
  if (norm.includes('billa') || norm.includes('билла') || norm.includes('била')) {
    return {
      bg: '#ffddb8',
      text: '#2a1700',
      border: '#fef08a',
      label: 'BILLA',
    };
  }
  if (norm.includes('фантастико') || norm.includes('fantastico')) {
    return {
      bg: 'rgba(111, 251, 190, 0.40)',
      text: '#005236',
      border: '#a7f3d0',
      label: 'ФАНТАСТИКО',
    };
  }
  if (norm.includes('т-маркет') || norm.includes('t-market') || norm.includes('t market')) {
    return {
      bg: '#dce9ff',
      text: '#3c4a42',
      border: '#cbdbf5',
      label: 'Т-МАРКЕТ',
    };
  }
  if (norm.includes('метро') || norm.includes('metro')) {
    return {
      bg: '#eff6ff',
      text: '#1d4ed8',
      border: '#bfdbfe',
      label: 'METRO',
    };
  }
  return {
    bg: '#dce9ff',
    text: '#3c4a42',
    border: '#cbdbf5',
    label: (chainName || 'МАГАЗИН').toUpperCase(),
  };
}

export const CATEGORIES: CategoryInfo[] = [
  {
    id: 'all',
    label: 'Всички категории',
    shortLabel: 'Всички',
    icon: 'apps',
    description: 'Всички находки и червени флагове',
  },
  {
    id: 'restaurants',
    label: 'Ресторанти и Заведения',
    shortLabel: 'Ресторанти',
    icon: 'restaurant',
    description: 'Порции, сметки, скрити такси и вкусна храна',
  },
  {
    id: 'hotels_airbnb',
    label: 'Хотели, Airbnb и Booking',
    shortLabel: 'Хотели & Airbnb',
    icon: 'bed',
    description: 'Обява срещу реалност, чистота, скрити условия',
  },
  {
    id: 'supermarket',
    label: 'Магазини и Продукти',
    shortLabel: 'Магазини',
    icon: 'cart',
    description: 'Хранителни стоки, промоции, шринкфлация',
  },
  {
    id: 'cafes_bars',
    label: 'Кафенета, Барове и Сладкарници',
    shortLabel: 'Кафе & Бар',
    icon: 'cafe',
    description: 'Цени на кафе, коктейли, десерти и обслужване',
  },
  {
    id: 'services_tech',
    label: 'Услуги, Техника и Авто',
    shortLabel: 'Услуги & Техника',
    icon: 'construct',
    description: 'Майстори, сервизи, електроника и битови разходи',
  },
  {
    id: 'vehicles',
    label: 'Авто и мото',
    shortLabel: 'Авто',
    icon: 'car',
    description: 'Коли, мотоциклети, части, ремонт и обслужване',
  },
  {
    id: 'real_estate',
    label: 'Имоти, наеми и продажби',
    shortLabel: 'Имоти',
    icon: 'home',
    description: 'Наеми, продажби, цени на квадрат и скрити разходи по имот',
  },
  {
    id: 'shops_places',
    label: 'Обекти, магазини и заведения',
    shortLabel: 'Обекти',
    icon: 'storefront',
    description: 'Нови и затворени обекти, обслужване, хигиена и цени',
  },
  {
    id: 'private_sellers',
    label: 'Частни продавачи и пазар',
    shortLabel: 'Частни продавачи',
    icon: 'people',
    description: 'Обяви от частни лица, сергии, пазар и втора употреба',
  },
  {
    id: 'other',
    label: 'Други стоки, обекти и услуги',
    shortLabel: 'Други',
    icon: 'ellipsis-horizontal-circle',
    description: 'Аптеки, бензиностанции, атракции, събития и всичко останало',
  },
];

export const PLATFORM_TAGS: PlatformTag[] = [
  'На място',
  'Супермаркет',
  'Онлайн магазин',
  'Доставка',
  'Airbnb',
  'Booking.com',
  'Пазар / Борса',
  'Други',
];

export const CITIES = [
  'Всички градове',
  'София',
  'Пловдив',
  'Варна',
  'Бургас',
  'Русе',
  'Стара Загора',
  'Плевен',
  'Сливен',
  'Добрич',
  'Шумен',
  'Перник',
  'Хасково',
  'Ямбол',
  'Пазарджик',
  'Благоевград',
  'Велико Търново',
  'Враца',
  'Габрово',
  'Асеновград',
  'Видин',
  'Казанлък',
  'Кюстендил',
  'Кърджали',
  'Монтана',
  'Димитровград',
  'Търговище',
  'Ловеч',
  'Силистра',
  'Разград',
  'Смолян',
  'Айтос',
  'Аксаково',
  'Албена',
  'Априлци',
  'Ардино',
  'Ахелой',
  'Ахтопол',
  'Балчик',
  'Банкя',
  'Банско',
  'Батак',
  'Белене',
  'Белица',
  'Белоградчик',
  'Белослав',
  'Берковица',
  'Бобов дол',
  'Божурище',
  'Боровец',
  'Ботевград',
  'Брацигово',
  'Брезник',
  'Бяла',
  'Бяла Слатина',
  'Велики Преслав',
  'Велинград',
  'Ветово',
  'Вълчедръм',
  'Вълчи дол',
  'Вършец',
  'Гълъбово',
  'Генерал Тошево',
  'Горна Оряховица',
  'Гоце Делчев',
  'Девин',
  'Девня',
  'Джебел',
  'Добринище',
  'Долна баня',
  'Долни Дъбник',
  'Дряново',
  'Дулово',
  'Дупница',
  'Елена',
  'Елин Пелин',
  'Елхово',
  'Етрополе',
  'Златица',
  'Златни пясъци',
  'Златоград',
  'Ивайловград',
  'Исперих',
  'Ихтиман',
  'Каварна',
  'Калофер',
  'Камено',
  'Карлово',
  'Карнобат',
  'к.к. Св. Константин и Елена',
  'Кнежа',
  'Козлодуй',
  'Копривщица',
  'Костенец',
  'Костинброд',
  'Котел',
  'Кочериново',
  'Кресна',
  'Кричим',
  'Крумовград',
  'Кубрат',
  'Кула',
  'Левски',
  'Лозница',
  'Лом',
  'Луковит',
  'Лъки',
  'Любимец',
  'Лясковец',
  'Мадан',
  'Малко Търново',
  'Мездра',
  'Мелник',
  'Момчилград',
  'Мъглиж',
  'Неделино',
  'Несебър',
  'Нова Загора',
  'Нови Искър',
  'Нови пазар',
  'Обзор',
  'Омуртаг',
  'Оряхово',
  'Павел баня',
  'Павликени',
  'Пампорово',
  'Панагюрище',
  'Перущица',
  'Петрич',
  'Пещера',
  'Пирдоп',
  'Полски Тръмбеш',
  'Поморие',
  'Попово',
  'Правец',
  'Приморско',
  'Провадия',
  'Първомай',
  'Раднево',
  'Радомир',
  'Разлог',
  'Ракитово',
  'Раковски',
  'Рила',
  'Роман',
  'Рудозем',
  'Садово',
  'Самоков',
  'Сандански',
  'Сапарева баня',
  'Свети Влас',
  'Свиленград',
  'Свищов',
  'Своге',
  'Севлиево',
  'Септември',
  'Симеоновград',
  'Симитли',
  'Слънчев бряг',
  'Сливница',
  'Смядово',
  'Созопол',
  'Сопот',
  'Средец',
  'Стамболийски',
  'Стражица',
  'Стралджа',
  'Стрелча',
  'Суворово',
  'Сунгурларе',
  'Съединение',
  'Твърдица',
  'Тервел',
  'Тетевен',
  'Тополовград',
  'Троян',
  'Трън',
  'Трявна',
  'Тутракан',
  'Хисаря',
  'Харманли',
  'Царево',
  'Чепеларе',
  'Червен бряг',
  'Черноморец',
  'Чирпан',
  'Шабла',
  'Шипка',
  'Якоруда',
];

export const DONATION_TIERS = [
  {
    id: 'coffee',
    amount: 2,
    emoji: '☕',
    title: 'Едно кафе',
    subtitle: 'Поддържа сървърите и OCR скенера за 50 бележки',
    badgeName: 'Поддръжник',
  },
  {
    id: 'guardian',
    amount: 5,
    emoji: '🛡️',
    title: 'Пазител на Цените',
    subtitle: 'Най-популярен избор! Отключва Златна Значка в профила',
    badgeName: 'Пазител на Общността',
    popular: true,
  },
  {
    id: 'legend',
    amount: 10,
    emoji: '🚀',
    title: 'Легенда на Общността',
    subtitle: 'Помага приложението да остане 100% без реклами и платени ревюта',
    badgeName: 'VIP Легенда',
  },
];
