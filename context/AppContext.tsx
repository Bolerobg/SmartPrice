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
import type {
  CategoryId,
  CommentItem,
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
  userProfile: UserProfile;
  leaderboard: LeaderboardUser[];
  priceAlerts: AlertWithMatches[];
  communityStats: CommunityStats | null;
  features: FeatureFlags | null;
  isLoading: boolean;
  isRefreshing: boolean;
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
  const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([]);
  const [priceAlerts, setPriceAlerts] = useState<AlertWithMatches[]>([]);
  const [communityStats, setCommunityStats] = useState<CommunityStats | null>(null);
  const [features, setFeatures] = useState<FeatureFlags | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
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
  const nudgeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ------------------------------------------------------------ Зареждане на данни

  const loadFeed = useCallback(async () => {
    const feed = await api.feed({
      polarity: selectedPolarityFilter === 'all' ? undefined : selectedPolarityFilter,
      category: selectedCategoryFilter === 'all' ? undefined : selectedCategoryFilter,
      city: selectedCityFilter,
      limit: 60,
    });
    setPosts(feed.items);
  }, [selectedPolarityFilter, selectedCategoryFilter, selectedCityFilter]);

  const loadSideData = useCallback(async () => {
    const [board, stats, alerts] = await Promise.all([
      api.leaderboard(50).catch(() => ({ items: [] as LeaderboardUser[] })),
      api.communityStats().catch(() => null),
      api.alerts().catch(() => ({ items: [] as AlertWithMatches[] })),
    ]);
    setLeaderboard(board.items);
    setCommunityStats(stats);
    setPriceAlerts(alerts.items);
  }, []);

  const refreshAll = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsRefreshing(true);
    try {
      await Promise.all([loadFeed(), loadSideData()]);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setIsRefreshing(false);
    }
  }, [isAuthenticated, loadFeed, loadSideData]);

  // Първоначално зареждане
  useEffect(() => {
    if (!isAuthenticated) {
      setIsLoading(false);
      setPosts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const [feed, board, stats, alerts, flags] = await Promise.all([
          api.feed({ limit: 60 }),
          api.leaderboard(50).catch(() => ({ items: [] as LeaderboardUser[] })),
          api.communityStats().catch(() => null),
          api.alerts().catch(() => ({ items: [] as AlertWithMatches[] })),
          api.features().catch(() => null),
        ]);
        if (cancelled) return;
        setPosts(feed.items);
        setLeaderboard(board.items);
        setCommunityStats(stats);
        setPriceAlerts(alerts.items);
        setFeatures(flags);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
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
    if (!isAuthenticated || isLoading) return;
    let cancelled = false;
    loadFeed().catch((err) => {
      if (!cancelled) setError(messageOf(err));
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading, loadFeed]);

  // Периодичен таймер за напомняне (само за не-дарители)
  useEffect(() => {
    if (!isAuthenticated || userProfile.isSupporter) {
      if (nudgeTimerRef.current) clearInterval(nudgeTimerRef.current);
      return;
    }

    nudgeTimerRef.current = setInterval(() => {
      const snoozedUntil = userProfile.nudgeSnoozedUntil ?? 0;
      const lastPrompt = userProfile.lastDonationPromptAt ?? 0;
      const now = Date.now();
      if (now > snoozedUntil && now - lastPrompt >= 90_000 && !isDonationModalOpen) {
        setIsPeriodicNudge(true);
        setDonationPromptReason(
          `Здравей, ${userProfile.name.split(' ')[0] || 'приятел'}! SmartPrice е без реклами и без платени ревюта. Подкрепи ни с малко дарение, за да продължим.`
        );
        setIsDonationModalOpen(true);
      }
    }, 35_000);

    return () => {
      if (nudgeTimerRef.current) clearInterval(nudgeTimerRef.current);
    };
  }, [
    isAuthenticated,
    userProfile.isSupporter,
    userProfile.nudgeSnoozedUntil,
    userProfile.lastDonationPromptAt,
    userProfile.name,
    isDonationModalOpen,
  ]);

  // ------------------------------------------------------------ Действия

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

      const { post, profile } = await api.createPost(payload);
      setPosts((prev) => [post, ...prev]);
      setAuthProfile(profile);
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
      triggerHaptic('light');
      try {
        const { post } = await api.toggleReaction(postId, reactionKey);
        applyPostUpdate(post);
        void recordUserInteraction();
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [applyPostUpdate, recordUserInteraction]
  );

  const markPostHelpedMe = useCallback(
    async (postId: string): Promise<number> => {
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
    [applyPostUpdate, recordUserInteraction, setAuthProfile]
  );

  const confirmPriceValidToday = useCallback(
    async (postId: string) => {
      triggerHaptic('success');
      try {
        const { post, profile } = await api.confirmPrice(postId);
        applyPostUpdate(post);
        setAuthProfile(profile);
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [applyPostUpdate, setAuthProfile]
  );

  const reportUpdatedPrice = useCallback(
    async (postId: string, newPrice: number) => {
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
    [applyPostUpdate, setAuthProfile]
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
      userProfile,
      leaderboard,
      priceAlerts,
      communityStats,
      features,
      isLoading,
      isRefreshing,
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
      totalCommunitySavedAllPosts,
    }),
    [
      posts,
      userProfile,
      leaderboard,
      priceAlerts,
      communityStats,
      features,
      isLoading,
      isRefreshing,
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
