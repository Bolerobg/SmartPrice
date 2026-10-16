import React, { useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { CATEGORIES, COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { openInGoogleMaps } from '@/lib/locationService';
import { formatPostedAt, formatPricePerUnit } from '@/src/lib/format';
import { computePriceStats, priceTrendLabel } from '@/lib/priceHistory';
import { Avatar } from '@/components/Avatar';
import { PostItem, ReactionKey } from '@/types';

/**
 * Откъде е дошла офертата.
 *
 * Приложението не е само потребителски отзиви: част от цените са внесени от
 * редакцията (реални касови бонове от кошчетата на касите, официални брошури).
 * Прозрачността е задължителна — всеки трябва да вижда, че това НЕ е мнение на
 * човек, който е бил там. Затова офертите с източник различен от „user“ носят
 * малък етикет.
 */
const SOURCE_LABEL: Record<string, { text: string; icon: string; hint: string }> = {
  receipt_basket: {
    text: 'ОТ БОН',
    icon: 'receipt-outline',
    hint: 'Реален касов бон, внесен от редакцията',
  },
  brochure: { text: 'ОТ БРОШУРА', icon: 'document-outline', hint: 'Официална брошура/каталог' },
  tiktok_signal: { text: 'СИГНАЛ', icon: 'megaphone-outline', hint: 'Сигнал, споделен с разрешение' },
  import: { text: 'ВНЕСЕНО', icon: 'cloud-download-outline', hint: 'Внесено от редакцията' },
  scraper: { text: 'ОТ МАГАЗИН', icon: 'storefront-outline', hint: 'Цена от онлайн магазин' },
};

interface PostCardProps {
  post: PostItem;
  distanceKm?: number;
}

export const PostCard: React.FC<PostCardProps> = ({ post, distanceKm }) => {
  const router = useRouter();
  const {
    toggleReaction,
    markPostHelpedMe,
    confirmPriceValidToday,
    toggleBookmark,
    openShare,
  } = useApp();
  const [showComparisonImage, setShowComparisonImage] = useState(false);

  const isGreen = post.polarity === 'green';
  const accentColor = isGreen ? COLORS.greenPrimary : COLORS.redPrimary;
  const accentSoftBg = isGreen ? COLORS.greenSoftBg : COLORS.redSoftBg;
  const accentBorder = isGreen ? COLORS.greenBorder : COLORS.redBorder;

  const categoryObj = CATEGORIES.find((c) => c.id === post.category);


  // Изчисляване на % спестяване или % надценка
  const priceDiffPercent =
    post.referencePrice && post.referencePrice > 0
      ? Math.round(
          (Math.abs(post.referencePrice - post.pricePaid) / post.referencePrice) * 100
        )
      : null;

  const highlightedReceiptItem =
    post.receipt?.items.find((i) => i.highlightReason) || post.receipt?.items[0];

  // Отваря общия лист за споделяне (виж components/ShareModal.tsx).
  // Преди тук беше Share.share(), което на десктоп браузър се проваляше
  // безшумно и пращаше само текст, без линк към офертата.
  const handleShare = () => openShare(post);

  const renderReactions = () => {
    if (isGreen) {
      const greenButtons: { key: ReactionKey; emoji: string; label: string; count: number }[] = [
        { key: 'topDeal', emoji: '🔥', label: 'Топ Удар', count: post.reactions.topDeal },
        { key: 'worthIt', emoji: '👍', label: 'Струва си', count: post.reactions.worthIt },
        { key: 'doubt', emoji: '🤔', label: 'Съмнително', count: post.reactions.doubt },
      ];

      return greenButtons.map((btn) => {
        const active = post.userReaction === btn.key;
        return (
          <TouchableOpacity
            key={btn.key}
            style={[
              styles.reactionChip,
              active && {
                backgroundColor: COLORS.greenSoftBg,
                borderColor: COLORS.greenPrimary,
              },
            ]}
            onPress={() => toggleReaction(post.id, btn.key)}
            activeOpacity={0.75}
          >
            <Text style={styles.reactionEmoji}>{btn.emoji}</Text>
            <Text
              style={[
                styles.reactionLabel,
                active && { color: COLORS.greenBright, fontWeight: '700' },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {btn.label}
            </Text>
            <Text
              style={[
                styles.reactionCount,
                active && { color: COLORS.greenBright },
              ]}
            >
              {btn.count}
            </Text>
          </TouchableOpacity>
        );
      });
    }

    const redButtons: { key: ReactionKey; emoji: string; label: string; count: number }[] = [
      { key: 'pureRobbery', emoji: '🚨', label: 'Чист Обир', count: post.reactions.pureRobbery },
      { key: 'avoid', emoji: '😤', label: 'Избягвай', count: post.reactions.avoid },
      { key: 'exaggerated', emoji: '⚖️', label: 'Пресилено', count: post.reactions.exaggerated },
    ];

    return redButtons.map((btn) => {
      const active = post.userReaction === btn.key;
      return (
        <TouchableOpacity
          key={btn.key}
          style={[
            styles.reactionChip,
            active && {
              backgroundColor: COLORS.redSoftBg,
              borderColor: COLORS.redPrimary,
            },
          ]}
          onPress={() => toggleReaction(post.id, btn.key)}
          activeOpacity={0.75}
        >
          <Text style={styles.reactionEmoji}>{btn.emoji}</Text>
          <Text
            style={[
              styles.reactionLabel,
              active && { color: COLORS.redBright, fontWeight: '700' },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {btn.label}
          </Text>
          <Text
            style={[
              styles.reactionCount,
              active && { color: COLORS.redBright },
            ]}
          >
            {btn.count}
          </Text>
        </TouchableOpacity>
      );
    });
  };

  return (
    <View style={[styles.card, { borderColor: accentBorder }]}>
      {/* Горен статус бар на картата */}
      <View style={[styles.polarityBanner, { backgroundColor: accentSoftBg }]}>
        <View style={styles.polarityLeft}>
          <View style={[styles.polarityDot, { backgroundColor: accentColor }]} />
          <Text
            style={[styles.polarityTitle, { color: accentColor }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {isGreen ? 'ТОП НАХОДКА' : 'ЧЕРВЕН ФЛАГ • НЕ ХОДИ'}
          </Text>
        </View>
        <View style={styles.bannerRightBadges}>
          <View style={styles.platformBadge}>
            <Text style={styles.platformBadgeText} numberOfLines={1}>
              {post.customPlatformLabel || post.platformTag}
            </Text>
          </View>
          {categoryObj && (
            <View style={styles.categoryBadge}>
              <Ionicons
                name={categoryObj.icon as any}
                size={11}
                color={COLORS.textSecondary}
              />
              <Text style={styles.categoryBadgeText} numberOfLines={1}>
                {post.customCategoryLabel || categoryObj.shortLabel}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Автор и Локация */}
      <TouchableOpacity
        activeOpacity={0.88}
        onPress={() => {
          // Винаги отваряме ОФЕРТАТА (за да се свери цената — както при
          // физическите магазини). На картата НЯМА линк към онлайн магазина —
          // по желание на потребителя; линкът живее в екрана на офертата.
          router.push(`/post/${post.id}`);
        }}
        style={styles.cardBodyTap}
      >
        <View style={styles.headerRow}>
          <Avatar uri={post.author.avatar} name={post.author.name} size={38} />
          <View style={styles.authorMeta}>
            <View style={styles.authorNameRow}>
              <Text style={styles.authorName} numberOfLines={1}>
                {post.author.name}
              </Text>
              {post.author.isSupporter && (
                <View style={styles.supporterPill}>
                  <Ionicons name="shield-checkmark" size={10} color={COLORS.goldBright} />
                  <Text style={styles.supporterPillText}>VIP</Text>
                </View>
              )}
            </View>
            <View style={styles.locationRow}>
              <Ionicons name="location" size={12} color={accentColor} />
              <Text style={styles.placeNameText} numberOfLines={1}>
                {post.placeName} • {post.city}
              </Text>
              {/* Онлайн или физически магазин — ясно, преди човек да тръгне натам.
                  За онлайн показваме и сайта; за физически — адреса. */}
              {post.source === 'scraper' || post.platformTag === 'Онлайн магазин' ? (
                <View style={styles.shopKindRow}>
                  <Ionicons name="globe-outline" size={11} color={COLORS.accentCyan} />
                  <Text style={styles.shopKindOnline}>ОНЛАЙН МАГАЗИН</Text>
                </View>
              ) : post.address || post.googleMapsUrl ? (
                <View style={styles.shopKindRow}>
                  <Ionicons name="location-outline" size={11} color={COLORS.goldPrimary} />
                  <Text style={styles.shopKindPhysical}>ФИЗИЧЕСКИ МАГАЗИН</Text>
                  <Text style={styles.shopKindWhere} numberOfLines={1}>
                    · {post.address || post.city}
                  </Text>
                </View>
              ) : null}
            </View>
            {/* Кога е сложена офертата — точната дата, не само „преди N дни“ */}
            <View style={styles.postedAtRow}>
              <Ionicons name="calendar-outline" size={11} color={COLORS.textMuted} />
              <Text style={styles.postedAtText} numberOfLines={1}>
                {formatPostedAt(post.createdAt)}
              </Text>
            </View>

            {/* Жива ли е цената: движила ли се е и кога за последно е проверена.
                Това кара човека да отвори офертата — и да я провери, ако е минал оттам. */}
            <View style={styles.liveRow}>
              {(() => {
                const stats = computePriceStats(post);
                const trend = priceTrendLabel(stats);
                return (
                  <>
                    {trend && (
                      <View
                        style={[
                          styles.liveChip,
                          {
                            backgroundColor:
                              stats.direction === 'down'
                                ? COLORS.greenSoftBg
                                : COLORS.redSoftBg,
                            borderColor:
                              stats.direction === 'down'
                                ? COLORS.greenBorder
                                : COLORS.redBorder,
                          },
                        ]}
                      >
                        <Ionicons
                          name={stats.direction === 'down' ? 'trending-down' : 'trending-up'}
                          size={11}
                          color={
                            stats.direction === 'down'
                              ? COLORS.greenBright
                              : COLORS.redBright
                          }
                        />
                        <Text
                          style={[
                            styles.liveChipText,
                            {
                              color:
                                stats.direction === 'down'
                                  ? COLORS.greenBright
                                  : COLORS.redBright,
                            },
                          ]}
                        >
                          {trend}
                        </Text>
                      </View>
                    )}

                    <View
                      style={[
                        styles.liveChip,
                        {
                          backgroundColor: stats.isFresh
                            ? COLORS.greenSoftBg
                            : COLORS.goldSoftBg,
                          borderColor: stats.isFresh
                            ? COLORS.greenBorder
                            : COLORS.goldBorder,
                        },
                      ]}
                    >
                      <Ionicons
                        name={stats.isFresh ? 'checkmark-circle' : 'time-outline'}
                        size={11}
                        color={stats.isFresh ? COLORS.greenBright : COLORS.goldBright}
                      />
                      <Text
                        style={[
                          styles.liveChipText,
                          {
                            color: stats.isFresh ? COLORS.greenBright : COLORS.goldBright,
                          },
                        ]}
                      >
                        {stats.daysSinceCheck === null
                          ? 'непроверена'
                          : stats.daysSinceCheck === 0
                            ? 'проверена днес'
                            : stats.daysSinceCheck === 1
                              ? 'проверена вчера'
                              : `непроверена ${stats.daysSinceCheck} дни`}
                      </Text>
                    </View>
                  </>
                );
              })()}
            </View>
          </View>

          <TouchableOpacity
            onPress={() => toggleBookmark(post.id)}
            style={styles.bookmarkBtn}
          >
            <Ionicons
              name={post.isBookmarked ? 'bookmark' : 'bookmark-outline'}
              size={20}
              color={post.isBookmarked ? COLORS.goldBright : COLORS.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* Заглавие и описание */}
        <Text style={styles.postTitle}>{post.title}</Text>

        {/* Уникалният ID на офертата — по него може да се търси в приложението */}
        <View style={styles.codeRow}>
          <Ionicons name="pricetag-outline" size={12} color={COLORS.accentCyan} />
          <Text style={styles.codeText}>ID: {post.code}</Text>
          {post.sellerType === 'private' ? (
            <View style={styles.sellerPill}>
              <Ionicons name="person-outline" size={11} color={COLORS.black} />
              <Text style={styles.sellerPillText}>ЧАСТНО ЛИЦЕ</Text>
            </View>
          ) : null}

          {/* Откъде е цената: внесена от редакцията (бон/брошура), не от потребител */}
          {post.source && post.source !== 'user' && SOURCE_LABEL[post.source] ? (
            <View style={styles.sourcePill}>
              <Ionicons
                name={SOURCE_LABEL[post.source].icon as never}
                size={11}
                color={COLORS.accentCyan}
              />
              <Text style={styles.sourcePillText}>{SOURCE_LABEL[post.source].text}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.postDescription} numberOfLines={3}>
          {post.description}
        </Text>

        {/* Частен продавач: къде и кога го намираш */}
        {post.sellerNote ? (
          <View style={styles.sellerNote}>
            <Ionicons name="location-outline" size={14} color={COLORS.goldBright} />
            <Text style={styles.sellerNoteText}>{post.sellerNote}</Text>
          </View>
        ) : null}

        {/* Снимка + Очакване vs Реалност + Бадж за Касова Бележка */}
        <View style={styles.imageContainer}>
          <Image
            source={{
              uri:
                showComparisonImage && post.comparisonImageUri
                  ? post.comparisonImageUri
                  : post.imageUri,
            }}
            style={styles.postImage}
            resizeMode="cover"
          />

          {/* Бадж за верифицирана касова бележка */}
          {post.receipt?.verifiedByAi && (
            <View style={styles.verifiedReceiptOverlay}>
              <Ionicons name="receipt" size={12} color={COLORS.goldBright} />
              <Text style={styles.verifiedReceiptText} numberOfLines={1}>
                Доказано с бележка ({Math.round(post.receipt.confidenceScore * 100)}% AI)
              </Text>
            </View>
          )}

          {/* Бутон за превключване „Обява/Меню vs Реалност“ */}
          {post.comparisonImageUri && (
            <TouchableOpacity
              style={styles.comparisonToggleBtn}
              onPress={() => setShowComparisonImage((prev) => !prev)}
              activeOpacity={0.85}
            >
              <Ionicons name="swap-horizontal" size={14} color={COLORS.white} />
              <Text style={styles.comparisonToggleText} numberOfLines={1}>
                {showComparisonImage
                  ? 'Покажи реалната снимка'
                  : 'Виж снимката от Обявата/Менюто'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Ценови овърлей долу на снимката */}
          <View style={styles.priceOverlayBar}>
            <View style={styles.priceLeftCol}>
              <Text style={styles.priceOverlayLabel} numberOfLines={1}>
                {isGreen ? 'ПЛАТЕНА ТОП ЦЕНА' : 'ПЛАТЕНА СУМА (КАПАН)'}
              </Text>
              <View style={styles.priceNumbersRow}>
                <Text style={[styles.priceMainValue, { color: accentColor }]}>
                  {post.pricePaid.toFixed(2)} {post.currency}
                </Text>
                {post.referencePrice && (
                  <Text style={styles.referencePriceText} numberOfLines={1}>
                    {isGreen ? 'вместо ' : 'реална: '}
                    {post.referencePrice.toFixed(2)} {post.currency}
                  </Text>
                )}
              </View>
            </View>

            {priceDiffPercent !== null && (
              <View
                style={[
                  styles.diffBadge,
                  { backgroundColor: isGreen ? COLORS.greenPrimary : COLORS.redPrimary },
                ]}
              >
                <Text style={styles.diffBadgeText}>
                  {isGreen
                    ? `-${priceDiffPercent}% СПЕСТЕНИ`
                    : `+${priceDiffPercent}% НАДЦЕНКА`}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Мини преглед на извлечен ред от касовата бележка */}
        {post.receipt && highlightedReceiptItem && (
          <View style={styles.receiptMiniStrip}>
            <View style={styles.receiptMiniLeft}>
              <Ionicons name="scan-circle" size={18} color={COLORS.goldBright} />
              <View style={{ flex: 1 }}>
                <Text style={styles.receiptMiniMerchant} numberOfLines={1}>
                  🧾 {post.receipt.merchantName} • {post.receipt.date}
                </Text>
                <Text style={styles.receiptMiniHighlight} numberOfLines={1}>
                  {highlightedReceiptItem.highlightReason ||
                    `${highlightedReceiptItem.name}: ${highlightedReceiptItem.totalPrice.toFixed(2)} €`}
                </Text>
              </View>
            </View>
            <View style={styles.viewReceiptPill}>
              <Text style={styles.viewReceiptPillText}>Бележка</Text>
              <Ionicons name="chevron-forward" size={13} color={COLORS.goldBright} />
            </View>
          </View>
        )}
      </TouchableOpacity>

      {/* Онлайн оферта (внесена от магазин) → БЕЗ линк на картата.
          Искането е ясно: на главната оферта да няма линк към магазина. Линкът
          остава в екрана на офертата, а тук картата е само за физически обекти —
          за тях води до Google Maps с адреса. */}
      {post.sourceUrl ? null : (
        /* Google Maps Адрес и Локация на обекта (само за физически обекти) */
        <TouchableOpacity
          activeOpacity={0.82}
          onPress={() =>
            openInGoogleMaps({
              placeName: post.placeName,
              address: post.address,
              city: post.city,
              latitude: post.latitude,
              longitude: post.longitude,
              googleMapsUrl: post.googleMapsUrl,
            })
          }
          style={{
            marginHorizontal: 12,
            marginBottom: 8,
            backgroundColor: 'rgba(59, 130, 246, 0.09)',
            borderWidth: 1,
            borderColor: 'rgba(59, 130, 246, 0.28)',
            borderRadius: 12,
            paddingHorizontal: 10,
            paddingVertical: 7,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 }}>
            <Ionicons name="location" size={16} color="#60A5FA" />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: COLORS.textPrimary,
                  fontSize: 11.5,
                  fontWeight: '700',
                }}
                numberOfLines={1}
              >
                {post.placeName}
                {post.address ? ` • ${post.address}` : ''} ({post.city})
                {distanceKm !== undefined ? ` • 📍 ${distanceKm.toFixed(1)} км` : ''}
              </Text>
              {post.locationAutoDetected && (
                <Text
                  style={{
                    color: COLORS.greenBright,
                    fontSize: 10,
                    fontWeight: '700',
                  }}
                  numberOfLines={1}
                >
                  ✓ Автоматично засечена GPS локация
                </Text>
              )}
            </View>
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: 'rgba(59, 130, 246, 0.18)',
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 8,
              flexShrink: 0,
            }}
          >
            <Ionicons name="map-outline" size={12} color="#60A5FA" />
            <Text
              style={{
                color: '#60A5FA',
                fontSize: 10.5,
                fontWeight: '800',
              }}
            >
              Google Maps
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Индикатори за Цена за 1 кг/л, Шринкфлация и Потвърждаване на цената днес */}
      <View
        style={{
          marginHorizontal: 12,
          marginBottom: 8,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, flex: 1 }}>
          {post.pricePerKgOrLiter && (
            <View
              style={{
                backgroundColor: COLORS.bgCardElevated,
                borderWidth: 1,
                borderColor: COLORS.borderSubtle,
                borderRadius: 8,
                paddingHorizontal: 7,
                paddingVertical: 3.5,
              }}
            >
              <Text
                style={{
                  color: COLORS.goldBright,
                  fontSize: 10.5,
                  fontWeight: '800',
                }}
              >
                ⚖️ {formatPricePerUnit(post.pricePerKgOrLiter, post.unitType)}
              </Text>
            </View>
          )}

          {post.isShrinkflation && (
            <View
              style={{
                backgroundColor: COLORS.redSoftBg,
                borderWidth: 1,
                borderColor: COLORS.redBorder,
                borderRadius: 8,
                paddingHorizontal: 7,
                paddingVertical: 3.5,
              }}
            >
              <Text
                style={{
                  color: COLORS.redBright,
                  fontSize: 10.5,
                  fontWeight: '800',
                }}
              >
                📉 Шринкфлация (намален грамаж)
              </Text>
            </View>
          )}

          {post.isFakePromo && (
            <View
              style={{
                backgroundColor: COLORS.redSoftBg,
                borderWidth: 1,
                borderColor: COLORS.redBorder,
                borderRadius: 8,
                paddingHorizontal: 7,
                paddingVertical: 3.5,
              }}
            >
              <Text
                style={{
                  color: COLORS.redBright,
                  fontSize: 10.5,
                  fontWeight: '800',
                }}
              >
                ⚠️ Фалшива промоция
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => confirmPriceValidToday(post.id)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            backgroundColor: post.userConfirmedValidToday
              ? COLORS.greenSoftBg
              : COLORS.bgCardElevated,
            borderWidth: 1,
            borderColor: post.userConfirmedValidToday
              ? COLORS.greenPrimary
              : COLORS.borderSubtle,
            borderRadius: 9,
            paddingHorizontal: 8,
            paddingVertical: 4.5,
          }}
        >
          <Ionicons
            name={
              post.userConfirmedValidToday
                ? 'checkmark-done-circle'
                : 'checkmark-circle-outline'
            }
            size={13}
            color={
              post.userConfirmedValidToday
                ? COLORS.greenBright
                : COLORS.textSecondary
            }
          />
          <Text
            style={{
              color: post.userConfirmedValidToday
                ? COLORS.greenBright
                : COLORS.textSecondary,
              fontSize: 10.5,
              fontWeight: '800',
            }}
          >
            {post.userConfirmedValidToday
              ? post.sourceUrl
                ? `Проверена в сайта днес (${post.verifiedValidTodayCount || 1})`
                : `Потвърдена днес (${post.verifiedValidTodayCount || 1})`
              : post.sourceUrl
                ? `Вярна ли е цената в сайта? (${post.verifiedValidTodayCount || 1})`
                : `Валидна днес? (${post.verifiedValidTodayCount || 1})`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Бързи реакции с 1 пръст */}
      <View style={styles.reactionsRow}>{renderReactions()}</View>

      {/* Долен бар: „Спести ми пари“, Коментари и Споделяне */}
      <View style={styles.footerRow}>
        <TouchableOpacity
          style={[
            styles.helpedButton,
            post.userMarkedHelped && {
              backgroundColor: COLORS.goldSoftBg,
              borderColor: COLORS.goldPrimary,
            },
          ]}
          onPress={() => markPostHelpedMe(post.id)}
          activeOpacity={0.8}
        >
          <Ionicons
            name={post.userMarkedHelped ? 'checkmark-circle' : 'wallet-outline'}
            size={15}
            color={post.userMarkedHelped ? COLORS.goldBright : COLORS.textPrimary}
          />
          <Text
            style={[
              styles.helpedButtonText,
              post.userMarkedHelped && { color: COLORS.goldBright },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {isGreen ? 'Спести ми пари' : 'Спаси ме от капан'} ({post.helpedCount})
          </Text>
        </TouchableOpacity>

        <View style={styles.footerRightActions}>
          <TouchableOpacity
            style={styles.iconActionBtn}
            onPress={() => router.push(`/post/${post.id}`)}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={17} color={COLORS.textSecondary} />
            <Text style={styles.iconActionText}>{post.comments.length}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.iconActionBtn}
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel="Сподели офертата"
            testID="share-post"
          >
            <Ionicons name="share-social-outline" size={17} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  codeText: { color: COLORS.accentCyan, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.5 },
  sellerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.goldBright,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    marginLeft: 4,
  },
  sellerPillText: { color: COLORS.black, fontSize: 8.5, fontWeight: '900', letterSpacing: 0.4 },
  /* Етикет „откъде е цената“ — за прозрачност, че не е потребителски отзив */
  sourcePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.accentCyanSoftBg,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    marginLeft: 4,
  },
  sourcePillText: {
    color: COLORS.accentCyan,
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  sellerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8,
    backgroundColor: 'rgba(23, 32, 54, 0.78)',
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sellerNoteText: { flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17.5 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.38,
    shadowRadius: 20,
    elevation: 8,
  },
  polarityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSubtle,
    gap: 6,
  },
  polarityLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginRight: 4,
  },
  polarityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  polarityTitle: {
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.4,
    flexShrink: 1,
  },
  bannerRightBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  platformBadge: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  platformBadgeText: {
    color: COLORS.textPrimary,
    fontSize: 10,
    fontWeight: '700',
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3.5,
    backgroundColor: 'rgba(6, 9, 17, 0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  categoryBadgeText: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  cardBodyTap: {
    paddingHorizontal: 15,
    paddingTop: 13,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 11,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    marginRight: 10,
    borderWidth: 1.5,
    borderColor: COLORS.borderStrong,
    flexShrink: 0,
  },
  authorMeta: {
    flex: 1,
    marginRight: 6,
  },
  authorNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  authorName: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  supporterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.goldSoftBg,
    borderColor: COLORS.goldBorder,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    flexShrink: 0,
  },
  supporterPillText: {
    color: COLORS.goldBright,
    fontSize: 9,
    fontWeight: '800',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2.5,
  },
  placeNameText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  /* Онлайн / физически магазин */
  shopKindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3.5,
    flexWrap: 'nowrap',
  },
  shopKindOnline: {
    color: COLORS.accentCyan,
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  shopKindPhysical: {
    color: COLORS.goldPrimary,
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  shopKindWhere: {
    color: COLORS.textMuted,
    fontSize: 10.5,
    fontWeight: '600',
    flexShrink: 1,
  },
  timeText: {
    color: COLORS.textMuted,
    fontSize: 11,
    flexShrink: 0,
  },
  postedAtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3.5,
  },
  postedAtText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  liveRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
  },
  liveChipText: { fontSize: 10, fontWeight: '800' },
  bookmarkBtn: {
    padding: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    flexShrink: 0,
  },
  postTitle: {
    color: COLORS.textPrimary,
    fontSize: 16.5,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 22.5,
    marginBottom: 6,
  },
  postDescription: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 19.5,
    marginBottom: 12,
  },
  imageContainer: {
    height: 220,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    position: 'relative',
    marginBottom: 11,
  },
  postImage: {
    width: '100%',
    height: '100%',
  },
  verifiedReceiptOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(6, 9, 17, 0.88)',
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  verifiedReceiptText: {
    color: COLORS.goldBright,
    fontSize: 10.5,
    fontWeight: '800',
    flexShrink: 1,
  },
  comparisonToggleBtn: {
    position: 'absolute',
    bottom: 60,
    right: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
  },
  comparisonToggleText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '800',
    flexShrink: 1,
  },
  priceOverlayBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(6, 9, 17, 0.90)',
    paddingHorizontal: 13,
    paddingVertical: 9.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.10)',
    gap: 8,
  },
  priceLeftCol: {
    flex: 1,
  },
  priceOverlayLabel: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  priceNumbersRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 1.5,
  },
  priceMainValue: {
    fontSize: 18.5,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  referencePriceText: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    textDecorationLine: 'line-through',
  },
  diffBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    flexShrink: 0,
  },
  diffBadgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  receiptMiniStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(252, 211, 77, 0.24)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8.5,
    marginBottom: 10,
  },
  receiptMiniLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 6,
  },
  receiptMiniMerchant: {
    color: COLORS.textPrimary,
    fontSize: 11.5,
    fontWeight: '700',
  },
  receiptMiniHighlight: {
    color: COLORS.goldBright,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  viewReceiptPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  viewReceiptPillText: {
    color: COLORS.goldBright,
    fontSize: 10.5,
    fontWeight: '800',
  },
  reactionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 15,
    paddingBottom: 11,
    gap: 7,
  },
  reactionChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingVertical: 7.5,
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  reactionEmoji: {
    fontSize: 12.5,
  },
  reactionLabel: {
    color: COLORS.textSecondary,
    fontSize: 10.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  reactionCount: {
    color: COLORS.textPrimary,
    fontSize: 10.5,
    fontWeight: '900',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 10.5,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
    backgroundColor: 'rgba(6, 9, 17, 0.45)',
    gap: 10,
  },
  helpedButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 7.5,
    borderRadius: 12,
  },
  helpedButtonText: {
    color: COLORS.textPrimary,
    fontSize: 11.5,
    fontWeight: '800',
    flexShrink: 1,
  },
  footerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  iconActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  iconActionText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
});
