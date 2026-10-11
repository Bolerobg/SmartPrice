import React, { useState } from 'react';
import {
  Image,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CATEGORIES, COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { openInGoogleMaps } from '@/lib/locationService';
import { PostItem, ReactionKey } from '@/types';

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

  const handleShare = async () => {
    try {
      const verdictText = isGreen ? '🟢 ТОП НАХОДКА' : '🔴 ЧЕРВЕН ФЛАГ (НЕ ХОДИ!)';
      await Share.share({
        message: `${verdictText} в SmartPrice!\n📍 ${post.placeName} (${post.city})\n💬 ${post.title}\n💳 Платено: ${post.pricePaid.toFixed(2)} ${post.currency}${post.receipt ? ' (Доказано с касова бележка 🧾)' : ''}`,
      });
    } catch {
      // Игнориране
    }
  };

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
        onPress={() => router.push(`/post/${post.id}`)}
        style={styles.cardBodyTap}
      >
        <View style={styles.headerRow}>
          <Image source={{ uri: post.author.avatar }} style={styles.avatar} />
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
              <Text style={styles.timeText} numberOfLines={1}>
                • {post.createdAt}
              </Text>
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
        <Text style={styles.postDescription} numberOfLines={3}>
          {post.description}
        </Text>

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
                    `${highlightedReceiptItem.name}: ${highlightedReceiptItem.totalPrice.toFixed(2)} лв.`}
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

      {/* Google Maps Адрес и Локация на обекта */}
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
                ⚖️ {post.pricePerKgOrLiter.toFixed(2)} лв./
                {post.unitType === 'ml' || post.unitType === 'l' ? 'л' : 'кг'}
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
              ? `Потвърдена днес (${post.verifiedValidTodayCount || 1})`
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

          <TouchableOpacity style={styles.iconActionBtn} onPress={handleShare}>
            <Ionicons name="share-social-outline" size={17} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 20,
    borderWidth: 1.2,
    marginBottom: 16,
    overflow: 'hidden',
  },
  polarityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSubtle,
    gap: 6,
  },
  polarityLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 4,
  },
  polarityDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  polarityTitle: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  bannerRightBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
  },
  platformBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 7,
  },
  platformBadgeText: {
    color: COLORS.textPrimary,
    fontSize: 10,
    fontWeight: '700',
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 7,
  },
  categoryBadgeText: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: '600',
  },
  cardBodyTap: {
    paddingHorizontal: 13,
    paddingTop: 11,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 9,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginRight: 9,
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
    gap: 5,
  },
  authorName: {
    color: COLORS.textPrimary,
    fontSize: 13.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  supporterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
    backgroundColor: COLORS.goldSoftBg,
    borderColor: COLORS.goldBorder,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 6,
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
    gap: 3,
    marginTop: 2,
  },
  placeNameText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  timeText: {
    color: COLORS.textMuted,
    fontSize: 11,
    flexShrink: 0,
  },
  bookmarkBtn: {
    padding: 5,
    flexShrink: 0,
  },
  postTitle: {
    color: COLORS.textPrimary,
    fontSize: 15.5,
    fontWeight: '800',
    lineHeight: 21,
    marginBottom: 5,
  },
  postDescription: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18.5,
    marginBottom: 10,
  },
  imageContainer: {
    height: 210,
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: COLORS.bgSecondary,
    position: 'relative',
    marginBottom: 10,
  },
  postImage: {
    width: '100%',
    height: '100%',
  },
  verifiedReceiptOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(9, 13, 22, 0.86)',
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 10,
  },
  verifiedReceiptText: {
    color: COLORS.goldBright,
    fontSize: 10.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  comparisonToggleBtn: {
    position: 'absolute',
    bottom: 56,
    right: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(99, 102, 241, 0.92)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  comparisonToggleText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  priceOverlayBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(9, 13, 22, 0.9)',
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 8,
  },
  priceLeftCol: {
    flex: 1,
  },
  priceOverlayLabel: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  priceNumbersRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 1,
  },
  priceMainValue: {
    fontSize: 17.5,
    fontWeight: '900',
  },
  referencePriceText: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    textDecorationLine: 'line-through',
  },
  diffBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 8,
    flexShrink: 0,
  },
  diffBadgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: '900',
  },
  receiptMiniStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(245, 158, 11, 0.09)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.28)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 9,
  },
  receiptMiniLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
    marginRight: 6,
  },
  receiptMiniMerchant: {
    color: COLORS.textPrimary,
    fontSize: 11,
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
    fontWeight: '700',
  },
  reactionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 13,
    paddingBottom: 9,
    gap: 6,
  },
  reactionChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingVertical: 6.5,
    paddingHorizontal: 5,
    borderRadius: 10,
  },
  reactionEmoji: {
    fontSize: 12,
  },
  reactionLabel: {
    color: COLORS.textSecondary,
    fontSize: 10.5,
    fontWeight: '600',
    flexShrink: 1,
  },
  reactionCount: {
    color: COLORS.textPrimary,
    fontSize: 10.5,
    fontWeight: '800',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    gap: 8,
  },
  helpedButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  helpedButtonText: {
    color: COLORS.textPrimary,
    fontSize: 11.5,
    fontWeight: '700',
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
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  iconActionText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
});
