import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { goBack } from '@/src/lib/navigation';
import { COLORS } from '@/constants/theme';
import { searchObjects } from '@/src/api/client';
import type { ObjectSummary } from '@/src/api/client';

/**
 * 🛒 „Онлайн магазини“ — отделен списък от обектите на място.
 *
 * Защо е отделно: „обект“ в приложението значи МЯСТО (заведение, магазин на
 * ъгъла), където се сравнява едно и също нещо — кафе, хляб, такса. Когато
 * скраперът внесе цял онлайн магазин (praktis.bg, sopharmacy.bg, deichmann.com),
 * в един „обект“ влизат крушка за 0.35 € и машина за 1240 € — такива магазини
 * НЕ бива да стоят в „Черен списък“ и „Честни места“.
 *
 * Тук са магазините, подредени по брой оферти, с диапазон на цените. Натискането
 * отваря страницата на магазина, където статистиката е ПО КАТЕГОРИИ (смислената).
 */
export default function ShopsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ObjectSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await searchObjects(q, undefined, 60, 'shop');
      setItems(res.items ?? []);
      setTotal(Number(res.total) || 0);
      setError('');
    } catch {
      setItems([]);
      setTotal(0);
      setError('Не успях да заредя магазините. Провери връзката.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Търсенето чака човекът да спре да пише.
  useEffect(() => {
    const t = setTimeout(() => void load(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query, load]);

  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.slug}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.85}
            onPress={() => router.push(`/object/${item.slug}` as never)}
          >
            <View style={styles.cardTop}>
              <View style={styles.iconWrap}>
                <Ionicons name="storefront" size={18} color={COLORS.accentCyan} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.place_name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.signals_count} оферти
                  {item.min_price != null && item.max_price != null
                    ? ` · от ${Number(item.min_price).toFixed(2)} до ${Number(item.max_price).toFixed(2)} €`
                    : ''}
                </Text>
                {item.categories ? (
                  <Text style={styles.cats} numberOfLines={1}>
                    🏷️ {item.categories.slice(0, 4).join(' · ')}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          loading ? (
            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
              <ActivityIndicator color={COLORS.accentCyan} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="storefront-outline" size={30} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>
                {error || 'Още няма внесен онлайн магазин. Пусни скрапера от панела (🕸️ Скрапер → нова обиколка).'}
              </Text>
            </View>
          )
        }
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <TouchableOpacity onPress={() => goBack(router)} hitSlop={12}>
                <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Онлайн магазини</Text>
              <View style={{ width: 22 }} />
            </View>

            <Text style={styles.subtitle}>
              Тук са онлайн магазините с внесените от тях оферти. Те НЕ се броят за обекти в „Черен
              списък“ и „Честни места“ — там са местата, за които хората сигнализират (заведения,
              магазини на място), а тук са целите каталози.
            </Text>

            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={COLORS.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Търси магазин (напр. bauhaus, sopharmacy)…"
                placeholderTextColor={COLORS.textMuted}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
              />
              {query.length > 0 ? (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              ) : null}
            </View>

            {!loading && items.length > 0 ? (
              <Text style={styles.countLine}>
                {total > items.length ? `Показвам ${items.length} от ${total} магазина` : `${items.length} магазина`}
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
    marginBottom: 10,
  },
  headerTitle: { color: COLORS.textPrimary, fontSize: 19, fontWeight: '900' },
  subtitle: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18, marginBottom: 12 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
    gap: 9,
    marginBottom: 10,
  },
  searchInput: { flex: 1, color: COLORS.textPrimary, fontSize: 16 },
  countLine: { color: COLORS.textMuted, fontSize: 11.5, fontWeight: '700', marginBottom: 8 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.30)',
  },
  name: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '900' },
  meta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 3, fontWeight: '700' },
  cats: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
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
