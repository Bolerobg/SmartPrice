import React, { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { EASY, isCatalogOffer } from '@/constants/easyDesign';
import { useApp } from '@/context/AppContext';
import { PostItem } from '@/types';

/**
 * 🧓 ЕДРА КАРТА НА ОФЕРТА („Лесен режим“).
 *
 * Защо е направена така:
 *   • ЕДНА идея на карта — снимка, име, цена, два бутона. Никакви дребни
 *     икони и скрити жестове: каквото не се вижда, не съществува.
 *   • ЦЕНАТА Е НАЙ-ЕДРОТО (46 px). Човек, който не разбира от приложения,
 *     търси с очи „колко пари“ — това трябва да се вижда от два метра.
 *   • „вместо 29.99 €“ стои до цената, а спестеното е изписано с думи
 *     („СПЕСТЯВАШ 13.00 €“), а не само като „−63%“ — процентите са абстрактни,
 *     парите не са.
 *   • Бутоните са 60 px високи и с ГЛАГОЛ, който казва какво ще стане
 *     („Спестих пари“), вместо икона с две думи под нея.
 *   • Цялата карта се натиска и отваря офертата — не е нужно да се целиш в
 *     малък надпис.
 *
 * Какво НЕ показваме (за да остане просто): реакциите (5 дребни балончета),
 * „Топ Удар“, адрес, разстояние, шринкфлация. Тези неща са в страницата на
 * офертата — който иска, ги отваря.
 */
export const EasyPostCard: React.FC<{ post: PostItem; onOpenHint?: string }> = ({ post }) => {
  const router = useRouter();
  const { toggleBookmark, markPostHelpedMe, openAuthPrompt } = useApp();

  const [helped, setHelped] = useState<number>(post.helpedCount ?? 0);
  const [saved, setSaved] = useState<boolean>(Boolean(post.isBookmarked));
  const [busy, setBusy] = useState(false);

  const isGreen = post.polarity === 'green';
  const catalog = isCatalogOffer(post.source);

  /** Колко пари се спестяват (или се надплащат) спрямо обичайната цена. */
  const oldPrice = typeof post.referencePrice === 'number' ? post.referencePrice : null;
  const diffEuro = oldPrice !== null ? Math.abs(oldPrice - post.pricePaid) : null;
  const diffPercent =
    oldPrice !== null && oldPrice > 0
      ? Math.round(Math.abs(1 - post.pricePaid / oldPrice) * 100)
      : null;

  const verifiedToday = post.verifiedValidTodayCount ?? 0;

  const open = () => router.push(`/post/${post.id}` as never);

  const onHelped = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const total = await markPostHelpedMe(post.id);
      if (typeof total === 'number') setHelped(total);
      else setHelped((n) => n + 1);
    } catch {
      // не е входен → каним да влезе, вместо да мълчим
      openAuthPrompt?.();
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await toggleBookmark(post.id);
      setSaved((v) => !v);
    } catch {
      openAuthPrompt?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity activeOpacity={0.92} onPress={open} style={styles.card}>
      {/* ---------------------------------------------------------- Снимка */}
      <View style={styles.imageWrap}>
        {post.imageUri ? (
          <Image source={{ uri: post.imageUri }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.imageEmpty]}>
            <Ionicons name="image-outline" size={44} color={COLORS.textMuted} />
            <Text style={styles.imageEmptyText}>Няма снимка</Text>
          </View>
        )}

        {/* Етикетът казва ОТКЪДЕ е цената — това е въпрос на доверие, не украса. */}
        <View style={[styles.sourcePill, catalog ? styles.sourcePillCatalog : styles.sourcePillUser]}>
          <Ionicons
            name={catalog ? 'storefront' : 'person'}
            size={16}
            color={catalog ? COLORS.accentCyan : COLORS.greenBright}
          />
          <Text style={[styles.sourceText, { color: catalog ? COLORS.accentCyan : COLORS.greenBright }]}>
            {catalog ? 'ЦЕНА В МАГАЗИНА' : 'ЦЕНА ОТ ЧОВЕК'}
          </Text>
        </View>
      </View>

      {/* ------------------------------------------------------------ Тяло */}
      <View style={styles.body}>
        {/* Къде: едро и първо, защото човек пита „къде е това?“ */}
        <View style={styles.placeRow}>
          <Ionicons name="location" size={20} color={COLORS.textSecondary} />
          <Text style={styles.placeText} numberOfLines={1}>
            {post.placeName || post.city || 'Неизвестно място'}
          </Text>
        </View>

        <Text style={styles.title} numberOfLines={2}>
          {post.title}
        </Text>

        {/* -------------------------------------------------------- Цената */}
        <View style={styles.priceBlock}>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{post.pricePaid.toFixed(2)}</Text>
            <Text style={styles.currency}>{post.currency || '€'}</Text>
          </View>
          {oldPrice !== null && (
            <Text style={styles.oldPrice}>вместо {oldPrice.toFixed(2)} €</Text>
          )}
        </View>

        {diffEuro !== null && diffEuro >= 0.01 && (
          <View style={[styles.savingsBadge, isGreen ? styles.savingsGreen : styles.savingsRed]}>
            <Ionicons
              name={isGreen ? 'trending-down' : 'trending-up'}
              size={22}
              color={COLORS.white}
            />
            <Text style={styles.savingsText}>
              {isGreen
                ? `СПЕСТЯВАШ ${diffEuro.toFixed(2)} €`
                : `НАДПЛАЩАШ ${diffEuro.toFixed(2)} €`}
              {diffPercent !== null ? ` (${diffPercent}%)` : ''}
            </Text>
          </View>
        )}

        {/* Доверие: казваме го с думи, без дребни икони и съкращения. */}
        {verifiedToday > 0 ? (
          <View style={styles.trustRow}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.greenBright} />
            <Text style={styles.trustText}>
              {verifiedToday === 1
                ? 'Днес 1 човек каза, че цената е вярна'
                : `Днес ${verifiedToday} души казаха, че цената е вярна`}
            </Text>
          </View>
        ) : null}

        {/* Отварянето е с думи, а не със стрелка без обяснение. Стои ПО-ГОРЕ,
            защото долу вдясно „виси“ бутонът „↑ Нагоре“ и застъпваше надписа. */}
        <TouchableOpacity activeOpacity={0.85} onPress={open} style={styles.moreBtn}>
          <Text style={styles.moreText}>Виж подробности</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.accentCyan} />
        </TouchableOpacity>

        {/* ------------------------------------------------------- Бутоните */}
        {/* Бутоните са ПОДРЕДЕНИ ЕДИН ПОД ДРУГ (не рамо до рамо): в два
            половинчати бутона надписът се съкращаваше („Спестих пари“ →
            „Спести…“), а за човек, който не разбира, съкратен надпис е
            неразбираем. Така всеки бутон е по цялата ширина и се чете цял. */}
        <View style={styles.buttons}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onHelped}
            style={[styles.button, styles.buttonPrimary, isGreen ? null : styles.buttonRed]}
          >
            <Ionicons name="happy-outline" size={26} color={COLORS.white} />
            <Text style={styles.buttonText} numberOfLines={1}>
              {isGreen ? 'Спестих пари' : 'Спаси ме от капан'}
              {helped > 0 ? ` (${helped})` : ''}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onSave}
            style={[styles.button, styles.buttonGhost, saved ? styles.buttonSaved : null]}
          >
            <Ionicons
              name={saved ? 'bookmark' : 'bookmark-outline'}
              size={26}
              color={saved ? COLORS.goldBright : COLORS.textPrimary}
            />
            <Text style={[styles.buttonText, styles.buttonGhostText]}>
              {saved ? 'Запазена в любими' : 'Запази в любими'}
            </Text>
          </TouchableOpacity>
        </View>

      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.bgCardElevated,
    borderRadius: EASY.radius.card,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    marginBottom: EASY.space.lg,
    overflow: 'hidden',
  },
  imageWrap: { position: 'relative', backgroundColor: COLORS.bgSecondary },
  image: { width: '100%', height: EASY.imageHeight, borderTopLeftRadius: EASY.radius.card, borderTopRightRadius: EASY.radius.card },
  imageEmpty: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  imageEmptyText: { color: COLORS.textMuted, fontSize: EASY.font.label, fontWeight: '700' },
  sourcePill: {
    position: 'absolute',
    top: EASY.space.sm,
    left: EASY.space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: EASY.radius.pill,
  },
  sourcePillCatalog: { backgroundColor: 'rgba(6, 9, 17, 0.86)', borderWidth: 1, borderColor: COLORS.accentCyanBorder },
  sourcePillUser: { backgroundColor: 'rgba(6, 9, 17, 0.86)', borderWidth: 1, borderColor: COLORS.greenBorder },
  sourceText: { fontSize: EASY.font.hint, fontWeight: '900', letterSpacing: 0.3 },

  body: { padding: EASY.space.md, gap: EASY.space.sm },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  placeText: { flex: 1, color: COLORS.textSecondary, fontSize: EASY.font.label, fontWeight: '800' },
  title: { color: COLORS.textPrimary, fontSize: EASY.font.title, fontWeight: '800', lineHeight: 30 },

  priceBlock: { marginTop: EASY.space.xs },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  price: { color: COLORS.white, fontSize: EASY.font.price, fontWeight: '900', letterSpacing: -1.5 },
  currency: { color: COLORS.textPrimary, fontSize: EASY.font.title, fontWeight: '800', marginBottom: 8 },
  oldPrice: { color: COLORS.textSecondary, fontSize: EASY.font.priceOld, fontWeight: '700', marginTop: 2 },

  savingsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: EASY.radius.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: EASY.space.xs,
  },
  savingsGreen: { backgroundColor: COLORS.greenDark },
  savingsRed: { backgroundColor: COLORS.redDark },
  savingsText: { flex: 1, color: COLORS.white, fontSize: EASY.font.body, fontWeight: '900' },

  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: EASY.space.xs },
  trustText: { flex: 1, color: COLORS.greenBright, fontSize: EASY.font.label, fontWeight: '700' },

  buttons: { flexDirection: 'column', gap: EASY.space.sm, marginTop: EASY.space.sm },
  button: {
    flex: 1,
    minHeight: EASY.touch.button,
    borderRadius: EASY.radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  buttonPrimary: { backgroundColor: COLORS.greenPrimary },
  buttonRed: { backgroundColor: COLORS.redPrimary },
  buttonGhost: { backgroundColor: COLORS.bgSecondary, borderWidth: 2, borderColor: COLORS.borderStrong },
  buttonSaved: { borderColor: COLORS.goldBorder, backgroundColor: COLORS.goldSoftBg },
  buttonText: { color: COLORS.white, fontSize: EASY.font.button, fontWeight: '900' },
  buttonGhostText: { color: COLORS.textPrimary },

  /* „Виж подробности“ стои ПО-ГОРЕ в картата (под спестеното), а не най-долу:
     долу вдясно „виси“ бутонът „↑ Нагоре“ и застъпваше надписа. */
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: EASY.touch.small,
    marginTop: EASY.space.xs,
  },
  moreText: { color: COLORS.accentCyan, fontSize: EASY.font.body, fontWeight: '800' },
});
