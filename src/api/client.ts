import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { firstTouch, type FirstTouch } from '@/lib/firstTouch';
import type {
  CategoryId,
  CommentItem,
  LeaderboardSort,
  LeaderboardUser,
  PlatformTag,
  PostItem,
  PriceDuel,
  PostPolarity,
  PriceAlertItem,
  ReactionKey,
  ReceiptData,
  UserProfile,
} from '@/types';

/**
 * Единствената точка за връзка със сървъра.
 * Никакви фалшиви fallback-и: ако сървърът не отговори, хвърляме ApiError,
 * а UI-ът показва честна грешка вместо измислени данни.
 */

const FALLBACK_HOST =
  Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://127.0.0.1:4000';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || FALLBACK_HOST).replace(/\/$/, '');

const TOKEN_KEY = '@smartprice_tokens_v1';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Грешка при липса на връзка със сървъра (не е отговор на сървъра). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

let memoryTokens: Tokens | null = null;
let refreshPromise: Promise<Tokens | null> | null = null;
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export async function loadTokens(): Promise<Tokens | null> {
  if (memoryTokens) return memoryTokens;
  try {
    const raw = await AsyncStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    memoryTokens = JSON.parse(raw) as Tokens;
    return memoryTokens;
  } catch {
    return null;
  }
}

