// ВАЖНО за деплоя: тази папка е „context/“ (единствено число) — включена е в
// списъка на smartprice_deploy.py, затова промяна ТУК води до билд на web.
// (Досега в списъка пишеше „contexts/“ и комит само тук НЕ се билдваше.)
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { isOfflineError, loadCache, saveCache } from '@/src/lib/offlineCache';

import {
  api,
  ApiError,
  uploadImage,
  type AlertWithMatches,
  type CommunityStats,
  type CreatePostPayload,
  type FeatureFlags,
} from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import {
  detectHomeScreenPlatform,
  getAddToHomeSeen,
  isAlreadyInstalled,
  saveAddToHomeSeen,
} from '@/components/AddToHomeScreenModal';
import { hasFirstBenefit, onFirstBenefit } from '@/src/lib/firstBenefit';
import type {
  CategoryId,
  CommentItem,
  LeaderboardSort,
  LeaderboardUser,
  PlatformTag,
  PostItem,
  PostPolarity,
  ReactionKey,
  ReceiptData,
  UserProfile,
} from '@/types';

const EMPTY_PROFILE: UserProfile = {
  id: '',
  name: '',
  handle: '',
  email: '',
  avatar: '',
  bio: '',
  city: 'София',
  isSupporter: false,
  totalDonatedBgn: 0,
  totalSavedForCommunityBgn: 0,
  personalSavedBgn: 0,
  postsCount: 0,
  verifiedReceiptsCount: 0,
  reputationPoints: 0,
  referralCode: '',
  referralPoints: 0,
  referralsInvited: 0,
  referralsRewarded: 0,
  referralsPending: 0,
  badges: [],
  donations: [],
  lastDonationPromptAt: null,
  interactionsSincePrompt: 0,
  nudgeSnoozedUntil: null,
};

export interface CreatePostInput {
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
  /** Локален URI на снимката — качва се към сървъра автоматично. */
  imageUri: string;
  comparisonImageUri?: string;
  comparisonLabel?: string;
  receipt?: ReceiptData;
  tags: string[];
}

interface AppContextValue {
  posts: PostItem[];
  /** 📶 Дата на запазеното, което показваме (null = онлайн). */
  offlineAt: string | null;
  userProfile: UserProfile;
  leaderboard: LeaderboardUser[];
  /** Ранглиста с избрано подреждане (за табовете в Общност). */
  fetchLeaderboard: (sort: LeaderboardSort) => Promise<LeaderboardUser[]>;
  priceAlerts: AlertWithMatches[];
  communityStats: CommunityStats | null;
  features: FeatureFlags | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  hasMorePosts: boolean;
  loadMorePosts: () => Promise<void>;
  error: string | null;
  clearError: () => void;
  refreshAll: () => Promise<void>;

  selectedPolarityFilter: 'all' | PostPolarity;
  setSelectedPolarityFilter: (filter: 'all' | PostPolarity) => void;
  selectedCategoryFilter: CategoryId;
  setSelectedCategoryFilter: (category: CategoryId) => void;
  selectedCityFilter: string;
  setSelectedCityFilter: (city: string) => void;

  addPost: (input: CreatePostInput) => Promise<PostItem>;
  deletePost: (postId: string) => Promise<void>;
  toggleReaction: (postId: string, reactionKey: ReactionKey) => Promise<void>;
  markPostHelpedMe: (postId: string) => Promise<number>;
  confirmPriceValidToday: (postId: string) => Promise<void>;
  reportUpdatedPrice: (postId: string, newPrice: number) => Promise<void>;
  addPriceAlert: (alert: {
    keyword: string;
    maxPrice?: number;
    city: string;
    polarity: 'green' | 'red' | 'any';
  }) => Promise<void>;
  removePriceAlert: (id: string) => Promise<void>;
  togglePriceAlert: (id: string) => Promise<void>;
  addComment: (
    postId: string,
    text: string,
    extra?: { imageUri?: string; reportedPrice?: number }
  ) => Promise<void>;
  toggleBookmark: (postId: string) => Promise<void>;
  reportPost: (postId: string, reason: string, details?: string) => Promise<string>;
  recordUserInteraction: (reasonHint?: string) => Promise<void>;

