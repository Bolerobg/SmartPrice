import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CityPickerDropdown } from '@/components/CityPickerDropdown';
import { ActiveRaffleCard } from '@/components/ActiveRaffleCard';
import { PostCard } from '@/components/PostCard';
import { QuickPricePhotoModal } from '@/components/QuickPricePhotoModal';
import { SmartPriceAssistantCard } from '@/components/SmartPriceAssistantCard';
import { SmartToolsModal } from '@/components/SmartToolsModal';
import { api } from '@/src/api/client';
import { CATEGORIES, COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/src/auth/AuthContext';
import { FounderBanner } from '@/components/FounderBanner';
import {
  calculateDistanceKm,
  detectUserAndStoreLocation,
  getCoordinatesForPost,
} from '@/lib/locationService';
import { matchesUniversalSearch, SortMode, sortPostsSmart } from '@/lib/smartSearch';
import type { PostItem } from '@/types';

/** Колко да изчакаме, преди да питаме сървъра (за да не удряме на всяка буква) */
const SEARCH_DEBOUNCE_MS = 350;

const QUICK_SEARCH_SUGGESTIONS = [
  'Кафе',
  'Вода',
  'Зехтин',
  'Меню',
  'Нощувка',
  'Такса',
  'Бележка',
];

const SORT_OPTIONS: { id: SortMode; label: string; icon: string }[] = [
  { id: 'newest', label: 'Най-нови', icon: 'time-outline' },
  { id: 'best_savings', label: 'Топ спестяване', icon: 'trending-down-outline' },
  { id: 'lowest_price', label: 'Най-ниска цена', icon: 'arrow-down-outline' },
  { id: 'highest_price', label: 'Най-висока цена', icon: 'arrow-up-outline' },
  { id: 'most_helped', label: 'Най-полезни', icon: 'flame-outline' },
];

export default function FeedScreen() {
  const {
    posts,
    userProfile,
    priceAlerts,
    selectedPolarityFilter,
    setSelectedPolarityFilter,
    selectedCategoryFilter,
    setSelectedCategoryFilter,
    selectedCityFilter,
    setSelectedCityFilter,
    openDonationModal,
    totalCommunitySavedAllPosts,
    openAuthPrompt,
  } = useApp();
  const { isAuthenticated } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const router = useRouter();

  // ID-то на офертата е САМО ЧИСЛА (напр. 48219357). Ако написаното изглежда
  // като такъв номер — предлагаме да я отворим направо, вместо да търсим по думи.
  const looksLikeOfferCode = /^\d{6,12}$/.test(searchQuery.trim());

  const openByCode = async () => {
    const code = searchQuery.trim();
    if (!code) return;
    setCodeBusy(true);
    try {
      const { post } = await api.postByCode(code);
      setSearchQuery('');
      router.push(`/post/${post.id}` as never);
    } catch (err) {
      Alert.alert(
        'Няма такава оферта',
        err instanceof Error && err.message
          ? err.message
          : `Не намерих оферта с ID ${code.toUpperCase()}. Провери кода и опитай пак.`
      );
    } finally {
      setCodeBusy(false);
    }
  };

    // Търсенето пита сървъра (цялата база), а не само заредените 60 поста.
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [serverResults, setServerResults] = useState<PostItem[] | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [isQuickPhotoOpen, setIsQuickPhotoOpen] = useState(false);
  const [quickInitialPhoto, setQuickInitialPhoto] = useState<string | null>(null);
  const [isSmartToolsOpen, setIsSmartToolsOpen] = useState(false);
  const [smartToolsTab, setSmartToolsTab] = useState<'basket' | 'shrinkflation' | 'alerts'>('basket');
  const [nearbySorted, setNearbySorted] = useState(false);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  // 1) Дебounce — чакаме да спреш да пишеш, преди да питаме сървъра.
  //    Без това всяка буква пускаше заявка и приложението „забиваше“.
  useEffect(() => {
    const t = setTimeout(
      () => setDebouncedQuery(searchQuery.trim()),
      SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(t);
  }, [searchQuery]);

  // 2) Търсене в ЦЯЛАТА база. Преди търсенето филтрираше само заредените
  //    60 поста, затова „пиле“ не намираше нищо извън тях.
  useEffect(() => {
    if (!debouncedQuery) {
      setServerResults(null);
      setIsSearching(false);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    api
      .feed({ q: debouncedQuery, limit: 60 })
      .then((res) => {
        if (!cancelled) setServerResults(res.items);
      })
      .catch(() => {
        if (!cancelled) setServerResults([]);
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const handleToggleNearby = async () => {
    if (nearbySorted) {
      setNearbySorted(false);
      return;
    }
    const info = await detectUserAndStoreLocation({
      fallbackCity: selectedCityFilter !== 'Всички градове' ? selectedCityFilter : userProfile.city,
    });

    // Без реални координати не подреждаме по „разстояние“ — иначе би било измислено.
    if (!info.hasRealCoordinates) {
      Alert.alert(
        'Няма достъп до локацията',
        'Не успях да взема GPS координати (няма разрешение или няма сигнал). Разреши достъп до локацията и опитай пак — иначе подредбата по разстояние би била неточна.'
      );
      return;
    }

    setUserCoords({ latitude: info.latitude, longitude: info.longitude });
    setNearbySorted(true);
  };

  const cityPostCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    posts.forEach((p) => {
      const key = p.city.toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [posts]);

  const handleQuickPickAndOpen = async (fromCamera: boolean) => {
    try {
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setQuickInitialPhoto(null);
          setIsQuickPhotoOpen(true);
          return;
        }
        const res = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.85,
        });
        if (!res.canceled && res.assets[0]?.uri) {
          setQuickInitialPhoto(res.assets[0].uri);
          setIsQuickPhotoOpen(true);
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            'Достъп до галерията',
            'Моля, разреши достъпа до снимките от настройките на телефона.'
          );
          return;
        }
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.85,
        });
        if (!res.canceled && res.assets[0]?.uri) {
          setQuickInitialPhoto(res.assets[0].uri);
          setIsQuickPhotoOpen(true);
        }
      }
    } catch {
      setQuickInitialPhoto(null);
      setIsQuickPhotoOpen(true);
    }
  };

  const postDistances = useMemo(() => {
    const map: Record<string, number> = {};
    const refLat = userCoords?.latitude ?? 42.6977;
    const refLng = userCoords?.longitude ?? 23.3219;
    posts.forEach((p) => {
      // Постове без реални координати не получават разстояние —
      // преди тук се измисляха координати и се показваха фалшиви километри.
      const coords = getCoordinatesForPost(p);
      if (!coords) return;
      map[p.id] = calculateDistanceKm(refLat, refLng, coords.latitude, coords.longitude);
    });
    return map;
  }, [posts, userCoords]);

  const filteredPosts = useMemo(() => {
      // Когато има активно търсене, показваме резултатите от СЪРВЪРА: те
      // обхващат цялата база (не само заредените 60 поста) и вече са минали
      // през търсенето по всички полета. Затова тук НЕ прилагаме отново
      // филтъра по категория — иначе търсенето пак се затваря в избрания таб
      // и „пиле“ не се намира, ако не е в „Магазини“.
      const isSearchActive = Boolean(debouncedQuery) && serverResults !== null;

      const matching = isSearchActive
        ? serverResults!
        : posts.filter((post) => {
            if (selectedPolarityFilter !== 'all' && post.polarity !== selectedPolarityFilter) {
              return false;
            }
            if (selectedCategoryFilter !== 'all' && post.category !== selectedCategoryFilter) {
              return false;
            }
            if (
              selectedCityFilter !== 'Всички градове' &&
              post.city.toLowerCase() !== selectedCityFilter.toLowerCase()
            ) {
              return false;
            }
            if (!matchesUniversalSearch(post, searchQuery)) {
              return false;
            }
            return true;
          });

      if (nearbySorted && !isSearchActive) {
        return [...matching].sort(
          (a, b) => (postDistances[a.id] ?? 999) - (postDistances[b.id] ?? 999)
        );
      }

      return sortPostsSmart(matching, sortMode);
    }, [
      posts,
      serverResults,
      debouncedQuery,
      selectedPolarityFilter,
      selectedCategoryFilter,
      selectedCityFilter,
      searchQuery,
      sortMode,
      nearbySorted,
      postDistances,
    ]);

  const greenCount = useMemo(
    () => posts.filter((p) => p.polarity === 'green').length,
    [posts]
  );
  const redCount = useMemo(
    () => posts.filter((p) => p.polarity === 'red').length,
    [posts]
  );

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    selectedPolarityFilter !== 'all' ||
    selectedCategoryFilter !== 'all' ||
    selectedCityFilter !== 'Всички градове' ||
    nearbySorted;

  const resetAllFilters = () => {
    setSearchQuery('');
    setSelectedPolarityFilter('all');
    setSelectedCategoryFilter('all');
    setSelectedCityFilter('Всички градове');
    setSortMode('newest');
    setNearbySorted(false);
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      {/* Горна лента с лого и бутон за Дарение / VIP статус */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <View style={styles.brandRow}>
            <View style={styles.logoBadge}>
              <Ionicons name="pricetags" size={16} color={COLORS.greenBright} />
            </View>
            <Text style={styles.brandTitle} numberOfLines={1}>
              SmartPrice
            </Text>
            <View style={styles.liveTag}>
              <Text style={styles.liveTagText}>AI • БГ</Text>
            </View>
          </View>
          <Text style={styles.brandSub} numberOfLines={1}>
            Общността спести{' '}
            <Text style={styles.savedHighlight}>
              {totalCommunitySavedAllPosts.toLocaleString('bg-BG')} €
            </Text>
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.donateTopButton,
            userProfile.isSupporter && styles.supporterTopButton,
          ]}
          onPress={() => openDonationModal()}
          activeOpacity={0.85}
        >
          <Ionicons
            name={userProfile.isSupporter ? 'shield-checkmark' : 'heart'}
            size={14}
            color={userProfile.isSupporter ? COLORS.goldBright : COLORS.black}
          />
          <Text
            style={[
              styles.donateTopButtonText,
              userProfile.isSupporter && { color: COLORS.goldBright },
            ]}
            numberOfLines={1}
          >
            {userProfile.isSupporter ? 'VIP Пазител' : 'Подкрепи'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* УНИВЕРСАЛНА ТЪРСАЧКА (Търси по всичко!) */}
      <View style={styles.universalSearchBox}>
        <Ionicons name="search" size={18} color={COLORS.greenBright} />
        <TextInput
          style={styles.universalSearchInput}
          placeholder="Търси продукт, място, град, цена... или ID на оферта"
          placeholderTextColor={COLORS.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearchQuery('')}
            style={styles.clearSearchBtn}
          >
            <Ionicons name="close-circle" size={19} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Търсене по ID на оферта: човекът вижда кода на обявата и го въвежда тук */}
      {looksLikeOfferCode ? (
        <TouchableOpacity
          style={styles.codeJump}
          activeOpacity={0.88}
          disabled={codeBusy}
          onPress={() => void openByCode()}
        >
          <Ionicons name="pricetag" size={15} color={COLORS.black} />
          <Text style={styles.codeJumpText}>
            {codeBusy ? 'Търся офертата...' : `Отвори оферта с ID ${searchQuery.trim().toUpperCase()}`}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.codeHint}>
          <Ionicons name="pricetag-outline" size={12} color={COLORS.accentCyan} />
          <Text style={styles.codeHintText}>
            Всяка оферта има ID (само числа, напр. 48219357). Напиши го тук, за да я намериш веднага.
          </Text>
        </View>
      )}

      {/* „Как работи“ — 12 екрана с примери, един след друг.
          Стои на първия екран, защото гостът вече влиза направо в потока и
          не вижда екрана за вход, където преди беше този бутон. */}
      <TouchableOpacity
        style={styles.howItWorks}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel="Как работи приложението"
        onPress={() => router.push('/tour?review=1' as never)}
      >
        <Ionicons name="help-circle" size={17} color={COLORS.accentCyan} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.howItWorksTitle}>Как работи приложението?</Text>
          <Text style={styles.howItWorksSub} numberOfLines={1}>
            12 екрана с примери — 30 секунди
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
      </TouchableOpacity>

      {/* Бонусът за новодошли: първа находка в първите минути → „Основател“ */}
      <FounderBanner />

      {/* Гостът чете потока, но не може да участва. Вместо да го оставяме да
          се чуди защо нищо не става при натискане — казваме му какво печели. */}
      {!isAuthenticated && (
        <View style={styles.guestCard}>
          <View style={styles.guestRow}>
            <View style={styles.guestIcon}>
              <Ionicons name="people" size={19} color={COLORS.black} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.guestTitle}>Виждаш реалните цени. Влез и участвай.</Text>
              <Text style={styles.guestSub}>
                Профилът е безплатен и отнема 30 секунди — после гласуваш, коментираш, качваш
                находки, събираш значки и участваш в томболата.
              </Text>
            </View>
          </View>
          <View style={styles.guestButtons}>
            <TouchableOpacity
              style={styles.guestPrimary}
              activeOpacity={0.9}
              onPress={() => router.push('/(auth)/register' as never)}
            >
              <Ionicons name="rocket" size={15} color={COLORS.white} />
              <Text style={styles.guestPrimaryText}>Регистрирай се</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.guestGhost}
              activeOpacity={0.85}
              onPress={() => openAuthPrompt('Виж какво получаваш с профил — безплатно е.')}
            >
              <Text style={styles.guestGhostText}>Какво получавам?</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ТОМБОЛАТА: истинската активна томбола с реалните статистики */}
      <ActiveRaffleCard onOpen={() => router.push('/raffle' as never)} />

      {/* Бързи тагове за умно търсене с 1 докосване */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickSearchScroll}
      >
        {QUICK_SEARCH_SUGGESTIONS.map((item) => {
          const active = searchQuery.toLowerCase() === item.toLowerCase();
          return (
            <TouchableOpacity
              key={item}
              style={[
                styles.quickSearchTag,
                active && styles.quickSearchTagActive,
              ]}
              onPress={() =>
                setSearchQuery(active ? '' : item)
              }
            >
              <Ionicons
                name="sparkles-outline"
                size={11}
                color={active ? COLORS.greenBright : COLORS.textMuted}
              />
              <Text
                style={[
                  styles.quickSearchTagText,
                  active && styles.quickSearchTagTextActive,
                ]}
              >
                {item}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* УМНИ ИНСТРУМЕНТИ ЗА ПОТРЕБИТЕЛЯ (Кошница, Шринкфлация, Ценови Аларми) */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 8,
        }}
      >
        <TouchableOpacity
          style={{
            flex: 1,
            minWidth: 100,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            backgroundColor: 'rgba(16, 185, 129, 0.14)',
            borderWidth: 1,
            borderColor: COLORS.greenBorder,
            borderRadius: 12,
            paddingVertical: 8,
            paddingHorizontal: 8,
          }}
          onPress={() => {
            setSmartToolsTab('basket');
            setIsSmartToolsOpen(true);
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="cart" size={14} color={COLORS.greenBright} />
          <Text
            style={{ color: COLORS.greenBright, fontSize: 11, fontWeight: '800' }}
            numberOfLines={1}
          >
            🛒 Кошница
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            flex: 1,
            minWidth: 105,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            backgroundColor: 'rgba(244, 63, 94, 0.14)',
            borderWidth: 1,
            borderColor: COLORS.redBorder,
            borderRadius: 12,
            paddingVertical: 8,
            paddingHorizontal: 8,
          }}
          onPress={() => {
            setSmartToolsTab('shrinkflation');
            setIsSmartToolsOpen(true);
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="scale" size={14} color={COLORS.redBright} />
          <Text
            style={{ color: COLORS.redBright, fontSize: 11, fontWeight: '800' }}
            numberOfLines={1}
          >
            📉 Шринкфлация
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            flex: 1,
            minWidth: 100,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            backgroundColor: 'rgba(245, 158, 11, 0.14)',
            borderWidth: 1,
            borderColor: COLORS.goldBorder,
            borderRadius: 12,
            paddingVertical: 8,
            paddingHorizontal: 8,
          }}
          onPress={() => {
            setSmartToolsTab('alerts');
            setIsSmartToolsOpen(true);
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="notifications" size={14} color={COLORS.goldBright} />
          <Text
            style={{ color: COLORS.goldBright, fontSize: 11, fontWeight: '800' }}
            numberOfLines={1}
          >
            🔔 Аларми ({priceAlerts.filter((a) => a.isActive).length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Бърз панел: Качи снимка с цена */}
      <View style={styles.quickUploadBar}>
        <TouchableOpacity
          style={styles.quickUploadLeft}
          onPress={() => {
            setQuickInitialPhoto(null);
            setIsQuickPhotoOpen(true);
          }}
          activeOpacity={0.85}
        >
          <View style={styles.quickCameraCircle}>
            <Ionicons name="camera" size={18} color={COLORS.greenBright} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickUploadTitle} numberOfLines={1}>
              Качи снимка с цена 📸
            </Text>
            <Text style={styles.quickUploadSub} numberOfLines={1}>
              Авто-засичане на магазин по GPS & адрес в Google Maps
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.quickUploadActions}>
          <TouchableOpacity
            style={styles.quickIconBtnPrimary}
            onPress={() => handleQuickPickAndOpen(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="camera" size={15} color={COLORS.black} />
            <Text style={styles.quickIconBtnPrimaryText}>Снимай</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickIconBtnSecondary}
            onPress={() => handleQuickPickAndOpen(false)}
            activeOpacity={0.85}
          >
            <Ionicons name="images-outline" size={16} color={COLORS.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ПАДАЩО МЕНЮ ЗА ВСИЧКИ ГРАДОВЕ В БЪЛГАРИЯ */}
      <CityPickerDropdown
        selectedCity={selectedCityFilter}
        onSelectCity={setSelectedCityFilter}
        includeAllOption
        label="Филтър по град в България"
        cityPostCounts={cityPostCounts}
      />

      {/* Главен превключвател: Всички / 🟢 Топ Оферти / 🔴 Червени Флагове */}
      <View style={styles.polaritySwitcher}>
        <TouchableOpacity
          style={[
            styles.polarityTab,
            selectedPolarityFilter === 'all' && styles.polarityTabAllActive,
          ]}
          onPress={() => setSelectedPolarityFilter('all')}
        >
          <Text
            style={[
              styles.polarityTabText,
              selectedPolarityFilter === 'all' && styles.polarityTabTextActive,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            ✨ Всички ({posts.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.polarityTab,
            selectedPolarityFilter === 'green' && styles.polarityTabGreenActive,
          ]}
          onPress={() => setSelectedPolarityFilter('green')}
        >
          <Text
            style={[
              styles.polarityTabText,
              selectedPolarityFilter === 'green' && {
                color: COLORS.greenBright,
                fontWeight: '800',
              },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            🟢 Оферти ({greenCount})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.polarityTab,
            selectedPolarityFilter === 'red' && styles.polarityTabRedActive,
          ]}
          onPress={() => setSelectedPolarityFilter('red')}
        >
          <Text
            style={[
              styles.polarityTabText,
              selectedPolarityFilter === 'red' && {
                color: COLORS.redBright,
                fontWeight: '800',
              },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            🔴 Не ходи ({redCount})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Категории (включително „Други“) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoriesScroll}
      >
        {CATEGORIES.map((cat) => {
          const active = selectedCategoryFilter === cat.id;
          return (
            <TouchableOpacity
              key={cat.id}
              style={[
                styles.categoryChip,
                active && styles.categoryChipActive,
              ]}
              onPress={() => setSelectedCategoryFilter(cat.id)}
            >
              <Ionicons
                name={cat.icon as any}
                size={14}
                color={active ? COLORS.white : COLORS.textSecondary}
              />
              <Text
                style={[
                  styles.categoryChipText,
                  active && styles.categoryChipTextActive,
                ]}
              >
                {cat.shortLabel}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Умно сортиране + GPS „Наблизо до мен“ + бутон за изчистване на филтрите */}
      <View style={styles.sortAndResetRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sortScroll}
        >
          <TouchableOpacity
            style={[
              styles.sortPill,
              nearbySorted && {
                backgroundColor: COLORS.greenSoftBg,
                borderColor: COLORS.greenBorder,
              },
            ]}
            onPress={handleToggleNearby}
          >
            <Ionicons
              name="navigate"
              size={12}
              color={nearbySorted ? COLORS.greenBright : COLORS.textMuted}
            />
            <Text
              style={[
                styles.sortPillText,
                nearbySorted && {
                  color: COLORS.greenBright,
                  fontWeight: '800',
                },
              ]}
            >
              📍 Около мен (GPS)
            </Text>
          </TouchableOpacity>

          {SORT_OPTIONS.map((opt) => {
            const active = !nearbySorted && sortMode === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.sortPill, active && styles.sortPillActive]}
                onPress={() => {
                  setNearbySorted(false);
                  setSortMode(opt.id);
                }}
              >
                <Ionicons
                  name={opt.icon as any}
                  size={12}
                  color={active ? COLORS.accentCyan : COLORS.textMuted}
                />
                <Text
                  style={[
                    styles.sortPillText,
                    active && styles.sortPillTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {hasActiveFilters && (
          <TouchableOpacity
            style={styles.resetFiltersBtn}
            onPress={resetAllFilters}
          >
            <Ionicons name="refresh" size={12} color={COLORS.redBright} />
            <Text style={styles.resetFiltersText}>Изчисти</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* УМЕН AI ЦЕНОВИ АСИСТЕНТ И КАЛКУЛАТОР */}
      <SmartPriceAssistantCard
        filteredPosts={filteredPosts}
        allPosts={posts}
        searchQuery={searchQuery}
        selectedCity={selectedCityFilter}
        onApplyQuickQuery={(q) => setSearchQuery(q)}
      />

      {/* Ненатрапчив банер за независима общност (ако потребителят още не е дарил) */}
      {!userProfile.isSupporter && (
        <TouchableOpacity
          style={styles.communityNudgeBanner}
          onPress={() =>
            openDonationModal(
              'SmartPrice е независим проект без реклами. Подкрепи ни с дарение и вземи златна значка „Пазител на Общността“!',
              true
            )
          }
          activeOpacity={0.85}
        >
          <View style={styles.nudgeLeft}>
            <View style={styles.nudgeIconBox}>
              <Ionicons name="sparkles" size={17} color={COLORS.goldBright} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.nudgeTitle} numberOfLines={1}>
                100% независими • Без платени ревюта
              </Text>
              <Text style={styles.nudgeSubtitle} numberOfLines={2}>
                Ти все още не си дарил. Подкрепи ни от 2 € →
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
      <SafeAreaView style={styles.safeArea}>
        {/* ВАЖНО: подаваме ЕЛЕМЕНТ (renderHeader()), не самата функция.
            Ако се подаде функция, FlatList я третира като компонент; понеже
            идентичността ѝ се сменя на всеки render, React размонтира и
            монтира хедъра наново — полето за търсене губи фокус на всяка
            буква и клавиатурата се затваря (изглежда като „рефреш“). */}
        <FlatList
          data={filteredPosts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PostCard post={item} distanceKm={postDistances[item.id]} />
          )}
          ListHeaderComponent={renderHeader()}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Ionicons name="search-outline" size={44} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>Няма намерени публикации</Text>
            <Text style={styles.emptySub}>
              Няма резултати за текущото търсене или град ({selectedCityFilter}).
              Изчисти филтрите или качи първата снимка с цена!
            </Text>
            {hasActiveFilters && (
              <TouchableOpacity
                style={styles.emptyResetBtn}
                onPress={resetAllFilters}
              >
                <Text style={styles.emptyResetBtnText}>
                  Покажи всички публикации
                </Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <QuickPricePhotoModal
        visible={isQuickPhotoOpen}
        initialImageUri={quickInitialPhoto}
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
  guestCard: {
    marginHorizontal: 14,
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: COLORS.indigoSoftBg,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
  },
  guestRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  guestIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.accentCyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestTitle: { color: COLORS.textPrimary, fontSize: 14.5, fontWeight: '900' },
  guestSub: { color: COLORS.textSecondary, fontSize: 12.6, lineHeight: 18, marginTop: 4 },
  guestButtons: { flexDirection: 'row', gap: 9, marginTop: 12, flexWrap: 'wrap' },
  guestPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: COLORS.greenPrimary,
  },
  guestPrimaryText: { color: COLORS.white, fontSize: 13, fontWeight: '900' },
  guestGhost: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  guestGhostText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '800' },
  // Търсене по ID на оферта
  codeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  codeHintText: { flex: 1, color: COLORS.textMuted, fontSize: 11.5, lineHeight: 16 },
  howItWorks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
    backgroundColor: COLORS.accentCyanSoftBg,
    maxWidth: '100%',
  },
  howItWorksTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '800' },
  howItWorksSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 1, flexShrink: 1 },
  codeJump: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    backgroundColor: COLORS.goldBright,
    borderRadius: 12,
    paddingVertical: 11,
  },
  codeJumpText: { color: COLORS.black, fontSize: 13, fontWeight: '900' },
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 32,
  },
  headerContainer: {
    paddingTop: 8,
    marginBottom: 10,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  topBarLeft: {
    flex: 1,
    marginRight: 4,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logoBadge: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  brandTitle: {
    color: COLORS.textPrimary,
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: -0.4,
    flexShrink: 1,
  },
  liveTag: {
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    flexShrink: 0,
  },
  liveTagText: {
    color: COLORS.accentCyan,
    fontSize: 8.5,
    fontWeight: '900',
  },
  brandSub: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    marginTop: 2,
  },
  savedHighlight: {
    color: COLORS.greenBright,
    fontWeight: '800',
  },
  donateTopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.goldBright,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    flexShrink: 0,
  },
  supporterTopButton: {
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
  },
  donateTopButtonText: {
    color: COLORS.black,
    fontSize: 11.5,
    fontWeight: '800',
  },
  universalSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1.2,
    borderColor: COLORS.borderStrong,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 9,
    gap: 8,
    marginBottom: 7,
  },
  universalSearchInput: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 13.5,
    paddingVertical: 0,
  },
  clearSearchBtn: {
    padding: 2,
  },
  quickSearchScroll: {
    gap: 6,
    paddingBottom: 9,
  },
  quickSearchTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(30, 41, 59, 0.65)',
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 9,
  },
  quickSearchTagActive: {
    backgroundColor: COLORS.greenSoftBg,
    borderColor: COLORS.greenBorder,
  },
  quickSearchTagText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  quickSearchTagTextActive: {
    color: COLORS.greenBright,
    fontWeight: '800',
  },
  quickUploadBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
    gap: 8,
  },
  quickUploadLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quickCameraCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  quickUploadTitle: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  quickUploadSub: {
    color: COLORS.textSecondary,
    fontSize: 10.5,
    marginTop: 1,
  },
  quickUploadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  quickIconBtnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.greenBright,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 10,
  },
  quickIconBtnPrimaryText: {
    color: COLORS.black,
    fontSize: 11.5,
    fontWeight: '900',
  },
  quickIconBtnSecondary: {
    width: 33,
    height: 33,
    borderRadius: 10,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  polaritySwitcher: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    padding: 3,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    marginBottom: 9,
    gap: 3,
  },
  polarityTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  polarityTabAllActive: {
    backgroundColor: COLORS.bgCardElevated,
  },
  polarityTabGreenActive: {
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
  },
  polarityTabRedActive: {
    backgroundColor: COLORS.redSoftBg,
    borderWidth: 1,
    borderColor: COLORS.redBorder,
  },
  polarityTabText: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: '600',
  },
  polarityTabTextActive: {
    color: COLORS.textPrimary,
    fontWeight: '800',
  },
  categoriesScroll: {
    gap: 7,
    paddingBottom: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
  },
  categoryChipActive: {
    backgroundColor: COLORS.accentIndigo,
    borderColor: COLORS.accentIndigo,
  },
  categoryChipText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: COLORS.white,
    fontWeight: '800',
  },
  sortAndResetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 6,
  },
  sortScroll: {
    gap: 6,
  },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
  },
  sortPillActive: {
    backgroundColor: 'rgba(6, 182, 212, 0.14)',
    borderColor: 'rgba(6, 182, 212, 0.4)',
  },
  sortPillText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  sortPillTextActive: {
    color: COLORS.accentCyan,
    fontWeight: '800',
  },
  resetFiltersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.redSoftBg,
    borderWidth: 1,
    borderColor: COLORS.redBorder,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    flexShrink: 0,
  },
  resetFiltersText: {
    color: COLORS.redBright,
    fontSize: 10.5,
    fontWeight: '800',
  },
  communityNudgeBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 14,
    padding: 10,
    marginTop: 2,
  },
  nudgeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  nudgeIconBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: COLORS.goldSoftBg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  nudgeTitle: {
    color: COLORS.goldBright,
    fontSize: 12,
    fontWeight: '800',
  },
  nudgeSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 50,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 12,
  },
  emptySub: {
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
  },
  emptyResetBtn: {
    marginTop: 14,
    backgroundColor: COLORS.accentIndigo,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  emptyResetBtnText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '800',
  },
});
