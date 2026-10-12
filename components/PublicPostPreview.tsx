import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { api } from '@/src/api/client';
import { openInGoogleMaps } from '@/lib/locationService';
import { formatPostedAtLong } from '@/src/lib/format';
import { postVerdict, shareViaSystem, hasSystemShare, buildShareMessage } from '@/lib/share';
import type { PostItem } from '@/types';

interface Props {
  id: string;
  /** Отваря се от гост по споделен линк → показваме покана за вход. */
  onLogin?: () => void;
}

/**
 * Публичен преглед на оферта — за хора, дошли по споделен линк, които още
 * нямат профил. Без него линкът водеше до екран за вход и получателят
 * не виждаше самата оферта („споделяне навсякъде“ не работеше).
 */
export const PublicPostPreview: React.FC<Props> = ({ id }) => {
  const router = useRouter();
  const [post, setPost] = useState<PostItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api.post(id);
        if (!cancelled) setPost(res.post);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error && err.message
              ? err.message
              : 'Офертата не може да се зареди.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleShare = async () => {
    if (!post) return;
    if (hasSystemShare()) {
      await shareViaSystem(post).catch(() => undefined);
      return;
    }
    // Няма системен диалог → показваме текста, за да го копира човекът.
    setError(null);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerBox}>
          <ActivityIndicator color={COLORS.accentCyan} />
          <Text style={styles.mutedText}>Зареждаме офертата…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerBox}>
          <Ionicons name="alert-circle-outline" size={34} color={COLORS.textMuted} />
          <Text style={styles.notFoundTitle}>Офертата не е намерена</Text>
          <Text style={styles.mutedText}>{error ?? 'Възможно е да е изтрита.'}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.replace('/(auth)/login')}
          >
            <Text style={styles.primaryBtnText}>Отвори SmartPrice</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isGreen = post.polarity === 'green';
  const accent = isGreen ? COLORS.greenBright : COLORS.redBright;
  const accentSoft = isGreen ? COLORS.greenSoftBg : COLORS.redSoftBg;
  const saved =
    post.referencePrice && post.referencePrice > post.pricePaid
      ? post.referencePrice - post.pricePaid
      : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Гост-лента */}
        <View style={styles.guestBar}>
          <Ionicons name="eye-outline" size={15} color={COLORS.accentCyan} />
          <Text style={styles.guestText}>Преглеждаш офертата като гост</Text>
        </View>

        <View style={[styles.verdictPill, { backgroundColor: accentSoft, borderColor: accent }]}>
          <Text style={[styles.verdictText, { color: accent }]}>{postVerdict(post)}</Text>
        </View>

        <Text style={styles.title}>{post.title}</Text>

        <View style={styles.metaRow}>
          <Ionicons name="location" size={13} color={accent} />
          <Text style={styles.metaText}>
            {post.placeName} · {post.city}
          </Text>
        </View>
        <View style={styles.postedAtRow}>
          <Ionicons name="calendar-outline" size={13} color={COLORS.textMuted} />
          <Text style={styles.timeText}>
            Офертата е сложена {formatPostedAtLong(post.createdAt)}
          </Text>
        </View>

        {post.imageUri ? (
          <Image source={{ uri: post.imageUri }} style={styles.hero} resizeMode="cover" />
        ) : null}

        <View style={styles.priceCard}>
          <View style={styles.priceCol}>
            <Text style={styles.priceLabel}>Платено</Text>
            <Text style={[styles.priceValue, { color: accent }]}>
              {post.pricePaid.toFixed(2)} {post.currency}
            </Text>
          </View>
          {post.referencePrice ? (
            <View style={styles.priceCol}>
              <Text style={styles.priceLabel}>Обичайна цена</Text>
              <Text style={styles.priceValueMuted}>
                {post.referencePrice.toFixed(2)} {post.currency}
              </Text>
            </View>
          ) : null}
          {saved ? (
            <View style={styles.priceCol}>
              <Text style={styles.priceLabel}>{isGreen ? 'Спестени' : 'Надвзето'}</Text>
              <Text style={[styles.priceValue, { color: isGreen ? COLORS.greenBright : COLORS.redBright }]}>
                {saved.toFixed(2)} {post.currency}
              </Text>
            </View>
          ) : null}
        </View>

        {post.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Описание</Text>
            <Text style={styles.bodyText}>{post.description}</Text>
          </View>
        ) : null}

        {post.receipt ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              🧾 Касова бележка · {post.receipt.merchantName}
            </Text>
            <Text style={styles.bodyText}>
              Общо {post.receipt.totalAmount.toFixed(2)} {post.receipt.currency}
              {post.receipt.items.length ? ` · ${post.receipt.items.length} артикула` : ''}
            </Text>
            {post.receipt.items.slice(0, 5).map((item) => (
              <View key={item.id} style={styles.receiptRow}>
                <Text style={styles.receiptName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.receiptPrice}>
                  {item.totalPrice.toFixed(2)} {post.currency}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {post.googleMapsUrl ? (
          <TouchableOpacity
            style={styles.mapRow}
            onPress={() => void openInGoogleMaps(post)}
            activeOpacity={0.85}
          >
            <Ionicons name="map-outline" size={16} color="#60A5FA" />
            <Text style={styles.mapText}>Виж на картата</Text>
            <Ionicons name="chevron-forward" size={15} color={COLORS.textMuted} />
          </TouchableOpacity>
        ) : null}

        {/* Покана за вход */}
        <View style={styles.ctaCard}>
          <Text style={styles.ctaTitle}>Виж още оферти в SmartPrice</Text>
          <Text style={styles.ctaText}>
            Реални цени от реални хора, червени флагове и скрити такси. Без реклами
            и без платени ревюта.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.replace('/(auth)/register')}
            activeOpacity={0.88}
          >
            <Text style={styles.primaryBtnText}>Създай профил безплатно</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={() => router.replace('/(auth)/login')}
            activeOpacity={0.7}
          >
            <Text style={styles.ghostBtnText}>Вече имам профил — вход</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.shareRow} onPress={() => void handleShare()} activeOpacity={0.85}>
          <Ionicons name="share-social-outline" size={17} color={COLORS.accentCyan} />
          <Text style={styles.shareText}>Сподели пак</Text>
        </TouchableOpacity>

        <Text style={styles.previewHint} numberOfLines={4}>
          {buildShareMessage(post)}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bgPrimary },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 30 },
  mutedText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center' },
  notFoundTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '900' },
  content: { padding: 18, paddingBottom: 40 },
  guestBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: COLORS.accentCyanSoftBg,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
    borderRadius: 999,
    paddingVertical: 7,
    marginBottom: 16,
  },
  guestText: { color: COLORS.accentCyan, fontSize: 11.5, fontWeight: '800' },
  verdictPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
    marginBottom: 12,
  },
  verdictText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.3 },
  title: { color: COLORS.textPrimary, fontSize: 21, fontWeight: '900', lineHeight: 28 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  metaText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700' },
  postedAtRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  timeText: { flex: 1, color: COLORS.textMuted, fontSize: 11.5 },
  hero: { width: '100%', height: 210, borderRadius: 18, marginTop: 16 },
  priceCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 15,
    marginTop: 16,
  },
  priceCol: { flex: 1, alignItems: 'center', gap: 4 },
  priceLabel: { color: COLORS.textMuted, fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase' },
  priceValue: { fontSize: 17, fontWeight: '900' },
  priceValueMuted: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '800' },
  section: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 15,
    marginTop: 14,
  },
  sectionTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '900', marginBottom: 8 },
  bodyText: { color: COLORS.textSecondary, fontSize: 13.5, lineHeight: 20 },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 8,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
  },
  receiptName: { flex: 1, color: COLORS.textSecondary, fontSize: 12.5 },
  receiptPrice: { color: COLORS.textPrimary, fontSize: 12.5, fontWeight: '800' },
  mapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 14,
    marginTop: 14,
  },
  mapText: { flex: 1, color: COLORS.textPrimary, fontSize: 13.5, fontWeight: '700' },
  ctaCard: {
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 18,
    padding: 18,
    marginTop: 22,
    alignItems: 'center',
  },
  ctaTitle: { color: COLORS.textPrimary, fontSize: 16.5, fontWeight: '900', textAlign: 'center' },
  ctaText: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 8,
  },
  primaryBtn: {
    backgroundColor: COLORS.accentCyan,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 22,
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 16,
  },
  primaryBtnText: { color: COLORS.black, fontSize: 14.5, fontWeight: '900' },
  ghostBtn: { alignItems: 'center', paddingVertical: 11, marginTop: 4 },
  ghostBtnText: { color: COLORS.textMuted, fontSize: 12.5, fontWeight: '700' },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 8,
  },
  shareText: { color: COLORS.accentCyan, fontSize: 13, fontWeight: '800' },
  previewHint: { color: COLORS.textMuted, fontSize: 10.5, lineHeight: 15, textAlign: 'center' },
});
