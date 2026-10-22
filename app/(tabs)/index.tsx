import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { COLORS, CITIES, getRetailChainStyle } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { QuickPricePhotoModal } from '@/components/QuickPricePhotoModal';
import { SmartToolsModal, type SmartToolTab } from '@/components/SmartToolsModal';
import { api } from '@/src/api/client';
import type { PostItem } from '@/types';

const DEFAULT_AVATAR_URI =
  'https://lh3.googleusercontent.com/aida/AEtjO1VuErqROe2PbBbZAgjMVuoRCFBmUSE6QBmQJJy1GloyyA2zUp2ZUjBkd78F_UhmIerVdZCyPj_hc9gLVQvykukOnVllDkvHaiCA-Z4IqyIya3kjRZcisn_g05eL7F4kh6zl784M0kWjbUrHioEPTmWXxrOVsgs24pbFPqy86VaaXyVLlGdmx0GwOmCmxHxeV1TCkzh8aqIsSIWkJuglQsQq59wl-Ts6O9m4mF8h9n1C543Afsrr4AlkM8A';

const VEREIA_CHEESE_IMG =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuAYrUoGkpK3UD8QMXjJgHPpgVayhTjO4P2qYQXb6VbTBXGrNgZaLqjOscEQbqxNdi_hTqpMD-m7Dhk0ThcfRJ7IOek3cGxqHVzVaCPCUaMftT0neKqZDu3spU-47letFW9jKmuDAqkbyOqLtzETLVsaynoXGSj-2IDVNm9ga6EG50bUe5-zzW4cc6WOY8dpwwmptQsOjexvhkLp21yiuGWxXYcJiMa7yxtNl-VYbRztEnpK4_g5FV0s';

export interface ChainOfferItem {
  id: string;
  chain: string;
  branch: string;
  price: number;
  oldPrice?: number;
  discountPct?: number;
  isBestDeal?: boolean;
  inStock?: boolean;
  promoText?: string;
  promoType?: 'brochure' | 'eco' | 'loyalty' | 'regular';
  savingText?: string;
  withoutCardText?: string;
  verificationText?: string;
  verifiedReceipt?: boolean;
  compact?: boolean;
}

export interface CatalogProduct {
  id: string;
  searchLabel: string;
  brandCategory: string;
  title: string;
  subtitle: string;
  barcode: string;
  weight: string;
  badgeText: string;
  imageUri: string;
  lowestPrice: number;
  avgPrice: number;
  highestPrice: number;
  maxSaving: number;
  historyDropPct: number;
  historyPeak: number;
  historyLow: number;
  historyInsight: string;
  lastVerifiedText: string;
  upvotes: number;
  downvotes: number;
  offers: ChainOfferItem[];
}

const CATALOG_PRODUCTS: CatalogProduct[] = [
  {
    id: 'vereia-cheese-400',
    searchLabel: 'Краве сирене Верея 400г',
    brandCategory: 'Верея • Млечни',
    title: 'Краве сирене 400г БДС',
    subtitle: 'Саламурено сирене, кутия',
    barcode: '380001234567',
    weight: '400 г',
    badgeText: 'БДС',
    imageUri: VEREIA_CHEESE_IMG,
    lowestPrice: 5.89,
    avgPrice: 7.45,
    highestPrice: 8.99,
    maxSaving: 3.1,
    historyDropPct: 18,
    historyPeak: 8.99,
    historyLow: 5.89,
    historyInsight: 'В момента цената е близо до историческия минимум за последните 6 месеца.',
    lastVerifiedText: 'Последно потвърдено преди 22 минути от потребител в Kaufland - Младост',
    upvotes: 42,
    downvotes: 2,
    offers: [
      {
        id: 'kaufland-1',
        chain: 'KAUFLAND',
        branch: 'Младост 4',
        price: 5.89,
        oldPrice: 8.99,
        discountPct: 34,
        isBestDeal: true,
        inStock: true,
        promoText: 'Седмична брошура • до неделя',
        promoType: 'brochure',
        verificationText: 'Касова бележка',
        verifiedReceipt: true,
      },
      {
        id: 'lidl-1',
        chain: 'LIDL',
        branch: 'бул. България',
        price: 6.49,
        promoText: 'Редовна цена • Алтернатива Pilos',
        promoType: 'eco',
        savingText: 'Спестяваш 2.50 лв.',
        verificationText: 'Обновено преди 3 ч.',
      },
      {
        id: 'billa-1',
        chain: 'BILLA',
        branch: 'Студентски град',
        price: 7.29,
        promoText: 'С Billa Card клубна цена',
        promoType: 'loyalty',
        withoutCardText: 'Без карта: 8.19 лв.',
        verificationText: 'Потвърдено от клиент',
      },
      {
        id: 'fantastico-1',
        chain: 'ФАНТАСТИКО',
        branch: 'Драгалевци',
        price: 7.89,
        promoText: 'Редовна цена на рафт',
        promoType: 'regular',
        compact: true,
      },
      {
        id: 'tmarket-1',
        chain: 'Т-МАРКЕТ',
        branch: 'Люлин 3',
        price: 8.49,
        promoText: 'Редовна цена',
        promoType: 'regular',
        compact: true,
      },
    ],
  },
  {
    id: 'butter-president-250',
    searchLabel: 'Краве масло Президент 250г',
    brandCategory: 'Президент • Млечни',
    title: 'Краве масло 82% 250г',
    subtitle: 'Масло от пастьоризирана сметана',
    barcode: '322802117002',
    weight: '250 г',
    badgeText: '82%',
    imageUri: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=400&auto=format&fit=crop&q=80',
    lowestPrice: 4.99,
    avgPrice: 6.45,
    highestPrice: 7.89,
    maxSaving: 2.9,
    historyDropPct: 22,
    historyPeak: 7.89,
    historyLow: 4.99,
    historyInsight: 'Промоционалната цена в Lidl е с 22% под средната за месеца.',
    lastVerifiedText: 'Последно потвърдено преди 45 минути от потребител в Lidl - Люлин',
    upvotes: 31,
    downvotes: 1,
    offers: [
      {
        id: 'lidl-butter',
        chain: 'LIDL',
        branch: 'бул. Сливница',
        price: 4.99,
        oldPrice: 7.89,
        discountPct: 37,
        isBestDeal: true,
        inStock: true,
        promoText: 'Уикенд акция • с Lidl Plus',
        promoType: 'brochure',
        verificationText: 'Касова бележка',
        verifiedReceipt: true,
      },
      {
        id: 'kaufland-butter',
        chain: 'KAUFLAND',
        branch: 'Банишора',
        price: 5.49,
        promoText: 'Седмична брошура • Kaufland Card',
        promoType: 'eco',
        savingText: 'Спестяваш 2.40 лв.',
        verificationText: 'Обновено преди 1 ч.',
      },
      {
        id: 'billa-butter',
        chain: 'BILLA',
        branch: 'Лозенец',
        price: 6.29,
        promoText: 'С Billa Card клубна цена',
        promoType: 'loyalty',
        withoutCardText: 'Без карта: 7.49 лв.',
        verificationText: 'Потвърдено от клиент',
      },
      {
        id: 'fantastico-butter',
        chain: 'ФАНТАСТИКО',
        branch: 'Гео Милев',
        price: 6.99,
        promoText: 'Редовна цена на рафт',
        promoType: 'regular',
        compact: true,
      },
    ],
  },
  {
    id: 'olive-oil-1l',
    searchLabel: 'Зехтин Extra Virgin 1л',
    brandCategory: 'Minerva • Масла',
    title: 'Зехтин Extra Virgin 1л',
    subtitle: 'Студено пресован маслинов зехтин',
    barcode: '520105401211',
    weight: '1 л',
    badgeText: 'Екстра',
    imageUri: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&auto=format&fit=crop&q=80',
    lowestPrice: 16.99,
    avgPrice: 21.4,
    highestPrice: 25.99,
    maxSaving: 9.0,
    historyDropPct: 26,
    historyPeak: 25.99,
    historyLow: 16.99,
    historyInsight: 'Силна промоция тази седмица — спестяваш до 9.00 лв. на бутилка.',
    lastVerifiedText: 'Последно потвърдено преди 1 час от потребител в Фантастико - Младост',
    upvotes: 58,
    downvotes: 3,
    offers: [
      {
        id: 'fantastico-oil',
        chain: 'ФАНТАСТИКО',
        branch: 'Младост 1',
        price: 16.99,
        oldPrice: 25.99,
        discountPct: 35,
        isBestDeal: true,
        inStock: true,
        promoText: 'Седмична брошура • до сряда',
        promoType: 'brochure',
        verificationText: 'Касова бележка',
        verifiedReceipt: true,
      },
      {
        id: 'kaufland-oil',
        chain: 'KAUFLAND',
        branch: 'Дружба',
        price: 18.49,
        promoText: 'Промо палет • Ограничени количества',
        promoType: 'eco',
        savingText: 'Спестяваш 7.50 лв.',
        verificationText: 'Обновено преди 2 ч.',
      },
      {
        id: 'billa-oil',
        chain: 'BILLA',
        branch: 'Център',
        price: 21.99,
        promoText: 'С Billa Card клубна цена',
        promoType: 'loyalty',
        withoutCardText: 'Без карта: 24.99 лв.',
        verificationText: 'Потвърдено от клиент',
      },
    ],
  },
];

