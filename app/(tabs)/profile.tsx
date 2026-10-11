import React, { useState } from 'react';
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
import { PostCard } from '@/components/PostCard';
import { COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';

export default function ProfileScreen() {
  const {
    userProfile,
    posts,
    openDonationModal,
    triggerPeriodicNudgeNow,
    resetSupporterStatusForDemo,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'badges' | 'bookmarks' | 'donations'>(
    'badges'
  );

  const bookmarkedPosts = posts.filter((p) => p.isBookmarked);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Профилна карта */}
        <View style={styles.profileCard}>
          <View style={styles.profileTop}>
            <Image source={{ uri: userProfile.avatar }} style={styles.avatar} />
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{userProfile.name}</Text>
                {userProfile.isSupporter && (
                  <View style={styles.vipBadge}>
                    <Ionicons name="shield-checkmark" size={12} color={COLORS.black} />
                    <Text style={styles.vipBadgeText}>VIP ДАРИТЕЛ</Text>
                  </View>
                )}
              </View>
              <Text style={styles.handle}>
                {userProfile.handle} • 📍 {userProfile.city}
              </Text>
              <Text style={styles.bio}>{userProfile.bio}</Text>
            </View>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={[styles.statVal, { color: COLORS.greenBright }]}>
                {userProfile.personalSavedBgn} лв.
              </Text>
              <Text style={styles.statLbl}>Лично спестени</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statVal, { color: COLORS.goldBright }]}>
                {userProfile.verifiedReceiptsCount}
              </Text>
              <Text style={styles.statLbl}>AI Бележки</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{userProfile.reputationPoints}</Text>
              <Text style={styles.statLbl}>Точки доверие</Text>
            </View>
          </View>
        </View>

        {/* Панел за Stripe Монетизация и Периодично Напомняне */}
        <View
          style={[
            styles.monetizationCard,
            userProfile.isSupporter && { borderColor: COLORS.greenBorder },
          ]}
        >
          <View style={styles.monetizationHeader}>
            <Ionicons
              name={userProfile.isSupporter ? 'shield-checkmark' : 'notifications-circle'}
              size={24}
              color={userProfile.isSupporter ? COLORS.greenBright : COLORS.goldBright}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.monetizationTitle}>
                {userProfile.isSupporter
                  ? 'Статус: Активен Дарител (Напомнянията са спрени)'
                  : 'Статус: Още не си дарил (Периодично напомняне активно)'}
              </Text>
              <Text style={styles.monetizationSub}>
                {userProfile.isSupporter
                  ? `Общо дарени през Stripe: ${userProfile.totalDonatedBgn.toFixed(2)} лв. Благодарим ти за подкрепата!`
                  : `Приложението пита периодично (на всеки 3 действия или по таймер), докато не направиш дарение през Stripe.`}
              </Text>
            </View>
          </View>

          <View style={styles.monetizationActions}>
            <TouchableOpacity
              style={styles.stripePrimaryBtn}
              onPress={() => openDonationModal()}
            >
              <Ionicons name="card" size={16} color={COLORS.black} />
              <Text style={styles.stripePrimaryBtnText}>
                {userProfile.isSupporter ? 'Направи ново дарение' : 'Дари чрез Stripe'}
              </Text>
            </TouchableOpacity>

            {!userProfile.isSupporter ? (
              <TouchableOpacity
                style={styles.testNudgeBtn}
                onPress={triggerPeriodicNudgeNow}
              >
                <Ionicons name="notifications-outline" size={16} color={COLORS.goldBright} />
                <Text style={styles.testNudgeBtnText}>
                  Тествай периодичното питане
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.testNudgeBtn}
                onPress={resetSupporterStatusForDemo}
              >
                <Ionicons name="refresh" size={16} color={COLORS.textSecondary} />
                <Text style={[styles.testNudgeBtnText, { color: COLORS.textSecondary }]}>
                  Нулирай за тест на напомнянето
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Табове в профила */}
        <View style={styles.subTabsRow}>
          <TouchableOpacity
            style={[
              styles.subTab,
              activeTab === 'badges' && styles.subTabActive,
            ]}
            onPress={() => setActiveTab('badges')}
          >
            <Text
              style={[
                styles.subTabText,
                activeTab === 'badges' && styles.subTabTextActive,
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              🏅 Значки ({userProfile.badges.filter((b) => b.unlocked).length}/
              {userProfile.badges.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.subTab,
              activeTab === 'bookmarks' && styles.subTabActive,
            ]}
            onPress={() => setActiveTab('bookmarks')}
          >
            <Text
              style={[
                styles.subTabText,
                activeTab === 'bookmarks' && styles.subTabTextActive,
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              🔖 Запазени ({bookmarkedPosts.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.subTab,
              activeTab === 'donations' && styles.subTabActive,
            ]}
            onPress={() => setActiveTab('donations')}
          >
            <Text
              style={[
                styles.subTabText,
                activeTab === 'donations' && styles.subTabTextActive,
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              💳 Дарения ({userProfile.donations.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Съдържание според избрания таб */}
        {activeTab === 'badges' && (
          <View style={styles.badgesGrid}>
            {userProfile.badges.map((badge) => (
              <View
                key={badge.id}
                style={[
                  styles.badgeCard,
                  !badge.unlocked && { opacity: 0.5 },
                ]}
              >
                <View
                  style={[
                    styles.badgeIconCircle,
                    { backgroundColor: `${badge.color}22`, borderColor: badge.color },
                  ]}
                >
                  <Ionicons name={badge.icon as any} size={22} color={badge.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.badgeHeaderRow}>
                    <Text style={styles.badgeTitle}>{badge.title}</Text>
                    <Text
                      style={[
                        styles.badgeStatus,
                        { color: badge.unlocked ? COLORS.greenBright : COLORS.textMuted },
                      ]}
                    >
                      {badge.unlocked ? '✓ Отключена' : 'Заключена'}
                    </Text>
                  </View>
                  <Text style={styles.badgeDesc}>{badge.description}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {activeTab === 'bookmarks' && (
          <View>
            {bookmarkedPosts.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="bookmark-outline" size={38} color={COLORS.textMuted} />
                <Text style={styles.emptyText}>
                  Все още нямаш запазени оферти или червени флагове. Натисни иконата за отметка върху всеки пост!
                </Text>
              </View>
            ) : (
              bookmarkedPosts.map((post) => <PostCard key={post.id} post={post} />)
            )}
          </View>
        )}

        {activeTab === 'donations' && (
          <View style={styles.donationsList}>
            {userProfile.donations.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="heart-outline" size={38} color={COLORS.goldBright} />
                <Text style={styles.emptyText}>
                  Все още нямаш направени дарения през Stripe. Подкрепи общността, за да отключиш VIP значка и да спреш периодичните напомняния!
                </Text>
              </View>
            ) : (
              userProfile.donations.map((don) => (
                <View key={don.id} style={styles.donationRecordCard}>
                  <View>
                    <Text style={styles.donTierTitle}>
                      {don.tierName} {don.isMonthly ? '(Месечен абонамент)' : '(Еднократно)'}
                    </Text>
                    <Text style={styles.donMeta}>
                      Stripe ID: {don.paymentIntentId} • {don.createdAt}
                    </Text>
                  </View>
                  <Text style={styles.donAmount}>{don.amountBgn.toFixed(2)} лв.</Text>
                </View>
              ))
            )}
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
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 38,
  },
  profileCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    padding: 16,
    marginBottom: 14,
  },
  profileTop: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 14,
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: COLORS.goldBright,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  name: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '900',
  },
  vipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.goldBright,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  vipBadgeText: {
    color: COLORS.black,
    fontSize: 9.5,
    fontWeight: '900',
  },
  handle: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    marginTop: 2,
  },
  bio: {
    color: COLORS.textPrimary,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 6,
  },
  statsGrid: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 14,
    paddingVertical: 10,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statVal: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
  statLbl: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  monetizationCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.goldBorder,
    padding: 15,
    marginBottom: 16,
  },
  monetizationHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  monetizationTitle: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  monetizationSub: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  monetizationActions: {
    flexDirection: 'row',
    gap: 8,
  },
  stripePrimaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.goldBright,
    paddingVertical: 11,
    borderRadius: 12,
  },
  stripePrimaryBtnText: {
    color: COLORS.black,
    fontSize: 12.5,
    fontWeight: '900',
  },
  testNudgeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  testNudgeBtnText: {
    color: COLORS.goldBright,
    fontSize: 11.5,
    fontWeight: '700',
  },
  subTabsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    padding: 4,
    marginBottom: 14,
  },
  subTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 10,
  },
  subTabActive: {
    backgroundColor: COLORS.bgCardElevated,
  },
  subTabText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  subTabTextActive: {
    color: COLORS.textPrimary,
    fontWeight: '800',
  },
  badgesGrid: {
    gap: 10,
  },
  badgeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 13,
  },
  badgeIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badgeTitle: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  badgeStatus: {
    fontSize: 11,
    fontWeight: '800',
  },
  badgeDesc: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 3,
  },
  emptyBox: {
    alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    borderRadius: 18,
    padding: 26,
    gap: 10,
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  donationsList: {
    gap: 10,
  },
  donationRecordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 15,
    padding: 14,
  },
  donTierTitle: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  donMeta: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    marginTop: 3,
  },
  donAmount: {
    color: COLORS.goldBright,
    fontSize: 16,
    fontWeight: '900',
  },
});