  isDonationModalOpen: boolean;
  isPeriodicNudge: boolean;
  donationPromptReason: string;
  paymentsEnabled: boolean;
  openDonationModal: (reason?: string, isPeriodic?: boolean) => void;
  closeDonationModal: () => void;
  snoozeDonationNudge: () => Promise<void>;
  submitDonation: (params: {
    amount: number;
    tierId: 'coffee' | 'guardian' | 'legend';
    isMonthly: boolean;
  }) => Promise<{ donationId: string; checkoutUrl: string; sessionId: string; message: string }>;
  confirmDonationReturn: (sessionId: string) => Promise<boolean>;

    /** Покана „добави на началния екран“ (само в браузър) */
        isAddToHomeOpen: boolean;
        addToHomeMode: 'invite' | 'help';
        openAddToHome: (mode?: 'invite' | 'help') => void;
        closeAddToHome: () => void;

    /** Споделяне на оферта (един общ лист за цялото приложение) */
    sharingPost: PostItem | null;
    openShare: (post: PostItem) => void;
    closeShare: () => void;

    /** Покана „направи профил“ — показва се, когато гост натисне нещо, което иска вход */
    isAuthPromptOpen: boolean;
    authPromptReason: string;
    openAuthPrompt: (reason?: string) => void;
    closeAuthPrompt: () => void;

    /** Поздравът при отключена значка „Основател“ (или null) */
    founderCelebration: { title: string; points: number } | null;
    closeFounderCelebration: () => void;

    totalCommunitySavedAllPosts: number;
  }

const AppContext = createContext<AppContextValue | undefined>(undefined);

