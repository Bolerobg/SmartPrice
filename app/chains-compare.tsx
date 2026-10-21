import React, { useCallback, useEffect, useState } from 'react';
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
import { useRouter } from 'expo-router';
import { goBack } from '@/src/lib/navigation';
import { COLORS } from '@/constants/theme';
import { CityPickerDropdown } from '@/components/CityPickerDropdown';
import { api, type ChainDifference } from '@/src/api/client';

/**
 * ⚖️ „Разлики между веригите“.
 *
 * Какво показва: по категории — коя верига е най-евтина и колко се различава от
 * най-скъпата. Това е най-ясната картина защо си струва да се сверява: „сиренето
 * е 0.90 € по-евтино в едно място, отколкото в друго“.
 *
 * Честност (за да не е реклама):
 *   • сравняваме ТИПИЧНАТА цена на веригата в категорията (медианата), не най-евтината
 *     оферта — иначе един промо артикул прави цялата верига „най-евтина“;
 *   • верига влиза в сметката само с поне 5 оферти в категорията;
 *   • категория влиза само ако в нея има поне 3 вериги за сравнение;
 *   • казваме с колко оферти и колко вериги е смятано — човекът сам да прецени.
 */
export default function ChainsCompareScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ChainDifference[]>([]);
  const [city, setCity] = useState('Всички градове');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (c: string) => {
    setLoading(true);
    try {
      const res = await api.chainDifferences(c);
      setItems(res.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(city);
  }, [city, load]);

  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.category}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.iconWrap}>
                <Ionicons name="pricetags" size={17} color={COLORS.accentCyan} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.category} numberOfLines={1}>
                  {item.category}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.matched_products} еднакви продукта в двете вериги · {item.chains_compared} вериги
                </Text>
              </View>
              <View style={styles.diffPill}>
                <Text style={styles.diffPillText}>−{item.diff_pct}%</Text>
              </View>
            </View>

            <View style={styles.row}>
              <Text style={styles.rowLabel}>По-евтино</Text>
              <Text style={styles.rowValue} numberOfLines={1}>
                {item.cheapest_chain} · {item.cheapest_median.toFixed(2)} €
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>По-скъпо</Text>
              <Text style={[styles.rowValue, { color: COLORS.redBright }]} numberOfLines={1}>
                {item.priciest_chain} · {item.priciest_median.toFixed(2)} €
              </Text>
            </View>
            <Text style={styles.diffLine}>
              Същите {item.matched_products} продукта излизат с {item.diff_eur.toFixed(2)} € (
              {item.diff_pct}%) повече в {item.priciest_chain}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={COLORS.accentCyan} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="pricetags-outline" size={28} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>
                За този град още няма достатъчно сверени цени, за да сравним веригите честно
                (нужни са поне 5 оферти на верига и поне 3 вериги в категорията).
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
              <Text style={styles.headerTitle}>Разлики между веригите</Text>
              <View style={{ width: 22 }} />
            </View>

            <Text style={styles.subtitle}>
              Сравняваме САМО продуктите, които ги има и в двете вериги (един и същ продукт), и
              показваме колко излизат те — не „средна цена на категорията“, където едната верига
              продава шампоан, а другата парфюм. Затова числата са реални, не рекламни.
            </Text>

            <CityPickerDropdown
              selectedCity={city}
              onSelectCity={setCity}
              includeAllOption
              label="Град за сравнението"
            />

            {!loading && items.length > 0 ? (
              <Text style={styles.countLine}>
                {items.length} категории с истинска разлика между веригите
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
  list: { padding: 16, paddingBottom: 40 },
  center: { paddingVertical: 30, alignItems: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerTitle: { color: COLORS.textPrimary, fontSize: 19, fontWeight: '900' },
  subtitle: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18, marginBottom: 12 },
  countLine: { color: COLORS.textMuted, fontSize: 11.5, fontWeight: '700', marginBottom: 8 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    gap: 6,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.30)',
  },
  category: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '900' },
  meta: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  diffPill: {
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    backgroundColor: COLORS.greenSoftBg,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  diffPillText: { color: COLORS.greenBright, fontSize: 12, fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowLabel: { color: COLORS.textMuted, fontSize: 11.5, fontWeight: '700' },
  rowValue: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '800' },
  diffLine: { color: COLORS.textSecondary, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
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