export default function PricesComparisonScreen() {
  const router = useRouter();
  const {
    userProfile,
    selectedCityFilter,
    setSelectedCityFilter,
    priceAlerts,
  } = useApp();

  const displayCity =
    selectedCityFilter && selectedCityFilter !== 'Всички градове'
      ? selectedCityFilter
      : 'София';

  const [selectedProductId, setSelectedProductId] = useState<string>(CATALOG_PRODUCTS[0]!.id);
  const [searchInput, setSearchInput] = useState<string>(CATALOG_PRODUCTS[0]!.searchLabel);
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);

  // Любими продукти (сърцето в Hero картата)
  const [favoriteIds, setFavoriteIds] = useState<Record<string, boolean>>({});

  // Списък за пазаруване (бутоните „+ В списъка“ и долният бутон „Добави в пазарската кошница“)
  const [addedOffers, setAddedOffers] = useState<
    Record<string, { chain: string; productTitle: string; price: number; saving: number }>
  >({});

  // Гласуване „Точна ли е тази цена?“ (👍 / 👎)
  const [userVote, setUserVote] = useState<Record<string, 'up' | 'down' | null>>({});

  // Филтър за веригите и сортиране
  const [isFilterOpen, setIsFilterOpen] = useState<boolean>(false);
  const [chainFilter, setChainFilter] = useState<string>('ALL');
  const [onlyVerifiedFilter, setOnlyVerifiedFilter] = useState<boolean>(false);
  const [sortOrder, setSortOrder] = useState<'price_asc' | 'discount_desc'>('price_asc');

  // Модали: Град, Камера/Бележка, Умни инструменти (Кошница / Аларми), Пазарска кошница
  const [isCityModalOpen, setIsCityModalOpen] = useState<boolean>(false);
  const [citySearch, setCitySearch] = useState<string>('');
  const [isQuickPhotoOpen, setIsQuickPhotoOpen] = useState<boolean>(false);
  const [isSmartToolsOpen, setIsSmartToolsOpen] = useState<boolean>(false);
  const [smartToolsTab, setSmartToolsTab] = useState<SmartToolTab>('basket');
  const [isBasketDrawerOpen, setIsBasketDrawerOpen] = useState<boolean>(false);
  const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState<boolean>(false);

  // Реални оферти от сървъра при търсене на произволен продукт
  const [liveServerOffers, setLiveServerOffers] = useState<PostItem[]>([]);
  const [isSearchingLive, setIsSearchingLive] = useState<boolean>(false);

  const currentProduct = useMemo(
    () => CATALOG_PRODUCTS.find((p) => p.id === selectedProductId) ?? CATALOG_PRODUCTS[0]!,
    [selectedProductId]
  );

  // Когато потребителят напише нещо различно от текущия продукт, търсим и в сървъра
  useEffect(() => {
    const q = searchInput.trim();
    if (!q || q === currentProduct.searchLabel) {
      setLiveServerOffers([]);
      setIsSearchingLive(false);
      return;
    }
    let cancelled = false;
    setIsSearchingLive(true);
    const timer = setTimeout(() => {
      api
        .feed({
          q,
          city: selectedCityFilter !== 'Всички градове' ? selectedCityFilter : undefined,
          limit: 15,
        })
        .then((res) => {
          if (!cancelled) setLiveServerOffers(res.items ?? []);
        })
        .catch(() => {
          if (!cancelled) setLiveServerOffers([]);
        })
        .finally(() => {
          if (!cancelled) setIsSearchingLive(false);
        });
    }, 320);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchInput, currentProduct.searchLabel, selectedCityFilter]);

  const handleSelectProduct = (prod: CatalogProduct) => {
    setSelectedProductId(prod.id);
    setSearchInput(prod.searchLabel);
    setIsSearchFocused(false);
    setChainFilter('ALL');
  };

  // Филтрирани и сортирани оферти по вериги за текущия продукт
  const visibleOffers = useMemo(() => {
    let list = [...currentProduct.offers];
    if (chainFilter !== 'ALL') {
      list = list.filter((o) => o.chain.toLowerCase() === chainFilter.toLowerCase());
    }
    if (onlyVerifiedFilter) {
      list = list.filter((o) => o.verifiedReceipt || o.verificationText?.includes('Потвърдено'));
    }
    if (sortOrder === 'discount_desc') {
      list.sort((a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0));
    } else {
      list.sort((a, b) => a.price - b.price);
    }
    return list;
  }, [currentProduct.offers, chainFilter, onlyVerifiedFilter, sortOrder]);

  const toggleOfferInList = (offer: ChainOfferItem) => {
    const saving = Math.max(0, currentProduct.highestPrice - offer.price);
    setAddedOffers((prev) => {
      const next = { ...prev };
      if (next[offer.id]) {
        delete next[offer.id];
      } else {
        next[offer.id] = {
          chain: offer.chain,
          productTitle: currentProduct.title,
          price: offer.price,
          saving,
        };
      }
      return next;
    });
  };

  // Изчисляване на общата икономия за бутона „Добави в пазарската кошница“
  // По подразбиране показва 12.40 лв. (точно както в дизайна), а при добавяне на артикули ги сумира
  const basketItemsList = Object.entries(addedOffers);
  const dynamicSavings = useMemo(() => {
    if (basketItemsList.length === 0) return 12.4;
    const extraSavings = basketItemsList.reduce((sum, [, item]) => sum + item.saving, 0);
    return Number((12.4 + extraSavings).toFixed(2));
  }, [basketItemsList]);

  const currentVote = userVote[currentProduct.id] ?? null;
  const displayUpvotes = currentProduct.upvotes + (currentVote === 'up' ? 1 : 0);
  const displayDownvotes = currentProduct.downvotes + (currentVote === 'down' ? 1 : 0);

  const isFavorite = Boolean(favoriteIds[currentProduct.id]);
  const activeAlertsCount = priceAlerts.filter((a) => a.isActive).length;

  const filteredCities = useMemo(() => {
    const q = citySearch.trim().toLowerCase();
    if (!q) return CITIES.slice(0, 20);
    return CITIES.filter((c) => c.toLowerCase().includes(q)).slice(0, 30);
  }, [citySearch]);

  const renderTrendChart = () => {
    if (Platform.OS === 'web') {
      return (
        <View style={styles.chartContainer}>
          <div style={{ width: '100%', height: 100, position: 'relative' }}>
            <svg
              viewBox="0 0 320 90"
              preserveAspectRatio="none"
              style={{ width: '100%', height: '100%', overflow: 'visible' }}
            >
              <defs>
                <linearGradient id="spestiChartGrad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity="0.30" />
                  <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <line
                x1="0"
                y1="15"
                x2="320"
                y2="15"
                stroke="#E2E8F0"
                strokeDasharray="3,3"
                strokeWidth="1"
              />
              <line
                x1="0"
                y1="50"
                x2="320"
                y2="50"
                stroke="#E2E8F0"
                strokeDasharray="3,3"
                strokeWidth="1"
              />
              <line
                x1="0"
                y1="80"
                x2="320"
                y2="80"
                stroke="#E2E8F0"
                strokeDasharray="3,3"
                strokeWidth="1"
              />
              <path
                d="M0,25 Q40,20 80,45 T160,30 T240,75 T320,68 L320,90 L0,90 Z"
                fill="url(#spestiChartGrad)"
              />
              <path
                d="M0,25 Q40,20 80,45 T160,30 T240,75 T320,68"
                fill="none"
                stroke="#006C49"
                strokeLinecap="round"
                strokeWidth="2.5"
              />
              <circle cx="80" cy="45" r="4" fill="#565E74" />
              <text
                x="80"
                y="38"
                fill="#565E74"
                fontSize="9"
                fontWeight="700"
                textAnchor="middle"
                fontFamily="Plus Jakarta Sans, sans-serif"
              >
                {currentProduct.historyPeak.toFixed(2)}
              </text>
              <circle cx="240" cy="75" r="4.5" fill="#10B981" />
              <text
                x="240"
                y="70"
                fill="#006C49"
                fontSize="9"
                fontWeight="800"
                textAnchor="middle"
                fontFamily="Plus Jakarta Sans, sans-serif"
              >
                {currentProduct.historyLow.toFixed(2)}
              </text>
            </svg>
          </div>
          <View style={styles.chartAxisRow}>
            <Text style={styles.chartAxisLabel}>Преди 30 дни</Text>
            <Text style={styles.chartAxisLabel}>Преди 15 дни</Text>
            <Text style={[styles.chartAxisLabel, styles.chartAxisLabelToday]}>Днес</Text>
          </View>
        </View>
      );
    }

    // Native fallback за iOS / Android
    return (
      <View style={styles.chartContainer}>
        <View style={styles.nativeChartBox}>
          <View style={styles.nativeChartGridLine} />
          <View style={styles.nativeChartGridLine} />
          <View style={styles.nativeChartGridLine} />
          <View style={styles.nativeChartPointsRow}>
            <View style={styles.nativeChartPointCol}>
              <Text style={styles.nativePeakLabel}>{currentProduct.historyPeak.toFixed(2)}</Text>
              <View style={styles.nativePeakDot} />
            </View>
            <View style={[styles.nativeChartPointCol, { marginTop: 28 }]}>
              <Text style={styles.nativeLowLabel}>{currentProduct.historyLow.toFixed(2)}</Text>
              <View style={styles.nativeLowDot} />
            </View>
          </View>
        </View>
        <View style={styles.chartAxisRow}>
          <Text style={styles.chartAxisLabel}>Преди 30 дни</Text>
          <Text style={styles.chartAxisLabel}>Преди 15 дни</Text>
          <Text style={[styles.chartAxisLabel, styles.chartAxisLabelToday]}>Днес</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* ================================================================ */}
      {/* FIXED TOP HEADER (Спести & Открий + BG + Локация + Нотификации)  */}
      {/* ================================================================ */}
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <View style={styles.headerLeft}>
            <View style={styles.brandTitleRow}>
              <Text style={styles.brandTitle}>Спести & Открий</Text>
              <View style={styles.bgPill}>
                <Text style={styles.bgPillText}>BG</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.locationBtn}
              onPress={() => setIsCityModalOpen(true)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`Избран град ${displayCity}. Натисни за смяна на града`}
            >
              <Ionicons name="location" size={14} color={COLORS.primary} />
              <Text style={styles.locationBtnText}>{displayCity}</Text>
              <Ionicons name="chevron-down" size={14} color={COLORS.onSurfaceVariant} />
            </TouchableOpacity>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.bellBtn}
              onPress={() => {
                setSmartToolsTab('alerts');
                setIsSmartToolsOpen(true);
              }}
              activeOpacity={0.75}
              accessibilityLabel={`Ценови известия${activeAlertsCount ? ` (${activeAlertsCount})` : ''}`}
            >
              <Ionicons name="notifications-outline" size={22} color={COLORS.onSurfaceVariant} />
              <View style={styles.bellDot} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.avatarWrap}
              onPress={() => router.push('/(tabs)/profile' as never)}
              activeOpacity={0.8}
              accessibilityLabel="Отвори профил"
            >
              <Image
                source={{ uri: userProfile.avatar || DEFAULT_AVATAR_URI }}
                style={styles.avatarImg}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ================================================================ */}
      {/* MAIN SCROLLABLE CONTENT                                          */}
      {/* ================================================================ */}
      <ScrollView
        style={styles.mainScroll}
        contentContainerStyle={styles.mainScrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. Search & Barcode Quick Access Bar */}
        <View style={styles.searchSection}>
          <View style={styles.searchPill}>
            <View style={styles.searchLeft}>
              <Ionicons name="search" size={20} color={COLORS.primary} />
              <TextInput
                style={styles.searchInput}
                value={searchInput}
                onChangeText={setSearchInput}
                onFocus={() => setIsSearchFocused(true)}
                placeholder="Търси продукт, марка или баркод..."
                placeholderTextColor={COLORS.outline}
                returnKeyType="search"
              />
              {searchInput.length > 0 && isSearchFocused ? (
                <TouchableOpacity
                  onPress={() => {
                    setSearchInput('');
                    setIsSearchFocused(true);
                  }}
                  hitSlop={8}
                >
                  <Ionicons name="close-circle" size={18} color={COLORS.outline} />
                </TouchableOpacity>
              ) : null}
            </View>

            <TouchableOpacity
              style={styles.barcodeBtn}
              onPress={() => setIsBarcodeModalOpen(true)}
              activeOpacity={0.8}
              accessibilityLabel="Сканирай баркод"
            >
              <Ionicons name="barcode-outline" size={19} color={COLORS.onSurfaceVariant} />
            </TouchableOpacity>
          </View>

          {/* Бърз избор на продукти за моментално тестване и сравнение */}
          {isSearchFocused && (
            <View style={styles.productSuggestionsCard}>
              <View style={styles.suggestionsHeaderRow}>
                <Text style={styles.suggestionsTitle}>Каталог за сравнение по вериги</Text>
                <TouchableOpacity onPress={() => setIsSearchFocused(false)} hitSlop={8}>
                  <Text style={styles.suggestionsCloseText}>Затвори</Text>
                </TouchableOpacity>
              </View>
              {CATALOG_PRODUCTS.map((prod) => {
                const active = prod.id === currentProduct.id;
                return (
                  <TouchableOpacity
                    key={prod.id}
                    style={[styles.suggestionRow, active && styles.suggestionRowActive]}
                    onPress={() => handleSelectProduct(prod)}
                    activeOpacity={0.8}
                  >
                    <Image source={{ uri: prod.imageUri }} style={styles.suggestionThumb} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggestionName} numberOfLines={1}>
                        {prod.searchLabel}
                      </Text>
                      <Text style={styles.suggestionMeta}>
                        Най-ниска: {prod.lowestPrice.toFixed(2)} лв. • Икономия до{' '}
                        {prod.maxSaving.toFixed(2)} лв.
                      </Text>
                    </View>
                    <Ionicons
                      name={active ? 'checkmark-circle' : 'chevron-forward'}
                      size={18}
                      color={active ? COLORS.primary : COLORS.outline}
                    />
                  </TouchableOpacity>
                );
              })}

              {/* Резултати от живата база при въведен текст */}
              {isSearchingLive ? (
                <View style={{ paddingVertical: 10, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                </View>
              ) : liveServerOffers.length > 0 ? (
                <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: COLORS.borderSubtle, paddingTop: 8 }}>
                  <Text style={styles.suggestionsTitle}>
                    Оферти от базата ({liveServerOffers.length})
                  </Text>
                  {liveServerOffers.slice(0, 5).map((post) => (
                    <TouchableOpacity
                      key={post.id}
                      style={styles.suggestionRow}
                      onPress={() => {
                        setIsSearchFocused(false);
                        router.push(`/post/${post.id}` as never);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestionName} numberOfLines={1}>
                          {post.title}
                        </Text>
                        <Text style={styles.suggestionMeta} numberOfLines={1}>
                          {post.placeName} • {post.city}
                        </Text>
                      </View>
                      <Text style={{ color: COLORS.primary, fontWeight: '800', fontSize: 13 }}>
                        {post.pricePaid.toFixed(2)} {post.currency}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          )}
        </View>

        {/* 2. Hero Product Overview Card */}
        <View style={styles.sectionPad}>
          <View style={styles.heroCard}>
            {/* Decorative background glow */}
            <View style={styles.heroGlow} pointerEvents="none" />

            <View style={styles.heroTopRow}>
              {/* Product Thumbnail with verified sticker */}
              <View style={styles.heroThumbContainer}>
                <View style={styles.heroThumbBox}>
                  <Image
                    source={{ uri: currentProduct.imageUri }}
                    style={styles.heroThumbImg}
                    resizeMode="cover"
                  />
                </View>
                <View style={styles.heroVerifiedSticker}>
                  <Ionicons name="checkmark-circle" size={11} color={COLORS.onPrimary} />
                  <Text style={styles.heroVerifiedStickerText}>{currentProduct.badgeText}</Text>
                </View>
              </View>

              {/* Meta info */}
              <View style={styles.heroMetaCol}>
                <View style={styles.heroBrandRow}>
                  <Text style={styles.heroBrandText}>{currentProduct.brandCategory}</Text>
                  <TouchableOpacity
                    style={styles.favoriteBtn}
                    onPress={() =>
                      setFavoriteIds((prev) => ({
                        ...prev,
                        [currentProduct.id]: !prev[currentProduct.id],
                      }))
                    }
                    hitSlop={8}
                    accessibilityLabel="Добави в любими"
                  >
                    <Ionicons
                      name={isFavorite ? 'heart' : 'heart-outline'}
                      size={20}
                      color={isFavorite ? COLORS.error : COLORS.onSurfaceVariant}
                    />
                  </TouchableOpacity>
                </View>

                <Text style={styles.heroProductTitle} numberOfLines={1}>
                  {currentProduct.title}
                </Text>
                <Text style={styles.heroProductSubtitle} numberOfLines={1}>
                  {currentProduct.subtitle}
                </Text>

                <View style={styles.heroTagsRow}>
                  <View style={styles.heroMetaTag}>
                    <Ionicons name="qr-code-outline" size={12} color={COLORS.onSurfaceVariant} />
                    <Text style={styles.heroMetaTagText}>{currentProduct.barcode}</Text>
                  </View>
                  <View style={styles.heroMetaTag}>
                    <Text style={styles.heroMetaTagText}>{currentProduct.weight}</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Price Highlights Summary Pill Grid */}
            <View style={styles.priceSummaryGrid}>
              <View style={styles.priceSummaryCol}>
                <Text style={styles.priceSummaryLabelLowest}>Най-ниска</Text>
                <Text style={styles.priceSummaryValLowest}>
                  {currentProduct.lowestPrice.toFixed(2)}{' '}
                  <Text style={styles.currencyUnitLowest}>лв.</Text>
                </Text>
              </View>

              <View style={styles.priceSummaryCol}>
                <Text style={styles.priceSummaryLabelAvg}>Средна</Text>
                <Text style={styles.priceSummaryValAvg}>
                  {currentProduct.avgPrice.toFixed(2)}{' '}
                  <Text style={styles.currencyUnitNormal}>лв.</Text>
                </Text>
              </View>

              <View style={styles.priceSummaryCol}>
                <Text style={styles.priceSummaryLabelHighest}>Най-висока</Text>
                <Text style={styles.priceSummaryValHighest}>
                  {currentProduct.highestPrice.toFixed(2)}{' '}
                  <Text style={styles.currencyUnitSecondary}>лв.</Text>
                </Text>
              </View>
            </View>

            {/* Maximum Savings Alert Banner */}
            <TouchableOpacity
              style={styles.maxSavingsBanner}
              activeOpacity={0.85}
              onPress={() => {
                const bestOffer = currentProduct.offers[0];
                if (bestOffer && !addedOffers[bestOffer.id]) {
                  toggleOfferInList(bestOffer);
                }
                setIsBasketDrawerOpen(true);
              }}
            >
              <View style={styles.maxSavingsLeft}>
                <Ionicons name="wallet-outline" size={18} color={COLORS.primary} />
                <Text style={styles.maxSavingsText} numberOfLines={1}>
                  Възможна икономия до{' '}
                  <Text style={styles.maxSavingsStrong}>
                    {currentProduct.maxSaving.toFixed(2)} лв.
                  </Text>{' '}
                  на опаковка!
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* 3. Store Price Comparison Header & Filters */}
        <View style={styles.comparisonHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.comparisonTitle}>Цени по вериги в {displayCity}</Text>
            <Text style={styles.comparisonSubtitle}>
              {sortOrder === 'price_asc'
                ? 'Сортирани от най-ниска към най-висока'
                : 'Сортирани по най-голяма отстъпка'}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.filterPillBtn,
              (isFilterOpen || chainFilter !== 'ALL' || onlyVerifiedFilter) &&
                styles.filterPillBtnActive,
            ]}
            onPress={() => setIsFilterOpen((prev) => !prev)}
            activeOpacity={0.8}
          >
            <Ionicons
              name="options-outline"
              size={14}
              color={
                isFilterOpen || chainFilter !== 'ALL' || onlyVerifiedFilter
                  ? COLORS.primary
                  : COLORS.onSurfaceVariant
              }
            />
            <Text
              style={[
                styles.filterPillText,
                (isFilterOpen || chainFilter !== 'ALL' || onlyVerifiedFilter) && {
                  color: COLORS.primary,
                },
              ]}
            >
              Филтър
            </Text>
          </TouchableOpacity>
        </View>

        {/* Разгъваем панел за филтриране по верига и сортиране */}
        {isFilterOpen && (
          <View style={styles.filterDrawer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {['ALL', 'KAUFLAND', 'LIDL', 'BILLA', 'ФАНТАСТИКО', 'Т-МАРКЕТ'].map((ch) => {
                const active = chainFilter === ch;
                return (
                  <TouchableOpacity
                    key={ch}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    onPress={() => setChainFilter(ch)}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                      {ch === 'ALL' ? 'Всички вериги' : ch}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.filterOptionsRow}>
              <TouchableOpacity
                style={[styles.filterChip, onlyVerifiedFilter && styles.filterChipActive]}
                onPress={() => setOnlyVerifiedFilter((p) => !p)}
              >
                <Ionicons
                  name="checkmark-done-circle-outline"
                  size={14}
                  color={onlyVerifiedFilter ? COLORS.onPrimary : COLORS.primary}
                />
                <Text
                  style={[styles.filterChipText, onlyVerifiedFilter && styles.filterChipTextActive]}
                >
                  Само потвърдени
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.filterChip,
                  sortOrder === 'discount_desc' && styles.filterChipActive,
                ]}
                onPress={() =>
                  setSortOrder((p) => (p === 'price_asc' ? 'discount_desc' : 'price_asc'))
                }
              >
                <Ionicons
                  name="swap-vertical-outline"
                  size={14}
                  color={sortOrder === 'discount_desc' ? COLORS.onPrimary : COLORS.onSurfaceVariant}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    sortOrder === 'discount_desc' && styles.filterChipTextActive,
                  ]}
                >
                  По % отстъпка
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.filterCompareLink}
                onPress={() => router.push('/chains-compare' as never)}
              >
                <Text style={styles.filterCompareLinkText}>По категории →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 4. Retailers Comparison List */}
        <View style={styles.retailersList}>
          {visibleOffers.map((offer) => {
            const chainStyle = getRetailChainStyle(offer.chain);
            const isAdded = Boolean(addedOffers[offer.id]);

            // Компактна карта (Фантастико, Т-Маркет)
            if (offer.compact) {
              return (
                <View key={offer.id} style={styles.retailCardCompact}>
                  <View style={styles.retailCompactLeft}>
                    <View style={styles.chainHeaderRow}>
                      <View style={[styles.chainPill, { backgroundColor: chainStyle.bg }]}>
                        <Text style={[styles.chainPillText, { color: chainStyle.text }]}>
                          {chainStyle.label}
                        </Text>
                      </View>
                      <Text style={styles.branchText} numberOfLines={1}>
                        {offer.branch}
                      </Text>
                    </View>
                    {offer.promoText ? (
                      <Text style={styles.compactSubText}>{offer.promoText}</Text>
                    ) : null}
                  </View>

                  <View style={styles.retailCompactRight}>
                    <Text
                      style={[
                        styles.compactPriceText,
                        offer.chain.includes('Т-МАРКЕТ') && { color: COLORS.secondary },
                      ]}
                    >
                      {offer.price.toFixed(2)}{' '}
                      <Text style={styles.compactCurrencyUnit}>лв.</Text>
                    </Text>

                    <TouchableOpacity
                      style={[
                        styles.compactAddBtn,
                        isAdded && { backgroundColor: COLORS.primaryFixed },
                      ]}
                      onPress={() => toggleOfferInList(offer)}
                      activeOpacity={0.8}
                      accessibilityLabel={`Добави ${offer.chain} в списъка`}
                    >
                      <Ionicons
                        name={isAdded ? 'checkmark' : 'add'}
                        size={18}
                        color={isAdded ? COLORS.onPrimaryFixed : COLORS.onSurface}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }

            // Card 1: Best Deal (с градиент и горна лента „Най-изгодно“)
            if (offer.isBestDeal) {
              return (
                <LinearGradient
                  key={offer.id}
                  colors={['rgba(111, 251, 190, 0.22)', '#ffffff', '#ffffff']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.retailCard}
                >
                  {/* Best Deal Top Ribbon */}
                  <View style={styles.bestDealRibbon}>
                    <View style={styles.bestDealBadgesLeft}>
                      <View style={styles.bestDealBadge}>
                        <Ionicons name="ribbon" size={13} color={COLORS.onPrimary} />
                        <Text style={styles.bestDealBadgeText}>Най-изгодно</Text>
                      </View>
                      {offer.discountPct ? (
                        <View style={styles.discountBadge}>
                          <Text style={styles.discountBadgeText}>-{offer.discountPct}%</Text>
                        </View>
                      ) : null}
                    </View>

                    {offer.inStock && (
                      <View style={styles.inStockRow}>
                        <View style={styles.inStockDot} />
                        <Text style={styles.inStockText}>В наличност</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.retailMainRow}>
                    <View style={styles.retailLeftCol}>
                      <View style={styles.chainHeaderRow}>
                        <View style={[styles.chainPill, { backgroundColor: chainStyle.bg }]}>
                          <Text style={[styles.chainPillText, { color: chainStyle.text }]}>
                            {chainStyle.label}
                          </Text>
                        </View>
                        <Text style={styles.branchText} numberOfLines={1}>
                          {offer.branch}
                        </Text>
                      </View>

                      {offer.promoText && (
                        <View style={styles.promoLineRow}>
                          <Ionicons
                            name="book-outline"
                            size={14}
                            color={COLORS.tertiaryContainer}
                          />
                          <Text style={styles.promoLineText}>{offer.promoText}</Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.retailPriceCol}>
                      {offer.oldPrice ? (
                        <Text style={styles.oldPriceStrikethrough}>
                          {offer.oldPrice.toFixed(2)} лв.
                        </Text>
                      ) : null}
                      <Text style={styles.heroBestPrice}>
                        {offer.price.toFixed(2)}{' '}
                        <Text style={styles.heroBestCurrency}>лв.</Text>
                      </Text>
                    </View>
                  </View>

                  <View style={styles.retailFooterRow}>
                    <View style={styles.verifiedReceiptRow}>
                      <Ionicons name="checkmark-circle" size={14} color={COLORS.primary} />
                      <Text style={styles.verifiedReceiptText}>
                        {offer.verificationText || 'Касова бележка'}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.addToListBtnPrimary,
                        isAdded && { backgroundColor: COLORS.primaryFixed },
                      ]}
                      onPress={() => toggleOfferInList(offer)}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={isAdded ? 'checkmark' : 'add'}
                        size={16}
                        color={isAdded ? COLORS.onPrimaryFixed : COLORS.onPrimaryContainer}
                      />
                      <Text
                        style={[
                          styles.addToListBtnPrimaryText,
                          isAdded && { color: COLORS.onPrimaryFixed },
                        ]}
                      >
                        {isAdded ? 'Добавено' : 'В списъка'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </LinearGradient>
              );
            }

            // Standard Full Card (Lidl, Billa)
            return (
              <View key={offer.id} style={styles.retailCard}>
                <View style={styles.retailMainRow}>
                  <View style={styles.retailLeftCol}>
                    <View style={styles.chainHeaderRow}>
                      <View style={[styles.chainPill, { backgroundColor: chainStyle.bg }]}>
                        <Text style={[styles.chainPillText, { color: chainStyle.text }]}>
                          {chainStyle.label}
                        </Text>
                      </View>
                      <Text style={styles.branchText} numberOfLines={1}>
                        {offer.branch}
                      </Text>
                    </View>

                    {offer.promoText && (
                      <View style={styles.promoLineRow}>
                        <Ionicons
                          name={offer.promoType === 'loyalty' ? 'pricetag-outline' : 'leaf-outline'}
                          size={14}
                          color={
                            offer.promoType === 'loyalty' ? COLORS.tertiary : COLORS.primary
                          }
                        />
                        <Text
                          style={[
                            styles.promoLineText,
                            offer.promoType === 'loyalty' && {
                              color: COLORS.tertiary,
                              fontWeight: '600',
                            },
                          ]}
                        >
                          {offer.promoText}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.retailPriceCol}>
                    <Text style={styles.cardPriceValue}>
                      {offer.price.toFixed(2)}{' '}
                      <Text style={styles.cardPriceCurrency}>лв.</Text>
                    </Text>
                    {offer.savingText ? (
                      <Text style={styles.savingMicroText}>{offer.savingText}</Text>
                    ) : null}
                    {offer.withoutCardText ? (
                      <Text style={styles.withoutCardMicroText}>{offer.withoutCardText}</Text>
                    ) : null}
                  </View>
                </View>

                <View style={styles.retailFooterRowStandard}>
                  <Text style={styles.updatedTimeText}>{offer.verificationText}</Text>
                  <TouchableOpacity
                    style={[
                      styles.addToListBtnSecondary,
                      isAdded && { backgroundColor: COLORS.primaryFixed },
                    ]}
                    onPress={() => toggleOfferInList(offer)}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={isAdded ? 'checkmark' : 'add'}
                      size={16}
                      color={isAdded ? COLORS.onPrimaryFixed : COLORS.onSurface}
                    />
                    <Text
                      style={[
                        styles.addToListBtnSecondaryText,
                        isAdded && { color: COLORS.onPrimaryFixed },
                      ]}
                    >
                      {isAdded ? 'Добавено' : 'В списъка'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        {/* 5. Price History Interactive Chart Section */}
        <View style={[styles.sectionPad, { marginTop: 20 }]}>
          <View style={styles.historyCard}>
            <View style={styles.historyHeaderRow}>
              <View>
                <Text style={styles.historyTitle}>История на цената</Text>
                <Text style={styles.historySubtitle}>Последните 30 дни (динамика в лв.)</Text>
              </View>
              <View style={styles.dropBadge}>
                <Text style={styles.dropBadgeText}>-{currentProduct.historyDropPct}% спад</Text>
              </View>
            </View>

            {renderTrendChart()}

            <View style={styles.insightBox}>
              <Ionicons name="trending-down" size={18} color={COLORS.primary} />
              <Text style={styles.insightText}>
                В момента цената е{' '}
                <Text style={{ fontWeight: '700', color: COLORS.onSurface }}>
                  близо до историческия минимум
                </Text>{' '}
                за последните 6 месеца.
              </Text>
            </View>
          </View>
        </View>

        {/* 6. Crowdsource & Community Verification Section */}
        <View style={[styles.sectionPad, { marginTop: 20 }]}>
          <View style={styles.communityCard}>
            <View style={styles.communityTopRow}>
              <View style={styles.communityIconCircle}>
                <Ionicons name="people" size={20} color={COLORS.onPrimaryFixedVariant} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.communityTitle}>Общност „Спести & Открий“</Text>
                <View style={styles.communityVerifiedRow}>
                  <View style={styles.communityLiveDot} />
                  <Text style={styles.communityVerifiedText}>
                    {currentProduct.lastVerifiedText}
                  </Text>
                </View>
              </View>
            </View>

            {/* Live community receipt contribution button */}
            <TouchableOpacity
              style={styles.scanReceiptBtn}
              onPress={() => setIsQuickPhotoOpen(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="camera" size={20} color={COLORS.primary} />
              <Text style={styles.scanReceiptBtnText}>Снимай етикет / касова бележка</Text>
            </TouchableOpacity>

            {/* Sentiment Upvote/Downvote Pill Row */}
            <View style={styles.sentimentRow}>
              <Text style={styles.sentimentPrompt}>Точна ли е тази цена?</Text>
              <View style={styles.sentimentBtns}>
                <TouchableOpacity
                  style={[
                    styles.votePill,
                    currentVote === 'up' && styles.votePillUpActive,
                  ]}
                  onPress={() =>
                    setUserVote((prev) => ({
                      ...prev,
                      [currentProduct.id]: prev[currentProduct.id] === 'up' ? null : 'up',
                    }))
                  }
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={currentVote === 'up' ? 'thumbs-up' : 'thumbs-up-outline'}
                    size={15}
                    color={currentVote === 'up' ? COLORS.primary : COLORS.onSurfaceVariant}
                  />
                  <Text
                    style={[
                      styles.votePillText,
                      currentVote === 'up' && { color: COLORS.primary },
                    ]}
                  >
                    {displayUpvotes}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.votePill,
                    currentVote === 'down' && styles.votePillDownActive,
                  ]}
                  onPress={() =>
                    setUserVote((prev) => ({
                      ...prev,
                      [currentProduct.id]: prev[currentProduct.id] === 'down' ? null : 'down',
                    }))
                  }
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={currentVote === 'down' ? 'thumbs-down' : 'thumbs-down-outline'}
                    size={15}
                    color={currentVote === 'down' ? COLORS.error : COLORS.onSurfaceVariant}
                  />
                  <Text
                    style={[
                      styles.votePillText,
                      currentVote === 'down' && { color: COLORS.error },
                    ]}
                  >
                    {displayDownvotes}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* 7. Sticky Bottom Basket CTA Bar */}
        <View style={[styles.sectionPad, { marginTop: 24 }]}>
          <TouchableOpacity
            style={styles.basketCtaBtn}
            onPress={() => {
              if (basketItemsList.length === 0 && currentProduct.offers[0]) {
                toggleOfferInList(currentProduct.offers[0]);
              }
              setIsBasketDrawerOpen(true);
            }}
            activeOpacity={0.9}
          >
            <View style={styles.basketCtaLeft}>
              <Ionicons name="cart" size={22} color={COLORS.onPrimary} />
              <Text style={styles.basketCtaText}>
                {basketItemsList.length > 0
                  ? `Пазарска кошница (${basketItemsList.length})`
                  : 'Добави в пазарската кошница'}
              </Text>
            </View>
            <View style={styles.basketCtaPill}>
              <Text style={styles.basketCtaPillText}>
                Спестяваш {dynamicSavings.toFixed(2)} лв.
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ================================================================ */}
      {/* МОДАЛ: ИЗБОР НА ГРАД                                             */}
      {/* ================================================================ */}
      <Modal
        visible={isCityModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsCityModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Избери град в България</Text>
              <TouchableOpacity onPress={() => setIsCityModalOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={COLORS.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalSearchBox}>
              <Ionicons name="search" size={17} color={COLORS.primary} />
              <TextInput
                style={styles.modalSearchInput}
                value={citySearch}
                onChangeText={setCitySearch}
                placeholder="Търси град..."
                placeholderTextColor={COLORS.outline}
              />
            </View>

            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {filteredCities.map((city) => {
                const active =
                  city === displayCity ||
                  (city === 'Всички градове' && selectedCityFilter === 'Всички градове');
                return (
                  <TouchableOpacity
                    key={city}
                    style={[styles.cityOptionRow, active && styles.cityOptionRowActive]}
                    onPress={() => {
                      setSelectedCityFilter(city);
                      setIsCityModalOpen(false);
                      setCitySearch('');
                    }}
                  >
                    <Ionicons
                      name={active ? 'location' : 'location-outline'}
                      size={17}
                      color={active ? COLORS.primary : COLORS.onSurfaceVariant}
                    />
                    <Text
                      style={[
                        styles.cityOptionText,
                        active && { color: COLORS.primary, fontWeight: '700' },
                      ]}
                    >
                      {city}
                    </Text>
                    {active && (
                      <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ================================================================ */}
      {/* МОДАЛ: ПАЗАРСКА КОШНИЦА И ИКОНОМИИ                               */}
      {/* ================================================================ */}
      <Modal
        visible={isBasketDrawerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsBasketDrawerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="cart" size={22} color={COLORS.primary} />
                <Text style={styles.modalTitle}>Пазарска кошница</Text>
              </View>
              <TouchableOpacity onPress={() => setIsBasketDrawerOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={COLORS.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            {basketItemsList.length === 0 ? (
              <View style={{ paddingVertical: 24, alignItems: 'center', gap: 8 }}>
                <Ionicons name="basket-outline" size={38} color={COLORS.outline} />
                <Text style={{ color: COLORS.onSurfaceVariant, fontSize: 14, textAlign: 'center' }}>
                  Натисни „+ В списъка“ до избраната верига, за да добавиш артикули за сравнение.
                </Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
                {basketItemsList.map(([id, item]) => {
                  const st = getRetailChainStyle(item.chain);
                  return (
                    <View key={id} style={styles.basketModalRow}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={[styles.chainPill, { backgroundColor: st.bg }]}>
                            <Text style={[styles.chainPillText, { color: st.text }]}>
                              {st.label}
                            </Text>
                          </View>
                          <Text style={styles.basketModalProdTitle} numberOfLines={1}>
                            {item.productTitle}
                          </Text>
                        </View>
                        {item.saving > 0 && (
                          <Text style={styles.basketModalSaving}>
                            Спестяваш {item.saving.toFixed(2)} лв. спрямо най-високата цена
                          </Text>
                        )}
                      </View>
                      <Text style={styles.basketModalPrice}>{item.price.toFixed(2)} лв.</Text>
                      <TouchableOpacity
                        onPress={() =>
                          setAddedOffers((prev) => {
                            const next = { ...prev };
                            delete next[id];
                            return next;
                          })
                        }
                        hitSlop={8}
                      >
                        <Ionicons name="trash-outline" size={18} color={COLORS.error} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            <View style={styles.basketModalSummary}>
              <Text style={styles.basketModalSummaryLabel}>Обща прогнозна икономия:</Text>
              <Text style={styles.basketModalSummaryVal}>{dynamicSavings.toFixed(2)} лв.</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={styles.basketModalPrimaryBtn}
                onPress={() => {
                  setIsBasketDrawerOpen(false);
                  setSmartToolsTab('basket');
                  setIsSmartToolsOpen(true);
                }}
              >
                <Ionicons name="sparkles" size={16} color={COLORS.onPrimary} />
                <Text style={styles.basketModalPrimaryText}>
                  Сравни целия списък по вериги
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ================================================================ */}
      {/* МОДАЛ: БАРКОД СКЕНЕР И БЪРЗО ТЪРСЕНЕ                             */}
      {/* ================================================================ */}
      <Modal
        visible={isBarcodeModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsBarcodeModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="barcode-outline" size={22} color={COLORS.primary} />
                <Text style={styles.modalTitle}>Баркод & Скенер на цени</Text>
              </View>
              <TouchableOpacity onPress={() => setIsBarcodeModalOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={COLORS.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            <Text style={{ color: COLORS.onSurfaceVariant, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>
              Избери продукт по баркод за моментално сравнение или снимай етикет / касова бележка от магазина:
            </Text>

            {CATALOG_PRODUCTS.map((prod) => (
              <TouchableOpacity
                key={prod.id}
                style={styles.suggestionRow}
                onPress={() => {
                  handleSelectProduct(prod);
                  setIsBarcodeModalOpen(false);
                }}
              >
                <Ionicons name="qr-code-outline" size={18} color={COLORS.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestionName}>{prod.title}</Text>
                  <Text style={styles.suggestionMeta}>EAN: {prod.barcode} • {prod.weight}</Text>
                </View>
                <Text style={{ color: COLORS.primary, fontWeight: '800', fontSize: 13 }}>
                  {prod.lowestPrice.toFixed(2)} лв.
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.scanReceiptBtn, { marginTop: 12 }]}
              onPress={() => {
                setIsBarcodeModalOpen(false);
                setIsQuickPhotoOpen(true);
              }}
            >
              <Ionicons name="camera" size={19} color={COLORS.primary} />
              <Text style={styles.scanReceiptBtnText}>Снимай етикет или касова бележка</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <QuickPricePhotoModal
        visible={isQuickPhotoOpen}
        onClose={() => setIsQuickPhotoOpen(false)}
      />

      <SmartToolsModal
        visible={isSmartToolsOpen}
        initialTab={smartToolsTab}
        onClose={() => setIsSmartToolsOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  header: {
    backgroundColor: 'rgba(248, 249, 255, 0.88)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(226, 232, 240, 0.65)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 3,
    zIndex: 40,
    ...(Platform.OS === 'web'
      ? ({
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        } as object)
      : {}),
  },
  headerInner: {
    height: 64,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  headerLeft: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  brandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    letterSpacing: -0.3,
    color: COLORS.onSurface,
  },
  bgPill: {
    backgroundColor: COLORS.primaryFixed,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  bgPillText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 13,
    letterSpacing: 0.4,
    color: COLORS.onPrimaryFixedVariant,
  },
  locationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: -1,
    minHeight: 24,
  },
  locationBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onSurfaceVariant,
    letterSpacing: 0.2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bellBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  bellDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.tertiaryContainer,
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  avatarWrap: {
    paddingLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(0, 108, 73, 0.22)',
  },

  mainScroll: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  mainScrollContent: {
    paddingBottom: 36,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  sectionPad: {
    paddingHorizontal: 16,
  },

  /* 1. Search & Barcode Quick Access Bar */
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surfaceContainerLowest,
    borderRadius: 999,
    padding: 6,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  searchLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    minWidth: 0,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    color: COLORS.onSurface,
    paddingVertical: 4,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  barcodeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },

  productSuggestionsCard: {
    marginTop: 8,
    backgroundColor: COLORS.surfaceContainerLowest,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    gap: 6,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 4,
  },
  suggestionsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  suggestionsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.outline,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  suggestionsCloseText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceContainerLow,
  },
  suggestionRowActive: {
    backgroundColor: 'rgba(111, 251, 190, 0.28)',
    borderWidth: 1,
    borderColor: COLORS.primaryContainer,
  },
  suggestionThumb: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceContainer,
  },
  suggestionName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: COLORS.onSurface,
  },
  suggestionMeta: {
    fontSize: 11.5,
    color: COLORS.onSurfaceVariant,
    marginTop: 1,
  },

  /* 2. Hero Product Overview Card */
  heroCard: {
    marginVertical: 8,
    backgroundColor: COLORS.surfaceContainerLowest,
    borderRadius: 16,
    padding: 16,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  heroGlow: {
    position: 'absolute',
    right: -40,
    top: -40,
    width: 144,
    height: 144,
    borderRadius: 72,
    backgroundColor: 'rgba(111, 251, 190, 0.30)',
    ...(Platform.OS === 'web' ? ({ filter: 'blur(32px)' } as object) : {}),
  },
  heroTopRow: {
    flexDirection: 'row',
    gap: 16,
    zIndex: 2,
  },
  heroThumbContainer: {
    position: 'relative',
    flexShrink: 0,
  },
  heroThumbBox: {
    width: 96,
    height: 96,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceContainerLow,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroThumbImg: {
    width: '100%',
    height: '100%',
  },
  heroVerifiedSticker: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  heroVerifiedStickerText: {
    color: COLORS.onPrimary,
    fontSize: 10,
    fontWeight: '700',
  },
  heroMetaCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  heroBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  heroBrandText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: COLORS.primary,
  },
  favoriteBtn: {
    padding: 4,
  },
  heroProductTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 23,
    color: COLORS.onSurface,
  },
  heroProductSubtitle: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    color: COLORS.onSurfaceVariant,
    marginTop: 2,
  },
  heroTagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  heroMetaTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.surfaceContainer,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  heroMetaTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onSurfaceVariant,
    letterSpacing: 0.3,
  },

  /* Price Highlights Summary Pill Grid */
  priceSummaryGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    backgroundColor: COLORS.surfaceContainerLow,
    borderRadius: 12,
    padding: 12,
  },
  priceSummaryCol: {
    flex: 1,
    alignItems: 'center',
  },
  priceSummaryLabelLowest: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 0.3,
  },
  priceSummaryValLowest: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
    letterSpacing: -0.4,
    color: COLORS.primary,
    marginTop: 2,
  },
  currencyUnitLowest: {
    fontSize: 13,
    fontWeight: '400',
    color: COLORS.primary,
  },
  priceSummaryLabelAvg: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.onSurfaceVariant,
    letterSpacing: 0.3,
  },
  priceSummaryValAvg: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
    letterSpacing: -0.4,
    color: COLORS.onSurface,
    marginTop: 2,
  },
  currencyUnitNormal: {
    fontSize: 13,
    fontWeight: '400',
    color: COLORS.onSurface,
  },
  priceSummaryLabelHighest: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.secondary,
    letterSpacing: 0.3,
  },
  priceSummaryValHighest: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
    letterSpacing: -0.4,
    color: COLORS.secondary,
    marginTop: 2,
  },
  currencyUnitSecondary: {
    fontSize: 13,
    fontWeight: '400',
    color: COLORS.secondary,
  },

  /* Maximum Savings Alert Banner */
  maxSavingsBanner: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(111, 251, 190, 0.40)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  maxSavingsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  maxSavingsText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.onPrimaryFixedVariant,
    flex: 1,
  },
  maxSavingsStrong: {
    fontWeight: '800',
    color: COLORS.onPrimaryFixedVariant,
  },

  /* 3. Store Price Comparison Header & Filters */
  comparisonHeader: {
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  comparisonTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    color: COLORS.onSurface,
  },
  comparisonSubtitle: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    color: COLORS.onSurfaceVariant,
  },
  filterPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.surfaceContainerHigh,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  filterPillBtnActive: {
    backgroundColor: COLORS.primaryFixed,
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onSurfaceVariant,
    letterSpacing: 0.3,
  },

  filterDrawer: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: COLORS.surfaceContainerLowest,
    borderRadius: 12,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.surfaceContainerLow,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onSurfaceVariant,
  },
  filterChipTextActive: {
    color: COLORS.onPrimary,
  },
  filterOptionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  filterCompareLink: {
    marginLeft: 'auto',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  filterCompareLinkText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: COLORS.primary,
  },

  /* 4. Retailers Comparison List */
  retailersList: {
    paddingHorizontal: 16,
    gap: 12,
  },
  retailCard: {
    backgroundColor: COLORS.surfaceContainerLowest,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  bestDealRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    marginBottom: 8,
  },
  bestDealBadgesLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bestDealBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  bestDealBadgeText: {
    color: COLORS.onPrimary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  discountBadge: {
    backgroundColor: COLORS.errorContainer,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  discountBadgeText: {
    color: COLORS.onErrorContainer,
    fontSize: 11,
    fontWeight: '700',
  },
  inStockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  inStockDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primaryContainer,
  },
  inStockText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
  },
  retailMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  retailLeftCol: {
    flex: 1,
    minWidth: 0,
  },
  chainHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chainPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  chainPillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  branchText: {
    fontSize: 13,
    fontWeight: '400',
    color: COLORS.onSurfaceVariant,
    flexShrink: 1,
  },
  promoLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  promoLineText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.onSurfaceVariant,
  },
  retailPriceCol: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  oldPriceStrikethrough: {
    fontSize: 13,
    fontWeight: '400',
    color: COLORS.secondary,
    textDecorationLine: 'line-through',
  },
  heroBestPrice: {
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 30,
    letterSpacing: -0.7,
    color: COLORS.primary,
  },
  heroBestCurrency: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  cardPriceValue: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
    letterSpacing: -0.4,
    color: COLORS.onSurface,
  },
  cardPriceCurrency: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.onSurfaceVariant,
  },
  savingMicroText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
    marginTop: 1,
  },
  withoutCardMicroText: {
    fontSize: 10,
    fontWeight: '400',
    color: COLORS.onSurfaceVariant,
    marginTop: 1,
  },
  retailFooterRow: {
    marginTop: 12,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  retailFooterRowStandard: {
    marginTop: 12,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  verifiedReceiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verifiedReceiptText: {
    fontSize: 11,
    color: COLORS.onSurfaceVariant,
  },
  updatedTimeText: {
    fontSize: 11,
    color: COLORS.onSurfaceVariant,
  },
  addToListBtnPrimary: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: COLORS.primaryContainer,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addToListBtnPrimaryText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.onPrimaryContainer,
  },
  addToListBtnSecondary: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceContainer,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addToListBtnSecondaryText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.onSurface,
  },

  /* Compact Retail Cards (Fantastico, T-Market) */
  retailCardCompact: {
    backgroundColor: COLORS.surfaceContainerLowest,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  retailCompactLeft: {
    flex: 1,
    minWidth: 0,
  },
  compactSubText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onSurfaceVariant,
    marginTop: 4,
  },
  retailCompactRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
  },
  compactPriceText: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.onSurface,
    letterSpacing: -0.4,
  },
  compactCurrencyUnit: {
    fontSize: 13,
    fontWeight: '400',
    color: COLORS.onSurfaceVariant,
  },
  compactAddBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* 5. Price History Interactive Chart Section */
  historyCard: {
    backgroundColor: COLORS.surfaceContainerLowest,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  historyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.onSurface,
  },
  historySubtitle: {
    fontSize: 13,
    fontWeight: '400',
    color: COLORS.onSurfaceVariant,
  },
  dropBadge: {
    backgroundColor: COLORS.primaryFixed,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  dropBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onPrimaryFixedVariant,
  },
  chartContainer: {
    marginTop: 16,
    width: '100%',
  },
  chartAxisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  chartAxisLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.onSurfaceVariant,
  },
  chartAxisLabelToday: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  nativeChartBox: {
    height: 92,
    justifyContent: 'space-between',
    paddingVertical: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 24,
  },
  nativeChartGridLine: {
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  nativeChartPointsRow: {
    position: 'absolute',
    inset: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  nativeChartPointCol: {
    alignItems: 'center',
  },
  nativePeakLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#565E74',
  },
  nativePeakDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#565E74',
    marginTop: 2,
  },
  nativeLowLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.primary,
  },
  nativeLowDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: COLORS.primaryContainer,
    marginTop: 2,
  },
  insightBox: {
    marginTop: 12,
    backgroundColor: COLORS.surfaceContainerLow,
    padding: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  insightText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.onSurfaceVariant,
  },

  /* 6. Crowdsource & Community Verification Section */
  communityCard: {
    backgroundColor: COLORS.surfaceContainerLowest,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  communityTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  communityIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.onSurface,
  },
  communityVerifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  communityLiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  communityVerifiedText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onSurfaceVariant,
    lineHeight: 15,
  },
  scanReceiptBtn: {
    width: '100%',
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceContainer,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  scanReceiptBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.onSurface,
    letterSpacing: 0.2,
  },
  sentimentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  sentimentPrompt: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onSurfaceVariant,
  },
  sentimentBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  votePill: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: COLORS.surfaceContainer,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  votePillUpActive: {
    backgroundColor: COLORS.primaryFixed,
  },
  votePillDownActive: {
    backgroundColor: COLORS.errorContainer,
  },
  votePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onSurfaceVariant,
  },

  /* 7. Sticky Bottom Basket CTA Bar */
  basketCtaBtn: {
    width: '100%',
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#006c49',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.24,
    shadowRadius: 12,
    elevation: 6,
  },
  basketCtaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  basketCtaText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: COLORS.onPrimary,
    letterSpacing: 0.2,
  },
  basketCtaPill: {
    backgroundColor: COLORS.primaryContainer,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  basketCtaPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onPrimaryContainer,
  },

  /* Modals */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(11, 28, 48, 0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: COLORS.surfaceContainerLowest,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.onSurface,
  },
  modalSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surfaceContainerLow,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },
  modalSearchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.onSurface,
  },
  cityOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  cityOptionRowActive: {
    backgroundColor: COLORS.surfaceContainerLow,
  },
  cityOptionText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.onSurface,
  },
  basketModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSubtle,
  },
  basketModalProdTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: COLORS.onSurface,
    flex: 1,
  },
  basketModalSaving: {
    fontSize: 11,
    color: COLORS.primary,
    fontWeight: '600',
    marginTop: 3,
  },
  basketModalPrice: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.onSurface,
  },
  basketModalSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceContainerLow,
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
  },
  basketModalSummaryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.onSurfaceVariant,
  },
  basketModalSummaryVal: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primary,
  },
  basketModalPrimaryBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  basketModalPrimaryText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: COLORS.onPrimary,
  },
});