const triggerHaptic = (type: 'light' | 'medium' | 'success' = 'light') => {
  if (Platform.OS === 'web') return;
  try {
    if (type === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (type === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // устройството не поддържа хаптика
  }
};

const messageOf = (err: unknown): string =>
  err instanceof ApiError ? err.message : 'Неочаквана грешка. Опитай отново.';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile: authProfile, setProfile: setAuthProfile } = useAuth();

  const [posts, setPosts] = useState<PostItem[]>([]);
  /**
   * 📶 Офлайн ли сме и от кога е запазеното, което показваме.
   * null = онлайн. Дата = показваме кеш и екранът казва „от кога“ (никаква
   * преструвка, че старата цена е актуална).
   */
  const [offlineAt, setOfflineAt] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([]);
  const [priceAlerts, setPriceAlerts] = useState<AlertWithMatches[]>([]);
  const [communityStats, setCommunityStats] = useState<CommunityStats | null>(null);
  const [features, setFeatures] = useState<FeatureFlags | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedPolarityFilter, setSelectedPolarityFilter] = useState<'all' | PostPolarity>('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<CategoryId>('all');
  const [selectedCityFilter, setSelectedCityFilter] = useState<string>('Всички градове');

  const [isDonationModalOpen, setIsDonationModalOpen] = useState(false);
  const [isPeriodicNudge, setIsPeriodicNudge] = useState(false);
  const [donationPromptReason, setDonationPromptReason] = useState(
    'SmartPrice съществува благодарение на хората, които споделят реални цени и подкрепят общността.'
  );

  const userProfile = authProfile ?? EMPTY_PROFILE;
    const isAuthenticated = Boolean(authProfile);

    // ---------------------------------------------------- „Добави на началния екран“
    const [isAddToHomeOpen, setIsAddToHomeOpen] = useState(false);
    const [addToHomeMode, setAddToHomeMode] = useState<'invite' | 'help'>('invite');

    // Гост може да чете потока, но за действие (глас, коментар, находка) трябва
    // профил. Вместо суха грешка му показваме покана за регистрация.
    const [isAuthPromptOpen, setIsAuthPromptOpen] = useState(false);
    const [authPromptReason, setAuthPromptReason] = useState('');
    const openAuthPrompt = useCallback((reason?: string) => {
      setAuthPromptReason(reason ?? '');
      setIsAuthPromptOpen(true);
    }, []);
    const closeAuthPrompt = useCallback(() => setIsAuthPromptOpen(false), []);
    const requireAuth = useCallback(
      (reason?: string): boolean => {
        if (isAuthenticated) return true;
        setAuthPromptReason(reason ?? '');
        setIsAuthPromptOpen(true);
        return false;
      },
      [isAuthenticated]
    );

    // Поздравът „Основател“ — включва се от createPost, когато сървърът каже,
    // че точно тази находка е отключила значката.
    const [founderCelebration, setFounderCelebration] = useState<
      { title: string; points: number } | null
    >(null);
    const closeFounderCelebration = useCallback(() => setFounderCelebration(null), []);

    const openAddToHome = useCallback((mode: 'invite' | 'help' = 'help') => {
      setAddToHomeMode(mode);
      setIsAddToHomeOpen(true);
    }, []);

    const closeAddToHome = useCallback(() => {
        setIsAddToHomeOpen(false);
        // Отбелязваме, че вече сме показали поканата, за да не досаждаме пак.
        void saveAddToHomeSeen();
      }, []);

    // ---------------------------------------------------- Споделяне на оферта
    const [sharingPost, setSharingPost] = useState<PostItem | null>(null);
    const openShare = useCallback((post: PostItem) => setSharingPost(post), []);
    const closeShare = useCallback(() => setSharingPost(null), []);

      // Показваме поканата „Добави на началния екран“ СЛЕД първата полза — когато
      // човекът вече е отворил оферта и е видял истинска цена. Преди питахме
      // 8 секунди след влизане, тоест преди да е разбрал защо му е приложението,
      // и затова почти никой не я приемаше. Работи и за гости (без вход).
      useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let unsubscribe: (() => void) | null = null;

        const schedule = (delayMs: number) => {
          if (cancelled) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (!cancelled) openAddToHome('invite');
          }, delayMs);
        };

        (async () => {
          if (detectHomeScreenPlatform() === 'native') return; // нативно → вече е инсталирано
          if (isAlreadyInstalled()) return; // вече е добавено
          if (await getAddToHomeSeen()) return; // вече сме питали
          if (cancelled) return;

          // Човекът е влязъл директно на оферта (линк от Facebook) — това САМО
          // по себе си е първата полза, затова питаме веднага след като я прочете.
          const onOfferPage =
            Platform.OS === 'web' &&
            typeof window !== 'undefined' &&
            /\/post\//.test(window.location.pathname);

          // Абонираме се ПРЕДИ проверката: иначе, ако първата полза се отбележи
          // точно в този момент (директно отваряне на /post/...), събитието
          // минава преди да има кой да го чуе и поканата не излиза никога.
          unsubscribe = onFirstBenefit(() => schedule(3_500));

          if (await hasFirstBenefit()) {
            // Ползата вече е била → питаме, но не на самия вход (освен ако
            // човекът не е точно на оферта в момента).
            schedule(onOfferPage ? 4_000 : 20_000);
          }
        })();

        return () => {
          cancelled = true;
          if (timer) clearTimeout(timer);
          if (unsubscribe) unsubscribe();
        };
      }, [openAddToHome]);

  // ------------------------------------------------------------ Зареждане на данни

  const lastFeedRef = useRef<{ key: string; at: number } | null>(null);

  const loadFeed = useCallback(async (force = false) => {
    // Предпазна мярка: два ефекта (първоначалното зареждане и смяната на филтрите)
    // тръгваха един след друг и теглеха СЪЩАТА лента 3 пъти при всяко отваряне
    // (3 × 143 KB на телефон). Ако същите филтри са теглени преди по-малко от
    // 2 секунди, вторият опит се прескача. „Дръпни надолу“ (refreshAll) винаги
    // тегли наново — то минава с force = true.
    const feedKey = `${selectedPolarityFilter}|${selectedCategoryFilter}|${selectedCityFilter}`;
    const now = Date.now();
    const lastFeed = lastFeedRef.current;
    if (!force && lastFeed && lastFeed.key === feedKey && now - lastFeed.at < 2000) return;
    lastFeedRef.current = { key: feedKey, at: now };

    const feed = await api.feed({
      polarity: selectedPolarityFilter === 'all' ? undefined : selectedPolarityFilter,
      category: selectedCategoryFilter === 'all' ? undefined : selectedCategoryFilter,
      city: selectedCityFilter,
      limit: 60,
    });
    setPosts(feed.items);
    setHasMorePosts(Boolean(feed.hasMore));
    // 📶 Запазваме лентата, за да има какво да покажем в магазина без сигнал.
    void saveCache('feed', feed.items);
    setOfflineAt(null);
  }, [selectedPolarityFilter, selectedCategoryFilter, selectedCityFilter]);

  /**
   * 📶 Показване на запазеното, когато няма връзка.
   *
   * Връща true, ако има какво да покажем (тогава екранът не бива да пише
   * „грешка“ — има съдържание, само е от по-рано и го казваме изрично).
   */
  const fallbackToCache = useCallback(async (): Promise<boolean> => {
    const cached = await loadCache<PostItem[]>('feed');
    if (cached?.data?.length) {
      setPosts(cached.data);
      setOfflineAt(cached.at);
      return true;
    }
    return false;
  }, []);

  const loadMorePosts = useCallback(async () => {
    if (!hasMorePosts || isLoadingMore || isLoading) return;
    setIsLoadingMore(true);
    try {
      const feed = await api.feed({
        polarity: selectedPolarityFilter === 'all' ? undefined : selectedPolarityFilter,
        category: selectedCategoryFilter === 'all' ? undefined : selectedCategoryFilter,
        city: selectedCityFilter,
        offset: posts.length,
        limit: 60,
      });
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const added = feed.items.filter((p) => !seen.has(p.id));
        return [...prev, ...added];
      });
      setHasMorePosts(Boolean(feed.hasMore));
    } catch {
      // тихо при грешка на следваща страница
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMorePosts, isLoadingMore, isLoading, posts.length, selectedPolarityFilter, selectedCategoryFilter, selectedCityFilter]);

  const loadSideData = useCallback(async () => {
    const [board, stats, alerts] = await Promise.all([
      api.leaderboard(50).catch(() => ({ items: [] as LeaderboardUser[] })),
      api.communityStats().catch(() => null),
      isAuthenticated
        ? api.alerts().catch(() => ({ items: [] as AlertWithMatches[] }))
        : Promise.resolve({ items: [] as AlertWithMatches[] }),
    ]);
    setLeaderboard(board.items);
    setCommunityStats(stats);
    setPriceAlerts(alerts.items);
  }, [isAuthenticated]);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([loadFeed(true), loadSideData()]);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setIsRefreshing(false);
    }
  }, [loadFeed, loadSideData]);

  // Референция към последната версия на loadFeed — първоначалното зареждане я
  // ползва, без да зависи от филтрите (иначе ефектът щеше да се пуска пак при
  // всяка смяна на филтър, а това прави филтърният ефект отдолу).
  const loadFeedRef = useRef(loadFeed);
  useEffect(() => {
    loadFeedRef.current = loadFeed;
  }, [loadFeed]);

  // Първоначално зареждане
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        // Потокът се показва и БЕЗ профил — това е входната врата от TikTok.
        // Затова го зареждаме винаги; само алармите (за любими цени) искат вход.
        //
        // ВАЖНО: ползваме СЪЩАТА функция като филтърния ефект (loadFeed), а не
        // отделна заявка. Преди тук имаше самостоятелно api.feed({limit:60}) и
        // затова при всяко отваряне лентата се теглеше 3 пъти (тази заявка +
        // филтърният ефект + повторното пускане при влизане в профила).
        await loadFeedRef.current();
        if (cancelled) return;
        setError(null);

        const [board, stats, flags] = await Promise.all([
          api.leaderboard(50).catch(() => ({ items: [] as LeaderboardUser[] })),
          api.communityStats().catch(() => null),
          api.features().catch(() => null),
        ]);
        if (cancelled) return;
        setLeaderboard(board.items);
        setCommunityStats(stats);
        setFeatures(flags);

        if (isAuthenticated) {
          const alerts = await api.alerts().catch(() => ({ items: [] as AlertWithMatches[] }));
          if (!cancelled) setPriceAlerts(alerts.items);
        } else if (!cancelled) {
          setPriceAlerts([]);
        }
      } catch (err) {
        if (cancelled) return;
        // 📶 Няма връзка? Показваме запазеното, вместо празен екран с грешка.
        if (isOfflineError(err) && (await fallbackToCache())) {
          setError(null);
          return;
        }
        setError(messageOf(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // Презареждане при смяна на филтрите (сървърна филтрация)
  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;
    loadFeed().catch((err) => {
      if (cancelled) return;
      // 📶 Пак: при липса на връзка показваме кеша, а не грешка.
      if (isOfflineError(err)) {
        void fallbackToCache().then((ok) => {
          if (!cancelled) setError(ok ? null : messageOf(err));
        });
        return;
      }
      setError(messageOf(err));
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading, loadFeed]);

  // ВАЖНО: преди тук имаше таймер, който отваряше модала за дарение на всеки
    // 35 секунди (с пауза само 90 с). Това е натрапчиво и кара хората да
    // отказват. Затова таймерът е премахнат изцяло.
    //
    // Сега подсещането идва само когато има СМИСЪЛ (виж recordUserInteraction):
    //   • след 8 реални действия, И поне 3 дни след предишното подсещане;
    //   • или когато потребителят мине праг на спестени пари (25/50/100 €…),
    //     защото тогава вече е усетил ползата.

    // ------------------------------------------------------------ Действия

  const fetchLeaderboard = useCallback(async (sort: LeaderboardSort) => {
    const res = await api.leaderboard(50, sort);
    return res.items;
  }, []);

  const recordUserInteraction = useCallback(
    async (reasonHint?: string) => {
      if (!isAuthenticated || userProfile.isSupporter) return;
      try {
        const result = await api.recordInteraction(reasonHint);
        setAuthProfile({
          ...userProfile,
          interactionsSincePrompt: result.interactionsSincePrompt,
          lastDonationPromptAt: result.shouldPrompt ? Date.now() : userProfile.lastDonationPromptAt,
        });
        if (result.shouldPrompt) {
          setIsPeriodicNudge(true);
          setDonationPromptReason(
            reasonHint ||
              'Ти активно използваш SmartPrice! Ще ни подкрепиш ли с едно дарение?'
          );
          setIsDonationModalOpen(true);
        }
      } catch {
        // напомнянето не е критично — не чупим действието заради него
      }
    },
    [isAuthenticated, userProfile, setAuthProfile]
  );

  const addPost = useCallback(
    async (input: CreatePostInput): Promise<PostItem> => {
      triggerHaptic('success');

      // 1. Качваме снимките на сървъра (реални файлове, не base64 в базата)
      const imageUrl = input.imageUri.startsWith('http')
        ? input.imageUri
        : await uploadImage(input.imageUri);

      let comparisonImageUrl: string | undefined;
      if (input.comparisonImageUri) {
        comparisonImageUrl = input.comparisonImageUri.startsWith('http')
          ? input.comparisonImageUri
          : await uploadImage(input.comparisonImageUri);
      }

      // 2. Касовата бележка: снимката също се качва
      let receipt: CreatePostPayload['receipt'];
      if (input.receipt) {
        const receiptImageUrl = input.receipt.receiptImageUri
          ? input.receipt.receiptImageUri.startsWith('http')
            ? input.receipt.receiptImageUri
            : await uploadImage(input.receipt.receiptImageUri)
          : undefined;

        receipt = {
          merchantName: input.receipt.merchantName,
          merchantTaxId: input.receipt.merchantTaxId,
          date: input.receipt.date,
          time: input.receipt.time,
          totalAmount: input.receipt.totalAmount,
          currency: 'BGN',
          confidenceScore: input.receipt.confidenceScore,
          verifiedByAi: input.receipt.verifiedByAi,
          source: input.receipt.verifiedByAi ? 'openrouter' : 'manual',
          model: (input.receipt as ReceiptData & { model?: string }).model,
          imageUrl: receiptImageUrl,
          items: input.receipt.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            totalPrice: i.totalPrice,
            highlightReason: i.highlightReason,
          })),
        };
      }

      const payload: CreatePostPayload = {
        polarity: input.polarity,
        category: input.category,
        customCategoryLabel: input.customCategoryLabel,
        platformTag: input.platformTag,
        customPlatformLabel: input.customPlatformLabel,
        title: input.title,
        description: input.description,
        placeName: input.placeName,
        city: input.city,
        address: input.address,
        latitude: input.latitude,
        longitude: input.longitude,
        googleMapsUrl: input.googleMapsUrl,
        locationAutoDetected: input.locationAutoDetected,
        pricePaid: input.pricePaid,
        referencePrice: input.referencePrice,
        unitQuantity: input.unitQuantity,
        unitType: input.unitType,
        isShrinkflation: input.isShrinkflation,
        isFakePromo: input.isFakePromo,
        imageUrl,
        comparisonImageUrl,
        comparisonLabel: input.comparisonLabel,
        tags: input.tags,
        receipt,
      };

      const { post, profile, founderBonus } = await api.createPost(payload);
      setPosts((prev) => [post, ...prev]);
      setAuthProfile(profile);
      if (founderBonus) setFounderCelebration(founderBonus);
      void loadSideData();
      void recordUserInteraction(
        'Страхотна публикация! За да поддържаме AI скенера на касови бележки, подкрепи SmartPrice с дарение.'
      );
      return post;
    },
    [loadSideData, recordUserInteraction, setAuthProfile]
  );

  const deletePost = useCallback(
    async (postId: string) => {
      triggerHaptic('medium');
      await api.deletePost(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      const { profile } = await api.me();
      setAuthProfile(profile);
      void loadSideData();
    },
    [loadSideData, setAuthProfile]
  );

  const applyPostUpdate = useCallback((post: PostItem) => {
    setPosts((prev) => prev.map((p) => (p.id === post.id ? post : p)));
  }, []);

  const toggleReaction = useCallback(
    async (postId: string, reactionKey: ReactionKey) => {
      if (!requireAuth('За да гласуваш, трябва профил. Отнема 30 секунди.')) return;
      triggerHaptic('light');
      try {
        const { post } = await api.toggleReaction(postId, reactionKey);
        applyPostUpdate(post);
        void recordUserInteraction();
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [applyPostUpdate, recordUserInteraction, requireAuth]
  );

  const markPostHelpedMe = useCallback(
    async (postId: string): Promise<number> => {
      if (!requireAuth('За да отбележиш, че ти е помогнало, трябва профил.')) return 0;
      triggerHaptic('medium');
      try {
        const result = await api.markHelped(postId);
        applyPostUpdate(result.post);
        setAuthProfile(result.profile);
        if (result.marked && result.savedAmount > 0) {
          void recordUserInteraction(
            `Този пост ти спести ${result.savedAmount.toFixed(2)} €! Ако SmartPrice ти помага, подкрепи ни с дарение.`
          );
        }
        return result.savedAmount;
      } catch (err) {
        setError(messageOf(err));
        return 0;
      }
    },
    [applyPostUpdate, recordUserInteraction, setAuthProfile, requireAuth]
  );

  const confirmPriceValidToday = useCallback(
    async (postId: string) => {
      if (!requireAuth('За да потвърдиш цена, трябва профил.')) return;
      triggerHaptic('success');
      try {
        const { post, profile } = await api.confirmPrice(postId);
        applyPostUpdate(post);
        setAuthProfile(profile);
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [applyPostUpdate, setAuthProfile, requireAuth]
  );

  const reportUpdatedPrice = useCallback(
    async (postId: string, newPrice: number) => {
      if (!requireAuth('За да докладваш нова цена, трябва профил.')) return;
      if (!Number.isFinite(newPrice) || newPrice <= 0) return;
      triggerHaptic('medium');
      try {
        const { post, profile } = await api.reportPrice(postId, newPrice);
        applyPostUpdate(post);
        setAuthProfile(profile);
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [applyPostUpdate, setAuthProfile, requireAuth]
  );

  const addPriceAlert = useCallback(
    async (alert: {
      keyword: string;
      maxPrice?: number;
      city: string;
      polarity: 'green' | 'red' | 'any';
    }) => {
      triggerHaptic('success');
      await api.createAlert(alert);
      const { items } = await api.alerts();
      setPriceAlerts(items);
    },
    []
  );

  const removePriceAlert = useCallback(async (id: string) => {
    triggerHaptic('light');
    await api.deleteAlert(id);
    setPriceAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const togglePriceAlert = useCallback(
    async (id: string) => {
      triggerHaptic('light');
      const target = priceAlerts.find((a) => a.id === id);
      if (!target) return;
      await api.updateAlert(id, { isActive: !target.isActive });
      setPriceAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, isActive: !a.isActive } : a))
      );
    },
    [priceAlerts]
  );

  const addComment = useCallback(
    async (
      postId: string,
      text: string,
      extra?: { imageUri?: string; reportedPrice?: number }
    ) => {
      if (!text.trim() && !extra?.imageUri) return;
      triggerHaptic('light');

      const imageUrl = extra?.imageUri
        ? extra.imageUri.startsWith('http')
          ? extra.imageUri
          : await uploadImage(extra.imageUri)
        : undefined;

      const { comment } = await api.addComment(postId, {
        text,
        imageUrl,
        reportedPrice: extra?.reportedPrice,
      });

      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId ? { ...post, comments: [...post.comments, comment] } : post
        )
      );
      void recordUserInteraction();
    },
    [recordUserInteraction]
  );

  const toggleBookmark = useCallback(
    async (postId: string) => {
      triggerHaptic('light');
      try {
        const { isBookmarked } = await api.toggleBookmark(postId);
        setPosts((prev) =>
          prev.map((post) => (post.id === postId ? { ...post, isBookmarked } : post))
        );
      } catch (err) {
        setError(messageOf(err));
      }
    },
    []
  );

  const reportPost = useCallback(async (postId: string, reason: string, details?: string) => {
    const result = await api.reportPost(postId, reason, details);
    return result.message;
  }, []);

  // ------------------------------------------------------------ Дарения

  const openDonationModal = useCallback((reason?: string, isPeriodic = false) => {
    triggerHaptic('light');
    setIsPeriodicNudge(isPeriodic);
    setDonationPromptReason(
      reason ||
        'Подкрепи SmartPrice! Средствата отиват за сървърите и за OCR скенера на касови бележки.'
    );
    setIsDonationModalOpen(true);
  }, []);

  const closeDonationModal = useCallback(() => {
    setIsDonationModalOpen(false);
  }, []);

  const snoozeDonationNudge = useCallback(async () => {
    triggerHaptic('light');
    setIsDonationModalOpen(false);
    try {
      await api.snoozeNudge();
      const { profile } = await api.me();
      setAuthProfile(profile);
    } catch {
      // не е критично
    }
  }, [setAuthProfile]);

  const submitDonation = useCallback(
    async (params: {
      amount: number;
      tierId: 'coffee' | 'guardian' | 'legend';
      isMonthly: boolean;
    }) => {
      const result = await api.startDonation(params);
      return {
        donationId: result.donationId,
        checkoutUrl: result.checkoutUrl,
        sessionId: result.sessionId,
        message: result.message,
      };
    },
    []
  );

  const confirmDonationReturn = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const result = await api.donationSession(sessionId);
      setAuthProfile(result.profile);
      if (result.status === 'succeeded') {
        triggerHaptic('success');
        void loadSideData();
        return true;
      }
      return false;
    },
    [loadSideData, setAuthProfile]
  );

  const totalCommunitySavedAllPosts = useMemo(
    () => communityStats?.communitySavedBgn ?? posts.reduce((acc, p) => acc + (p.communitySavedBgn || 0), 0),
    [communityStats, posts]
  );

  const value = useMemo<AppContextValue>(
    () => ({
      posts,
      offlineAt,
      userProfile,
      leaderboard,
      fetchLeaderboard,
      priceAlerts,
      communityStats,
      features,
      isLoading,
      isRefreshing,
      isLoadingMore,
      hasMorePosts,
      loadMorePosts,
      error,
      clearError: () => setError(null),
      refreshAll,
      selectedPolarityFilter,
      setSelectedPolarityFilter,
      selectedCategoryFilter,
      setSelectedCategoryFilter,
      selectedCityFilter,
      setSelectedCityFilter,
      addPost,
      deletePost,
      toggleReaction,
      markPostHelpedMe,
      confirmPriceValidToday,
      reportUpdatedPrice,
      addPriceAlert,
      removePriceAlert,
      togglePriceAlert,
      addComment,
      toggleBookmark,
      reportPost,
      recordUserInteraction,
      isDonationModalOpen,
      isPeriodicNudge,
      donationPromptReason,
      paymentsEnabled: features?.payments ?? false,
      openDonationModal,
      closeDonationModal,
      snoozeDonationNudge,
      submitDonation,
            confirmDonationReturn,

            isAddToHomeOpen,
            addToHomeMode,
            openAddToHome,
            closeAddToHome,

            isAuthPromptOpen,
            authPromptReason,
            openAuthPrompt,
            closeAuthPrompt,

            founderCelebration,
            closeFounderCelebration,

            sharingPost,
            openShare,
            closeShare,

            totalCommunitySavedAllPosts,
          }),
    [
      posts,
      offlineAt,
      userProfile,
      leaderboard,
      fetchLeaderboard,
      priceAlerts,
      communityStats,
      features,
      isLoading,
      isRefreshing,
      isLoadingMore,
      hasMorePosts,
      loadMorePosts,
      error,
      refreshAll,
      selectedPolarityFilter,
      selectedCategoryFilter,
      selectedCityFilter,
      addPost,
      deletePost,
      toggleReaction,
      markPostHelpedMe,
      confirmPriceValidToday,
      reportUpdatedPrice,
      addPriceAlert,
      removePriceAlert,
      togglePriceAlert,
      addComment,
      toggleBookmark,
      reportPost,
      recordUserInteraction,
      isDonationModalOpen,
      isPeriodicNudge,
      donationPromptReason,
      openDonationModal,
      closeDonationModal,
      snoozeDonationNudge,
      submitDonation,
            confirmDonationReturn,

            isAddToHomeOpen,
            addToHomeMode,
            openAddToHome,
            closeAddToHome,

            isAuthPromptOpen,
            authPromptReason,
            openAuthPrompt,
            closeAuthPrompt,

            founderCelebration,
            closeFounderCelebration,

            sharingPost,
            openShare,
            closeShare,

            totalCommunitySavedAllPosts,
          ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = (): AppContextValue => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp трябва да се използва вътре в AppProvider');
  return ctx;
};
