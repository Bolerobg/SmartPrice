import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import {
  detectHomeScreenPlatform,
  isAlreadyInstalled,
} from '@/components/AddToHomeScreenModal';
import { InviteCard } from '@/components/InviteCard';
import { PushNotificationsCard } from '@/components/PushNotificationsCard';
import { StoryCardModal } from '@/components/StoryCardModal';
import { COLORS } from '@/constants/theme';
import { storyCardUrl } from '@/src/api/client';
import { formatPostedAt } from '@/src/lib/format';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/src/auth/AuthContext';
import { useRouter } from 'expo-router';

const BADGE_UNITS: Record<string, string> = {
  price_checks: 'проверки',
  price_corrections: 'поправки',
  reputation_points: 'точки',
  posts: 'оферти',
  receipts: 'бележки',
  red_flags: 'червени флага',
  savings: '€',
  supporter: '',
  referrals: 'покани',
};

function unitFor(badge: { metric?: string | null }): string {
  return badge.metric ? (BADGE_UNITS[badge.metric] ?? '') : '';
}

export default function ProfileScreen() {
  const router = useRouter();
  const { userProfile, posts, openDonationModal, refreshAll, openAddToHome } = useApp();
  const { user, logout, refreshProfile } = useAuth();

  const [activeTab, setActiveTab] = useState<'badges' | 'bookmarks' | 'donations'>(
    'badges'
  );
  // Карта „Спестих X €“ за Stories (генерира я сървърът).
  const [cardOpen, setCardOpen] = useState(false);

  // Значките: отключените отгоре, а от заключените — тази, която е най-близо.
  const sortedBadges = [...userProfile.badges].sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    const ra = (a.progress ?? 0) / Math.max(1, a.threshold ?? 1);
    const rb = (b.progress ?? 0) / Math.max(1, b.threshold ?? 1);
    return rb - ra;
  });
  const nextBadge = sortedBadges.find((b) => !b.unlocked && (b.threshold ?? 0) > 0);

  // „Обнови данните от сървъра“ — тегли наново И профила (дарения, значки,
  // спестени), не само потока. Иначе при натискане на екрана на профила
  // визуално не се променяше нищо и изглеждаше, че бутонът не работи.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [justRefreshed, setJustRefreshed] = useState(false);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setJustRefreshed(false);
    try {
      await Promise.all([refreshAll(), refreshProfile()]);
      setJustRefreshed(true);
      setTimeout(() => setJustRefreshed(false), 2600);
    } catch (err) {
      Alert.alert(
        'Не успя да се обнови',
        err instanceof Error && err.message
          ? err.message
          : 'Провери връзката с интернет и опитай пак.'
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  // Показваме реда „сложи на началния екран“ само в браузър и само ако още
  // не е добавено — в истинското приложение е излишно.
  const [showInstallRow, setShowInstallRow] = useState(false);
  useEffect(() => {
    setShowInstallRow(detectHomeScreenPlatform() !== 'native' && !isAlreadyInstalled());
  }, []);

  const bookmarkedPosts = posts.filter((p) => p.isBookmarked);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {!user && (
          <View style={styles.guestAuthBanner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.guestAuthTitle}>Разглеждаш като гост</Text>
              <Text style={styles.guestAuthSub}>
                Влез в профила си, за да запазваш оферти, значки и точки доверие в „Спести & Открий“.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.guestAuthBtn}
              onPress={() => router.push('/login' as never)}
              activeOpacity={0.85}
            >
              <Text style={styles.guestAuthBtnText}>Вход</Text>
            </TouchableOpacity>
          </View>
        )}

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
                {userProfile.personalSavedBgn} €
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

        {/* Поканален цикъл: кодът, линкът и колко души са дошли по тях */}
        <InviteCard profile={userProfile} onOpenCard={() => setCardOpen(true)} />

        <View style={styles.raffleRow}>
          <TouchableOpacity
            style={[styles.storyCardBtn, { flex: 1, backgroundColor: COLORS.tertiaryContainer }]}
            onPress={() => router.push('/raffle' as never)}
            activeOpacity={0.88}
          >
            <Ionicons name="gift" size={17} color={COLORS.onPrimary} />
            <Text style={[styles.storyCardBtnText, { color: COLORS.onPrimary }]}>Томболи</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.storyCardBtn, { flex: 1, backgroundColor: COLORS.surfaceContainerLowest, borderWidth: 1, borderColor: COLORS.greenBorder }]}
            onPress={() => router.push('/favorites' as never)}
            activeOpacity={0.88}
          >
            <Ionicons name="bookmark" size={16} color={COLORS.greenBright} />
            <Text style={[styles.storyCardBtnText, { color: COLORS.greenBright }]}>Любими</Text>
          </TouchableOpacity>
        </View>

        {/* 🏷️ Продаване: моите обяви + вход към пускане на нова */}
        <View style={styles.raffleRow}>
          <TouchableOpacity
            style={[styles.storyCardBtn, { flex: 1, backgroundColor: COLORS.surfaceContainerLowest, borderWidth: 1, borderColor: COLORS.borderStrong }]}
            onPress={() => router.push('/listings' as never)}
            activeOpacity={0.88}
          >
            <Ionicons name="pricetags" size={16} color={COLORS.textPrimary} />
            <Text style={[styles.storyCardBtnText, { color: COLORS.textPrimary }]}>Моите обяви</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.storyCardBtn, { flex: 1, backgroundColor: COLORS.primary }]}
            onPress={() => router.push('/listings/new' as never)}
            activeOpacity={0.88}
          >
            <Ionicons name="add-circle" size={16} color={COLORS.onPrimary} />
            <Text style={[styles.storyCardBtnText, { color: COLORS.onPrimary }]}>Продавам нещо</Text>
          </TouchableOpacity>
        </View>

        {/* 🎮 Тренировка на пъзела — без ограничения, за подготовка за томболата */}
        <View style={styles.raffleRow}>
          <TouchableOpacity
            style={[styles.storyCardBtn, { flex: 1, backgroundColor: COLORS.surfaceContainerLowest, borderWidth: 1, borderColor: COLORS.accentCyanBorder }]}
            onPress={() => router.push('/puzzle-demo' as never)}
            activeOpacity={0.88}
          >
            <Ionicons name="game-controller" size={16} color={COLORS.primary} />
            <Text style={[styles.storyCardBtnText, { color: COLORS.primary }]}>Тренировка · пъзелът</Text>
          </TouchableOpacity>
        </View>

        {(userProfile.isAdmin || userProfile.role === 'admin') && (
          <View style={styles.raffleRow}>
            <TouchableOpacity
              style={[styles.storyCardBtn, { flex: 1, backgroundColor: COLORS.surfaceContainerLowest, borderWidth: 1, borderColor: COLORS.goldBorder }]}
              onPress={() => router.push('/admin/raffles' as never)}
              activeOpacity={0.88}
            >
              <Ionicons name="settings" size={16} color={COLORS.goldBright} />
              <Text style={[styles.storyCardBtnText, { color: COLORS.goldBright }]}>Админ панел (Томболи)</Text>
            </TouchableOpacity>
          </View>
        )}

        {userProfile.personalSavedBgn > 0 ? (
          <TouchableOpacity
            style={styles.storyCardBtn}
            onPress={() => setCardOpen(true)}
            activeOpacity={0.88}
          >
            <Ionicons name="image" size={17} color={COLORS.onPrimary} />
            <Text style={[styles.storyCardBtnText, { color: COLORS.onPrimary }]}>
              Карта „Спестих {userProfile.personalSavedBgn.toFixed(2)} €“ за Stories
            </Text>
          </TouchableOpacity>
        ) : null}

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
                  ? 'Статус: Пазител на Общността 💛 (напомнянията са спрени)'
                  : 'Статус: Още не си подкрепил проекта'}
              </Text>
              <Text style={styles.monetizationSub}>
                {userProfile.isSupporter
                  ? `Твоята подкрепа: ${userProfile.totalDonatedBgn.toFixed(2)} € — благодарим ти! Ти си „Пазител на Общността“.`
                  : `Можеш да подкрепиш SmartPrice по всяко време. Питаме дискретно — най-рано след 8 действия и поне 3 дни след предишно напомняне.`}
              </Text>
            </View>
          </View>

          <View style={styles.monetizationActions}>
            <TouchableOpacity
              style={styles.stripePrimaryBtn}
              onPress={() => openDonationModal()}
            >
              <Ionicons name="heart" size={16} color={COLORS.onPrimary} />
              <Text style={styles.stripePrimaryBtnText}>
                {userProfile.isSupporter ? 'Подкрепи отново' : 'Подкрепи проекта'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.testNudgeBtn, isRefreshing && { opacity: 0.65 }]}
              onPress={() => void handleRefresh()}
              disabled={isRefreshing}
              activeOpacity={0.85}
            >
              {isRefreshing ? (
                <ActivityIndicator size="small" color={COLORS.goldBright} />
              ) : (
                <Ionicons
                  name={justRefreshed ? 'checkmark-circle' : 'refresh-outline'}
                  size={16}
                  color={justRefreshed ? COLORS.greenBright : COLORS.goldBright}
                />
              )}
              <Text
                style={[
                  styles.testNudgeBtnText,
                  justRefreshed && { color: COLORS.greenBright },
                ]}
              >
                {isRefreshing
                  ? 'Обновява…'
                  : justRefreshed
                    ? 'Обновено ✓'
                    : userProfile.isSupporter
                      ? 'Обнови даренията'
                      : 'Обнови данните от сървъра'}
              </Text>
            </TouchableOpacity>
          </View>

          <PushNotificationsCard />

          <View style={styles.monetizationActions}>
            <TouchableOpacity
              style={styles.testNudgeBtn}
              onPress={() => router.push('/change-password' as never)}
            >
              <Ionicons name="key-outline" size={16} color={COLORS.goldBright} />
              <Text style={[styles.testNudgeBtnText, { color: COLORS.goldBright }]}>
                Смяна на паролата
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.testNudgeBtn}
              onPress={() =>
                Alert.alert('Изход от профила', 'Сигурен ли си, че искаш да излезеш?', [
                  { text: 'Отказ', style: 'cancel' },
                  {
                    text: 'Излез',
                    style: 'destructive',
                    onPress: () => void logout(),
                  },
                ])
              }
            >
              <Ionicons name="log-out-outline" size={16} color={COLORS.redBright} />
              <Text style={[styles.testNudgeBtnText, { color: COLORS.redBright }]}>
                Излез от профила
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Покана: сложи приложението на началния екран (само в браузър) */}
        {showInstallRow && (
          <TouchableOpacity
            style={styles.installRow}
            onPress={() => openAddToHome('help')}
            activeOpacity={0.85}
          >
            <View style={styles.installIcon}>
              <Ionicons name="phone-portrait-outline" size={19} color={COLORS.accentCyan} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.installTitle}>Сложи SmartPrice на телефона</Text>
              <Text style={styles.installSub}>
                Икона на началния екран — отваря се като истинско приложение
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}

        {/* Как работи приложението — същата презентация, но по всяко време.
            Първото обяснение се вижда само веднъж и след месец човекът вече
            не помни половината функции. */}
        <TouchableOpacity
          style={styles.installRow}
          onPress={() => router.push('/tour?review=1')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Как работи приложението"
        >
          <View style={styles.installIcon}>
            <Ionicons name="school-outline" size={19} color={COLORS.goldBright} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.installTitle}>Как работи приложението</Text>
            <Text style={styles.installSub}>
              Кратък преговор на всичко, което SmartPrice може
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </TouchableOpacity>

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
            {/* Какво следва — най-близката значка, за да има цел пред очите */}
            {nextBadge && (
              <View style={styles.nextBadgeCard}>
                <Ionicons name="flag" size={15} color={COLORS.goldBright} />
                <Text style={styles.nextBadgeText}>
                  Следваща: <Text style={styles.nextBadgeStrong}>{nextBadge.title}</Text>
                  {' — '}
                  {nextBadge.threshold && nextBadge.progress !== undefined
                    ? `още ${Math.max(0, nextBadge.threshold - nextBadge.progress)} ${unitFor(nextBadge)}`
                    : 'още малко'}
                </Text>
              </View>
            )}

            {sortedBadges.map((badge) => {
              const threshold = badge.threshold ?? 0;
              const progress = badge.progress ?? 0;
              const pct =
                threshold > 0 ? Math.min(100, Math.round((progress / threshold) * 100)) : 0;

              return (
                <View
                  key={badge.id}
                  style={[
                    styles.badgeCard,
                    !badge.unlocked && styles.badgeCardLocked,
                    badge.unlocked && { borderColor: `${badge.color}66` },
                  ]}
                >
                  <View
                    style={[
                      styles.badgeIconCircle,
                      {
                        backgroundColor: badge.unlocked ? `${badge.color}22` : COLORS.bgCardElevated,
                        borderColor: badge.unlocked ? badge.color : COLORS.borderSubtle,
                      },
                    ]}
                  >
                    <Ionicons
                      name={badge.unlocked ? (badge.icon as any) : 'lock-closed'}
                      size={20}
                      color={badge.unlocked ? badge.color : COLORS.textMuted}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.badgeHeaderRow}>
                      <Text
                        style={[
                          styles.badgeTitle,
                          !badge.unlocked && { color: COLORS.textSecondary },
                        ]}
                        numberOfLines={1}
                      >
                        {badge.title}
                      </Text>
                      <Text
                        style={[
                          styles.badgeStatus,
                          { color: badge.unlocked ? COLORS.greenBright : COLORS.textMuted },
                        ]}
                      >
                        {badge.unlocked ? '✓ Отключена' : `${progress} / ${threshold}`}
                      </Text>
                    </View>
                    <Text style={styles.badgeDesc}>{badge.description}</Text>

                    {!badge.unlocked && threshold > 0 && (
                      <View style={styles.badgeTrack}>
                        <View
                          style={[
                            styles.badgeFill,
                            { width: `${pct}%`, backgroundColor: badge.color },
                          ]}
                        />
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
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
                  Все още не си подкрепил SmartPrice. Стани „Пазител на Общността“ — златна значка и без напомняния!
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
                      Реф. №{don.paymentIntentId.slice(-8).toUpperCase()} • {formatPostedAt(don.createdAt)}
                    </Text>
                  </View>
                  <Text style={styles.donAmount}>{don.amountBgn.toFixed(2)} €</Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      <StoryCardModal
        visible={cardOpen}
        onClose={() => setCardOpen(false)}
        cardUrl={storyCardUrl({
          total: userProfile.personalSavedBgn,
          name: userProfile.name,
          code: userProfile.referralCode,
          posts: userProfile.postsCount,
        })}
        message={
          `${userProfile.name} е спестил ${userProfile.personalSavedBgn.toFixed(2)} € с SmartPrice — ` +
          'реални цени от хора, без реклами. Влез по моя код:'
        }
        title={`Карта „Спестих ${userProfile.personalSavedBgn.toFixed(2)} €“`}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  raffleRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  storyCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.greenBright,
    borderRadius: 16,
    paddingVertical: 13.5,
    marginTop: 12,
    shadowColor: COLORS.greenPrimary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  storyCardBtnText: { color: COLORS.black, fontSize: 13.5, fontWeight: '900' },
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 110,
  },
  guestAuthBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surfaceContainerLow,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
  },
  guestAuthTitle: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  guestAuthSub: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    lineHeight: 16.5,
    marginTop: 2,
  },
  guestAuthBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  guestAuthBtnText: {
    color: COLORS.onPrimary,
    fontSize: 12.5,
    fontWeight: '800',
  },
  profileCard: {
    backgroundColor: COLORS.surfaceContainerLowest,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    padding: 18,
    marginBottom: 14,
    shadowColor: COLORS.onSurface,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },
  profileTop: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 16,
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 22,
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
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  vipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3.5,
    backgroundColor: COLORS.goldBright,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
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
    lineHeight: 18.5,
    marginTop: 6,
  },
  statsGrid: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    paddingVertical: 12,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statVal: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  statLbl: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2.5,
  },
  monetizationCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    padding: 16,
    marginBottom: 16,
  },
  monetizationHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    marginBottom: 14,
  },
  monetizationTitle: {
    color: COLORS.textPrimary,
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  monetizationSub: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 17.5,
    marginTop: 3,
  },
  monetizationActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  stripePrimaryBtn: {
    flex: 1,
    minWidth: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  stripePrimaryBtnText: {
    color: COLORS.onPrimary,
    fontSize: 12.5,
    fontWeight: '800',
  },
  testNudgeBtn: {
    flex: 1,
    minWidth: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  testNudgeBtnText: {
    color: COLORS.goldBright,
    fontSize: 11.5,
    fontWeight: '700',
  },
  installRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.bgCard,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 14,
  },
  installIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: COLORS.accentCyanSoftBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  installTitle: { color: COLORS.textPrimary, fontSize: 13.5, fontWeight: '800' },
  installSub: {
    color: COLORS.textMuted,
    fontSize: 11.5,
    marginTop: 3,
    lineHeight: 16,
  },
  subTabsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 4,
    marginBottom: 14,
  },
  subTab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 12,
  },
  subTabActive: {
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  subTabText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  subTabTextActive: {
    color: COLORS.textPrimary,
    fontWeight: '800',
  },
  badgesGrid: {
    gap: 10,
  },
  nextBadgeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 16,
    padding: 12,
  },
  nextBadgeText: { flex: 1, color: COLORS.textSecondary, fontSize: 11.5, lineHeight: 16.5 },
  nextBadgeStrong: { color: COLORS.goldBright, fontWeight: '900' },
  badgeCardLocked: {
    opacity: 0.75,
  },
  badgeTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.bgCardElevated,
    marginTop: 8,
    overflow: 'hidden',
  },
  badgeFill: { height: 5, borderRadius: 3 },
  badgeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 18,
    padding: 14,
  },
  badgeIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 15,
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
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 20,
    padding: 28,
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
    borderRadius: 18,
    padding: 15,
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
    fontSize: 16.5,
    fontWeight: '900',
  },
});
