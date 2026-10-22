import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '@/src/lib/navigation';
import { ReceiptModalCard } from '@/components/ReceiptModalCard';
import { PublicPostPreview } from '@/components/PublicPostPreview';
import { PriceHistoryCard } from '@/components/PriceHistoryCard';
import { ObjectSignalsCard } from '@/components/ObjectSignalsCard';
import { ShopPriceCompare } from '@/components/ShopPriceCompare';
import { PriceDuelCard } from '@/components/PriceDuelCard';
import { Avatar } from '@/components/Avatar';
import { COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/src/auth/AuthContext';
import { openInGoogleMaps } from '@/lib/locationService';
import { formatPostedAt, formatPostedAtLong, formatRelativeTime } from '@/src/lib/format';
import { api, loadSimilarOffers } from '@/src/api/client';
import type { SimilarOffer } from '@/src/api/client';
import type { PostItem, PriceDuel } from '@/types';


export default function PostDetailScreen() {
  /**
   * `duel=1` идва от чипа „по-скъпо другаде“ в лентата: отваряме ТАЗИ оферта и
   * веднага слизаме до дуелната карта, за да види човекът цялото сравнение, а не
   * да го пращаме направо в друга оферта без контекст.
   */
  const { id, duel: duelParam } = useLocalSearchParams<{ id: string; duel?: string }>();
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

  // „Същият продукт другаде“: другите цени, които общността е намерила за
  // същия продукт. Показваме ги, за да може човекът да сравни и да избере
  // най-изгодното, вместо да вижда само една оферта.
  const [similar, setSimilar] = useState<{ count: number; items: SimilarOffer[] } | null>(null);

  /**
   * ⚔️ Ценовата дуелна карта: същият продукт при други доставчици + присъдата
   * за нашата цена (най-ниска / близка / по-скъпа / чист обир). Идва заедно с
   * „същият продукт другаде“ — единствената разлика е, че тук има сметка.
   */
  const [duelCard, setDuelCard] = useState<PriceDuel | null>(null);

  /** Позицията на дуелната карта в скрола (за автоматично слизане до нея). */
  const scrollRef = useRef<ScrollView>(null);
  const duelY = useRef(0);
  const duelScrolled = useRef(false);

  useEffect(() => {
    let alive = true;
    if (!isAuthenticated || !id) return;
    loadSimilarOffers(String(id))
      .then((r) => {
        if (alive && r.count > 0) setSimilar({ count: r.count, items: r.items });
        if (alive) setDuelCard(r.duel ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, isAuthenticated]);

  /**
   * Ако публикацията не е в заредената лента — взимаме я от сървъра по id.
   *
   * Защо: екранът търсеше само в `posts` (общата лента). Радарът вече тегли
   * СВОЯТА филтрирана лента (червени/зелени), значи при натискане на оферта от
   * „Червени флагове“ публикацията не беше в общия списък и екранът казваше
   * „Публикацията не е намерена“, макар тя да съществува (проверено 19.10.2026).
   */
  const [remotePost, setRemotePost] = useState<PostItem | null>(null);
  const [remoteTried, setRemoteTried] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const inLocalList = posts.some((p) => p.id === id);

  useEffect(() => {
    if (!id || inLocalList) {
      setRemoteTried(true);
      return;
    }
    let alive = true;
    setRemoteTried(false);
    api
      .post(String(id))
      .then((r) => {
        if (alive) setRemotePost(r.post);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setRemoteTried(true);
      });
    return () => {
      alive = false;
    };
  }, [id, inLocalList, retryKey]);

  // Гост, дошъл по споделен линк: показваме публичен преглед на офертата.
  // Без това линкът водеше до екран за вход и получателят не виждаше нищо.
  if (!isAuthenticated) {
    return <PublicPostPreview id={id} />;
  }

  const post = posts.find((p) => p.id === id) ?? remotePost;

  /**
   * Има ли ИСТИНСКИ линк към продукта в онлайн магазина.
   * При цените, внесени от агрегатор (supermarketbg.eu), сървърът връща shopUrl=null —
   * тогава не показваме бутон за външния сайт, защото линкът води до чуждия каталог,
   * а не до продукта в магазина.
   */
  /**
   * 📍 Място, внесено от Google Maps (картата „Еврото“ или обиколката).
   *
   * Това НЕ е магазин: няма продукт и няма цена, която да се провери. Затова
   * му даваме свои бутони — „Виж къде е на картата“ и „Навигация до там“ —
   * вместо „Провери цената в магазина“ (което за място няма смисъл).
   */
  const isMapPlace = post?.source === 'maps' || post?.source === 'maps-roam';

  const hasShopLink = Boolean(post?.shopUrl) && !isMapPlace;
  /**
   * 🛒 Оферта, внесена от каталозите на веригите (Метро, Кауфланд…).
   *
   * Опознава се по ИЗТОЧНИКА и етикета, не по линка: линкът към чуждия сайт е
   * премахнат (по искане на потребителя), затова не може да служи за проверка.
   */
  const isCatalogImport =
    post?.source === 'scraper' || post?.platformTag === 'Супермаркет';


  // Още теглим от сървъра — не показваме „не е намерена“ преждевременно.
  if (!post && !remoteTried) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.notFoundBox}>
          <ActivityIndicator size="small" color={COLORS.greenBright} />
        </View>
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.notFoundBox}>
          <Text style={styles.notFoundText}>Публикацията не е намерена.</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 12.5, textAlign: 'center', marginBottom: 10 }}>
            Ако връзката е слаба, опитай пак — публикацията може да не е стигнала до теб.
          </Text>
          <TouchableOpacity
            style={styles.backBtnSimple}
            onPress={() => {
              setRemotePost(null);
              setRemoteTried(false);
              setRetryKey((k) => k + 1);
            }}
          >
            <Text style={styles.backBtnSimpleText}>🔄 Опитай пак</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.backBtnSimple, { marginTop: 8 }]}
            onPress={() => goBack(router)}
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
          <TouchableOpacity onPress={() => goBack(router)} style={styles.navIconBtn}>
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
              {isMapPlace
                ? (isGreen ? '📍 ЧЕСТНО МЯСТО' : '📍 ЛОШИ ОТЗИВИ • ВНИМАВАЙ')
                : (isGreen ? '🟢 ТОП НАХОДКА' : '🔴 ЧЕРВЕН ФЛАГ • НЕ ХОДИ')}
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
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Автор и локация */}
          <View style={styles.authorBox}>
            <Avatar uri={post.author.avatar} name={post.author.name} size={44} />
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

          {/* ID на офертата — по него се търси в приложението */}
          {post.code ? (
            <View style={styles.codeBox}>
              <Ionicons name="pricetag-outline" size={13} color={COLORS.accentCyan} />
              <Text style={styles.codeLabel}>ID на офертата:</Text>
              <Text style={styles.codeValue}>{post.code}</Text>
              <Text style={styles.codeHint}>напиши го в търсачката, за да я намериш пак</Text>
            </View>
          ) : null}

          {post.sellerType === 'private' ? (
            <View style={styles.sellerBox}>
              <View style={styles.sellerPill}>
                <Ionicons name="person-outline" size={11} color={COLORS.black} />
                <Text style={styles.sellerPillText}>ЧАСТНО ЛИЦЕ</Text>
              </View>
              {post.sellerNote ? <Text style={styles.sellerNote}>{post.sellerNote}</Text> : null}
              {post.sellerContact ? (
                <Text style={styles.sellerContact}>Контакт: {post.sellerContact}</Text>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.description}>{post.description}</Text>

          {/* ⚔️ Умната ценова проверка: същият продукт при друг доставчик,
              с колко е по-евтин/скъп и какво значи това за нашата цена. */}
          {duelCard ? (
            <View
              onLayout={(e) => {
                duelY.current = e.nativeEvent.layout.y;
                // Слизаме до картата само веднъж и само ако сме дошли от чипа.
                if (duelParam === '1' && !duelScrolled.current) {
                  duelScrolled.current = true;
                  setTimeout(() => {
                    scrollRef.current?.scrollTo({
                      y: Math.max(0, duelY.current - 12),
                      animated: true,
                    });
                  }, 320);
                }
              }}
            >
              <PriceDuelCard
                duel={duelCard}
                myCurrency={post.currency}
                onOpen={(twinId) => router.push(`/post/${twinId}`)}
              />
            </View>
          ) : null}

          {/* ⚠️ Само ПОДОБНИ оферти (без присъда!).
              Този списък търси по думи в заглавието и затова може да хване друг
              вариант — друг цвят, друг модел, друг пол. Затова тук НЯМА
              „най-евтино“ и няма твърдения: само заглавие, магазин и цена, за
              да провери човекът сам. Истинското сравнение е в „Ценова проверка“
              горе (то иска същия модел, цвят, размер, пол и ДРУГ доставчик). */}
          {!duelCard && similar && similar.count > 0 ? (
            <View style={styles.similarBox}>
              <View style={styles.similarHeader}>
                <Ionicons name="swap-horizontal" size={16} color={COLORS.accentCyan} />
                <Text style={styles.similarTitle}>Подобни оферти ({similar.count})</Text>
              </View>
              <Text style={styles.similarHint}>
                Приличат си по заглавие, но може да са друг вариант, цвят или модел — провери сам, преди да
                сравняваш цени. Натисни, за да отвориш офертата.
              </Text>
              {similar.items.slice(0, 8).map((s) => {
                const price = Number(s.price);
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.similarRow}
                    onPress={() => router.push(`/post/${s.id}`)}
                    accessibilityRole="button"
                  >
                    {s.image_url ? (
                      <Image source={{ uri: s.image_url }} style={styles.similarThumb} />
                    ) : (
                      <View style={[styles.similarThumb, styles.similarThumbEmpty]}>
                        <Ionicons name="image-outline" size={16} color={COLORS.textMuted} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.similarRowTitle} numberOfLines={1}>
                        {s.title}
                      </Text>
                      <Text style={styles.similarRowMeta} numberOfLines={1}>
                        {s.source === 'scraper' ? '🌐 ' : '📍 '}
                        {s.place_name || ''}
                        {s.city ? ` • ${s.city}` : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.similarPrice}>{price.toFixed(2)} €</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
              <Text style={styles.similarFoot}>Твоята цена: {post.pricePaid.toFixed(2)} €</Text>
            </View>
          ) : null}

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
              resizeMode="contain"
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
          <View style={[styles.priceComparisonCard, isMapPlace && { display: 'none' }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.priceBoxLabel}>
                {isCatalogImport
                  ? 'ЦЕНА В ВЕРИГАТА'
                  : isGreen
                    ? 'ПЛАТЕНА ТОП ЦЕНА'
                    : 'ПЛАТЕНА СУМА (КАПАН)'}
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
                <Ionicons name={hasShopLink ? 'cart' : 'location'} size={20} color="#60A5FA" />
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
                  {isMapPlace
                    ? 'МЯСТО ОТ GOOGLE MAPS'
                    : hasShopLink
                      ? 'ОНЛАЙН МАГАЗИН'
                      : isCatalogImport
                        ? 'ВЕРИГА • ГРАД'
                        : 'МЕСТОПОЛОЖЕНИЕ НА ОБЕКТА • GOOGLE MAPS'}
                </Text>
                <Text
                  style={{
                    color: COLORS.textPrimary,
                    fontSize: 15,
                    fontWeight: '800',
                    marginTop: 1,
                  }}
                >
                  {hasShopLink ? 'Продукт в онлайн магазин' : post.placeName}
                </Text>
                {/* Само за физически обекти: адресът. За онлайн не показваме сайта —
                    по желание на потребителя (името на магазина не се показва в UI). */}
                {!post.sourceUrl || isCatalogImport || isMapPlace ? (
                  <Text
                    style={{
                      color: COLORS.textSecondary,
                      fontSize: 12.5,
                      marginTop: 2,
                    }}
                  >
                    {isMapPlace
                      ? `📍 ${post.address ? `${post.address}, ` : ''}гр. ${post.city}`
                      : isCatalogImport
                        ? `📍 ${post.placeName} • гр. ${post.city}`
                        : `📍 ${post.address ? `${post.address}, ` : ''}гр. ${post.city}`}
                  </Text>
                ) : null}
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

            {/* Сверка с магазина — общ компонент, за да е еднакво и при гостите */}
            {/* Сверка с магазина: показва се САМО когато има истински линк към
                онлайн магазин. За внесените от веригите цени няма какво да
                проверим (и не искаме да четем чуждия сайт). */}
            {hasShopLink ? (
              <ShopPriceCompare postId={post.id} ourPriceEur={post.pricePaid} />
            ) : null}

            {/* Бутонът за външен линк съществува САМО при истински линк към продукта.
                При внесени от агрегатор цени (supermarketbg.eu) няма как да дадем
                линк към конкретния магазин, затова по-добре без бутон, отколкото
                бутон, който изхвърля човека в чуждия сайт. */}
            {isMapPlace ? (
              <View style={{ gap: 8 }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18 }}>
                  Това е място, не онлайн магазин — цена не се проверява. Виж го на картата
                  или пусни навигация до там.
                </Text>
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
                  <Ionicons name="map-outline" size={17} color="#60A5FA" />
                  <Text style={{ color: '#60A5FA', fontSize: 13, fontWeight: '800' }}>
                    Виж къде е на картата
                  </Text>
                </TouchableOpacity>
                {post.latitude && post.longitude ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      const url = `https://www.google.com/maps/dir/?api=1&destination=${post.latitude},${post.longitude}`;
                      Linking.openURL(url).catch(() =>
                        openInGoogleMaps({
                          placeName: post.placeName,
                          address: post.address,
                          city: post.city,
                          latitude: post.latitude,
                          longitude: post.longitude,
                          googleMapsUrl: post.googleMapsUrl,
                        })
                      );
                    }}
                    style={{
                      backgroundColor: COLORS.greenSoftBg,
                      borderWidth: 1,
                      borderColor: COLORS.greenBorder,
                      borderRadius: 12,
                      paddingVertical: 11,
                      paddingHorizontal: 14,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                  >
                    <Ionicons name="navigate-outline" size={17} color={COLORS.greenBright} />
                    <Text style={{ color: COLORS.greenBright, fontSize: 13, fontWeight: '800' }}>
                      Навигация до там
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : !hasShopLink && isCatalogImport ? null : (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                // Има линк към продукта → отваряме магазина. Иначе → картата с локацията.
                if (hasShopLink && post.shopUrl) {
                  Linking.openURL(post.shopUrl).catch(() =>
                    openInGoogleMaps({
                      placeName: post.placeName,
                      address: post.address,
                      city: post.city,
                      latitude: post.latitude,
                      longitude: post.longitude,
                      googleMapsUrl: post.googleMapsUrl,
                    })
                  );
                  return;
                }
                openInGoogleMaps({
                  placeName: post.placeName,
                  address: post.address,
                  city: post.city,
                  latitude: post.latitude,
                  longitude: post.longitude,
                  googleMapsUrl: post.googleMapsUrl,
                });
              }}
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
              <Ionicons name={hasShopLink ? 'cart-outline' : 'map'} size={17} color="#60A5FA" />
              <Text
                style={{
                  color: '#60A5FA',
                  fontSize: 13,
                  fontWeight: '800',
                }}
              >
                {hasShopLink ? 'Отвори продукта в магазина' : 'Отвори адреса в Google Maps'}
              </Text>
              <Ionicons name="open-outline" size={15} color="#60A5FA" />
            </TouchableOpacity>
            )}
          </View>

          {/* История на цената + „Беше ли на място?“ — САМО за оферти с цена.
              При места от Google Maps цена не се следи, затова картата не се показва. */}
          {isMapPlace ? null : <PriceHistoryCard post={post} />}

          {/*
            🛒 Оферта от ВЕРИГА (внесена цена): казваме честно как стои историята.
            Сверяваме цените на веригите наново всяка седмица — при промяна редът
            влиза в историята и човекът ще види с колко е паднала. Досега не
            обещаваме графика, която още няма данни.
          */}
          {post.source === 'scraper' && (post.priceHistory ?? []).length < 2 ? (
            <Text
              style={{
                color: COLORS.textMuted,
                fontSize: 12,
                marginTop: 6,
                lineHeight: 17,
              }}
            >
              🔄 Тази цена идва от внесените цени на веригите (Метро, Кауфланд, Билла…).
              Сверяваме ги наново всяка седмица — щом цената се промени, историята се появява
              тук и ще виждаш с колко е паднала.
            </Text>
          ) : null}

          {/* 🏪 Към кой обект е и колко души са сигнализирали за него */}
          <ObjectSignalsCard postId={String(id)} />

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

          {(post.signalCount ?? 1) > 1 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <Ionicons name="people-outline" size={15} color={COLORS.textSecondary} />
              <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>
                {post.signalCount} души сигнализират за това
              </Text>
            </View>
          )}

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
                  <Avatar uri={c.authorAvatar} name={c.authorName} size={34} />
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
                          resizeMode="contain"
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
  /* „Същият продукт другаде“ */
  similarBox: {
    marginTop: 16,
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(148, 163, 184, 0.08)',
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
  },
  similarHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  similarTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '800' },
  similarHint: { color: COLORS.textMuted, fontSize: 11.5, marginTop: 4, marginBottom: 6, lineHeight: 16 },
  similarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 163, 184, 0.14)',
  },
  similarThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
  },
  similarThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  similarRowTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700' },
  similarRowMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  similarPrice: { color: COLORS.accentCyan, fontSize: 14, fontWeight: '800' },
  similarBest: {
    color: COLORS.greenPrimary,
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  similarFoot: { color: COLORS.textSecondary, fontSize: 11.5, marginTop: 10, fontWeight: '700' },

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
    gap: 11,
    marginBottom: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 15,
  },
  authorNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  authorName: {
    color: COLORS.textPrimary,
    fontSize: 15.5,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  supporterTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  supporterTagText: {
    color: COLORS.goldBright,
    fontSize: 10,
    fontWeight: '800',
  },
  locationMeta: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    marginTop: 2.5,
  },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  codeLabel: { color: COLORS.textMuted, fontSize: 11.5, fontWeight: '700' },
  codeValue: { color: COLORS.accentCyan, fontSize: 13, fontWeight: '900', letterSpacing: 0.6 },
  codeHint: { color: COLORS.textMuted, fontSize: 10.5, fontStyle: 'italic' },
  sellerBox: {
    marginTop: 8,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  sellerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.goldBright,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    alignSelf: 'flex-start',
  },
  sellerPillText: { color: COLORS.black, fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  sellerNote: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18 },
  sellerContact: { color: COLORS.goldBright, fontSize: 12, fontWeight: '800' },
  title: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.4,
    lineHeight: 26,
    marginBottom: 8,
  },
  description: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 21.5,
    marginBottom: 14,
  },
  heroImageBox: {
    height: 248,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
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
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    paddingHorizontal: 13,
    paddingVertical: 8.5,
    borderRadius: 14,
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    padding: 16,
    marginBottom: 10,
  },
  priceBoxLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  priceBoxValue: {
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: -0.5,
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
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    marginTop: 8,
    marginBottom: 12,
  },
  bigHelpedBtnText: {
    color: COLORS.textPrimary,
    fontSize: 13.5,
    fontWeight: '800',
  },
  supportPromptStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 16,
    padding: 13,
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
    fontSize: 16.5,
    fontWeight: '800',
    letterSpacing: -0.2,
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
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 13,
  },
  commentAvatar: {
    width: 34,
    height: 34,
    borderRadius: 12,
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
    lineHeight: 18.5,
  },
  commentPhotoWrapper: {
    marginTop: 8,
    borderRadius: 14,
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
    backgroundColor: 'rgba(6, 9, 17, 0.90)',
  },
  commentPriceTagText: {
    color: '#6ffbbe',
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
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.bgSecondary,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
  },
  attachPhotoBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentInput: {
    flex: 1,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 9.5,
    color: COLORS.textPrimary,
    fontSize: 13.5,
  },
  sendCommentBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
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
    borderRadius: 12,
  },
  backBtnSimpleText: {
    color: COLORS.textPrimary,
  },
});
