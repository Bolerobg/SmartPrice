import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '@/src/lib/navigation';
import { COLORS } from '@/constants/theme';
import { PostCard } from '@/components/PostCard';
import { openInGoogleMaps } from '@/lib/locationService';
import { api, ApiError, loadObject, type ObjectDetail } from '@/src/api/client';
import type { PostItem, PostPolarity } from '@/types';

/**
 * 🏪 „Всички оферти на този обект“ — екранът, който се отваря, когато човек
 * натисне обект от класацията в Радара (черен списък / „Честно място“).
 *
 * Защо съществува: досега натискането само попълваше търсачката с името на
 * обекта и човекът виждаше общ резултат от търсене по текст, вместо „всички
 * оферти с този таг“. Тук филтърът е на СЪРВЪРА по тага на обекта
 * (md5(място|град) — същият, по който групира и класацията), така че виждаш
 * точно докладите за този обект, с всички цени, снимки и реакции.
 *
 * Внесените стоки (scraper) и обявите (olx) са изключени — те не са обекти с
 * гласове от хора (същото правило като в класацията), за да не се пълни
 * списъкът с продукти от онлайн магазин със същото име.
 */
type Filter = 'all' | 'red' | 'green';

export default function PlaceOffersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string; name?: string; city?: string }>();
  const slug = String(params.slug || '');
  // Името идва веднага от екрана, от който сме тръгнали, за да няма мигане
  // „Обект…“, докато заредят данните. Сървърът после дава точното.
  const [placeName, setPlaceName] = useState(String(params.name || ''));
  const [city, setCity] = useState(String(params.city || ''));
  const [detail, setDetail] = useState<ObjectDetail | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const PAGE = 30;
  const [items, setItems] = useState<PostItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);

  // Профилът на обекта: брой сигнали, цени, Google рейтинг и работно време.
  // Ако не се зареди, екранът пак работи (списъкът с оферти е важният).
  useEffect(() => {
    let alive = true;
    if (!slug) return;
    loadObject(slug)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        if (d.object?.place_name) setPlaceName(d.object.place_name);
        if (d.object?.city) setCity(d.object.city);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slug]);

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      if (!slug || busyRef.current) return; // една заявка наведнъж
      busyRef.current = true;
      setBusy(true);
      if (replace) setLoading(true);
      try {
        const feed = await api.feed({
          place: slug,
          polarity: filter === 'all' ? undefined : (filter as PostPolarity),
          limit: PAGE,
          offset,
        });
        setItems((prev) => {
          if (replace) return feed.items;
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...feed.items.filter((p) => !seen.has(p.id))];
        });
        setHasMore(Boolean(feed.hasMore));
        if (replace) setTotal(Number(feed.total) || 0);
        setError('');
      } catch (err) {
        if (replace) {
          setItems([]);
          setTotal(0);
        }
        setHasMore(false);
        setError(err instanceof ApiError ? err.message : 'Не успях да заредя офертите.');
      } finally {
        busyRef.current = false;
        setBusy(false);
        setLoading(false);
        setRefreshing(false);
      }
    },
    [slug, filter]
  );

  useEffect(() => {
    void load(0, true);
  }, [load]);

  const o = detail?.object ?? null;

  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PostCard post={item} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void load(0, true);
        }}
        onEndReached={() => {
          if (hasMore && !busyRef.current) void load(items.length, false);
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          loading ? (
            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
              <ActivityIndicator color={COLORS.greenBright} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="storefront-outline" size={32} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>
                {error
                  ? error
                  : filter === 'all'
                    ? 'Няма публикувани оферти за този обект.'
                    : 'Няма оферти с този филтър — виж „Всички“. '}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          busy && items.length > 0 ? (
            <View style={{ paddingVertical: 18, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={COLORS.greenBright} />
            </View>
          ) : null
        }
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <TouchableOpacity onPress={() => goBack(router)} hitSlop={12}>
                <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Оферти на обекта</Text>
              <View style={{ width: 22 }} />
            </View>

            <View style={styles.heroCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="storefront" size={20} color={COLORS.accentCyan} />
                <Text style={styles.placeName} numberOfLines={2}>
                  {placeName || 'Обект'}
                </Text>
              </View>
              {city ? (
                <Text style={styles.placeSub}>
                  📍 {city}
                  {o?.address ? ` • ${o.address}` : ''}
                  {o?.category ? ` • ${o.category}` : ''}
                </Text>
              ) : null}

              <View style={styles.pillRow}>
                <View style={styles.pill}>
                  <Text style={styles.pillText}>
                    {filter === 'all' ? 'Всички' : filter === 'red' ? 'Червени' : 'Добри'}: {total}
                  </Text>
                </View>
                {o ? (
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{o.signals_count} сигнала</Text>
                  </View>
                ) : null}
                {o && o.min_price != null ? (
                  <View style={[styles.pill, styles.pillGreen]}>
                    <Text style={styles.pillText}>от {Number(o.min_price).toFixed(2)} €</Text>
                  </View>
                ) : null}
                {o && o.max_price != null ? (
                  <View style={[styles.pill, styles.pillRed]}>
                    <Text style={styles.pillText}>до {Number(o.max_price).toFixed(2)} €</Text>
                  </View>
                ) : null}
                {detail?.place?.rating != null ? (
                  <View style={[styles.pill, styles.pillGold]}>
                    <Text style={styles.pillText}>★ {detail.place.rating.toFixed(2)}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  activeOpacity={0.85}
                  onPress={() =>
                    openInGoogleMaps({
                      placeName: placeName,
                      address: o?.address ?? undefined,
                      city: city,
                    })
                  }
                >
                  <Ionicons name="map-outline" size={14} color={COLORS.black} />
                  <Text style={styles.actionText}>Карта</Text>
                </TouchableOpacity>
                {slug ? (
                  <TouchableOpacity
                    style={styles.actionGhost}
                    activeOpacity={0.85}
                    onPress={() => router.push(`/object/${slug}` as never)}
                  >
                    <Ionicons name="stats-chart-outline" size={14} color={COLORS.accentCyan} />
                    <Text style={[styles.actionText, { color: COLORS.accentCyan }]}>
                      Статистика и цени
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <Text style={styles.hint}>
                Тук виждаш всички оферти с тага на този обект (място + град). Внесените стоки от
                онлайн магазини и обявите от класифайд сайтове не се броят — те не са обекти с
                гласове от хора.
              </Text>
            </View>

            <View style={styles.tabsRow}>
              {(
                [
                  { id: 'all', label: 'Всички', icon: 'apps-outline' },
                  { id: 'red', label: 'Червени', icon: 'warning-outline' },
                  { id: 'green', label: 'Добри', icon: 'shield-checkmark-outline' },
                ] as Array<{ id: Filter; label: string; icon: string }>
              ).map((t) => {
                const active = filter === t.id;
                const accent =
                  t.id === 'red' ? COLORS.redBright : t.id === 'green' ? COLORS.greenBright : COLORS.accentCyan;
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[
                      styles.tab,
                      active && {
                        borderColor: accent,
                        backgroundColor:
                          t.id === 'red'
                            ? COLORS.redSoftBg
                            : t.id === 'green'
                              ? COLORS.greenSoftBg
                              : 'rgba(34,211,238,0.12)',
                      },
                    ]}
                    activeOpacity={0.85}
                    onPress={() => setFilter(t.id)}
                  >
                    <Ionicons name={t.icon as never} size={13} color={active ? accent : COLORS.textMuted} />
                    <Text style={[styles.tabText, active && { color: accent }]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {!loading && items.length > 0 ? (
              <Text style={styles.countLine}>
                Показвам {items.length}
                {total > items.length ? ` от ${total}` : ''} оферти
              </Text>
            ) : null}
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  listContent: { padding: 16, paddingBottom: 40 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '800', letterSpacing: 0.6 },
  heroCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  placeName: { flex: 1, color: COLORS.textPrimary, fontSize: 19, fontWeight: '900' },
  placeSub: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 6 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    backgroundColor: COLORS.bgCardElevated,
  },
  pillGreen: { backgroundColor: COLORS.greenSoftBg, borderColor: COLORS.greenBorder },
  pillRed: { backgroundColor: COLORS.redSoftBg, borderColor: COLORS.redBorder },
  pillGold: { backgroundColor: COLORS.goldSoftBg, borderColor: COLORS.goldBorder },
  pillText: { color: COLORS.textPrimary, fontSize: 11.5, fontWeight: '800' },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.accentCyan,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  actionGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  actionText: { color: COLORS.black, fontSize: 12, fontWeight: '900' },
  hint: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: 10 },
  tabsRow: { flexDirection: 'row', gap: 7, marginBottom: 10 },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 11,
    paddingVertical: 8,
  },
  tabText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '800' },
  countLine: { color: COLORS.textMuted, fontSize: 11.5, fontWeight: '700', marginBottom: 8 },
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
});
