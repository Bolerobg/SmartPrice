import React, { useMemo, useState } from 'react';
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
import { PostCard } from '@/components/PostCard';
import { CATEGORIES, COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { openInGoogleMaps } from '@/lib/locationService';
import { matchesUniversalSearch } from '@/lib/smartSearch';
import { CategoryId } from '@/types';

export default function RadarScreen() {
  const {
    posts,
    isRefreshing,
    refreshAll,
    isLoadingMore,
    hasMorePosts,
    loadMorePosts,
  } = useApp();
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

  const rankedVenues = useMemo(() => {
    const map: Record<
      string,
      {
        placeName: string;
        city: string;
        address?: string;
        score: number;
        reportsCount: number;
        hasReceipt: boolean;
      }
    > = {};

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

  const filteredAndSortedPosts = useMemo(() => {
    const matching = posts.filter((p) => {
      if (radarMode === 'red_hall' && p.polarity !== 'red') return false;
      if (radarMode === 'green_gems' && p.polarity !== 'green') return false;
      if (activeCategory !== 'all' && p.category !== activeCategory) return false;
      if (activeCity !== 'Всички градове' && p.city !== activeCity) return false;

      return matchesUniversalSearch(p, searchQuery);
    });

    return matching.sort((a, b) => {
      if (radarMode === 'red_hall') {
        const scoreA = a.reactions.pureRobbery + a.reactions.avoid;
        const scoreB = b.reactions.pureRobbery + b.reactions.avoid;
        return scoreB - scoreA;
      }
      const scoreA = a.reactions.topDeal + a.reactions.worthIt;
      const scoreB = b.reactions.topDeal + b.reactions.worthIt;
      return scoreB - scoreA;
    });
  }, [posts, searchQuery, radarMode, activeCategory, activeCity]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={filteredAndSortedPosts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PostCard post={item} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshing={isRefreshing}
        onRefresh={() => void refreshAll()}
        onEndReached={() => {
          if (hasMorePosts) {
            void loadMorePosts();
          }
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          isLoadingMore ? (
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
                      onPress={() => setSearchQuery(v.placeName)}
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
                {filteredAndSortedPosts.length} резултата
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