export async function saveTokens(tokens: Tokens | null): Promise<void> {
  memoryTokens = tokens;
  try {
    if (tokens) await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // кешът в паметта е достатъчен за текущата сесия
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  /** Вътрешно: предотвратява безкраен цикъл при refresh. */
  retryOn401?: boolean;
  timeoutMs?: number;
}

async function refreshTokens(): Promise<Tokens | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const current = await loadTokens();
    if (!current?.refreshToken) return null;
    try {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!response.ok) {
        await saveTokens(null);
        return null;
      }
      const data = (await response.json()) as Tokens;
      await saveTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      return data;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, retryOn401 = true, timeoutMs = 20000 } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';

  if (auth) {
    const tokens = await loadTokens();
    if (tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiError(
      0,
      'network_error',
      `Няма връзка със сървъра (${API_URL}). Провери, че API-то работи и телефонът е в същата мрежа.`,
      err
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 && auth && retryOn401) {
    // Ако изобщо не е имало токен, човекът е гост (гледа потока без профил).
    // Тогава „Сесията е изтекла“ е подвеждащо — казваме му какво да направи.
    const hadToken = Boolean(headers.Authorization);
    const refreshed = hadToken ? await refreshTokens() : false;
    if (refreshed) {
      return rawRequest<T>(path, { ...options, retryOn401: false });
    }
    await saveTokens(null);
    onUnauthorized?.();
    if (!hadToken) {
      throw new ApiError(
        401,
        'auth_required',
        'За да гласуваш, да коментираш или да качиш находка, трябва профил — отнема 30 секунди.'
      );
    }
    throw new ApiError(401, 'unauthorized', 'Сесията е изтекла. Влез отново.');
  }

  const text = await response.text();
  const parsed: unknown = text ? safeJson(text) : null;

  if (!response.ok) {
    const errorShape = (parsed as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(
      response.status,
      errorShape?.code ?? 'http_error',
      errorShape?.message ?? `Грешка от сървъра (${response.status}).`,
      errorShape?.details
    );
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Качва снимка (multipart) и връща публичния ѝ адрес. */
/** Оферта за същия продукт, намерена на друго място. */
export interface SimilarOffer {
  id: string;
  public_code?: string;
  title: string;
  price: string | number;
  city?: string;
  place_name?: string;
  platform_tag?: string;
  source?: string;
  image_url?: string;
  polarity?: string;
  created_at?: string;
  address?: string;
  google_maps_url?: string;
}

/**
 * „Същият продукт другаде“ — всички други цени за този продукт.
 *
 * Смисълът на приложението е да сравниш: намерил си олио за 5 € — ами ако
 * същото е 3.50 € в магазина отсреща? Сървърът сравнява по заглавие и връща
 * офертите подредени от най-евтината.
 */
export async function loadSimilarOffers(
  postId: string
): Promise<{ key: string; count: number; items: SimilarOffer[]; duel: PriceDuel | null }> {
  return rawRequest<{ key: string; count: number; items: SimilarOffer[]; duel: PriceDuel | null }>(
    `/api/posts/${postId}/similar`
  );
}

/* ============================================================ ЧАСТНИ ОБЯВИ
 * Обявите, които ПОТРЕБИТЕЛИТЕ пускат (не нашите находки). Платени са:
 * 2 € за 60 дни, могат да се спрат и да се отбележат като продадени.
 */

export interface ListingOption {
  id: string;
  label: string;
}

export interface ListingConfigPublic {
  priceEur: number;
  days: number;
  maxImages: number;
  maxActive: number;
  remindBeforeDays: number;
  currency: string;
  choices: {
    conditions: ListingOption[];
    handovers: ListingOption[];
    categories: ListingOption[];
  };
}

export type ListingStatus =
  | 'draft'
  | 'pending_payment'
  | 'active'
  | 'paused'
  | 'sold'
  | 'expired'
  | 'rejected';

export interface UserListing {
  id: string;
  user_id: string;
  title: string;
  description: string;
  price_eur: number | null;
  is_negotiable: boolean;
  is_free: boolean;
  category: string;
  subcategory: string | null;
  city: string;
  neighborhood: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  item_condition: string;
  contact_phone: string | null;
  contact_note: string | null;
  handover: string;
  status: ListingStatus;
  days: number;
  paid_until: string | null;
  activated_at: string | null;
  sold_at: string | null;
  price_paid_eur: number | null;
  renewals: number;
  views_count: number;
  saves_count: number;
  contacts_count: number;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
  /** До 5 адреса на снимки. */
  images: string[];
  /** Колко дни остават от платения срок. */
  daysLeft?: number | null;
}

export interface MyListingsResponse {
  stats: {
    active: number;
    paused: number;
    sold: number;
    expired: number;
    drafts: number;
    spentEur: number;
    views: number;
  };
  items: UserListing[];
}

export interface ListingNudgeInfo {
  show: boolean;
  reason: string;
  cooldownDays?: number;
  off: boolean;
}

export interface PuzzleDemoInfo {
  show: boolean;
  seen: number;
  bestMs: number | null;
  reason: string;
}

export interface NewListingInput {
  title: string;
  description?: string;
  priceEur?: number | null;
  isNegotiable?: boolean;
  isFree?: boolean;
  category?: string;
  city: string;
  neighborhood?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  itemCondition?: string;
  contactPhone?: string | null;
  contactNote?: string | null;
  handover?: string;
  images: string[];
}

export interface ListingCheckoutResult {
  checkoutUrl: string;
  sessionId: string;
  paymentId: string;
  amountEur: number;
  message?: string;
}

export async function uploadImage(uri: string): Promise<string> {
  const tokens = await loadTokens();
  const form = new FormData();

  if (Platform.OS === 'web') {
    // На web uri е blob:/data: адрес → взимаме самия файл
    const blob = await (await fetch(uri)).blob();
    const extension = blob.type.split('/')[1] ?? 'jpg';
    form.append('file', blob, `photo.${extension}`);
  } else {
    const name = uri.split('/').pop() ?? 'photo.jpg';
    const match = /\.(\w+)$/.exec(name);
    const extension = match?.[1]?.toLowerCase() ?? 'jpg';
    const type = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
    form.append('file', { uri, name, type } as unknown as Blob);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/uploads`, {
      method: 'POST',
      headers: tokens?.accessToken ? { Authorization: `Bearer ${tokens.accessToken}` } : {},
      body: form,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Качването на снимката не успя — няма връзка със сървъра.');
  }

  const text = await response.text();
  const parsed = text ? safeJson(text) : null;
  if (!response.ok) {
    const errorShape = (parsed as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(
      response.status,
      errorShape?.code ?? 'upload_failed',
      errorShape?.message ?? 'Качването на снимката не успя.'
    );
  }
  return (parsed as { url: string }).url;
}

// ---------------------------------------------------------------- Типове отговори

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  profile: UserProfile;
}

/** Отговорът при регистрация: НЯМА токени, докато имейлът не се потвърди. */
export interface RegisterResponse {
  requiresVerification: true;
  email: string;
  /** Дали кодът за покана е приет (точките идват след потвърждаване на имейла). */
  referralApplied?: boolean;
  /** Името на човека, който го е поканил — за да го поздравим по име. */
  referralInviterName?: string;
  /** Дали сървърът изобщо може да праща имейли (RESEND_API_KEY) */
  emailSent: boolean;
  message: string;
  /** Връща се САМО в dev режим (EXPOSE_DEV_CODES=true извън production). */
  devCode?: string;
}

export interface ResendCodeResponse {
  sent: boolean;
  emailSent: boolean;
  alreadyVerified?: boolean;
  message: string;
  devCode?: string;
}

export interface ForgotPasswordResponse {
  ok: true;
  emailSent: boolean;
  message: string;
  devCode?: string;
}

export interface ChainDifference {
  category: string;
  cheapest_chain: string;
  cheapest_median: number;
  /** Колко еднакви продукта има в двете сравнявани вериги. */
  matched_products: number;
  priciest_chain: string;
  priciest_median: number;
  diff_eur: number;
  diff_pct: number;
  chains_compared: number;
}

export interface BasketComparison {
  city: string | null;
  itemsTotal: number;
  best: { chain: string; total: number; found: number; missing: number } | null;
  bestPair: { chains: [string, string]; total: number; found: number; missing: number } | null;
  pairSaving: number | null;
  chains: Array<{ chain: string; total: number; found: number; missing: number }>;
  rows: Array<{
    title: string;
    quantity: number;
    cheapest: { chain: string; price: number; offerTitle: string; postId: string } | null;
    perChain: Array<{ chain: string; price: number; offerTitle: string; postId: string }>;
  }>;
}

export interface FeedResponse {
  items: PostItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface CommunityStats {
  totalPosts: number;
  greenPosts: number;
  redPosts: number;
  verifiedReceipts: number;
  communitySavedBgn: number;
  contributors: number;
  raisedThisMonthBgn: number;
  supporters: number;
}

export interface FeatureFlags {
  ocr: boolean;
  payments: boolean;
  mail: boolean;
  /** AI съветникът „Ценко“ (чат в приложението) — включен ли е на сървъра. */
  assistant?: boolean;
  ocrModel: string | null;
  /** Бонус за новодошли: първа находка до N минути → значка + точки. */
  founderBonus?: { windowMin: number; points: number } | null;
}

export interface AlertWithMatches extends PriceAlertItem {
  matches: Array<{ id: string; title: string; pricePaid: number; polarity: PostPolarity }>;
}

export interface CheckoutResponse {
  donationId: string;
  checkoutUrl: string;
  sessionId: string;
  /** Сумата в конфигурираната валута (EUR — Stripe вече не приема BGN). */
  amount: number;
  currency: string;
  isMonthly: boolean;
  message: string;
}

export interface OcrReceipt extends ReceiptData {
  model?: string;
}

export interface PuzzleTile {
  id: string;
  imageUrl: string;
  /** Хеш на продукта: две плочки с еднакъв pairId са двойка (името не се издава). */
  pairId: string | null;
  label: string;
}

export interface RafflePrize {
  title: string;
  url: string;
  image: string;
  price: number | null;
  currency: string;
}

export interface RaffleEntryState {
  qualified: boolean;
  practiceUsed: number;
  practiceLeft: number;
  bestPracticeMs: number | null;
  runTimeMs: number | null;
  runStarted: boolean;
  disqualified?: boolean;
}

export interface RaffleItem {
  id: string;
  title: string;
  description: string;
  prize: RafflePrize;
  conditionPosts: number;
  conditionImagesOnly: boolean;
  /** Находките трябва да са от поне толкова различни дни. */
  conditionDistinctDays?: number;
  /** Профилът трябва да е на поне толкова дни. */
  minAccountAgeDays?: number;
  /** Имейлът трябва да е потвърден преди поне толкова дни. */
  minVerifiedAgeDays?: number;
  /** Синхронен старт: кога ВСИЧКИ играят официалното нареждане. */
  officialWindowMin?: number;
  officialWindow?: {
    synced: boolean;
    open: boolean;
    opensAt: string | null;
    closesAt: string | null;
    opensInSeconds: number;
    closesInSeconds: number;
  };
  countFromStart: boolean;
  minParticipants: number;
  startsAt: string | null;
  endsAt: string;
  status: 'draft' | 'active' | 'running' | 'finished' | 'cancelled';
  cancelReason: string | null;
  winnerId: string | null;
  winningTimeMs: number | null;
  qualifiedCount: number;
  finishedAt: string | null;
  secondsLeft: number;
  myProgress?: number;
  /** Колко находки от различни дни имам (за условието „от ≥2 дни“). */
  myDaysCount?: number;
  daysNeeded?: number;
  // --- спонсор и правила (миграция 021) ---
  sponsor?: { name: string; url: string } | null;
  rules?: string;
  deliveryNote?: string;
  /** Как се печели: първият изпълнил условието или най-бързото нареждане. */
  winMode?: 'fastest_puzzle' | 'first_to_complete';
  prizeKind?: 'product' | 'cash' | 'service' | 'other';
  prizeValueEur?: number | null;
  claimDeadlineDays?: number;
  queueOrder?: number;
  autoActivateNext?: boolean;
  closedReason?: string | null;
  postsNeeded?: number;
  practiceAttempts?: number;
  myEntry?: RaffleEntryState | null;
  entries?: number;
}

export interface RaffleStanding {
  rank: number | null;
  userId: string;
  name: string;
  handle: string;
  avatar: string;
  runTimeMs: number | null;
  practiceUsed: number;
  bestPracticeMs: number | null;
  qualifiedAt: string | null;
  runFinishedAt: string | null;
  disqualified: boolean;
}

/** Пълните резултати от томбола — виждат ги ВСИЧКИ, не само участниците. */
export interface RaffleResults {
  final: boolean;
  /** Сайтът в демо режим ли е. При демо режим участниците не се маркират като демо. */
  demoMode?: boolean;
  winner: {
    userId: string;
    name: string;
    handle: string;
    avatar: string;
    timeMs: number | null;
    /** Демо (тестов) играч — не е реален човек. */
    isDemo?: boolean;
  } | null;
  stats: {
    participants: number;
    finished: number;
    disqualified: number;
    fastestMs: number | null;
    averageMs: number | null;
    slowestMs: number | null;
    practiceUsedTotal: number;
  };
  rows: {
    rank: number | null;
    userId: string;
    name: string;
    handle: string;
    avatar: string;
    runTimeMs: number | null;
    practiceUsed: number;
    bestPracticeMs: number | null;
    joinedAt: string;
    runFinishedAt: string | null;
    disqualified: boolean;
    /** Демо (тестов) играч — не е реален човек. */
    isDemo?: boolean;
  }[];
  timeline: { kind: string; label: string; at: string; user: string | null; timeMs: number | null }[];
}

export interface RaffleWinner {
  raffleId: string;
  title: string;
  prizeTitle: string;
  prizeImage: string;
  finishedAt: string | null;
  winningTimeMs: number | null;
  winner: { name: string; handle: string; avatar: string } | null;
}

export interface AdminRaffleInput {
  title: string;
  description?: string;
  prizeTitle: string;
  prizeUrl?: string;
  prizeImageUrl?: string;
  prizePrice?: number;
  conditionPosts?: number;
  conditionImagesOnly?: boolean;
  minParticipants?: number;
  countFromStart?: boolean;
  startsAt?: string;
  endsAt: string;
  activate?: boolean;
}

/**
 * Отговор от проверката на цената в онлайн магазина (за сверка с нашата цена).
 * Ако `ok` е false — `reason` казва честно защо (магазинът не отговори и т.н.).
 */
export interface ShopPriceCheck {
  ok: boolean;
  priceEur?: number;
  /** Редовната цена в магазина (когато страницата показва и промо цена). */
  listPriceEur?: number;
  title?: string;
  checkedAt: string;
  reason?: string;
  cached?: boolean;
  /**
   * Магазинът блокира автоматични проверки от нашия сървър (Cloudflare).
   * Тогава `stored` носи последната РЕАЛНО проверена цена.
   */
  blocked?: boolean;
  stored?: {
    priceEur: number;
    listPriceEur?: number;
    checkedAt: string;
    /** 'server' = проверил сървърът; 'local' = проверил нашият робот от домашен IP. */
    checkedBy: string;
  };
  ourPriceEur: number;
  shopName: string;
  postTitle: string;
  /** Положителна = в магазина е по-скъпо; отрицателна = по-евтино. */
  diffEur: number | null;
}

export interface ReferralSummary {
  code: string;
  link: string;
  /** Колко точки носи една успешна покана (за двамата). */
  pointsPerInvite: number;
  invited: number;
  rewarded: number;
  pending: number;
  pointsEarned: number;
  invitedUsers: Array<{
    id: string;
    name: string;
    handle: string;
    avatar: string;
    status: 'pending' | 'rewarded' | 'void';
    points: number;
    createdAt: string;
    rewardedAt: string | null;
  }>;
  shareText: string;
}

export interface ReferralCheck {
  valid: boolean;
  inviterName?: string;
  inviterHandle?: string;
  inviterAvatar?: string;
  link?: string;
}

export interface CreatePostPayload {
  polarity: PostPolarity;
  category: Exclude<CategoryId, 'all'>;
  customCategoryLabel?: string;
  platformTag: PlatformTag;
  customPlatformLabel?: string;
  title: string;
  description: string;
  placeName: string;
  city: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  googleMapsUrl?: string;
  locationAutoDetected?: boolean;
  pricePaid: number;
  referencePrice?: number;
  unitQuantity?: number;
  unitType?: 'g' | 'kg' | 'ml' | 'l' | 'pcs';
  isShrinkflation?: boolean;
  isFakePromo?: boolean;
  imageUrl: string;
  comparisonImageUrl?: string;
  comparisonLabel?: string;
  tags?: string[];
  receipt?: {
    merchantName: string;
    merchantTaxId?: string;
    date?: string;
    time?: string;
    totalAmount: number;
    currency: 'BGN' | 'EUR';
    confidenceScore: number;
    verifiedByAi: boolean;
    source: 'manual' | 'openrouter' | 'openai';
    model?: string;
    imageUrl?: string;
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
      totalPrice?: number;
      highlightReason?: string;
    }>;
  };
}

export interface FeedQuery {
  polarity?: PostPolarity;
  category?: string;
  city?: string;
  q?: string;
  /** Таг на обект (слуг) — само офертите на този обект (място + град). */
  place?: string;
  /** 🛒 Само офертите на една верига за супермаркети (Кауфланд, Метро…). */
  chain?: string;
  /** 🛒 Без внесените каталожни цени — класациите на Радара (места/доклади от хора). */
  excludeCatalog?: boolean;
  sort?: 'newest' | 'best_savings' | 'lowest_price' | 'highest_price' | 'most_helped';
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------- API

// ------------------------------------------------- AI съветник „Ценко“

/** Какво може да „натисне“ човекът след отговора на Ценко. */
export type AssistantAction =
  | 'check_price'
  | 'add_post'
  | 'radar'
  | 'invite'
  | 'leaderboard'
  | 'favorites'
  | 'search'
  | 'latest'
  | 'tour'
  | 'donate'
  | 'nearby'
  | 'none';

export interface AssistantSuggestion {
  label: string;
  action: AssistantAction;
}

export interface AssistantReply {
  reply: string;
  /** Простите стъпки (когато Ценко обяснява „как се прави“). Иначе — празно. */
  steps: string[];
  /** Настроението на Ценко — за малък бадж/иконка в чата. */
  mood: string;
  suggestions: AssistantSuggestion[];
  model: string;
  latencyMs: number;
}

export interface AssistantTopic {
  id: string;
  title: string;
  question: string;
  category: string;
}

export interface AssistantQuota {
  enabled: boolean;
  limit: number;
  used: number;
  left: number;
}

export const api = {
  health: () => rawRequest<{ status: string; database: boolean }>('/api/health', { auth: false }),

  features: () => rawRequest<FeatureFlags>('/api/health/features', { auth: false }),

  register: (input: {
    email: string;
    password: string;
    name: string;
    city?: string;
    /** Телефонен номер — задължителен. Един номер = един акаунт. */
    phone: string;
    /** Код за покана от приятел (по избор). */
    ref?: string;
    /** Откъде е дошъл кодът — за статистика по канал. */
    refChannel?: string;
    /** Първо докосване (utm/referrer). Ако не се подаде — взима се само. */
    source?: FirstTouch;
  }) =>
    rawRequest<RegisterResponse>('/api/auth/register', {
      method: 'POST',
      // Откъде е дошъл човекът — за статистиката в панела (не чупи входа,
      // ако няма запис: полето просто не се праща).
      body: { ...input, source: input.source ?? firstTouch() },
      auth: false,
    }),

  login: (input: { email: string; password: string; source?: FirstTouch }) =>
    rawRequest<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: { ...input, source: input.source ?? firstTouch() },
      auth: false,
    }),

  /** Потвърждава имейла с кода от писмото и влиза директно. */
  verifyEmail: (input: { email: string; code: string }) =>
    rawRequest<AuthResponse>('/api/auth/verify-email', {
      method: 'POST',
      body: input,
      auth: false,
    }),

  /** Иска нов код (потвърждение или нова парола). */
  resendCode: (input: { email: string; purpose: 'email_verify' | 'password_reset' }) =>
    rawRequest<ResendCodeResponse>('/api/auth/resend-code', {
      method: 'POST',
      body: input,
      auth: false,
    }),

  /** Заявка за код за нова парола. Отговорът е еднакъв за познат и непознат имейл. */
  forgotPassword: (input: { email: string }) =>
    rawRequest<ForgotPasswordResponse>('/api/auth/forgot-password', {
      method: 'POST',
      body: input,
      auth: false,
    }),

  /** Задава нова парола с кода от писмото и влиза директно. */
  resetPassword: (input: { email: string; code: string; newPassword: string }) =>
    rawRequest<AuthResponse>('/api/auth/reset-password', {
      method: 'POST',
      body: input,
      auth: false,
    }),

  me: () => rawRequest<{ profile: UserProfile }>('/api/auth/me'),

  updateProfile: (input: { name?: string; bio?: string; city?: string; avatarUrl?: string }) =>
    rawRequest<{ profile: UserProfile }>('/api/auth/me', { method: 'PATCH', body: input }),

  feed: (query: FeedQuery = {}) => {
    const params = new URLSearchParams();
    if (query.polarity) params.set('polarity', query.polarity);
    if (query.category && query.category !== 'all') params.set('category', query.category);
    if (query.city && query.city !== 'Всички градове') params.set('city', query.city);
    if (query.q?.trim()) params.set('q', query.q.trim());
    if (query.place) params.set('place', query.place);
    // 🛒 Само офертите на една верига (чиповете „Всички вериги / Кауфланд…“).
    if (query.chain) params.set('chain', query.chain);
    // 🛒 Без внесените каталожни цени — за класациите на Радара (места и доклади).
    if (query.excludeCatalog) params.set('excludeCatalog', 'true');
    if (query.sort) params.set('sort', query.sort);
    params.set('limit', String(query.limit ?? 60));
    params.set('offset', String(query.offset ?? 0));
    return rawRequest<FeedResponse>(`/api/posts?${params.toString()}`);
  },

  /**
   * Класация на обектите за „Радар“ — смята се в базата върху ВСИЧКИ постове,
   * не само върху заредените (иначе черният списък показваше 1 обект).
   */
  /**
   * ⚖️ „Разлики между веригите“ — по категории: най-евтината и най-скъпата
   * верига и колко се различават (сметката е на сървъра, по ТИПИЧНА цена).
   */
  chainDifferences: (city?: string) => {
    const params = new URLSearchParams();
    if (city && city !== 'Всички градове') params.set('city', city);
    return rawRequest<{ items: ChainDifference[] }>(
      `/api/chains/differences${params.toString() ? `?${params.toString()}` : ''}`
    );
  },

  /**
   * 🛒 Колко би струвал ЦЯЛ списък за покупки по вериги.
   *
   * Смята се на сървъра върху ВСИЧКИ внесени цени (не само върху заредената
   * лента) — за всеки продукт от списъка намира най-евтиното съвпадение във
   * всяка верига и после сумира: по верига, най-евтината една верига и
   * най-евтината ДВОЙКА вериги.
   */
  basketCompare: (body: { items: Array<{ title: string; quantity?: number }>; city?: string }) =>
    rawRequest<BasketComparison>('/api/basket/compare', { method: 'POST', body, auth: false }),

  /**
   * 🛒 Кои вериги за супермаркети има в базата (за чиповете над потока).
   * Връща само вериги, в които НАИСТИНА има внесени оферти, с техния брой.
   */
  chains: (city?: string) => {
    const params = new URLSearchParams();
    if (city && city !== 'Всички градове') params.set('city', city);
    return rawRequest<{
      /** 📊 Обобщение за видимия брояч в потока: колко цени, от колко вериги, в колко града. */
      stats: { offers: number; chains: number; cities: number; products: number };
      items: Array<{ name: string; offers: number; minPrice: number | null }>;
    }>(`/api/posts/chains${params.toString() ? `?${params.toString()}` : ''}`);
  },

  venueRanking: (query: { polarity: 'red' | 'green'; category?: string; city?: string; limit?: number }) => {
    const params = new URLSearchParams({ polarity: query.polarity, limit: String(query.limit ?? 10) });
    if (query.category && query.category !== 'all') params.set('category', query.category);
    if (query.city && query.city !== 'Всички градове') params.set('city', query.city);
    return rawRequest<{
      polarity: string;
      items: Array<{
        placeName: string;
        city: string;
        /** Слуг на обекта — за да се отворят всички оферти с този таг. */
        slug?: string;
        address?: string;
        score: number;
        reportsCount: number;
        hasReceipt: boolean;
      }>;
    }>(`/api/posts/venues?${params.toString()}`);
  },

  post: (id: string) => rawRequest<{ post: PostItem }>(`/api/posts/${id}`),

  /**
   * Цената в онлайн магазина „сега“ — за сверяване с нашата цена.
   * Публичен е (работи и за гост). `refresh` = 1 заобикаля 10-минутния кеш.
   *
   * Проверката отваря страницата на магазина в истински браузър на сървъра и
   * трае 8–20 секунди. Затова тук таймаутът е 60 сек, а не общите 20: иначе
   * приложението прекъсваше заявката и бутонът изглеждаше „счупен“.
   */
  shopPrice: (id: string, refresh = false) =>
    rawRequest<ShopPriceCheck>(`/api/posts/${id}/shop-price${refresh ? '?refresh=1' : ''}`, {
      timeoutMs: 60_000,
    }),

  /** Търсене по ID на офертата (числов код, напр. 48219357). Работи и без вход. */
  postByCode: (code: string) =>
    rawRequest<{ post: PostItem }>(`/api/posts/by-code/${encodeURIComponent(code.trim())}`),

  bookmarks: () => rawRequest<{ items: PostItem[]; total: number }>('/api/posts/bookmarks'),

  /** Смяна на паролата, докато си влязъл (иска текущата парола). */
  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    rawRequest<{ ok: boolean; message: string }>('/api/auth/change-password', {
      method: 'POST',
      body: payload,
    }),

  /** Бележка и собствено място към любима оферта. */
  setBookmarkNote: (postId: string, payload: { note?: string | null; lat?: number | null; lng?: number | null }) =>
    rawRequest<{ ok: boolean }>(`/api/posts/${postId}/bookmark`, { method: 'PATCH', body: payload }),

  /** Победител подава данни за доставка на наградата. */
  raffleClaim: (
    raffleId: string,
    body: { name: string; phone: string; city: string; address: string; note?: string }
  ) => rawRequest<{ ok: boolean }>(`/api/raffles/${raffleId}/claim`, { method: 'POST', body }),

  /** Данните за доставка на моята печалба (само за победителя). */
  raffleWin: (raffleId: string) =>
    rawRequest<{
      prizeTitle: string;
      sponsorName: string;
      status: string;
      deliveryNote: string;
      delivery: { name: string | null; phone: string | null; city: string | null; address: string | null; note: string | null } | null;
      isMine: boolean;
      wonAt: string | null;
      trackingNote: string | null;
    }>(`/api/raffles/${raffleId}/win`),

  /** Моите томболи: участия, резултати, кой е спечелил. */
  myRaffles: () =>
    rawRequest<{
      stats: { postsTotal: number; postsWithPhoto: number; wins: number; entries: number };
      items: Array<{
        raffleId: string;
        title: string;
        prizeTitle: string;
        prizeImage: string;
        sponsorName: string;
        status: string;
        iWon: boolean;
        winStatus: string | null;
        winner: { name: string; city: string } | null;
        joinedAt: string | null;
        finishedAt: string | null;
        endsAt: string | null;
      }>;
    }>('/api/raffles/mine'),

  /** Публична история: коя томбола, каква награда, кой спечели. */
  raffleHistory: (limit = 30) =>
    rawRequest<{ items: Array<Record<string, unknown>> }>(`/api/raffles/history?limit=${limit}`, {
      auth: false,
    }),

  createPost: (payload: CreatePostPayload) =>
    rawRequest<{
      post: PostItem;
      profile: UserProfile;
      /** Значка „Основател“, ако точно тази публикация я е отключила. */
      founderBonus?: { title: string; points: number } | null;
    }>('/api/posts', {
      method: 'POST',
      body: payload,
    }),

  deletePost: (id: string) => rawRequest<{ ok: boolean }>(`/api/posts/${id}`, { method: 'DELETE' }),

  updatePost: (id: string, payload: { title?: string; description?: string; referencePrice?: number | null }) =>
    rawRequest<{ post: PostItem }>(`/api/posts/${id}`, { method: 'PATCH', body: payload }),

  toggleReaction: (postId: string, reactionKey: ReactionKey) =>
    rawRequest<{ post: PostItem }>(`/api/posts/${postId}/reactions`, {
      method: 'POST',
      body: { reactionKey },
    }),

  markHelped: (postId: string) =>
    rawRequest<{ marked: boolean; savedAmount: number; post: PostItem; profile: UserProfile }>(
      `/api/posts/${postId}/helped`,
      { method: 'POST' }
    ),

  confirmPrice: (postId: string) =>
    rawRequest<{ post: PostItem; profile: UserProfile }>(`/api/posts/${postId}/confirm`, {
      method: 'POST',
    }),

  reportPrice: (postId: string, price: number) =>
    rawRequest<{ post: PostItem; profile: UserProfile }>(`/api/posts/${postId}/price`, {
      method: 'POST',
      body: { price },
    }),

  toggleBookmark: (postId: string) =>
    rawRequest<{ isBookmarked: boolean }>(`/api/posts/${postId}/bookmark`, { method: 'POST' }),

  reportPost: (postId: string, reason: string, details?: string) =>
    rawRequest<{ ok: boolean; message: string }>(`/api/posts/${postId}/report`, {
      method: 'POST',
      body: { reason, details },
    }),

  comments: (postId: string) => rawRequest<{ items: CommentItem[] }>(`/api/posts/${postId}/comments`),

  addComment: (postId: string, input: { text?: string; imageUrl?: string; reportedPrice?: number }) =>
    rawRequest<{ comment: CommentItem }>(`/api/posts/${postId}/comments`, {
      method: 'POST',
      body: input,
    }),

  likeComment: (commentId: string) =>
    rawRequest<{ liked: boolean; comment: CommentItem | null }>(`/api/comments/${commentId}/like`, {
      method: 'POST',
    }),

  deleteComment: (commentId: string) =>
    rawRequest<{ ok: boolean }>(`/api/comments/${commentId}`, { method: 'DELETE' }),

  communityStats: () => rawRequest<CommunityStats>('/api/community/stats', { auth: false }),

  leaderboard: (limit = 50, sort: LeaderboardSort = 'saved') =>
    rawRequest<{ items: LeaderboardUser[]; sort: LeaderboardSort }>(
      `/api/community/leaderboard?limit=${limit}&sort=${sort}`,
      { auth: false }
    ),

  publicProfile: (id: string) => rawRequest<{ profile: UserProfile }>(`/api/community/users/${id}`),

  alerts: () => rawRequest<{ items: AlertWithMatches[] }>('/api/alerts'),

  createAlert: (input: {
    keyword: string;
    maxPrice?: number;
    city: string;
    polarity: 'green' | 'red' | 'any';
  }) => rawRequest<{ id: string }>('/api/alerts', { method: 'POST', body: input }),

  updateAlert: (id: string, input: { isActive?: boolean; keyword?: string; maxPrice?: number | null; city?: string; polarity?: 'green' | 'red' | 'any' }) =>
    rawRequest<{ ok: boolean }>(`/api/alerts/${id}`, { method: 'PATCH', body: input }),

  deleteAlert: (id: string) => rawRequest<{ ok: boolean }>(`/api/alerts/${id}`, { method: 'DELETE' }),

  ocrReceipt: (input: { imageUrl: string; categoryHint?: string; polarityHint?: PostPolarity }) =>
    rawRequest<{ receipt: OcrReceipt }>('/api/ocr/receipt', {
      method: 'POST',
      body: input,
      timeoutMs: 60000,
    }),

  donationConfig: () =>
    rawRequest<{ enabled: boolean; currency: string; tiers: Array<{ id: string; title: string; amount: number }> }>(
      '/api/donations/config',
      { auth: false }
    ),

  startDonation: (input: { amount: number; tierId: 'coffee' | 'guardian' | 'legend'; isMonthly: boolean }) =>
    rawRequest<CheckoutResponse>('/api/donations/checkout', { method: 'POST', body: input }),

  donationSession: (sessionId: string) =>
    rawRequest<{ status: 'pending' | 'succeeded' | 'failed' | 'refunded'; profile: UserProfile }>(
      `/api/donations/session/${sessionId}`
    ),

  myDonations: () =>
    rawRequest<{
      items: Array<{
        id: string;
        amountBgn: number;
        tierId: string;
        tierName: string;
        isMonthly: boolean;
        status: string;
        createdAt: string;
      }>;
      profile: UserProfile;
    }>('/api/donations/mine'),

  recordInteraction: (reasonHint?: string) =>
    rawRequest<{
      shouldPrompt: boolean;
      interactionsSincePrompt: number;
      reasonHint?: string;
      firstName?: string;
      personalSavedBgn?: number;
    }>('/api/me/interaction', { method: 'POST', body: { reasonHint } }),

  snoozeNudge: () => rawRequest<{ ok: boolean; snoozedForMs: number }>('/api/me/snooze', { method: 'POST' }),

  /** 👥 Кой къде отваря — за статистиката в админ панела. */
  activity: (screen: string, platform?: string) =>
    rawRequest<{ ok: boolean; counted: boolean }>('/api/me/activity', {
      method: 'POST',
      body: { screen, platform },
    }),

  /** 📈 Събитие по пътя на потребителя — работи и БЕЗ вход (броим и гостите). */
  funnelEvent: (payload: {
    visitor: string;
    kind: string;
    platform?: string;
    meta?: Record<string, unknown>;
  }) =>
    rawRequest<{ ok: boolean; counted: boolean }>('/api/events', {
      method: 'POST',
      auth: false,
      body: payload,
    }),

  // ------------------------------------------------------------- Частни обяви (продавам)
  /** Цена, срок и колко снимки — за да го покажем още преди да е влязъл. */
  listingConfig: () => rawRequest<ListingConfigPublic>('/api/listings/config', { auth: false }),

  /** Активни обяви за разглеждане. */
  browseListings: (params: {
    q?: string;
    city?: string;
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: 'recent' | 'cheap' | 'expensive';
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.q?.trim()) qs.set('q', params.q.trim());
    if (params.city) qs.set('city', params.city);
    if (params.category) qs.set('category', params.category);
    if (params.minPrice != null) qs.set('minPrice', String(params.minPrice));
    if (params.maxPrice != null) qs.set('maxPrice', String(params.maxPrice));
    if (params.sort) qs.set('sort', params.sort);
    qs.set('limit', String(params.limit ?? 30));
    qs.set('offset', String(params.offset ?? 0));
    return rawRequest<{ total: number; items: UserListing[] }>(`/api/listings?${qs.toString()}`, { auth: false });
  },

  /** Моите обяви + дашборд (колко дни остават, история). */
  myListings: () => rawRequest<MyListingsResponse>('/api/listings/mine'),

  listing: (id: string) => rawRequest<{ listing: UserListing }>(`/api/listings/${id}`, { auth: false }),

  createListing: (body: NewListingInput) =>
    rawRequest<{ listing: UserListing; next: string }>('/api/listings', { method: 'POST', body }),

  updateListing: (id: string, body: Partial<NewListingInput>) =>
    rawRequest<{ listing: UserListing }>(`/api/listings/${id}`, { method: 'PATCH', body }),

  /** Спиране / пускане / „продадено“ — с едно натискане. */
  listingAction: (id: string, action: 'pause' | 'resume' | 'sold') =>
    rawRequest<{ listing: UserListing }>(`/api/listings/${id}/${action}`, { method: 'POST' }),

  /** Плащане: 2 € за 60 дни (или подновяване). */
  listingCheckout: (id: string, kind: 'publish' | 'renew' = 'publish') =>
    rawRequest<ListingCheckoutResult>(`/api/listings/${id}/checkout`, {
      method: 'POST',
      body: { kind, returnScheme: 'smartprice' },
      timeoutMs: 30_000,
    }),

  /** Потвърждаване след връщане от Stripe — питаме Stripe, не вярваме на клиента. */
  confirmListingPayment: (sessionId: string) =>
    rawRequest<{ ok: boolean; listingId?: string; paidUntil?: string; daysLeft?: number; reason?: string }>(
      '/api/listings/payments/confirm',
      { method: 'POST', body: { sessionId }, timeoutMs: 30_000 }
    ),

  listingHistory: (id: string) =>
    rawRequest<{
      events: Array<{ action: string; note: string | null; created_at: string }>;
      payments: Array<{ amount_eur: number; days: number; kind: string; status: string; paid_at: string | null; created_at: string }>;
    }>(`/api/listings/${id}/history`),

  /** Да показваме ли „и ти можеш да продаваш“ (подканата за купувача). */
  listingNudge: () => rawRequest<ListingNudgeInfo>('/api/listings/nudge'),
  listingNudgeSeen: () => rawRequest<{ ok: boolean }>('/api/listings/nudge/seen', { method: 'POST' }),
  listingNudgeOff: (off = true) =>
    rawRequest<{ ok: boolean; off: boolean }>('/api/listings/nudge/off', { method: 'POST', body: { off } }),

  // ------------------------------------------------------------- Демо на пъзела
  puzzleDemoNudge: () => rawRequest<PuzzleDemoInfo>('/api/puzzle/demo/nudge', { auth: false }),
  puzzleDemoRecord: (ms: number) =>
    rawRequest<{ plays: number; bestMs: number | null }>('/api/puzzle/demo/record', { method: 'POST', body: { ms } }),
  puzzleDemoOff: (off = true) =>
    rawRequest<{ ok: boolean; off: boolean }>('/api/puzzle/demo/off', { method: 'POST', body: { off } }),

  // ------------------------------------------------------------- Поканален цикъл
  /** Моят код, линк, колко души съм поканил и колко точки носят поканите. */
  referrals: () => rawRequest<ReferralSummary>('/api/referrals/me'),

  /** Има ли такъв код и кой стои зад него (преди регистрация). */
  checkReferralCode: (code: string) =>
    rawRequest<ReferralCheck>(
      `/api/referrals/check?code=${encodeURIComponent(code.trim())}`,
      { auth: false }
    ),

  // ------------------------------------------------------------- Томболи
  raffles: () => rawRequest<{ items: RaffleItem[] }>('/api/raffles'),
  raffle: (id: string) =>
    rawRequest<{ raffle: RaffleItem; standings: RaffleStanding[]; results: RaffleResults }>(
      `/api/raffles/${id}`
    ),
  /** Дъската на пъзела: practice = тренировъчна, official = само в рамките на официалното нареждане. */
  rafflePuzzle: (id: string, mode: 'practice' | 'official') =>
    rawRequest<{ tiles: PuzzleTile[]; pairs: string[]; minRunMs: number; maxRunMs: number }>(
      `/api/raffles/${id}/puzzle?mode=${mode}`
    ),
  joinRaffle: (id: string) =>
    rawRequest<{ ok: boolean; qualified: boolean; postsCount: number; practiceAttempts: number }>(
      `/api/raffles/${id}/join`,
      { method: 'POST' }
    ),
  practiceRaffle: (id: string, timeMs: number) =>
    rawRequest<{ ok: boolean; practiceUsed: number; practiceLeft: number; bestPracticeMs: number | null }>(
      `/api/raffles/${id}/practice`,
      { method: 'POST', body: { timeMs } }
    ),
  startRaffleRun: (id: string) =>
    rawRequest<{ ok: boolean; startedAt: string; minRunMs: number; maxRunMs: number }>(
      `/api/raffles/${id}/run/start`,
      { method: 'POST' }
    ),
  finishRaffleRun: (id: string) =>
    rawRequest<{ ok: boolean; timeMs: number; place: number }>(`/api/raffles/${id}/run/finish`, {
      method: 'POST',
    }),
  rafflePromo: (id: string) =>
    rawRequest<{ shouldShow: boolean; views: number; maxViews: number; anonymous?: boolean; participating?: boolean }>(
      `/api/raffles/${id}/promo`
    ),
  markRafflePromoViewed: (id: string) =>
    rawRequest<{ shouldShow: boolean; views: number; maxViews: number }>(`/api/raffles/${id}/promo-view`, {
      method: 'POST',
      body: {},
    }),
  raffleWinners: () => rawRequest<{ items: RaffleWinner[] }>('/api/raffles/winners'),

  // ------------------------------------------------------------- Админ (томболи)
  adminRaffles: () => rawRequest<{ items: RaffleItem[] }>('/api/admin/raffles'),
  adminCreateRaffle: (input: AdminRaffleInput) =>
    rawRequest<{ raffle: RaffleItem }>('/api/admin/raffles', { method: 'POST', body: input }),
  adminRaffleStatus: (id: string, status: 'draft' | 'active' | 'running' | 'cancelled') =>
    rawRequest<{ raffle: RaffleItem }>(`/api/admin/raffles/${id}/status`, { method: 'POST', body: { status } }),
  adminDrawRaffle: (id: string) =>
    rawRequest<{ cancelled: boolean; winnerId?: string; timeMs?: number; raffle: RaffleItem }>(
      `/api/admin/raffles/${id}/draw`,
      { method: 'POST' }
    ),

  /** Залепване на код за вече създаден профил (до 7 дни след регистрация). */
  claimReferral: (code: string) =>
    rawRequest<{ ok: true; inviterName: string; points: number }>('/api/referrals/claim', {
      method: 'POST',
      body: { code },
    }),

  // ------------------------------------------------------------- AI съветник „Ценко“
  /**
   * Пита Ценко. Пращаме цялата история (тя е кратка — сървърът я реже до
   * ASSISTANT_HISTORY съобщения). Работи и за гости, но с по-малък лимит.
   * timeoutMs е по-голям: моделът „мисли“ преди да отговори.
   */
  assistantChat: (input: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    /** true = само „поздрави ме“ (когато чатът се отваря за пръв път). */
    greeting?: boolean;
    /** От кой екран е отворен чатът — за да е уместна подканата. */
    screen?: string;
  }) =>
    rawRequest<AssistantReply>('/api/assistant/chat', {
      method: 'POST',
      body: input,
      auth: true,
      // 30 сек (не 60): отговорът идва за ~2-3 сек, значи ако се чака повече —
      // заявката се е загубила. По-добре бързо да кажем „опитай пак“, отколкото
      // човекът да гледа „върти се“ цяла минута.
      timeoutMs: 30000,
    }),

  /** Колко въпроса са останали в текущия час (за тиха индикация в чата). */
  assistantQuota: () => rawRequest<AssistantQuota>('/api/assistant/quota'),

  /**
   * Готови въпроси за стартовите бутончета. Идват от наръчника в базата —
   * значи щом се добави нова тема в панела, тук се появява нов бутон сам.
   */
  assistantTopics: () =>
    rawRequest<{ enabled: boolean; items: AssistantTopic[] }>('/api/assistant/topics', {
      auth: false,
    }),
};

/**
 * Адрес на генерираната карта „Спестих X €“ (PNG 1080×1920, готов за Stories).
 * Сървърът я рисува — затова е един и същ файл навсякъде.
 */
export function storyCardUrl(params: {
  postId?: string;
  total?: number;
  name?: string;
  code?: string;
  posts?: number;
}): string {
  const q = new URLSearchParams();
  if (params.postId) q.set('post', params.postId);
  if (params.total !== undefined) q.set('total', String(params.total));
  if (params.name) q.set('name', params.name);
  if (params.code) q.set('code', params.code);
  if (params.posts !== undefined) q.set('posts', String(params.posts));
  return `${API_URL}/api/referrals/card.png?${q.toString()}`;
}

/* ================= 🏪 Обекти (#11) ================= */

export interface ObjectSummary {
  slug: string;
  place_name: string;
  /** Онлайн магазин ли е (тогава не се брои за обект в класациите). */
  is_shop?: boolean;
  city: string;
  signals_count: number;
  reporters_count: number;
  green_count: number;
  red_count: number;
  min_price: number | null;
  max_price: number | null;
  avg_price: number | null;
  last_seen: string;
  first_seen: string;
  helped_total: number;
  category: string | null;
  categories?: string[] | null;
  cover_image: string | null;
  last_post_id?: string | null;
  unit_type?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  merchant_name?: string | null;
  merchant_tax_id?: string | null;
  receipts_verified?: number;
}

export interface ObjectSignal {
  id: string;
  title: string;
  description: string;
  polarity: string;
  category: string;
  price_paid: number;
  currency: string;
  image_url: string;
  created_at: string;
  helped_count: number;
  unit_quantity: number | null;
  unit_type: string | null;
  price_per_unit: number | null;
  is_fake_promo: boolean;
  is_shrinkflation: boolean;
  verified_by_ai: boolean | null;
  merchant_name: string | null;
  merchant_tax_id: string | null;
}

/** Обогатени данни от Google Maps за обекта (рейтинг, отзиви, работно време). */
export interface ObjectPlace {
  rating: number | null;
  reviews_count: number | null;
  place_category: string | null;
  place_address: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  website: string | null;
  /** Работно време по дни, както го дава Google: [{ day: 'понеделник', hours: '8:00ч. to 18:00ч.' }] */
  hours: Array<{ day: string; hours: string }> | null;
  maps_url: string | null;
  updated_at: string;
}

export interface ObjectDetail {
  object: ObjectSummary;
  /** Онлайн магазин ли е (тогава статистиката на цените няма смисъл). */
  is_shop?: boolean;
  /**
   * За онлайн магазин: статистика ПО КАТЕГОРИИ (смислената).
   * „Инструменти: 12 оферти, 8–140 €“ вместо „средно 41 €“.
   */
  categories_stats?: Array<{
    category: string;
    posts: number;
    min_price: number;
    avg_price: number;
    max_price: number;
    /** 🥇 Най-изгодният магазин в тази категория ли е този. */
    best_value?: boolean;
    /** С колко % типичната му цена е под следващия магазин. */
    saving_pct?: number;
    /** Колко магазина се сравняват в категорията. */
    shops_compared?: number;
  }>;
  /** Google Maps: рейтинг, отзиви, работно време. Може да липсва. */
  place?: ObjectPlace | null;
  /** 🏢 Провереният търговец на обекта (значка „✅ Проверен търговец“). */
  business?: BusinessPublic | null;
  signals: ObjectSignal[];
  history: Array<{ id: string; price: number; title: string; created_at: string; polarity: string; image_url: string }>;
  months: Array<{ month: string; avg_price: number; min_price: number; max_price: number; posts: number }>;
}

/** Страница на един обект (по слуг от v_objects). */
export async function loadObject(slug: string): Promise<ObjectDetail> {
  return rawRequest<ObjectDetail>('/api/objects/' + encodeURIComponent(slug));
}

/** Обектът, към който принадлежи дадена оферта. */
export async function loadObjectForPost(postId: string): Promise<ObjectDetail> {
  return rawRequest<ObjectDetail>('/api/objects/by-post/' + encodeURIComponent(postId));
}

/**
 * 🔎 Офертите на един обект/магазин — с търсене и страници.
 *
 * Защо не през loadObject: той връща само първите 80 оферти. В магазин с 200+
 * продукта човекът не можеше да намери нищо, затова търсенето върви на сървъра.
 */
export async function loadObjectOffers(
  slug: string,
  query: { q?: string; /** 🏷️ Само офертите в една категория („Сирене“). */ category?: string; limit?: number; offset?: number } = {}
): Promise<{ total: number; items: ObjectSignal[] }> {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.category?.trim()) params.set('category', query.category.trim());
  params.set('limit', String(query.limit ?? 30));
  params.set('offset', String(query.offset ?? 0));
  return rawRequest<{ total: number; items: ObjectSignal[] }>(
    `/api/objects/${encodeURIComponent(slug)}/offers?${params.toString()}`
  );
}

/** Търсене на обекти по име или град. */
export async function searchObjects(
  query: string,
  city?: string,
  limit = 20,
  kind?: 'shop' | 'place'
): Promise<{ total: number; items: ObjectSummary[] }> {
  const parts = ['limit=' + limit];
  if (query.trim()) parts.push('q=' + encodeURIComponent(query.trim()));
  if (city && city.trim()) parts.push('city=' + encodeURIComponent(city.trim()));
  if (kind) parts.push('kind=' + kind);
  return rawRequest<{ total: number; items: ObjectSummary[] }>('/api/objects?' + parts.join('&'));
}

/* ================= 🥇 „Най-изгодни цени“ по категории ================= */

/**
 * Магазин, който е най-изгоден в дадена категория.
 *
 * Смята се на сървъра по ТИПИЧНАТА (медианна) цена на офертите в категорията, а
 * не по най-ниската единична оферта — иначе един евтин артикул „прави“ целия
 * магазин най-изгоден. Значка се дава само при ≥3 оферти, ≥2 магазина за
 * сравнение и ≥5 % по-ниска медиана от следващия.
 */
export interface BestValueCategory {
  category: string;
  slug: string;
  place_name: string;
  posts: number;
  min_price: number;
  max_price: number;
  avg_price: number;
  median_price: number;
  shops_compared: number;
  saving_pct: number;
  /** Кой е следващият магазин в категорията (спрямо него е разликата). */
  next_place_name: string | null;
  next_median: number | null;
}

/** Правилото, по което се дава значката 🥇 (идва от сървъра — не се хардкодва в UI). */
export interface BestValueRule {
  min_posts: number;
  min_winner_posts: number;
  min_shops_compared: number;
  min_saving_pct: number;
  metric: string;
}

export async function bestValueCategories(): Promise<{
  items: BestValueCategory[];
  rule?: BestValueRule;
}> {
  return rawRequest<{ items: BestValueCategory[]; rule?: BestValueRule }>(
    '/api/objects/best-value'
  );
}

/* ================= 🏢 „Търговец в SmartPrice“ (втората страна) =================
 * Досега само потребителите имаха глас. Тук търговецът заявява „това е моят
 * обект“, доказва го с ЕИК (ако ЕИК съвпадне с касова бележка от същия обект,
 * одобрението е моментално) и получава право на ОФИЦИАЛЕН отговор под
 * сигналите за неговия обект.
 */

export interface BusinessPublic {
  id: string;
  venue_slug: string;
  place_name: string;
  city: string | null;
  legal_name: string;
  /** ✅ Проверен търговец (одобрен от екипа или автоматично по ЕИК). */
  verified: boolean;
  tier: 'free' | 'verified';
  paid_until: string | null;
  /** Има ли право да пише официални отговори точно сега. */
  can_reply: boolean;
  /** 💰 Платен абонамент „Проверен търговец“, който е активен в момента. */
  plan_active: boolean;
}

export interface BusinessMine extends BusinessPublic {
  status: 'pending' | 'verified' | 'rejected';
  tax_id: string | null;
  contact_email: string;
  contact_phone: string | null;
  auto_approved: boolean;
  reject_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  replies_count: number;
}

export interface BusinessReply {
  id: string;
  post_id: string;
  body: string;
  created_at: string;
  business_id: string;
  legal_name: string;
  place_name: string;
  city: string | null;
}

export interface ClaimBusinessInput {
  venueSlug: string;
  legalName: string;
  taxId?: string;
  contactEmail: string;
  contactPhone?: string;
  proofUrl?: string;
}

export async function claimBusiness(
  input: ClaimBusinessInput
): Promise<{ business: BusinessMine; autoApproved: boolean; message: string }> {
  return rawRequest('/api/business/claim', { method: 'POST', body: input });
}

export async function myBusinesses(): Promise<{ items: BusinessMine[] }> {
  return rawRequest('/api/business/mine');
}

/** Официалните отговори под една оферта (публично — вижда ги всеки). */
export async function businessRepliesForPost(postId: string): Promise<BusinessReply[]> {
  return rawRequest<{ byPost: BusinessReply[] }>(
    `/api/business/replies?postId=${encodeURIComponent(postId)}`
  ).then((r) => r.byPost ?? []);
}

/** Официалните отговори за много оферти наведнъж (за лентата). */
export async function businessRepliesForPosts(
  postIds: string[]
): Promise<Record<string, BusinessReply[]>> {
  const ids = postIds.filter(Boolean).slice(0, 40);
  if (ids.length === 0) return {};
  return rawRequest<{ grouped: Record<string, BusinessReply[]> }>(
    `/api/business/replies?postIds=${encodeURIComponent(ids.join(','))}`,
    { auth: false }
  ).then((r) => r.grouped ?? {});
}

/** Кой проверен търговец отговаря за обекта на тази оферта. */
export async function businessForPost(postId: string): Promise<BusinessPublic | null> {
  return rawRequest<{ business: BusinessPublic | null }>(
    `/api/business/for-post?postId=${encodeURIComponent(postId)}`,
    { auth: false }
  ).then((r) => r.business ?? null);
}

/** Мога ли АЗ да отговоря официално на този сигнал (собственик и проверен ли съм). */
export async function businessCanReply(
  postId: string
): Promise<{ canReply: boolean; businessId: string | null; reason: string | null }> {
  return rawRequest<{ canReply: boolean; businessId: string | null; reason: string | null }>(
    `/api/business/can-reply?postId=${encodeURIComponent(postId)}`
  ).catch(() => ({ canReply: false, businessId: null, reason: 'error' }));
}

export async function postBusinessReply(
  businessId: string,
  postId: string,
  body: string
): Promise<{ reply: BusinessReply }> {
  return rawRequest(`/api/business/${encodeURIComponent(businessId)}/reply`, {
    method: 'POST',
    body: { postId, body },
  });
}

/* ================= 💰 План „Проверен търговец“ (Фаза 2) =================
 * 19 €/месец: неограничени официални отговори, оферти в своя обект и
 * статистика. Безплатно: регистрация + 1 отговор на месец.
 */

export interface BusinessPlanConfig {
  enabled: boolean;
  priceEur: number;
  months: number;
  currency: string;
  freeRepliesPerMonth: number;
  includes: string[];
}

export async function businessPlanConfig(): Promise<BusinessPlanConfig> {
  return rawRequest<BusinessPlanConfig>('/api/business/plan/config', { auth: false });
}

/** Пуска плащане за абонамента и връща линка към Stripe. */
export async function subscribeBusiness(
  businessId: string,
  months = 1
): Promise<{ checkoutUrl: string | null; sessionId: string; amount: number; currency: string; message: string }> {
  return rawRequest(`/api/business/${encodeURIComponent(businessId)}/subscribe`, {
    method: 'POST',
    body: { months },
  });
}

/** Проверка след връщане от Stripe (ако webhook-ът още не е пристигнал). */
export async function confirmBusinessPaid(
  businessId: string,
  sessionId: string
): Promise<{ business: BusinessMine | null }> {
  return rawRequest(`/api/business/${encodeURIComponent(businessId)}/paid`, {
    method: 'POST',
    body: { sessionId },
  });
}

export interface VenueStats {
  views_today: number;
  views_7d: number;
  views_30d: number;
  signals_count: number;
  replies_count: number;
  reports_30d: number;
  avg_rating: number | null;
  plan_active: boolean;
  paid_until: string | null;
}

export async function businessStats(businessId: string): Promise<VenueStats | null> {
  return rawRequest<{ stats: VenueStats | null }>(
    `/api/business/${encodeURIComponent(businessId)}/stats`
  ).then((r) => r.stats);
}

export interface BusinessPayment {
  id: string;
  amount: number;
  currency: string;
  months: number;
  status: string;
  created_at: string;
  paid_at: string | null;
}

export async function businessPayments(businessId: string): Promise<BusinessPayment[]> {
  return rawRequest<{ items: BusinessPayment[] }>(
    `/api/business/${encodeURIComponent(businessId)}/payments`
  ).then((r) => r.items ?? []);
}

/* ======================== 🏷️ Оферти от търговеца ======================== */

export interface BusinessOffer {
  id: string;
  business_id: string;
  title: string;
  description: string;
  price: number | null;
  old_price: number | null;
  image_url: string | null;
  valid_until: string | null;
  status: 'active' | 'hidden';
  created_at: string;
  expired: boolean;
}

/** Офертите на търговеца (собственик — включително скритите). */
export async function businessOffers(businessId: string): Promise<BusinessOffer[]> {
  return rawRequest<{ items: BusinessOffer[] }>(
    `/api/business/${encodeURIComponent(businessId)}/offers`
  ).then((r) => r.items ?? []);
}

export async function createBusinessOffer(
  businessId: string,
  input: {
    title: string;
    description?: string;
    price?: number;
    oldPrice?: number;
    imageUrl?: string;
    validUntil?: string;
  }
): Promise<{ offer: BusinessOffer }> {
  return rawRequest(`/api/business/${encodeURIComponent(businessId)}/offers`, {
    method: 'POST',
    body: input,
  });
}

export async function setBusinessOfferStatus(
  offerId: string,
  status: 'active' | 'hidden'
): Promise<void> {
  await rawRequest(`/api/business/offers/${encodeURIComponent(offerId)}/status`, {
    method: 'POST',
    body: { status },
  });
}

export async function deleteBusinessOffer(offerId: string): Promise<void> {
  await rawRequest(`/api/business/offers/${encodeURIComponent(offerId)}`, { method: 'DELETE' });
}

/** Публично: офертите на един обект (за страницата на обекта). */
export async function publicVenueOffers(slug: string, limit = 5): Promise<BusinessOffer[]> {
  return rawRequest<{ items: BusinessOffer[] }>(
    `/api/business/offers?slug=${encodeURIComponent(slug)}&limit=${limit}`,
    { auth: false }
  ).then((r) => r.items ?? []);
}

/** Публично: брои едно гледане на обекта (статистиката за търговеца). */
export async function registerVenueView(slug: string): Promise<void> {
  await rawRequest('/api/business/venue-view', {
    method: 'POST',
    body: { slug },
    auth: false,
  }).catch(() => undefined);
}

/* ============ 🔔 Умна покана „включи известията“ (след първа полза) ============
 * Броим „ползване“ (отваряне на поток/оферта) и чак след няколко отваряния питаме.
 * Сървърът решава — не пита, ако вече си абониран, казал си „не“, или поканата
 * е била показвана преди по-малко от 14 дни.
 */

export interface PushPromptState {
  shouldPrompt: boolean;
  count: number;
  threshold?: number;
  muted?: boolean;
  subscribed?: boolean;
}

/** Отбелязва едно ползване и връща дали е време за поканата. */
export async function pushPromptTick(): Promise<PushPromptState> {
  return rawRequest<PushPromptState>('/api/me/push-prompt', { method: 'POST' }).catch(() => ({
    shouldPrompt: false,
    count: 0,
  }));
}

/** „Не ми показвай повече“. */
export async function pushPromptNever(): Promise<void> {
  await rawRequest('/api/me/push-prompt/never', { method: 'POST' }).catch(() => undefined);
}
