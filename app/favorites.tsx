import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  TextInput,
  Modal,
  Alert as RNAlert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { goBack } from '@/src/lib/navigation';
import { COLORS } from '@/constants/theme';
import { api, ApiError } from '@/src/api/client';
import type { PostItem } from '@/types';

/**
 * Любими оферти.
 *
 * Освен че офертата е отбелязана, тук се вижда и ТОЧНОТО МЯСТО (GPS), за да
 * може човек да отиде до там: адрес, координати, „Отвори в Google Maps“ и
 * „Навигация“. Към всяка любима може да се запише лична бележка.
 */
export default function FavoritesScreen() {
  const router = useRouter();
  const [items, setItems] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PostItem | null>(null);
  const [noteText, setNoteText] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.bookmarks();
      setItems(res.items || []);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не успях да заредя любимите.');
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Всички любими, които имат място — за да се види колко са „до мен“. */
  const withLocation = useMemo(
    () => items.filter((p) => p.latitude != null && p.longitude != null).length,
    [items]
  );

  const openMap = (post: PostItem, navigate: boolean) => {
    const lat = post.favorite?.noteLat ?? post.latitude;
    const lng = post.favorite?.noteLng ?? post.longitude;
    if (lat == null || lng == null) {
      RNAlert.alert('Няма място', 'Тази оферта е без запазено място (GPS). Остави бележка къде си я видял.');
      return;
    }
    const url = navigate
      ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
      : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    void Linking.openURL(url);
  };

  const removeFavorite = (post: PostItem) => {
    RNAlert.alert('Премахни от любими?', post.title, [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Премахни',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.toggleBookmark(post.id);
            setItems((prev) => prev.filter((p) => p.id !== post.id));
          } catch {
            RNAlert.alert('Грешка', 'Не успях да го премахна. Опитай пак.');
          }
        },
      },
    ]);
  };

  const saveNote = async () => {
    if (!editing) return;
    try {
      await api.setBookmarkNote(editing.id, { note: noteText.trim() || null });
      setItems((prev) =>
        prev.map((p) =>
          p.id === editing.id ? { ...p, favorite: { ...(p.favorite ?? { savedAt: null, noteLat: null, noteLng: null }), note: noteText.trim() || null } } : p
        )
      );
      setEditing(null);
    } catch (err) {
      RNAlert.alert('Грешка', err instanceof ApiError ? err.message : 'Не успях да запазя бележката.');
    }
  };

  const formatAddress = (post: PostItem) => {
    const parts = [post.placeName, post.address, post.city].filter(Boolean);
    return parts.join(' · ');
  };

  const coords = (post: PostItem) => {
    const lat = post.favorite?.noteLat ?? post.latitude;
    const lng = post.favorite?.noteLng ?? post.longitude;
    if (lat == null || lng == null) return null;
    return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={COLORS.greenBright}
          />
        }
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => goBack(router)} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Любими</Text>
          <View style={{ width: 22 }} />
        </View>

        <Text style={styles.subtitle}>
          Твоите запазени оферти с мястото, където да ги намериш. Натисни „Навигация“ и телефонът ще те заведе.
        </Text>

        {loading ? <ActivityIndicator color={COLORS.greenBright} style={{ marginTop: 30 }} /> : null}

        {!loading && error ? (
          <View style={styles.empty}>
            <Ionicons name="alert-circle-outline" size={32} color={COLORS.goldBright} />
            <Text style={styles.emptyText}>{error}</Text>
          </View>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={34} color={COLORS.goldBright} />
            <Text style={styles.emptyText}>
              Още нямаш любими. Натисни отметката (🔖) на оферта, която искаш да запомниш — ще я намериш тук с
              точното ѝ място.
            </Text>
          </View>
        ) : null}

        {items.length > 0 ? (
          <Text style={styles.countLine}>
            {items.length} любими · {withLocation} с място на картата
          </Text>
        ) : null}

        {items.map((post) => (
          <View key={post.id} style={styles.card}>
            <View style={styles.cardTop}>
              {post.imageUri ? (
                <Image source={{ uri: post.imageUri }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbFallback]}>
                  <Ionicons name="image-outline" size={20} color={COLORS.textMuted} />
                </View>
              )}

              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {post.title}
                </Text>
                <Text style={styles.code}>ID: {post.code}</Text>
                <Text style={styles.price}>
                  {post.pricePaid.toFixed(2)} {post.currency}
                  {post.referencePrice && post.referencePrice > post.pricePaid
                    ? `  ·  спестени ${(post.referencePrice - post.pricePaid).toFixed(2)} ${post.currency}`
                    : ''}
                </Text>
              </View>

              <TouchableOpacity onPress={() => removeFavorite(post)} hitSlop={10}>
                <Ionicons name="bookmark" size={20} color={COLORS.goldBright} />
              </TouchableOpacity>
            </View>

            <View style={styles.placeBox}>
              <View style={styles.placeRow}>
                <Ionicons name="location" size={15} color={COLORS.greenBright} />
                <Text style={styles.placeText}>{formatAddress(post)}</Text>
              </View>
              {coords(post) ? (
                <View style={styles.placeRow}>
                  <Ionicons name="navigate-outline" size={14} color={COLORS.accentCyan} />
                  <Text style={styles.coordText}>{coords(post)}</Text>
                </View>
              ) : (
                <Text style={styles.noPlace}>Няма записано място (GPS) за тази оферта</Text>
              )}

              {post.favorite?.note ? (
                <View style={styles.noteBox}>
                  <Ionicons name="create-outline" size={13} color={COLORS.goldBright} />
                  <Text style={styles.noteText}>{post.favorite.note}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => openMap(post, true)} activeOpacity={0.85}>
                <Ionicons name="navigate" size={15} color={COLORS.onPrimary} />
                <Text style={styles.actionText}>Навигация</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionGhost]}
                onPress={() => openMap(post, false)}
                activeOpacity={0.85}
              >
                <Ionicons name="map-outline" size={15} color={COLORS.accentCyan} />
                <Text style={[styles.actionText, { color: COLORS.accentCyan }]}>Карта</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionGhost]}
                onPress={() => {
                  setEditing(post);
                  setNoteText(post.favorite?.note ?? '');
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="create-outline" size={15} color={COLORS.goldBright} />
                <Text style={[styles.actionText, { color: COLORS.goldBright }]}>Бележка</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionGhost]}
                onPress={() => router.push(`/post/${post.id}` as never)}
                activeOpacity={0.85}
              >
                <Ionicons name="open-outline" size={15} color={COLORS.textSecondary} />
                <Text style={[styles.actionText, { color: COLORS.textSecondary }]}>Отвори</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={Boolean(editing)} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Бележка към любимата</Text>
            <Text style={styles.modalSub} numberOfLines={2}>
              {editing?.title}
            </Text>
            <TextInput
              style={styles.input}
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Напр.: тук е най-евтино, продават и в събота сутрин"
              placeholderTextColor={COLORS.textMuted}
              multiline
              maxLength={500}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalGhost} onPress={() => setEditing(null)} activeOpacity={0.85}>
                <Text style={styles.modalGhostText}>Отказ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalPrimary} onPress={() => void saveNote()} activeOpacity={0.88}>
                <Text style={styles.modalPrimaryText}>Запази</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  scroll: { padding: 18, paddingTop: 26, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '900' },
  subtitle: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 8, marginBottom: 14 },
  countLine: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 10 },
  empty: {
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 22,
  },
  emptyText: { color: COLORS.textSecondary, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 17,
    padding: 13,
    marginBottom: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  thumb: { width: 62, height: 62, borderRadius: 12, backgroundColor: COLORS.bgCardElevated },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: COLORS.textPrimary, fontSize: 14.5, fontWeight: '900' },
  code: { color: COLORS.accentCyan, fontSize: 11, fontWeight: '800', marginTop: 3, letterSpacing: 0.4 },
  price: { color: COLORS.goldBright, fontSize: 12.5, fontWeight: '800', marginTop: 4 },
  placeBox: {
    marginTop: 11,
    backgroundColor: COLORS.bgCardElevated,
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  placeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  placeText: { flex: 1, color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 17 },
  coordText: { color: COLORS.accentCyan, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  noPlace: { color: COLORS.textMuted, fontSize: 11.5, fontStyle: 'italic' },
  noteBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 2 },
  noteText: { flex: 1, color: COLORS.goldBright, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 7, marginTop: 11, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.greenBright,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  actionGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  actionText: { color: COLORS.black, fontSize: 12, fontWeight: '900' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: COLORS.bgPrimary,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 20,
    padding: 18,
  },
  modalTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '900' },
  modalSub: { color: COLORS.textMuted, fontSize: 12.5, marginTop: 5, marginBottom: 12 },
  input: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 12,
    color: COLORS.textPrimary,
    padding: 12,
    minHeight: 90,
    fontSize: 13.5,
    textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalGhost: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  modalGhostText: { color: COLORS.textSecondary, fontSize: 13.5, fontWeight: '800' },
  modalPrimary: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.greenBright,
  },
  modalPrimaryText: { color: COLORS.onPrimary, fontSize: 13.5, fontWeight: '900' },
});