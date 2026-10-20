export type PostPolarity = 'green' | 'red';

export type CategoryId =
  | 'all'
  | 'restaurants'
  | 'hotels_airbnb'
  | 'supermarket'
  | 'cafes_bars'
  | 'services_tech'
  | 'vehicles'
  | 'real_estate'
  | 'shops_places'
  | 'private_sellers'
  | 'other';

export interface CategoryInfo {
  id: CategoryId;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
}

export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  highlightReason?: string; // напр. "Скрита такса!" или "-45% реална отстъпка"
}

export interface ReceiptData {
  merchantName: string;
  merchantTaxId?: string;
  date: string;
  time?: string;
  totalAmount: number;
  currency: string;
  items: ReceiptItem[];
  verifiedByAi: boolean;
  confidenceScore: number;
  receiptImageUri?: string;
}

export interface PostReactions {
  // За Зелени постове (Находки)
  topDeal: number;     // 🔥 Топ Удар!
  worthIt: number;     // 👍 Струва си
  doubt: number;       // 🤔 Съмнително
  // За Червени постове (Червени флагове)
  pureRobbery: number; // 🚨 Чист Обир!
  avoid: number;       // 😤 Избягвай!
  exaggerated: number; // ⚖️ Преувеличено
}

export type ReactionKey = keyof PostReactions;

export interface CommentItem {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorAvatar: string;
  authorIsSupporter: boolean;
  text: string;
  imageUri?: string;
  reportedPrice?: number;
  createdAt: string;
  likes: number;
}

export type StandardPlatformTag =
  | 'На място'
  | 'Супермаркет'
  | 'Онлайн магазин'
  | 'Доставка'
  | 'Airbnb'
  | 'Booking.com'
  | 'Пазар / Борса'
  | 'Други';

export type PlatformTag = StandardPlatformTag | (string & {});

export interface PriceHistoryPoint {
  id: string;
  price: number;
  recordedAt: string;
  reportedBy: string;
  status: 'initial' | 'confirmed' | 'changed';
}

export interface PriceAlertItem {
  id: string;
  keyword: string;
  maxPrice?: number;
  city: string;
  polarity: 'green' | 'red' | 'any';
  createdAt: string;
  isActive: boolean;
}

/**
 * ⚔️ Ценова проверка: същият продукт при друг доставчик.
 * Идва от сървъра заедно с офертата (един ред на картата в лентата).
 */
export interface PostPriceCompare {
  /** Колко други оферти са за същия продукт. */
  twinCount: number;
  cheapestPrice: number;
  cheapestPlace: string | null;
  cheapestId: string | null;
  /** Колко € по-скъп е нашият (0 = ние сме най-евтини). */
  saving: number;
  savingPct: number;
  verdict: 'cheapest' | 'similar' | 'pricier' | 'rip-off';
}

/** Конкурентна оферта в дуелната карта (страница на оферта). */
export interface TwinOffer {
  id: string;
  code: string | null;
  title: string;
  price: number;
  place: string | null;
  city: string | null;
  source: string | null;
  platformTag: string | null;
  imageUrl: string | null;
  createdAt: string | null;
  address: string | null;
  mapsUrl: string | null;
  /** + = по-скъпо от нашата цена, − = по-евтино. */
  delta: number;
  deltaPct: number;
  cheaper: boolean;
  similarity: number;
}

/** Пълната дуелна карта. */
export interface PriceDuel extends PostPriceCompare {
  myPrice: number;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  overAvgPct: number;
  others: TwinOffer[];
}

