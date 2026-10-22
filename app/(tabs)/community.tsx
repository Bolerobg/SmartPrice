import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { Avatar } from '@/components/Avatar';
import { InviteCard } from '@/components/InviteCard';
import { PostCard } from '@/components/PostCard';
import { RaffleTeaser } from '@/components/RaffleTeaser';

type BoardTab = 'saved' | 'checkers' | 'points';
type HomeSection = 'feed' | 'leaderboard';

/** „1 проверка“ / „2 проверки“ — броячите да звучат човешки. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const BOARD_TABS: { key: BoardTab; label: string; icon: string }[] = [
  { key: 'saved', label: 'Топ спестили', icon: 'pricetags-outline' },
  { key: 'checkers', label: 'Проверяващи', icon: 'search-outline' },
  { key: 'points', label: 'Точки доверие', icon: 'star-outline' },
];

export default function CommunityScreen() {
  const router = useRouter();
  const {
    leaderboard,
    fetchLeaderboard,
    posts,
    totalCommunitySavedAllPosts,
    openDonationModal,
    userProfile,
    communityStats,
  } = useApp();

  const [homeSection, setHomeSection] = useState<HomeSection>('feed');
  const [feedPolarity, setFeedPolarity] = useState<'all' | 'green' | 'red'>('all');

  // Реални броячи от базата (не измислени числа)
  const totalReceiptsCount = communityStats?.verifiedReceipts ?? posts.filter((p) => p.receipt?.verifiedByAi).length;
  const totalRedFlagsCount = communityStats?.redPosts ?? posts.filter((p) => p.polarity === 'red').length;
  const totalGreenCount = communityStats?.greenPosts ?? posts.filter((p) => p.polarity === 'green').length;

  const [boardTab, setBoardTab] = useState<BoardTab>('saved');
  const [board, setBoard] = useState(leaderboard);
  const [boardLoading, setBoardLoading] = useState(false);

  useEffect(() => {
    setBoard(leaderboard);
  }, [leaderboard]);

  useEffect(() => {
    let cancelled = false;
    setBoardLoading(true);
    fetchLeaderboard(boardTab)
      .then((items) => {
        if (!cancelled) setBoard(items);
      })
      .catch(() => {
        if (!cancelled && boardTab === 'saved') setBoard(leaderboard);
      })
      .finally(() => {
        if (!cancelled) setBoardLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardTab]);

  const weeklyChampion = [...board].sort((a, b) => b.checksLast7d - a.checksLast7d)[0];
  const showChampion = boardTab === 'checkers' && (weeklyChampion?.checksLast7d ?? 0) > 0;

  const monthlyGoalBgn = 800;
  const currentRaisedBgn = communityStats?.raisedThisMonthBgn ?? 0;
  const goalProgress = Math.min(100, Math.round((currentRaisedBgn / monthlyGoalBgn) * 100));

  const visiblePosts = posts
    .filter((p) => (feedPolarity === 'all' ? true : p.polarity === feedPolarity))
    .slice(0, 20);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Топ бранд хедър „Спести & Открий“ */}
        <View style={styles.topBrandRow}>
          <View style={styles.brandLeft}>
            <View style={styles.brandIconBox}>
              <Ionicons name="analytics" size={20} color={COLORS.onPrimary} />
            </View>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.screenTitle}>Спести & Открий</Text>
                <View style={styles.bgPill}>
                  <Text style={styles.bgPillText}>BG</Text>
                </View>
              </View>
              <Text style={styles.screenSub}>
                Начален поток, реални сигнали и класация на общността
              </Text>
            </View>
          </View>
        </View>

        {/* Бързи преки пътища */}
        <View style={styles.quickActionsGrid}>
          <TouchableOpacity
            style={[styles.quickActionCard, styles.quickActionPrimary]}
            onPress={() => router.push('/(tabs)' as never)}
            activeOpacity={0.85}
          >
            <Ionicons name="pricetags" size={18} color={COLORS.onPrimary} />
            <Text style={styles.quickActionPrimaryText}>Сравни по вериги</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/(tabs)/add' as never)}
            activeOpacity={0.85}
          >
            <Ionicons name="camera-outline" size={18} color={COLORS.primary} />
            <Text style={styles.quickActionText}>Добави сигнал</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/shops' as never)}
            activeOpacity={0.85}
          >
            <Ionicons name="storefront-outline" size={18} color={COLORS.primary} />
            <Text style={styles.quickActionText}>Каталози</Text>
          </TouchableOpacity>
        </View>

        {/* Голяма карта: Спестени пари на общността */}
        <View style={styles.heroStatsCard}>
          <View style={styles.heroTopRow}>
            <View>
              <Text style={styles.heroLabel}>СПЕСТЕНИ ПАРИ НА ОБЩНОСТТА</Text>
              <Text style={styles.heroBigAmount}>
                {totalCommunitySavedAllPosts.toLocaleString('bg-BG')} лв.
              </Text>
            </View>
            <View style={styles.heroTrophyCircle}>
              <Ionicons name="trophy" size={26} color={COLORS.tertiary} />
            </View>
          </View>

          <View style={styles.heroMiniStatsRow}>
            <View style={styles.heroMiniBox}>
              <Text style={[styles.heroMiniVal, { color: COLORS.tertiary }]}>
                {totalReceiptsCount}
              </Text>
              <Text style={styles.heroMiniLbl}>AI Касови бележки</Text>
            </View>
            <View style={styles.heroMiniBox}>
              <Text style={[styles.heroMiniVal, { color: COLORS.error }]}>
                {totalRedFlagsCount}
              </Text>
              <Text style={styles.heroMiniLbl}>Червени флагове</Text>
            </View>
            <View style={styles.heroMiniBox}>
              <Text style={[styles.heroMiniVal, { color: COLORS.primary }]}>
                {totalGreenCount}
              </Text>
              <Text style={styles.heroMiniLbl}>Топ оферти</Text>
            </View>
          </View>
        </View>

        {/* Главен превключвател: Жив поток vs Класация & Кауза */}
        <View style={styles.mainSwitchRow}>
          <TouchableOpacity
            style={[styles.mainSwitchTab, homeSection === 'feed' && styles.mainSwitchTabActive]}
            onPress={() => setHomeSection('feed')}
            activeOpacity={0.85}
          >
            <Ionicons
              name="newspaper-outline"
              size={15}
              color={homeSection === 'feed' ? COLORS.onPrimary : COLORS.textSecondary}
            />
            <Text
              style={[
                styles.mainSwitchText,
                homeSection === 'feed' && styles.mainSwitchTextActive,
              ]}
            >
              Начален Поток ({posts.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.mainSwitchTab,
              homeSection === 'leaderboard' && styles.mainSwitchTabActive,
            ]}
            onPress={() => setHomeSection('leaderboard')}
            activeOpacity={0.85}
          >
            <Ionicons
              name="podium-outline"
              size={15}
              color={homeSection === 'leaderboard' ? COLORS.onPrimary : COLORS.textSecondary}
            />
            <Text
              style={[
                styles.mainSwitchText,
                homeSection === 'leaderboard' && styles.mainSwitchTextActive,
              ]}
            >
              Класации & Томболи
            </Text>
          </TouchableOpacity>
        </View>

        {homeSection === 'feed' ? (
          <View>
            <View style={styles.feedFilterRow}>
              {[
                { key: 'all', label: 'Всички сигнали' },
                { key: 'green', label: '🟢 Топ находки' },
                { key: 'red', label: '🔴 Червени флагове' },
              ].map((f) => {
                const active = feedPolarity === f.key;
                return (
                  <TouchableOpacity
                    key={f.key}
                    style={[styles.feedFilterChip, active && styles.feedFilterChipActive]}
                    onPress={() => setFeedPolarity(f.key as 'all' | 'green' | 'red')}
                  >
                    <Text
                      style={[
                        styles.feedFilterChipText,
                        active && styles.feedFilterChipTextActive,
                      ]}
                    >
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {visiblePosts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}

            {/*
              ⚠️ ЖИВО (22.10.2026): при смяна на чипа („Топ находки“ / „Червени
              флагове“) екранът можеше да остане ПРАЗЕН — изглеждаше все едно
              табът не показва нищо. Ако няма попадения, казваме го с думи и
              даваме бутон да се види всичко.
            */}
            {visiblePosts.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>
                  {feedPolarity === 'green'
                    ? 'Още няма топ находки'
                    : feedPolarity === 'red'
                      ? 'Още няма червени флагове'
                      : 'Още няма сигнали'}
                </Text>
                <Text style={styles.emptyHint}>
                  Покажи всички сигнали — или добави своя находка, за да помогнеш на следващите.
                </Text>
                <TouchableOpacity
                  style={styles.emptyBtn}
                  activeOpacity={0.85}
                  onPress={() => setFeedPolarity('all')}
                >
                  <Text style={styles.emptyBtnText}>Покажи всички сигнали</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : (
          <View>
            {/* Поканата е до класацията нарочно: точките от покани влизат в нея. */}
            <InviteCard profile={userProfile} compact />

            {/* Томболата: кой какво е спечелил и как да участваш */}
            <RaffleTeaser compact />

            {/* Прозрачно финансиране чрез Stripe дарения */}
            <View style={styles.fundingCard}>
              <View style={styles.fundingHeader}>
                <View style={styles.fundingBadge}>
                  <Ionicons name="heart" size={14} color={COLORS.tertiary} />
                  <Text style={styles.fundingBadgeText}>
                    100% ФИНАНСИРАНО ОТ ХОРАТА КАТО ТЕБ
                  </Text>
                </View>
                <Text style={styles.fundingPercent}>{goalProgress}%</Text>
              </View>

              <Text style={styles.fundingTitle}>
                Месечен фонд за AI OCR скенер и независими сървъри
              </Text>
              <Text style={styles.fundingDesc}>
                Спести & Открий не продава реклами и не позволява на вериги да плащат за скриване на високи цени.
              </Text>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${goalProgress}%` }]} />
              </View>

              <View style={styles.fundingFooter}>
                <Text style={styles.fundingNumbers}>
                  Събрани: <Text style={{ color: COLORS.tertiary, fontWeight: '800' }}>{currentRaisedBgn} €</Text> от {monthlyGoalBgn} €
                </Text>

                <TouchableOpacity
                  style={styles.donateSmallBtn}
                  onPress={() => openDonationModal()}
                >
                  <Ionicons name="heart" size={14} color={COLORS.onPrimary} />
                  <Text style={styles.donateSmallBtnText}>Подкрепи проекта</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Ранглиста — три начина да си полезен */}
            <Text style={styles.sectionHeading}>🏆 Топ Защитници на Потребителите</Text>

            <View style={styles.boardTabs}>
              {BOARD_TABS.map((tab) => {
                const active = boardTab === tab.key;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    onPress={() => setBoardTab(tab.key)}
                    activeOpacity={0.85}
                    style={[styles.boardTab, active && styles.boardTabActive]}
                  >
                    <Ionicons
                      name={tab.icon as never}
                      size={13}
                      color={active ? COLORS.onPrimary : COLORS.textSecondary}
                    />
                    <Text style={[styles.boardTabText, active && styles.boardTabTextActive]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Проверяващ на седмицата */}
            {showChampion && weeklyChampion && (
              <View style={styles.championCard}>
                <Text style={styles.championCrown}>👑 ПРОВЕРЯВАЩ НА СЕДМИЦАТА</Text>
                <View style={styles.championRow}>
                  <Avatar
                    uri={weeklyChampion.avatar}
                    name={weeklyChampion.name}
                    size={42}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.championName} numberOfLines={1}>
                      {weeklyChampion.name}
                    </Text>
                    <Text style={styles.championMeta}>
                      {plural(weeklyChampion.checksLast7d, 'проверка', 'проверки')} през последните 7 дни
                    </Text>
                  </View>
                  <View style={styles.championPoints}>
                    <Text style={styles.championPointsValue}>{weeklyChampion.reputationPoints}</Text>
                    <Text style={styles.championPointsLabel}>точки</Text>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.leaderboardList}>
              {boardLoading && board.length === 0 && (
                <Text style={styles.boardEmpty}>Зареждаме ранглистата…</Text>
              )}
              {!boardLoading && board.length === 0 && (
                <Text style={styles.boardEmpty}>
                  Още никой не е проверявал чужда цена. Първият ще е на върха.
                </Text>
              )}
              {board.map((user) => {
                const isMe = user.id === 'user-me';
                return (
                  <View
                    key={user.id}
                    style={[
                      styles.leaderRow,
                      isMe && styles.leaderRowMe,
                    ]}
                  >
                    <View
                      style={[
                        styles.rankBadge,
                        user.rank === 1 && { backgroundColor: COLORS.tertiaryContainer },
                        user.rank === 2 && { backgroundColor: '#94A3B8' },
                        user.rank === 3 && { backgroundColor: '#D97706' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.rankText,
                          user.rank <= 3 && { color: COLORS.white },
                        ]}
                      >
                        #{user.rank}
                      </Text>
                    </View>

                    <Avatar
                      uri={user.avatar}
                      name={user.name}
                      size={42}
                      borderColor={isMe ? COLORS.primary : undefined}
                    />

                    <View style={styles.leaderInfo}>
                      <View style={styles.leaderNameRow}>
                        <Text style={styles.leaderName} numberOfLines={1}>
                          {user.name}
                        </Text>
                        {user.isSupporter && (
                          <Ionicons
                            name="shield-checkmark"
                            size={14}
                            color={COLORS.tertiary}
                          />
                        )}
                      </View>
                      <Text style={styles.leaderMeta} numberOfLines={1}>
                        {boardTab === 'checkers'
                          ? `🔍 ${plural(user.priceChecks, 'проверка', 'проверки')} • ✏️ ${plural(user.priceCorrections, 'поправка', 'поправки')}`
                          : boardTab === 'points'
                            ? `⭐ ${plural(user.reputationPoints, 'точка', 'точки')} • 🔍 ${plural(user.priceChecks, 'проверка', 'проверки')}`
                            : `🧾 ${plural(user.verifiedReceipts, 'бележка', 'бележки')} • 🟢 ${user.greenPosts} • 🔴 ${user.redFlagsExposed}`}
                      </Text>
                      {user.badgeTitle && user.badgeTitle !== 'Ловец на цени' ? (
                        <Text style={styles.leaderBadge} numberOfLines={1}>
                          {user.badgeTitle}
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.leaderSavedCol}>
                      <Text
                        style={[
                          styles.leaderSavedAmount,
                          boardTab !== 'saved' && { color: COLORS.tertiary },
                        ]}
                      >
                        {boardTab === 'checkers'
                          ? `${user.checksLast7d}`
                          : boardTab === 'points'
                            ? `${user.reputationPoints}`
                            : `${user.communitySavedBgn.toLocaleString('bg-BG')} €`}
                      </Text>
                      <Text style={styles.leaderSavedLabel}>
                        {boardTab === 'checkers'
                          ? 'тази седмица'
                          : boardTab === 'points'
                            ? 'точки'
                            : 'спестени'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
  },
  emptyBox: {
    backgroundColor: COLORS.bgCardElevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    padding: 16,
    marginTop: 12,
    alignItems: 'center',
  },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 15.5, fontWeight: '800' },
  emptyHint: {
    color: COLORS.textMuted,
    fontSize: 12.5,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  emptyBtn: {
    marginTop: 12,
    backgroundColor: COLORS.greenPrimary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  emptyBtnText: { color: COLORS.onPrimary, fontSize: 13.5, fontWeight: '800' },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 110,
  },
  topBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  brandLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  bgPill: {
    backgroundColor: COLORS.primaryFixed,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  bgPillText: {
    color: COLORS.onPrimaryFixedVariant,
    fontSize: 10,
    fontWeight: '800',
  },
  screenTitle: {
    color: COLORS.textPrimary,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  screenSub: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  quickActionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 8,
  },
  quickActionPrimary: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  quickActionPrimaryText: {
    color: COLORS.onPrimary,
    fontSize: 11.5,
    fontWeight: '800',
  },
  quickActionText: {
    color: COLORS.textPrimary,
    fontSize: 11.5,
    fontWeight: '700',
  },
  mainSwitchRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceContainerLow,
    borderRadius: 16,
    padding: 4,
    gap: 6,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  mainSwitchTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
  },
  mainSwitchTabActive: {
    backgroundColor: COLORS.primary,
  },
  mainSwitchText: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    fontWeight: '700',
  },
  mainSwitchTextActive: {
    color: COLORS.onPrimary,
    fontWeight: '800',
  },
  feedFilterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  feedFilterChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: COLORS.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  feedFilterChipActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderColor: COLORS.primary,
  },
  feedFilterChipText: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: '700',
  },
  feedFilterChipTextActive: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  heroStatsCard: {
    backgroundColor: COLORS.surfaceContainerLowest,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    padding: 16,
    marginBottom: 14,
    shadowColor: COLORS.onSurface,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  heroLabel: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  heroBigAmount: {
    color: COLORS.textPrimary,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 2,
  },
  heroTrophyCircle: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: COLORS.tertiaryFixed,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroMiniStatsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceContainerLow,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 12,
    justifyContent: 'space-between',
  },
  heroMiniBox: {
    flex: 1,
    alignItems: 'center',
  },
  heroMiniVal: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  heroMiniLbl: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  fundingCard: {
    backgroundColor: COLORS.surfaceContainerLowest,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    padding: 18,
    marginBottom: 20,
  },
  fundingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  fundingBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.tertiaryFixed,
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 999,
  },
  fundingBadgeText: {
    color: COLORS.tertiary,
    fontSize: 9.5,
    fontWeight: '800',
    flexShrink: 1,
  },
  fundingPercent: {
    color: COLORS.tertiary,
    fontSize: 15.5,
    fontWeight: '800',
  },
  fundingTitle: {
    color: COLORS.textPrimary,
    fontSize: 15.5,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  fundingDesc: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    lineHeight: 18.5,
    marginBottom: 12,
  },
  progressTrack: {
    height: 9,
    backgroundColor: COLORS.surfaceContainerLow,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.tertiaryContainer,
    borderRadius: 999,
  },
  fundingFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fundingNumbers: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
  },
  donateSmallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8.5,
    borderRadius: 999,
  },
  donateSmallBtnText: {
    color: COLORS.onPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  sectionHeading: {
    color: COLORS.textPrimary,
    fontSize: 17.5,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 10,
  },
  boardTabs: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: 12,
  },
  boardTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: COLORS.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 14,
    paddingVertical: 9.5,
    paddingHorizontal: 6,
  },
  boardTabActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  boardTabText: {
    color: COLORS.textSecondary,
    fontSize: 10.5,
    fontWeight: '800',
  },
  boardTabTextActive: { color: COLORS.onPrimary },

  championCard: {
    backgroundColor: COLORS.tertiaryFixed,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 20,
    padding: 14,
    marginBottom: 12,
  },
  championCrown: {
    color: COLORS.tertiary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 9,
  },
  championRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  championAvatar: { width: 42, height: 42, borderRadius: 14 },
  championName: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '800' },
  championMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 3 },
  championPoints: { alignItems: 'flex-end' },
  championPointsValue: { color: COLORS.tertiary, fontSize: 16.5, fontWeight: '800' },
  championPointsLabel: { color: COLORS.textMuted, fontSize: 10 },

  boardEmpty: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 14,
  },
  leaderBadge: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 3,
  },
  leaderboardList: {
    gap: 10,
  },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 18,
    padding: 13,
  },
  leaderRowMe: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surfaceContainerLow,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: COLORS.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rankText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  leaderAvatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    marginRight: 10,
  },
  leaderInfo: {
    flex: 1,
    marginRight: 8,
  },
  leaderNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  leaderName: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  leaderMeta: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 3,
  },
  leaderSavedCol: {
    alignItems: 'flex-end',
  },
  leaderSavedAmount: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '800',
  },
  leaderSavedLabel: {
    color: COLORS.textMuted,
    fontSize: 10.5,
  },
});
