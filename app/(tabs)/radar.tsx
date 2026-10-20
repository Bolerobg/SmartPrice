import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CityPickerDropdown } from '@/components/CityPickerDropdown';
import { useRouter } from 'expo-router';
import { PostCard } from '@/components/PostCard';
import { CATEGORIES, COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { openInGoogleMaps } from '@/lib/locationService';
import { api } from '@/src/api/client';
import { CategoryId, PostItem } from '@/types';

/**
 * Един обект в класацията (черен списък / „Честно място“).
 * `slug` идва от сървъра (md5 от място+град) и е тагът на обекта — с него се
 * отварят ВСИЧКИ оферти на този обект.
 */
interface VenueItem {
  placeName: string;
  city: string;
  address?: string;
  score: number;
  reportsCount: number;
  hasReceipt: boolean;
  slug?: string;
}

export default function RadarScreen() {
  const router = useRouter();
  // От общото състояние ползваме само постовете за броячите по градове —
  // самата лента на радара се тегли отделно, филтрирана на сървъра.
  const { posts } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [radarMode, setRadarMode] = useState<'red_hall' | 'green_gems'>('red_hall');
  const [activeCategory, setActiveCategory] = useState<CategoryId>('all');
  const [activeCity, setActiveCity] = useState<string>('Всички градове');

  // Ключовете са с малки букви, защото CityPickerDropdown чете counts[city.toLowerCase()]
  const cityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of posts) {
      const key = p.city.toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [posts]);

  const localVenues = useMemo(() => {
    const map: Record<string, VenueItem> = {};

    for (const p of posts) {
      if (radarMode === 'red_hall' && p.polarity !== 'red') continue;
      if (radarMode === 'green_gems' && p.polarity !== 'green') continue;
      if (activeCategory !== 'all' && p.category !== activeCategory) continue;
      if (activeCity !== 'Всички градове' && p.city !== activeCity) continue;

      const key = `${p.placeName.toLowerCase()}__${p.city.toLowerCase()}`;
      const score =
        radarMode === 'red_hall'
          ? p.reactions.pureRobbery + p.reactions.avoid
          : p.reactions.topDeal + p.reactions.worthIt;

      if (!map[key]) {
        map[key] = {
          placeName: p.placeName,
          city: p.city,
          address: p.address,
          score,
          reportsCount: 1,
          hasReceipt: Boolean(p.receipt?.verifiedByAi),
        };
      } else {
        map[key].score += score;
        map[key].reportsCount += 1;
        if (p.receipt?.verifiedByAi) map[key].hasReceipt = true;
      }
    }

    return Object.values(map)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
  }, [posts, radarMode, activeCategory, activeCity]);

  /**
   * Класацията се смята на СЪРВЪРА, върху всички публикувани постове.
   *
   * Защо: екранът черпи само първите 60 поста от лентата (а сега в тях има и
   * стотици внесени продукти), затова обектите с гласове от по-стари постове
   * изчезваха и черният списък показваше само 1 обект. Ако сървърът не отговори,
   * оставаме с местната сметка (по-добре нещо, отколкото нищо).
   */
  const [serverVenues, setServerVenues] = useState<VenueItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    const city = activeCity !== 'Всички градове' ? activeCity : undefined;
    const category = activeCategory !== 'all' ? activeCategory : undefined;
    api
      .venueRanking({
        polarity: radarMode === 'red_hall' ? 'red' : 'green',
        city,
        category,
        limit: 10,
      })
      .then((res) => {
        if (!alive) return;
        const items = res.items ?? [];
        // Празен отговор не е „няма обекти“ — падаме на местната сметка, за да
        // не изчезне целият блок.
        setServerVenues(items.length ? items : null);
      })
      .catch(() => {
        if (alive) setServerVenues(null);
      });
    return () => {
      alive = false;
    };
  }, [radarMode, activeCategory, activeCity]);

  const rankedVenues = serverVenues ?? localVenues;

  /**
   * Натискане на обект → екран „всички оферти с този таг“.
   *
   * Преди тук само се пълнеше търсачката с името на обекта — човекът не
   * виждаше „всички оферти на този обект“, а общ резултат от търсене по текст
   * (можеше да хване и съвсем друг обект със същото име в описанието).
   * Сега отиваме на екрана на обекта, който филтрира на СЪРВЪРА по тага
   * (място + град). Ако сървърът не е дал слуг (стар кеш на списъка), падаме
   * обратно на търсене по име, за да не остане бутонът „мъртъв“.
   */
  const openVenueOffers = useCallback(
    (v: VenueItem) => {
      if (v.slug) {
        router.push(
          `/place/${v.slug}?name=${encodeURIComponent(v.placeName)}&city=${encodeURIComponent(v.city)}` as never
        );
        return;
      }
      setSearchQuery(v.placeName);
    },
    [router]
  );


  /**
   * СВОЯ лента, филтрирана на СЪРВЪРА (не в телефона!).
   *
   * Защо: радарът филтрираше общата лента от 60 поста в паметта. След като в
   * лентата влязоха стотици внесени стоки, в „черен“ режим оставаше 1 пост —
   * човекът виждаше „само първия продукт“, а списъкът веднага искаше още и
   * забиваше приложението (по 44 заявки в минута, проверено в логовете
   * 19.10.2026). Сега заявката носи polarity/category/city и сървърът връща
   * само нужното.
   */
  const PAGE = 60;
  const [list, setList] = useState<PostItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listHasMore, setListHasMore] = useState(false);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [listTotal, setListTotal] = useState(0);
  const busyRef = useRef(false);
  const [query, setQuery] = useState('');

  // Изчакваме човекът да спре да пише, преди да питаме сървъра.
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchQuery.trim()), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const loadList = useCallback(
    async (offset: number, replace: boolean) => {
      if (busyRef.current) return; // една заявка наведнъж — иначе списъкът „забива“
      busyRef.current = true;
      setListBusy(true);
      if (replace) setListLoading(true);
      try {
        const feed = await api.feed({
          polarity: radarMode === 'red_hall' ? 'red' : 'green',
          category: activeCategory !== 'all' ? activeCategory : undefined,
          city: activeCity !== 'Всички градове' ? activeCity : undefined,
          q: query || undefined,
          limit: PAGE,
          offset,
        });
        setList((prev) => {
          if (replace) return feed.items;
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...feed.items.filter((p) => !seen.has(p.id))];
        });
        setListHasMore(Boolean(feed.hasMore));
        if (replace) setListTotal(Number(feed.total) || 0);
      } catch {
        if (replace) setList([]);
        setListHasMore(false);
      } finally {
        busyRef.current = false;
        setListBusy(false);
        setListLoading(false);
        setListRefreshing(false);
      }
    },
    [radarMode, activeCategory, activeCity, query]
  );

  // Нови филтри (или търсене) → първа страница отначало.
  useEffect(() => {
    void loadList(0, true);
  }, [loadList]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PostCard post={item} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshing={listRefreshing}
        onRefresh={() => {
          setListRefreshing(true);
          void loadList(0, true);
        }}
        onEndReached={() => {
          if (listHasMore) {
            void loadList(list.length, false);
          }
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          listLoading ? (
            <View style={{ paddingVertical: 28, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={COLORS.greenBright} />
            </View>
          ) : (
            <Text style={{ color: COLORS.textMuted, textAlign: 'center', paddingVertical: 24, fontSize: 13 }}>
              Тук още няма нищо. Първият доклад е твой.
            </Text>
          )
        }
        ListFooterComponent={
          listBusy && list.length > 0 ? (
            <View style={{ paddingVertical: 18, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={COLORS.greenBright} />
            </View>
          ) : null
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={{ marginBottom: 10 }}>
              <Text style={styles.screenTitle}>Ценови Радар & Търсене</Text>
              <Text style={styles.screenSub}>
                Провери обект, продукт, бележка, цена или град преди да платиш
              </Text>
              <CityPickerDropdown
                selectedCity={activeCity}
                onSelectCity={setActiveCity}
                includeAllOption
                cityPostCounts={cityCounts}
                accentColor={
                  radarMode === 'red_hall' ? COLORS.redBright : COLORS.greenBright
                }
              />
            </View>

            {/* Универсална Търсачка */}
            <View style={styles.searchBar}>
              <Ionicons name="search" size={19} color={COLORS.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Търси по всичко: продукт, обект, град, сума, автор..."
                placeholderTextColor={COLORS.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={19} color={COLORS.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Голям превключвател: Къде да НЕ се ходи vs Златни Находки */}
            <View style={styles.modeCardsRow}>
              <TouchableOpacity
                style={[
                  styles.modeCard,
                  radarMode === 'red_hall' && styles.modeCardRedActive,
                ]}
                onPress={() => setRadarMode('red_hall')}
                activeOpacity={0.85}
              >
                <View style={styles.modeHeader}>
                  <Ionicons
                    name="warning"
                    size={20}
                    color={radarMode === 'red_hall' ? COLORS.redBright : COLORS.textMuted}
                  />
                  <Text
                    style={[
                      styles.modeCount,
                      radarMode === 'red_hall' && { color: COLORS.redBright },
                    ]}
                  >
                    ЧЕРЕН СПИСЪК
                  </Text>
                </View>
                <Text style={styles.modeTitle}>Къде да НЕ се ходи</Text>
                <Text style={styles.modeDesc}>
                  Скрити такси, скъпи ресторанти и подвеждащи нощувки
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modeCard,
                  radarMode === 'green_gems' && styles.modeCardGreenActive,
                ]}
                onPress={() => setRadarMode('green_gems')}
                activeOpacity={0.85}
              >
                <View style={styles.modeHeader}>
                  <Ionicons
                    name="shield-checkmark"
                    size={20}
                    color={
                      radarMode === 'green_gems' ? COLORS.greenBright : COLORS.textMuted
                    }
                  />
                  <Text
                    style={[
                      styles.modeCount,
                      radarMode === 'green_gems' && { color: COLORS.greenBright },
                    ]}
                  >
                    СЕРТИФИКАТ
                  </Text>
                </View>
                <Text style={styles.modeTitle}>Честни Места</Text>
                <Text style={styles.modeDesc}>
                  Най-евтините цени и коректни обекти с касова бележка
                </Text>
              </TouchableOpacity>
            </View>

            {/* 🏆 КЛАСАЦИЯ НА ОБЕКТИТЕ: Черен Списък vs Сертификат за Честно Място */}
            {rankedVenues.length > 0 && (
              <View
                style={{
                  backgroundColor: COLORS.bgCard,
                  borderWidth: 1,
                  borderColor:
                    radarMode === 'red_hall' ? COLORS.redBorder : COLORS.greenBorder,
                  borderRadius: 16,
                  padding: 12,
                  marginBottom: 14,
                  gap: 8,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <Ionicons
                      name={radarMode === 'red_hall' ? 'skull-outline' : 'ribbon'}
                      size={17}
                      color={
                        radarMode === 'red_hall' ? COLORS.redBright : COLORS.greenBright
                      }
                    />
                    <Text
                      style={{
                        color: COLORS.textPrimary,
                        fontSize: 12.5,
                        fontWeight: '900',
                        flex: 1,
                      }}
                      numberOfLines={1}
                    >
                      {radarMode === 'red_hall'
                        ? '🚫 Черен Списък на Обектите'
                        : '🏆 Сертификат „Честно Място“'}
                    </Text>
                  </View>
                  <Text
                    style={{
                      color:
                        radarMode === 'red_hall' ? COLORS.redBright : COLORS.greenBright,
                      fontSize: 10.5,
                      fontWeight: '800',
                    }}
                  >
                    {activeCity}
                  </Text>
                </View>

                {rankedVenues.map((v, idx) => (
                  <View
                    key={`${v.placeName}-${idx}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: 'rgba(15, 23, 42, 0.65)',
                      borderRadius: 12,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      gap: 8,
                    }}
                  >
                    <TouchableOpacity
                      style={{ flex: 1 }}
                      onPress={() => openVenueOffers(v)}
                    >
                      <Text
                        style={{
                          color: COLORS.textPrimary,
                          fontSize: 12.5,
                          fontWeight: '800',
                        }}
                        numberOfLines={1}
                      >
                        #{idx + 1} {v.placeName}
                      </Text>
                      <Text
                        style={{
                          color: COLORS.textMuted,
                          fontSize: 10.5,
                          marginTop: 2,
                        }}
                        numberOfLines={1}
                      >
                        📍 {v.city}
                        {v.address ? ` • ${v.address}` : ''} • {v.score}{' '}
                        {radarMode === 'red_hall' ? 'гласа „Обир!“' : 'гласа „Топ!“'}
                      </Text>
                      <Text
                        style={{
                          color: radarMode === 'red_hall' ? COLORS.redBright : COLORS.greenBright,
                          fontSize: 10.5,
                          fontWeight: '800',
                          marginTop: 3,
                        }}
                        numberOfLines={1}
                      >
                        Виж всички оферти за този обект ›
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        backgroundColor:
                          radarMode === 'red_hall'
                            ? COLORS.redSoftBg
                            : COLORS.greenSoftBg,
                        borderWidth: 1,
                        borderColor:
                          radarMode === 'red_hall'
                            ? COLORS.redBorder
                            : COLORS.greenBorder,
                        paddingHorizontal: 8,
                        paddingVertical: 5,
                        borderRadius: 9,
                      }}
                      onPress={() =>
                        openInGoogleMaps({
                          placeName: v.placeName,
                          address: v.address,
                          city: v.city,
                        })
                      }
                    >
                      <Ionicons
                        name="map-outline"
                        size={12}
                        color={
                          radarMode === 'red_hall'
                            ? COLORS.redBright
                            : COLORS.greenBright
                        }
                      />
                      <Text
                        style={{
                          color:
                            radarMode === 'red_hall'
                              ? COLORS.redBright
                              : COLORS.greenBright,
                          fontSize: 10.5,
                          fontWeight: '800',
                        }}
                      >
                        Карта
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Филтри по категории */}
            <View style={styles.categoryGrid}>
              {CATEGORIES.map((cat) => {
                const isSelected = activeCategory === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.catPill,
                      isSelected && {
                        backgroundColor:
                          radarMode === 'red_hall'
                            ? COLORS.redSoftBg
                            : COLORS.greenSoftBg,
                        borderColor:
                          radarMode === 'red_hall'
                            ? COLORS.redPrimary
                            : COLORS.greenPrimary,
                      },
                    ]}
                    onPress={() => setActiveCategory(cat.id)}
                  >
                    <Ionicons
                      name={cat.icon as any}
                      size={14}
                      color={
                        isSelected
                          ? radarMode === 'red_hall'
                            ? COLORS.redBright
                            : COLORS.greenBright
                          : COLORS.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.catPillText,
                        isSelected && {
                          color:
                            radarMode === 'red_hall'
                              ? COLORS.redBright
                              : COLORS.greenBright,
                          fontWeight: '800',
                        },
                      ]}
                    >
                      {cat.shortLabel}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.resultsHeader}>
              <Text style={styles.resultsTitle} numberOfLines={1}>
                {radarMode === 'red_hall'
                  ? '🚨 Сигнали „Чист Обир!“'
                  : '🔥 Сигнали „Топ Удар!“'}
              </Text>
              <Text style={styles.resultsCount}>
                {listTotal} резултата
              </Text>
            </View>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 36,
  },
  header: {
    paddingTop: 12,
    marginBottom: 14,
  },
  screenTitle: {
    color: COLORS.textPrimary,
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  screenSub: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 3,
    marginBottom: 14,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
    marginBottom: 14,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  modeCardsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  modeCard: {
    flex: 1,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 22,
    padding: 15,
  },
  modeCardRedActive: {
    backgroundColor: COLORS.redSoftBg,
    borderColor: COLORS.redBorder,
  },
  modeCardGreenActive: {
    backgroundColor: COLORS.greenSoftBg,
    borderColor: COLORS.greenBorder,
  },
  modeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  modeCount: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  modeTitle: {
    color: COLORS.textPrimary,
    fontSize: 15.5,
    fontWeight: '900',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  modeDesc: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    lineHeight: 16.5,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginBottom: 14,
  },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5.5,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingHorizontal: 12,
    paddingVertical: 7.5,
    borderRadius: 999,
  },
  catPillText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  resultsTitle: {
    color: COLORS.textPrimary,
    fontSize: 13.5,
    fontWeight: '800',
  },
  resultsCount: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
});
