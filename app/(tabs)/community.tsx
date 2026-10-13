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
import { COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { Avatar } from '@/components/Avatar';
import { InviteCard } from '@/components/InviteCard';
import { RaffleTeaser } from '@/components/RaffleTeaser';

type BoardTab = 'saved' | 'checkers' | 'points';

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
  const {
    leaderboard,
    fetchLeaderboard,
    posts,
    totalCommunitySavedAllPosts,
    openDonationModal,
    userProfile,
    communityStats,
  } = useApp();

  // Реални броячи от базата (не измислени числа)
  const totalReceiptsCount = communityStats?.verifiedReceipts ?? posts.filter((p) => p.receipt?.verifiedByAi).length;
  const totalRedFlagsCount = communityStats?.redPosts ?? posts.filter((p) => p.polarity === 'red').length;
  const totalGreenCount = communityStats?.greenPosts ?? posts.filter((p) => p.polarity === 'green').length;

  // Реално събраното този месец от Stripe дарения (идва от базата)
  // Ранглистата се тегли наново при смяна на таба — трите подреждания
  // показват различни хора, защото има три различни начина да си полезен.
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.screenTitle}>Общност & Класации</Text>
        <Text style={styles.screenSub}>
          Заедно правим цените прозрачни и разобличаваме некоректните търговци
        </Text>

        {/* Поканата е до класацията нарочно: точките от покани влизат в нея. */}
        <InviteCard profile={userProfile} compact />

        {/* Томболата: кой какво е спечелил и как да участваш */}
        <RaffleTeaser compact />

        {/* Голяма карта: Спестени пари на общността */}
        <View style={styles.heroStatsCard}>
          <View style={styles.heroTopRow}>
            <View>
              <Text style={styles.heroLabel}>СПЕСТЕНИ ПАРИ НА ОБЩНОСТТА</Text>
              <Text style={styles.heroBigAmount}>
                {totalCommunitySavedAllPosts.toLocaleString('bg-BG')} €
              </Text>
            </View>
            <View style={styles.heroTrophyCircle}>
              <Ionicons name="trophy" size={28} color={COLORS.goldBright} />
            </View>
          </View>

          <View style={styles.heroMiniStatsRow}>
            <View style={styles.heroMiniBox}>
              <Text style={[styles.heroMiniVal, { color: COLORS.goldBright }]}>
                {totalReceiptsCount}
              </Text>
              <Text style={styles.heroMiniLbl}>AI Касови бележки</Text>
            </View>
            <View style={styles.heroMiniBox}>
              <Text style={[styles.heroMiniVal, { color: COLORS.redBright }]}>
                {totalRedFlagsCount}
              </Text>
              <Text style={styles.heroMiniLbl}>Червени флагове</Text>
            </View>
            <View style={styles.heroMiniBox}>
              <Text style={[styles.heroMiniVal, { color: COLORS.greenBright }]}>
                {totalGreenCount}
              </Text>
              <Text style={styles.heroMiniLbl}>Топ оферти</Text>
            </View>
          </View>
        </View>

        {/* Прозрачно финансиране чрез Stripe дарения */}
        <View style={styles.fundingCard}>
          <View style={styles.fundingHeader}>
            <View style={styles.fundingBadge}>
              <Ionicons name="heart" size={14} color={COLORS.goldBright} />
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
            SmartPrice не продава реклами и не позволява на бизнеси да плащат за скриване на негативни ревюта.
          </Text>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${goalProgress}%` }]} />
          </View>

          <View style={styles.fundingFooter}>
            <Text style={styles.fundingNumbers}>
              Събрани: <Text style={{ color: COLORS.goldBright, fontWeight: '800' }}>{currentRaisedBgn} €</Text> от {monthlyGoalBgn} €
            </Text>

            <TouchableOpacity
              style={styles.donateSmallBtn}
              onPress={() => openDonationModal()}
            >
              <Ionicons name="heart" size={14} color={COLORS.black} />
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
                  color={active ? COLORS.black : COLORS.textSecondary}
                />
                <Text style={[styles.boardTabText, active && styles.boardTabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Проверяващ на седмицата — кой е обиколил най-много места тия дни */}
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
                    user.rank === 1 && { backgroundColor: COLORS.goldPrimary },
                    user.rank === 2 && { backgroundColor: '#94A3B8' },
                    user.rank === 3 && { backgroundColor: '#D97706' },
                  ]}
                >
                  <Text
                    style={[
                      styles.rankText,
                      user.rank <= 3 && { color: COLORS.black },
                    ]}
                  >
                    #{user.rank}
                  </Text>
                </View>

                <Avatar
                  uri={user.avatar}
                  name={user.name}
                  size={42}
                  borderColor={isMe ? COLORS.accentIndigo : undefined}
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
                        color={COLORS.goldBright}
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
                      boardTab !== 'saved' && { color: COLORS.goldBright },
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 36,
  },
  screenTitle: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: '900',
  },
  screenSub: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 3,
    marginBottom: 14,
  },
  heroStatsCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: COLORS.greenBorder,
    padding: 16,
    marginBottom: 16,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  heroLabel: {
    color: COLORS.greenBright,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  heroBigAmount: {
    color: COLORS.textPrimary,
    fontSize: 30,
    fontWeight: '900',
    marginTop: 2,
  },
  heroTrophyCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroMiniStatsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 14,
    padding: 12,
    justifyContent: 'space-between',
  },
  heroMiniBox: {
    flex: 1,
    alignItems: 'center',
  },
  heroMiniVal: {
    fontSize: 18,
    fontWeight: '900',
  },
  heroMiniLbl: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  fundingCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    padding: 16,
    marginBottom: 20,
  },
  fundingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  fundingBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.goldSoftBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  fundingBadgeText: {
    color: COLORS.goldBright,
    fontSize: 9.5,
    fontWeight: '800',
    flexShrink: 1,
  },
  fundingPercent: {
    color: COLORS.goldBright,
    fontSize: 15,
    fontWeight: '900',
  },
  fundingTitle: {
    color: COLORS.textPrimary,
    fontSize: 15.5,
    fontWeight: '800',
    marginBottom: 4,
  },
  fundingDesc: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 12,
  },
  progressTrack: {
    height: 9,
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.goldBright,
    borderRadius: 5,
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
    backgroundColor: COLORS.goldBright,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 11,
  },
  donateSmallBtnText: {
    color: COLORS.black,
    fontSize: 12,
    fontWeight: '800',
  },
  sectionHeading: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '800',
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
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 6,
  },
  boardTabActive: {
    backgroundColor: COLORS.goldBright,
    borderColor: COLORS.goldBright,
  },
  boardTabText: {
    color: COLORS.textSecondary,
    fontSize: 10.5,
    fontWeight: '800',
  },
  boardTabTextActive: { color: COLORS.black },

  championCard: {
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  championCrown: {
    color: COLORS.goldBright,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    marginBottom: 9,
  },
  championRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  championAvatar: { width: 42, height: 42, borderRadius: 21 },
  championName: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '900' },
  championMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 3 },
  championPoints: { alignItems: 'flex-end' },
  championPointsValue: { color: COLORS.goldBright, fontSize: 16, fontWeight: '900' },
  championPointsLabel: { color: COLORS.textMuted, fontSize: 10 },

  boardEmpty: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 14,
  },
  leaderBadge: {
    color: COLORS.accentCyan,
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
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 12,
  },
  leaderRowMe: {
    borderColor: COLORS.accentIndigo,
    backgroundColor: COLORS.indigoSoftBg,
  },
  rankBadge: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: COLORS.bgCardElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rankText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '900',
  },
  leaderAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
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
    color: COLORS.greenBright,
    fontSize: 14.5,
    fontWeight: '900',
  },
  leaderSavedLabel: {
    color: COLORS.textMuted,
    fontSize: 10.5,
  },
});
