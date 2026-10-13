import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type {
  CategoryId,
  CommentItem,
  LeaderboardSort,
  LeaderboardUser,
  PlatformTag,
  PostItem,
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
    const refreshed = await refreshTokens();
    if (refreshed) {
      return rawRequest<T>(path, { ...options, retryOn401: false });
    }
    await saveTokens(null);
    onUnauthorized?.();
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
  ocrModel: string | null;
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
  sort?: 'newest' | 'best_savings' | 'lowest_price' | 'highest_price' | 'most_helped';
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------- API

export const api = {
  health: () => rawRequest<{ status: string; database: boolean }>('/api/health', { auth: false }),

  features: () => rawRequest<FeatureFlags>('/api/health/features', { auth: false }),

  register: (input: {
    email: string;
    password: string;
    name: string;
    city?: string;
    /** Код за покана от приятел (по избор). */
    ref?: string;
    /** Откъде е дошъл кодът — за статистика по канал. */
    refChannel?: string;
  }) =>
    rawRequest<RegisterResponse>('/api/auth/register', {
      method: 'POST',
      body: input,
      auth: false,
    }),

  login: (input: { email: string; password: string }) =>
    rawRequest<AuthResponse>('/api/auth/login', { method: 'POST', body: input, auth: false }),

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
    if (query.sort) params.set('sort', query.sort);
    params.set('limit', String(query.limit ?? 60));
    params.set('offset', String(query.offset ?? 0));
    return rawRequest<FeedResponse>(`/api/posts?${params.toString()}`);
  },

  post: (id: string) => rawRequest<{ post: PostItem }>(`/api/posts/${id}`),

  bookmarks: () => rawRequest<{ items: PostItem[]; total: number }>('/api/posts/bookmarks'),

  createPost: (payload: CreatePostPayload) =>
    rawRequest<{ post: PostItem; profile: UserProfile }>('/api/posts', {
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

  // ------------------------------------------------------------- Поканален цикъл
  /** Моят код, линк, колко души съм поканил и колко точки носят поканите. */
  referrals: () => rawRequest<ReferralSummary>('/api/referrals/me'),

  /** Има ли такъв код и кой стои зад него (преди регистрация). */
  checkReferralCode: (code: string) =>
    rawRequest<ReferralCheck>(
      `/api/referrals/check?code=${encodeURIComponent(code.trim())}`,
      { auth: false }
    ),

  /** Залепване на код за вече създаден профил (до 7 дни след регистрация). */
  claimReferral: (code: string) =>
    rawRequest<{ ok: true; inviterName: string; points: number }>('/api/referrals/claim', {
      method: 'POST',
      body: { code },
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
