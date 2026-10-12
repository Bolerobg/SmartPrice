import React, { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ReceiptModalCard } from '@/components/ReceiptModalCard';
import { PublicPostPreview } from '@/components/PublicPostPreview';
import { PriceHistoryCard } from '@/components/PriceHistoryCard';
import { COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/src/auth/AuthContext';
import { openInGoogleMaps } from '@/lib/locationService';
import { formatPostedAt, formatPostedAtLong, formatRelativeTime } from '@/src/lib/format';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const {
    posts,
    addComment,
    markPostHelpedMe,
    toggleBookmark,
    openDonationModal,
    openShare,
  } = useApp();

  const [commentText, setCommentText] = useState('');
  const [commentPhotoUri, setCommentPhotoUri] = useState<string>('');
  const [commentPrice, setCommentPrice] = useState<string>('');
  const [showPriceInput, setShowPriceInput] = useState(false);
  const [showComparison, setShowComparison] = useState(false);

  // Гост, дошъл по споделен линк: показваме публичен преглед на офертата.
  // Без това линкът водеше до екран за вход и получателят не виждаше нищо.
  if (!isAuthenticated) {
    return <PublicPostPreview id={id} />;
  }

  const post = posts.find((p) => p.id === id);

  if (!post) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.notFoundBox}>
          <Text style={styles.notFoundText}>Публикацията не е намерена.</Text>
          <TouchableOpacity
            style={styles.backBtnSimple}
            onPress={() => router.back()}
          >
            <Text style={styles.backBtnSimpleText}>Назад</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isGreen = post.polarity === 'green';
  const accentColor = isGreen ? COLORS.greenPrimary : COLORS.redPrimary;

  const pickCommentPhoto = async (fromCamera: boolean) => {
    try {
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Достъп до камерата', 'Моля, разреши достъп до камерата.');
          return;
        }
        const res = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.8,
        });
        if (!res.canceled && res.assets[0]?.uri) {
          setCommentPhotoUri(res.assets[0].uri);
          setShowPriceInput(true);
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Достъп до галерията', 'Моля, разреши достъп до снимките.');
          return;
        }
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.8,
        });
        if (!res.canceled && res.assets[0]?.uri) {
          setCommentPhotoUri(res.assets[0].uri);
          setShowPriceInput(true);
        }
      }
    } catch {
      // Игнориране
    }
  };

  const handleSendComment = () => {
    if (!commentText.trim() && !commentPhotoUri) return;
    const parsedPrice = commentPrice.trim()
      ? Number(commentPrice.replace(',', '.'))
      : undefined;

    addComment(post.id, commentText, {
      imageUri: commentPhotoUri || undefined,
      reportedPrice:
        parsedPrice && !isNaN(parsedPrice) && parsedPrice > 0
          ? parsedPrice
          : undefined,
    });
    setCommentText('');
    setCommentPhotoUri('');
    setCommentPrice('');
    setShowPriceInput(false);
  };

  // Общ лист за споделяне (виж components/ShareModal.tsx). Преди беше
  // Share.share(), което на десктоп браузър не правеше нищо.
  const handleShare = () => openShare(post);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Горен навигационен бар */}
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navIconBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>

          <View
            style={[
              styles.navPolarityPill,
              {
                backgroundColor: isGreen ? COLORS.greenSoftBg : COLORS.redSoftBg,
                borderColor: isGreen ? COLORS.greenBorder : COLORS.redBorder,
              },
            ]}
          >
            <Text
              style={[styles.navPolarityText, { color: accentColor }]}
              numberOfLines={1}
            >
              {isGreen ? '🟢 ТОП НАХОДКА' : '🔴 ЧЕРВЕН ФЛАГ • НЕ ХОДИ'}
            </Text>
          </View>

          <View style={styles.navRightRow}>
            <TouchableOpacity
              onPress={() => toggleBookmark(post.id)}
              style={styles.navIconBtn}
            >
              <Ionicons
                name={post.isBookmarked ? 'bookmark' : 'bookmark-outline'}
                size={21}
                color={post.isBookmarked ? COLORS.goldBright : COLORS.textPrimary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleShare}
              style={styles.navIconBtn}
              accessibilityRole="button"
              accessibilityLabel="Сподели офертата"
              testID="share-post"
            >
              <Ionicons name="share-social-outline" size={21} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Автор и локация */}
          <View style={styles.authorBox}>
            <Image source={{ uri: post.author.avatar }} style={styles.avatar} />
            <View style={{ flex: 1 }}>
              <View style={styles.authorNameRow}>
                <Text style={styles.authorName} numberOfLines={1}>
                  {post.author.name}
                </Text>
                {post.author.isSupporter && (
                  <View style={styles.supporterTag}>
                    <Ionicons
                      name="shield-checkmark"
                      size={11}
                      color={COLORS.goldBright}
                    />
                    <Text style={styles.supporterTagText}>VIP</Text>
                  </View>
                )}
              </View>
              <Text style={styles.locationMeta} numberOfLines={2}>
                📍 {post.placeName} • {post.city} ({post.customPlatformLabel || post.platformTag}
                {post.customCategoryLabel ? ` • ${post.customCategoryLabel}` : ''})
              </Text>
              {/* Кога е сложена офертата */}
              <View style={styles.postedAtRow}>
                <Ionicons name="calendar-outline" size={13} color={COLORS.textMuted} />
                <Text style={styles.postedAtText} numberOfLines={2}>
                  Офертата е сложена {formatPostedAtLong(post.createdAt)}
                </Text>
              </View>
            </View>
          </View>

          <Text style={styles.title}>{post.title}</Text>
          <Text style={styles.description}>{post.description}</Text>

          {/* Главна снимка + Обява vs Реалност */}
          <View style={styles.heroImageBox}>
            <Image
              source={{
                uri:
                  showComparison && post.comparisonImageUri
                    ? post.comparisonImageUri
                    : post.imageUri,
              }}
              style={styles.heroImage}
              resizeMode="cover"
            />
            {post.comparisonImageUri && (
              <TouchableOpacity
                style={styles.compareBtn}
                onPress={() => setShowComparison((p) => !p)}
              >
                <Ionicons name="swap-horizontal" size={16} color={COLORS.white} />
                <Text style={styles.compareBtnText} numberOfLines={1}>
                  {showComparison
                    ? 'Върни реалната снимка'
                    : post.comparisonLabel || 'Сравни с Обявата/Менюто'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Ценова карта */}
          <View style={styles.priceComparisonCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.priceBoxLabel}>
                {isGreen ? 'ПЛАТЕНА ТОП ЦЕНА' : 'ПЛАТЕНА СУМА (КАПАН)'}
              </Text>
              <Text style={[styles.priceBoxValue, { color: accentColor }]}>
                {post.pricePaid.toFixed(2)} {post.currency}
              </Text>
            </View>

            {post.referencePrice && (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.priceBoxLabel}>
                  {isGreen ? 'СТАНДАРТНА ЦЕНА' : 'ОЧАКВАНА РЕАЛНА ЦЕНА'}
                </Text>
                <Text style={styles.refPriceValue}>
                  {post.referencePrice.toFixed(2)} {post.currency}
                </Text>
              </View>
            )}
          </View>

          {/* Карта с местоположението на магазина и адрес в Google Maps */}
          <View
            style={{
              backgroundColor: COLORS.bgCard,
              borderWidth: 1,
              borderColor: 'rgba(59, 130, 246, 0.35)',
              borderRadius: 18,
              padding: 14,
              marginBottom: 14,
              gap: 10,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  backgroundColor: 'rgba(59, 130, 246, 0.16)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="location" size={20} color="#60A5FA" />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: COLORS.textMuted,
                    fontSize: 10.5,
                    fontWeight: '800',
                    letterSpacing: 0.4,
                  }}
                >
                  МЕСТОПОЛОЖЕНИЕ НА ОБЕКТА • GOOGLE MAPS
                </Text>
                <Text
                  style={{
                    color: COLORS.textPrimary,
                    fontSize: 15,
                    fontWeight: '800',
                    marginTop: 1,
                  }}
                >
                  {post.placeName}
                </Text>
                <Text
                  style={{
                    color: COLORS.textSecondary,
                    fontSize: 12.5,
                    marginTop: 2,
                  }}
                >
                  📍 {post.address ? `${post.address}, ` : ''}гр. {post.city}
                </Text>
                {post.locationAutoDetected && (
                  <Text
                    style={{
                      color: COLORS.greenBright,
                      fontSize: 11,
                      fontWeight: '700',
                      marginTop: 2,
                    }}
                  >
                    ✓ Автоматично засечена GPS локация при качване на снимката
                  </Text>
                )}
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
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
                backgroundColor: 'rgba(59, 130, 246, 0.18)',
                borderWidth: 1,
                borderColor: 'rgba(59, 130, 246, 0.5)',
                borderRadius: 12,
                paddingVertical: 11,
                paddingHorizontal: 14,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Ionicons name="map" size={17} color="#60A5FA" />
              <Text
                style={{
                  color: '#60A5FA',
                  fontSize: 13,
                  fontWeight: '800',
                }}
              >
                Отвори адреса в Google Maps
              </Text>
              <Ionicons name="open-outline" size={15} color="#60A5FA" />
            </TouchableOpacity>
          </View>

          {/* История на цената + „Беше ли на място?“ */}
          <PriceHistoryCard post={post} />

          {/* Пълна касова бележка (AI OCR) */}
          {post.receipt && (
            <ReceiptModalCard receipt={post.receipt} polarity={post.polarity} />
          )}

          {/* Бутон „Това ми спести пари / Спаси ме от капан!“ */}
          <TouchableOpacity
            style={[
              styles.bigHelpedBtn,
              post.userMarkedHelped && {
                backgroundColor: COLORS.goldSoftBg,
                borderColor: COLORS.goldPrimary,
              },
            ]}
            onPress={() => markPostHelpedMe(post.id)}
          >
            <Ionicons
              name={post.userMarkedHelped ? 'checkmark-circle' : 'wallet'}
              size={19}
              color={post.userMarkedHelped ? COLORS.goldBright : COLORS.white}
            />
            <Text style={styles.bigHelpedBtnText} numberOfLines={2}>
              {post.userMarkedHelped
                ? `Отбелязано! Общо спестени ${post.communitySavedBgn} € от ${post.helpedCount} души`
                : `${isGreen ? '💰 Тази оферта ми спести пари!' : '🛡️ Този сигнал ме спаси от капан!'} (${post.helpedCount})`}
            </Text>
          </TouchableOpacity>

          {/* Подкрепа за автора и платформата */}
          <TouchableOpacity
            style={styles.supportPromptStrip}
            onPress={() =>
              openDonationModal(
                `Благодарение на сигнала за „${post.placeName}“, общността вече си е спестила ${post.communitySavedBgn} €! Подкрепи SmartPrice.`
              )
            }
          >
            <Ionicons name="heart-circle" size={22} color={COLORS.goldBright} />
            <Text style={styles.supportPromptText}>
              Полезен ли ти беше този сигнал? Подкрепи SmartPrice с дарение →
            </Text>
          </TouchableOpacity>

          {/* Секция Коментари */}
          <Text style={styles.commentsHeading}>
            💬 Мнения и снимки с цени ({post.comments.length})
          </Text>

          {post.comments.length === 0 ? (
            <Text style={styles.noCommentsText}>
              Бъди първият, който ще коментира или прикачи актуална снимка с цена!
            </Text>
          ) : (
            <View style={styles.commentsList}>
              {post.comments.map((c) => (
                <View key={c.id} style={styles.commentCard}>
                  <Image source={{ uri: c.authorAvatar }} style={styles.commentAvatar} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.commentHeader}>
                      <Text style={styles.commentAuthor} numberOfLines={1}>
                        {c.authorName}
                      </Text>
                      {c.authorIsSupporter && (
                        <Ionicons
                          name="shield-checkmark"
                          size={12}
                          color={COLORS.goldBright}
                        />
                      )}
                      <Text style={styles.commentTime}>• {formatPostedAt(c.createdAt)}</Text>
                    </View>
                    <Text style={styles.commentBody}>{c.text}</Text>
                    {c.imageUri && (
                      <View style={styles.commentPhotoWrapper}>
                        <Image
                          source={{ uri: c.imageUri }}
                          style={styles.commentPhoto}
                          resizeMode="cover"
                        />
                        {c.reportedPrice !== undefined && (
                          <View style={styles.commentPriceTag}>
                            <Ionicons
                              name="pricetag"
                              size={11}
                              color={COLORS.greenBright}
                            />
                            <Text style={styles.commentPriceTagText}>
                              Заснета цена: {c.reportedPrice.toFixed(2)} €
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Превю на прикачена снимка с цена към коментара */}
        {(commentPhotoUri || showPriceInput) && (
          <View style={styles.commentAttachmentBar}>
            {commentPhotoUri ? (
              <Image
                source={{ uri: commentPhotoUri }}
                style={styles.commentThumb}
              />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.commentAttachLabel}>Цена на снимката (€):</Text>
              <TextInput
                style={styles.commentPriceInput}
                placeholder="напр. 12.50"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="decimal-pad"
                value={commentPrice}
                onChangeText={setCommentPrice}
              />
            </View>
            <TouchableOpacity
              onPress={() => {
                setCommentPhotoUri('');
                setCommentPrice('');
                setShowPriceInput(false);
              }}
              style={{ padding: 6 }}
            >
              <Ionicons name="close-circle" size={20} color={COLORS.redBright} />
            </TouchableOpacity>
          </View>
        )}

        {/* Поле за писане на коментар + бутони за снимане на цена */}
        <View style={styles.commentInputBar}>
          <TouchableOpacity
            style={styles.attachPhotoBtn}
            onPress={() => pickCommentPhoto(true)}
          >
            <Ionicons name="camera-outline" size={20} color={COLORS.greenBright} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.attachPhotoBtn}
            onPress={() => pickCommentPhoto(false)}
          >
            <Ionicons name="image-outline" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <TextInput
            style={styles.commentInput}
            placeholder="Коментирай или снимай цена..."
            placeholderTextColor={COLORS.textMuted}
            value={commentText}
            onChangeText={setCommentText}
          />
          <TouchableOpacity
            style={styles.sendCommentBtn}
            onPress={handleSendComment}
          >
            <Ionicons name="send" size={17} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  postedAtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 7,
  },
  postedAtText: {
    flex: 1,
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },

  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSubtle,
  },
  navIconBtn: {
    padding: 6,
  },
  navPolarityPill: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  navPolarityText: {
    fontSize: 11,
    fontWeight: '900',
  },
  navRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
  },
  authorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  authorNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  authorName: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  supporterTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.goldSoftBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  supporterTagText: {
    color: COLORS.goldBright,
    fontSize: 10,
    fontWeight: '800',
  },
  locationMeta: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    marginTop: 2,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 25,
    marginBottom: 8,
  },
  description: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 14,
  },
  heroImageBox: {
    height: 240,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: COLORS.bgCard,
    marginBottom: 14,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  compareBtn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.94)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  compareBtnText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '800',
  },
  priceComparisonCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    padding: 14,
    marginBottom: 8,
  },
  priceBoxLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '800',
  },
  priceBoxValue: {
    fontSize: 22,
    fontWeight: '900',
    marginTop: 2,
  },
  refPriceValue: {
    color: COLORS.textSecondary,
    fontSize: 16,
    fontWeight: '700',
    textDecorationLine: 'line-through',
    marginTop: 2,
  },
  bigHelpedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1.5,
    borderColor: COLORS.borderStrong,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  bigHelpedBtnText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  supportPromptStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 14,
    padding: 12,
    marginBottom: 18,
  },
  supportPromptText: {
    flex: 1,
    color: COLORS.goldBright,
    fontSize: 12,
    fontWeight: '700',
  },
  commentsHeading: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
  },
  noCommentsText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  commentsList: {
    gap: 10,
  },
  commentCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    padding: 12,
  },
  commentAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  commentAuthor: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  commentTime: {
    color: COLORS.textMuted,
    fontSize: 11,
  },
  commentBody: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  commentPhotoWrapper: {
    marginTop: 8,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  commentPhoto: {
    width: '100%',
    height: 150,
  },
  commentPriceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(9, 13, 22, 0.92)',
  },
  commentPriceTagText: {
    color: COLORS.greenBright,
    fontSize: 12,
    fontWeight: '800',
  },
  commentAttachmentBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: COLORS.bgCard,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderStrong,
  },
  commentThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  commentAttachLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  commentPriceInput: {
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    color: COLORS.greenBright,
    fontSize: 13,
    fontWeight: '800',
  },
  commentInputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: COLORS.bgSecondary,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
  },
  attachPhotoBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentInput: {
    flex: 1,
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: COLORS.textPrimary,
    fontSize: 13,
  },
  sendCommentBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.accentIndigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    marginBottom: 12,
  },
  backBtnSimple: {
    backgroundColor: COLORS.bgCard,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  backBtnSimpleText: {
    color: COLORS.textPrimary,
  },
});
