import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import {
  INITIAL_LEADERBOARD,
  INITIAL_POSTS,
  INITIAL_USER_PROFILE,
} from '@/constants/mockData';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { processStripeDonation } from '@/services/stripeDonations';
import {
  CategoryId,
  CommentItem,
  DonationRecord,
  LeaderboardUser,
  PlatformTag,
  PostItem,
  PostPolarity,
  PriceAlertItem,
  ReactionKey,
  ReceiptData,
  UserProfile,
} from '@/types';

const STORAGE_KEYS = {
  POSTS: '@smartprice_posts_v1',
  PROFILE: '@smartprice_profile_v1',
  ALERTS: '@smartprice_alerts_v1',
};

const INITIAL_PRICE_ALERTS: PriceAlertItem[] = [
  {
    id: 'alert-1',
    keyword: 'Зехтин',
    maxPrice: 20,
    city: 'Всички градове',
    polarity: 'green',
    createdAt: 'Днес',
    isActive: true,
  },
  {
    id: 'alert-2',
    keyword: 'Созопол',
    city: 'Созопол',
    polarity: 'red',
    createdAt: 'Днес',
    isActive: true,
  },
];

// На всеки колко интеракции да пита потребителя за дарение, ако все още НЕ е дарил
const INTERACTIONS_THRESHOLD_FOR_NUDGE = 3;
// Периодичен интервал за проверка (в милисекунди - напр. 90 секунди активна сесия след отлагане)
const PERIODIC_TIME_THRESHOLD_MS = 90 * 1000;

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
  pricePerKgOrLiter?: number;
  isShrinkflation?: boolean;
  isFakePromo?: boolean;
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
  priceAlerts: PriceAlertItem[];
  isLoading: boolean;
  // Филтри за потока
  selectedPolarityFilter: 'all' | PostPolarity;
  setSelectedPolarityFilter: (filter: 'all' | PostPolarity) => void;
  selectedCategoryFilter: CategoryId;
  setSelectedCategoryFilter: (category: CategoryId) => void;
  selectedCityFilter: string;
  setSelectedCityFilter: (city: string) => void;
  // Действия с постове
  addPost: (input: CreatePostInput) => Promise<PostItem>;
  toggleReaction: (postId: string, reactionKey: ReactionKey) => void;
  markPostHelpedMe: (postId: string) => void;
  confirmPriceValidToday: (postId: string) => void;
  reportUpdatedPrice: (postId: string, newPrice: number) => void;
  addPriceAlert: (
    alert: Omit<PriceAlertItem, 'id' | 'createdAt' | 'isActive'>
  ) => void;
  removePriceAlert: (id: string) => void;
  togglePriceAlert: (id: string) => void;
  addComment: (
    postId: string,
    text: string,
    extra?: { imageUri?: string; reportedPrice?: number }
  ) => void;
  toggleBookmark: (postId: string) => void;
  recordUserInteraction: (reasonHint?: string) => void;
  // Монетизация & Дарения през Stripe + Периодично напомняне
  isDonationModalOpen: boolean;
  isPeriodicNudge: boolean;
  donationPromptReason: string;
  openDonationModal: (reason?: string, isPeriodic?: boolean) => void;
  snoozeDonationNudge: () => void;
  submitDonation: (params: {
    amountBgn: number;
    tierId: 'coffee' | 'guardian' | 'legend';
    isMonthly: boolean;
    paymentMethodType: 'apple_pay' | 'google_pay' | 'card';
  }) => Promise<{ success: boolean; message: string; paymentIntentId: string }>;
  resetSupporterStatusForDemo: () => void;
  triggerPeriodicNudgeNow: () => void;
  totalCommunitySavedAllPosts: number;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const triggerHaptic = (type: 'light' | 'medium' | 'success' = 'light') => {
  if (Platform.OS === 'web') return;
  try {
    if (type === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (type === 'medium') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  } catch {
    // Игнориране при липса на поддръжка
  }
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [posts, setPosts] = useState<PostItem[]>(INITIAL_POSTS);
  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_USER_PROFILE);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlertItem[]>(INITIAL_PRICE_ALERTS);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [selectedPolarityFilter, setSelectedPolarityFilter] = useState<'all' | PostPolarity>('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<CategoryId>('all');
  const [selectedCityFilter, setSelectedCityFilter] = useState<string>('Всички градове');

  // Състояния за Stripe Дарения и Периодично напомняне
  const [isDonationModalOpen, setIsDonationModalOpen] = useState<boolean>(false);
  const [isPeriodicNudge, setIsPeriodicNudge] = useState<boolean>(false);
  const [donationPromptReason, setDonationPromptReason] = useState<string>(
    'SmartPrice съществува единствено благодарение на хората, които споделят реални цени и подкрепят общността.'
  );

  // Зареждане от AsyncStorage (и Supabase ако е свързан)
  useEffect(() => {
    const loadInitialState = async () => {
      try {
        const [storedPosts, storedProfile, storedAlerts] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.POSTS),
          AsyncStorage.getItem(STORAGE_KEYS.PROFILE),
          AsyncStorage.getItem(STORAGE_KEYS.ALERTS),
        ]);

        if (storedPosts) {
          setPosts(JSON.parse(storedPosts));
        }
        if (storedProfile) {
          setUserProfile(JSON.parse(storedProfile));
        }
        if (storedAlerts) {
          setPriceAlerts(JSON.parse(storedAlerts));
        }
      } catch {
        // Използваме примерните данни при грешка
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialState();
  }, []);

  // Автоматичен запис при промяна
  useEffect(() => {
    if (!isLoading) {
      AsyncStorage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(posts)).catch(() => {});
    }
  }, [posts, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      AsyncStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(userProfile)).catch(() => {});
    }
  }, [userProfile, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      AsyncStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(priceAlerts)).catch(() => {});
    }
  }, [priceAlerts, isLoading]);

  // ПЕРИОДИЧЕН ТАЙМЕР за напомняне на потребители, които НЕ са дарили
  useEffect(() => {
    if (isLoading || userProfile.isSupporter) return;

    // Първоначално ненатрапчиво напомняне след 35 секунди в приложението, ако още не е показвано
    const timer = setInterval(() => {
      setUserProfile((current) => {
        if (current.isSupporter) return current;
        const now = Date.now();
        const snoozedUntil = current.nudgeSnoozedUntil || 0;
        const lastPrompt = current.lastDonationPromptAt || 0;

        if (now > snoozedUntil && now - lastPrompt >= PERIODIC_TIME_THRESHOLD_MS) {
          setIsPeriodicNudge(true);
          setDonationPromptReason(
            `Здравей, ${current.name.split(' ')[0]}! Вече си спестил над ${current.personalSavedBgn} лв. с SmartPrice. Приложението е 100% без реклами и без платени ревюта. Подкрепи ни с малко дарение, за да продължим!`
          );
          setIsDonationModalOpen(true);
          return {
            ...current,
            lastDonationPromptAt: now,
          };
        }
        return current;
      });
    }, 35000);

    return () => clearInterval(timer);
  }, [isLoading, userProfile.isSupporter]);

  // Отчитане на потребителска интеракция и проверка дали е време за периодично напомняне
  const recordUserInteraction = useCallback((reasonHint?: string) => {
    setUserProfile((prev) => {
      if (prev.isSupporter) return prev;

      const nextInteractions = prev.interactionsSincePrompt + 1;
      const now = Date.now();

      if (nextInteractions >= INTERACTIONS_THRESHOLD_FOR_NUDGE) {
        setIsPeriodicNudge(true);
        setDonationPromptReason(
          reasonHint ||
            `Ти активно използваш SmartPrice! До момента общността ни си е спестила хиляди левове от скъпи капани. Тъй като все още не си дарил, ще ни подкрепиш ли с едно кафе през Stripe?`
        );
        setIsDonationModalOpen(true);

        return {
          ...prev,
          interactionsSincePrompt: 0,
          lastDonationPromptAt: now,
        };
      }

      return {
        ...prev,
        interactionsSincePrompt: nextInteractions,
      };
    });
  }, []);

  const openDonationModal = useCallback((reason?: string, isPeriodic = false) => {
    triggerHaptic('light');
    setIsPeriodicNudge(isPeriodic);
    if (reason) {
      setDonationPromptReason(reason);
    } else {
      setDonationPromptReason(
        'Подкрепи SmartPrice с дарение през Stripe! 100% от средствата отиват за поддръжка на сървърите и AI скенера на касови бележки.'
      );
    }
    setIsDonationModalOpen(true);
  }, []);

  const snoozeDonationNudge = useCallback(() => {
    triggerHaptic('light');
    setIsDonationModalOpen(false);
    setUserProfile((prev) => ({
      ...prev,
      interactionsSincePrompt: 0,
      lastDonationPromptAt: Date.now(),
      nudgeSnoozedUntil: Date.now() + PERIODIC_TIME_THRESHOLD_MS,
    }));
  }, []);

  const triggerPeriodicNudgeNow = useCallback(() => {
    triggerHaptic('medium');
    setIsPeriodicNudge(true);
    setDonationPromptReason(
      `Периодично напомняне: SmartPrice няма реклами и не приема пари от ресторанти или хотели за изтриване на негативни отзиви. Подкрепи каузата с дарение през Stripe!`
    );
    setIsDonationModalOpen(true);
  }, []);

  const submitDonation = useCallback(
    async ({
      amountBgn,
      tierId,
      isMonthly,
      paymentMethodType,
    }: {
      amountBgn: number;
      tierId: 'coffee' | 'guardian' | 'legend';
      isMonthly: boolean;
      paymentMethodType: 'apple_pay' | 'google_pay' | 'card';
    }) => {
      const result = await processStripeDonation({
        amountBgn,
        tierId,
        isMonthly,
        userId: userProfile.id,
        userEmail: userProfile.email,
        paymentMethodType,
      });

      if (result.success) {
        triggerHaptic('success');
        const newDonation: DonationRecord = {
          id: `don-${Date.now()}`,
          amountBgn,
          tierName:
            tierId === 'coffee'
              ? 'Едно кафе'
              : tierId === 'guardian'
              ? 'Пазител на Цените'
              : 'Легенда на Общността',
          isMonthly,
          createdAt: 'Току-що',
          paymentIntentId: result.paymentIntentId,
        };

        setUserProfile((prev) => ({
          ...prev,
          isSupporter: true,
          supporterSince: new Date().toLocaleDateString('bg-BG'),
          supporterTier: tierId,
          totalDonatedBgn: prev.totalDonatedBgn + amountBgn,
          reputationPoints: prev.reputationPoints + 150,
          interactionsSincePrompt: 0,
          donations: [newDonation, ...prev.donations],
          badges: prev.badges.map((b) =>
            b.id === 'badge-supporter' ? { ...b, unlocked: true } : b
          ),
        }));
      }

      return {
        success: result.success,
        message: result.message,
        paymentIntentId: result.paymentIntentId,
      };
    },
    [userProfile.email, userProfile.id]
  );

  // Позволява лесно тестване на периодичното напомняне отново дори след тестово дарение
  const resetSupporterStatusForDemo = useCallback(() => {
    triggerHaptic('light');
    setUserProfile((prev) => ({
      ...prev,
      isSupporter: false,
      supporterTier: undefined,
      interactionsSincePrompt: 0,
      nudgeSnoozedUntil: null,
    }));
  }, []);

  const addPost = useCallback(
    async (input: CreatePostInput): Promise<PostItem> => {
      triggerHaptic('success');
      const hasReceipt = Boolean(input.receipt);

      const newPost: PostItem = {
        id: `post-${Date.now()}`,
        polarity: input.polarity,
        category: input.category,
        customCategoryLabel: input.customCategoryLabel?.trim() || undefined,
        platformTag: input.platformTag,
        customPlatformLabel: input.customPlatformLabel?.trim() || undefined,
        title: input.title.trim(),
        description: input.description.trim(),
        placeName: input.placeName.trim(),
        city: input.city,
        address: input.address?.trim(),
        latitude: input.latitude,
        longitude: input.longitude,
        googleMapsUrl: input.googleMapsUrl,
        locationAutoDetected: input.locationAutoDetected,
        pricePaid: input.pricePaid,
        referencePrice: input.referencePrice,
        currency: 'лв.',
        unitQuantity: input.unitQuantity,
        unitType: input.unitType,
        pricePerKgOrLiter: input.pricePerKgOrLiter,
        isShrinkflation: input.isShrinkflation,
        isFakePromo: input.isFakePromo,
        verifiedValidTodayCount: 1,
        userConfirmedValidToday: true,
        lastVerifiedAt: 'Току-що',
        priceHistory: [
          {
            id: `ph-${Date.now()}`,
            price: input.pricePaid,
            recordedAt: 'Днес',
            reportedBy: userProfile.name,
            status: 'initial',
          },
        ],
        imageUri: input.imageUri,
        comparisonImageUri: input.comparisonImageUri,
        comparisonLabel: input.comparisonLabel,
        receipt: input.receipt,
        author: {
          id: userProfile.id,
          name: userProfile.name,
          handle: userProfile.handle,
          avatar: userProfile.avatar,
          isSupporter: userProfile.isSupporter,
          badgeTitle: userProfile.isSupporter ? 'Пазител на Общността' : 'Детектив с Бележка',
        },
        createdAt: 'Току-що',
        reactions: {
          topDeal: input.polarity === 'green' ? 1 : 0,
          worthIt: 0,
          doubt: 0,
          pureRobbery: input.polarity === 'red' ? 1 : 0,
          avoid: 0,
          exaggerated: 0,
        },
        userReaction: input.polarity === 'green' ? 'topDeal' : 'pureRobbery',
        helpedCount: 1,
        communitySavedBgn:
          input.referencePrice && input.referencePrice > input.pricePaid
            ? Math.round(input.referencePrice - input.pricePaid)
            : 20,
        tags:
          input.tags.length > 0
            ? input.tags
            : [input.polarity === 'green' ? '#ТопНаходка' : '#ЧервенФлаг', `#${input.city}`],
        comments: [],
      };

      setPosts((prev) => [newPost, ...prev]);

      setUserProfile((prev) => ({
        ...prev,
        postsCount: prev.postsCount + 1,
        verifiedReceiptsCount: hasReceipt
          ? prev.verifiedReceiptsCount + 1
          : prev.verifiedReceiptsCount,
        reputationPoints: prev.reputationPoints + (hasReceipt ? 60 : 25),
      }));

      if (isSupabaseConfigured && supabase) {
        try {
          await supabase.from('posts').insert({
            polarity: newPost.polarity,
            category: newPost.category,
            platform_tag: newPost.platformTag,
            title: newPost.title,
            description: newPost.description,
            place_name: newPost.placeName,
            city: newPost.city,
            address: newPost.address,
            price_paid: newPost.pricePaid,
            reference_price: newPost.referencePrice,
            image_url: newPost.imageUri,
            has_verified_receipt: hasReceipt,
            receipt_merchant_name: newPost.receipt?.merchantName,
            receipt_total_amount: newPost.receipt?.totalAmount,
          });
        } catch {
          // Продължаваме с локалния запис
        }
      }

      recordUserInteraction(
        'Страхотна публикация! За да поддържаме AI скенера на касови бележки безплатен за всички, можеш да подкрепиш SmartPrice с дарение.'
      );

      return newPost;
    },
    [recordUserInteraction, userProfile]
  );

  const toggleReaction = useCallback(
    (postId: string, reactionKey: ReactionKey) => {
      triggerHaptic('light');
      setPosts((prev) =>
        prev.map((post) => {
          if (post.id !== postId) return post;

          const prevReaction = post.userReaction;
          const updatedReactions = { ...post.reactions };

          if (prevReaction) {
            updatedReactions[prevReaction] = Math.max(0, updatedReactions[prevReaction] - 1);
          }

          if (prevReaction === reactionKey) {
            return {
              ...post,
              reactions: updatedReactions,
              userReaction: undefined,
            };
          }

          updatedReactions[reactionKey] = (updatedReactions[reactionKey] || 0) + 1;
          return {
            ...post,
            reactions: updatedReactions,
            userReaction: reactionKey,
          };
        })
      );

      recordUserInteraction();
    },
    [recordUserInteraction]
  );

  const markPostHelpedMe = useCallback(
    (postId: string) => {
      triggerHaptic('medium');
      let estimatedSaving = 25;

      setPosts((prev) =>
        prev.map((post) => {
          if (post.id !== postId) return post;
          if (post.userMarkedHelped) return post;

          if (post.referencePrice) {
            estimatedSaving = Math.max(10, Math.round(Math.abs(post.referencePrice - post.pricePaid)));
          }

          return {
            ...post,
            userMarkedHelped: true,
            helpedCount: post.helpedCount + 1,
            communitySavedBgn: post.communitySavedBgn + estimatedSaving,
          };
        })
      );

      setUserProfile((prev) => ({
        ...prev,
        personalSavedBgn: prev.personalSavedBgn + estimatedSaving,
      }));

      recordUserInteraction(
        `Този пост ти спести около ${estimatedSaving} лв.! Ако SmartPrice ти помага да харчиш умно и да избягваш капани, подкрепи ни с малко дарение.`
      );
    },
    [recordUserInteraction]
  );

  const confirmPriceValidToday = useCallback(
    (postId: string) => {
      triggerHaptic('success');
      setPosts((prev) =>
        prev.map((post) => {
          if (post.id !== postId) return post;
          if (post.userConfirmedValidToday) return post;

          const prevHistory = post.priceHistory || [
            {
              id: `ph-init-${post.id}`,
              price: post.pricePaid,
              recordedAt: post.createdAt,
              reportedBy: post.author.name,
              status: 'initial' as const,
            },
          ];

          return {
            ...post,
            userConfirmedValidToday: true,
            verifiedValidTodayCount: (post.verifiedValidTodayCount || 1) + 1,
            lastVerifiedAt: 'Потвърдена днес',
            priceHistory: [
              ...prevHistory,
              {
                id: `ph-${Date.now()}`,
                price: post.pricePaid,
                recordedAt: 'Току-що',
                reportedBy: userProfile.name,
                status: 'confirmed',
              },
            ],
          };
        })
      );
      setUserProfile((prev) => ({
        ...prev,
        reputationPoints: prev.reputationPoints + 10,
      }));
    },
    [userProfile.name]
  );

  const reportUpdatedPrice = useCallback(
    (postId: string, newPrice: number) => {
      if (isNaN(newPrice) || newPrice <= 0) return;
      triggerHaptic('medium');
      setPosts((prev) =>
        prev.map((post) => {
          if (post.id !== postId) return post;

          const prevHistory = post.priceHistory || [
            {
              id: `ph-init-${post.id}`,
              price: post.pricePaid,
              recordedAt: post.createdAt,
              reportedBy: post.author.name,
              status: 'initial' as const,
            },
          ];

          return {
            ...post,
            pricePaid: newPrice,
            lastVerifiedAt: 'Обновена днес',
            verifiedValidTodayCount: (post.verifiedValidTodayCount || 1) + 1,
            priceHistory: [
              ...prevHistory,
              {
                id: `ph-${Date.now()}`,
                price: newPrice,
                recordedAt: 'Току-що',
                reportedBy: userProfile.name,
                status: 'changed',
              },
            ],
          };
        })
      );
      setUserProfile((prev) => ({
        ...prev,
        reputationPoints: prev.reputationPoints + 15,
      }));
    },
    [userProfile.name]
  );

  const addPriceAlert = useCallback(
    (alertInput: Omit<PriceAlertItem, 'id' | 'createdAt' | 'isActive'>) => {
      triggerHaptic('success');
      const newAlert: PriceAlertItem = {
        ...alertInput,
        id: `alert-${Date.now()}`,
        createdAt: 'Днес',
        isActive: true,
      };
      setPriceAlerts((prev) => [newAlert, ...prev]);
    },
    []
  );

  const removePriceAlert = useCallback((id: string) => {
    triggerHaptic('light');
    setPriceAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const togglePriceAlert = useCallback((id: string) => {
    triggerHaptic('light');
    setPriceAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, isActive: !a.isActive } : a))
    );
  }, []);

  const addComment = useCallback(
    (
      postId: string,
      text: string,
      extra?: { imageUri?: string; reportedPrice?: number }
    ) => {
      if (!text.trim() && !extra?.imageUri) return;
      triggerHaptic('light');

      const newComment: CommentItem = {
        id: `comment-${Date.now()}`,
        postId,
        authorId: userProfile.id,
        authorName: userProfile.name,
        authorHandle: userProfile.handle,
        authorAvatar: userProfile.avatar,
        authorIsSupporter: userProfile.isSupporter,
        text:
          text.trim() ||
          (extra?.reportedPrice
            ? `Актуална снимка с цена: ${extra.reportedPrice.toFixed(2)} лв.`
            : 'Прикачена снимка с цена'),
        imageUri: extra?.imageUri,
        reportedPrice: extra?.reportedPrice,
        createdAt: 'Току-що',
        likes: 0,
      };

      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId
            ? { ...post, comments: [...post.comments, newComment] }
            : post
        )
      );

      recordUserInteraction();
    },
    [recordUserInteraction, userProfile]
  );

  const toggleBookmark = useCallback((postId: string) => {
    triggerHaptic('light');
    setPosts((prev) =>
      prev.map((post) =>
        post.id === postId ? { ...post, isBookmarked: !post.isBookmarked } : post
      )
    );
  }, []);

  const leaderboard = useMemo(() => {
    return INITIAL_LEADERBOARD.map((item) => {
      if (item.id === 'user-me') {
        return {
          ...item,
          isSupporter: userProfile.isSupporter,
          verifiedReceipts: userProfile.verifiedReceiptsCount,
          communitySavedBgn: userProfile.totalSavedForCommunityBgn,
          badgeTitle: userProfile.isSupporter ? 'Пазител на Общността' : 'Детектив с Бележка',
        };
      }
      return item;
    });
  }, [userProfile]);

  const totalCommunitySavedAllPosts = useMemo(() => {
    return posts.reduce((acc, p) => acc + (p.communitySavedBgn || 0), 0);
  }, [posts]);

  return (
    <AppContext.Provider
      value={{
        posts,
        userProfile,
        leaderboard,
        priceAlerts,
        isLoading,
        selectedPolarityFilter,
        setSelectedPolarityFilter,
        selectedCategoryFilter,
        setSelectedCategoryFilter,
        selectedCityFilter,
        setSelectedCityFilter,
        addPost,
        toggleReaction,
        markPostHelpedMe,
        confirmPriceValidToday,
        reportUpdatedPrice,
        addPriceAlert,
        removePriceAlert,
        togglePriceAlert,
        addComment,
        toggleBookmark,
        recordUserInteraction,
        isDonationModalOpen,
        isPeriodicNudge,
        donationPromptReason,
        openDonationModal,
        snoozeDonationNudge,
        submitDonation,
        resetSupporterStatusForDemo,
        triggerPeriodicNudgeNow,
        totalCommunitySavedAllPosts,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextValue => {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp трябва да се използва вътре в AppProvider');
  }
  return ctx;
};
