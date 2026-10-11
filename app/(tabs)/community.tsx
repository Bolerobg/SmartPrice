import React from 'react';
import {
  Image,
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

export default function CommunityScreen() {
  const {
    leaderboard,
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
                100% ФИНАНСИРАНО ОТ ПОТРЕБИТЕЛИТЕ (STRIPE)
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
              Събрани: <Text style={{ color: COLORS.goldBright, fontWeight: '800' }}>{currentRaisedBgn} лв.</Text> от {monthlyGoalBgn} лв.
            </Text>

            <TouchableOpacity
              style={styles.donateSmallBtn}
              onPress={() => openDonationModal()}
            >
              <Ionicons name="card" size={14} color={COLORS.black} />
              <Text style={styles.donateSmallBtnText}>Дари чрез Stripe</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Ранглиста на Топ Ловците на Цени */}
        <Text style={styles.sectionHeading}>🏆 Топ Защитници на Потребителите</Text>
        <View style={styles.leaderboardList}>
          {leaderboard.map((user) => {
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

                <Image source={{ uri: user.avatar }} style={styles.leaderAvatar} />

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
                  <Text style={styles.leaderMeta}>
                    🧾 {user.verifiedReceipts} бележки • 🟢 {user.greenPosts} • 🔴{' '}
                    {user.redFlagsExposed}
                  </Text>
                </View>

                <View style={styles.leaderSavedCol}>
                  <Text style={styles.leaderSavedAmount}>
                    {user.communitySavedBgn.toLocaleString('bg-BG')} лв.
                  </Text>
                  <Text style={styles.leaderSavedLabel}>спестени</Text>
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
    fontSize: 11.5,
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