export interface PostItem {
  id: string;
  code: string; // Публичен ID на офертата (напр. SP-7K2M4Q) — по него се търси
  polarity: PostPolarity; // 'green' = Изгодно / Находка, 'red' = Червен флаг / Не ходи!
  category: Exclude<CategoryId, 'all'>;
  customCategoryLabel?: string; // Потребителско описание при избор на Категория „Други“
  platformTag: PlatformTag;
  customPlatformLabel?: string; // Потребителско описание при избор на Платформа „Други“
  title: string;
  description: string;
  placeName: string;
  city: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  googleMapsUrl?: string;
  locationAutoDetected?: boolean;
  /**
   * Откъде идва цената: 'user' (качил я е човек) или 'receipt_basket' /
   * 'brochure' / 'tiktok_signal' / 'import' (внесена от редакцията).
   * Ползва се за етикета „от бон“ / „от брошура“ — за прозрачност.
   */
  source?: string;
  sourceNote?: string | null;
  /** Линк към продукта в онлайн магазина (при оферти от скрапер). */
  sourceUrl?: string | null;
  pricePaid: number;
  referencePrice?: number; // Очаквана/нормална цена за сравнение (колко е спестено или надвзето)
  currency: string;
  // Цена за 1 кг / 1 л и Детектор за Шринкфлация / Фалшиви промоции
  unitQuantity?: number;
  unitType?: 'g' | 'kg' | 'ml' | 'l' | 'pcs';
  pricePerKgOrLiter?: number;
  isShrinkflation?: boolean;
  isFakePromo?: boolean;
  // Потвърждаване на цената днес и История на цената
  verifiedValidTodayCount?: number;
  userConfirmedValidToday?: boolean;
  lastVerifiedAt?: string;
  priceHistory?: PriceHistoryPoint[];
  imageUri: string;
  comparisonImageUri?: string; // Втора снимка: "Обява в Booking/Меню vs Реалност"
  comparisonLabel?: string;
  // Частни продавачи: човек, който продава на определено място
  sellerType?: 'business' | 'private';
  sellerNote?: string; // допълнителен коментар: къде и кога го намираш
  sellerContact?: string;
  /** Идва само от /api/posts/bookmarks — бележката към любима оферта */
  favorite?: {
    savedAt: string | null;
    note: string | null;
    noteLat: number | null;
    noteLng: number | null;
  };
  receipt?: ReceiptData;
  author: {
    id: string;
    name: string;
    handle: string;
    avatar: string;
    isSupporter: boolean;
    badgeTitle: string;
  };
  createdAt: string;
  reactions: PostReactions;
  userReaction?: ReactionKey;
  helpedCount: number; // Брой хора натиснали "Спести ми пари / Спаси ме от капан"
  signalCount?: number; // Брой независими сигнали за същата оферта (Facebook групи)
  /** ⚔️ Същият продукт при друг доставчик — за чипа „по-евтино другаде“. */
  compare?: PostPriceCompare;
  communitySavedBgn: number; // Общо спестени € на общността от този пост
  userMarkedHelped?: boolean;
  isBookmarked?: boolean;
  comments: CommentItem[];
  tags: string[];
}

export interface BadgeItem {
  id: string;
  title: string;
  icon: string;
  description: string;
  unlocked: boolean;
  color: string;
  /** Колко е напреднал потребителят по условието на значката. */
  progress?: number;
  /** При каква стойност се отключва. */
  threshold?: number;
  /** От какво зависи значката (за да знаем мерната единица). */
  metric?: string | null;
}

export type LeaderboardSort = 'saved' | 'checkers' | 'points';

export interface LeaderboardUser {
  id: string;
  rank: number;
  name: string;
  handle: string;
  avatar: string;
  isSupporter: boolean;
  verifiedReceipts: number;
  communitySavedBgn: number;
  greenPosts: number;
  redFlagsExposed: number;
  /** Точки доверие (трупат се и от проверки на цени). */
  reputationPoints: number;
  /** Колко чужди цени е проверил на място. */
  priceChecks: number;
  /** Колко от тях са били реални поправки. */
  priceCorrections: number;
  /** Проверки през последните 7 дни. */
  checksLast7d: number;
  badgeTitle: string;
}

export interface DonationRecord {
  id: string;
  amountBgn: number;
  tierName: string;
  isMonthly: boolean;
  createdAt: string;
  paymentIntentId: string;
}

export interface UserProfile {
  id: string;
  name: string;
  handle: string;
  email: string;
  avatar: string;
  bio: string;
  city: string;
  role?: 'user' | 'admin';
  isAdmin?: boolean;
  isSupporter: boolean;
  supporterSince?: string;
  supporterTier?: 'coffee' | 'guardian' | 'legend';
  totalDonatedBgn: number;
  totalSavedForCommunityBgn: number;
  personalSavedBgn: number;
  postsCount: number;
  verifiedReceiptsCount: number;
  reputationPoints: number;
  /** Личен код за покана (напр. A1B2C3). */
  referralCode: string;
  /** Колко точки са дошли ИМЕННО от покани. */
  referralPoints: number;
  /** Колко души са дошли по моя код. */
  referralsInvited: number;
  /** Колко от тях са потвърдили имейла (реално наградени). */
  referralsRewarded: number;
  /** Чакащи потвърждение. */
  referralsPending: number;
  badges: BadgeItem[];
  donations: DonationRecord[];
  /** Откъде идва цената: 'user' | 'receipt_basket' | 'brochure' | 'tiktok_signal' | 'import' */
  source?: string;
  sourceNote?: string | null;
  /** Кога е създаден профилът (ISO низ). Ползва се за прозореца на „Основател“. */
  createdAt?: string | null;
  lastDonationPromptAt: number | null;
  interactionsSincePrompt: number;
  nudgeSnoozedUntil: number | null;
}
