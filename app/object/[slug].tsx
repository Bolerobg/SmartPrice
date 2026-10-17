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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { formatMoney, formatRelativeTime, formatNumber, unitLabel } from '@/src/lib/format';
import { loadObject, type ObjectDetail, type ObjectSignal } from '@/src/api/client';

const CATEGORY_LABELS: Record<string, string> = {
  restaurants: 'Заведения',
  hotels_airbnb: 'Настаняване',
  supermarket: 'Магазини и храни',
  cafes_bars: 'Кафенета и барове',
  services_tech: 'Услуги',
  vehicles: 'Авто',
  real_estate: 'Имоти',
  shops_places: 'Обекти',
  private_sellers: 'Частни продавачи',
  other: 'Други',
};

/**
 * 🏪 Страница на обект (#11).
 * Показва колко пъти хората са сигнализирали, как се е движила цената във времето,
 * всички сигнали за обекта и търговеца (ако има проверена касова бележка).
 */
export default function ObjectScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [data, setData] = useState<ObjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    loadObject(String(slug || ''))
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message || 'Обектът не се зареди.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={COLORS.greenPrimary} />
        <Text style={styles.muted}>Зареждам обекта…</Text>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={styles.center}>
        <Ionicons name="alert-circle-outline" size={40} color={COLORS.textMuted} />
        <Text style={styles.muted}>{error || 'Няма такъв обект.'}</Text>
        <TouchableOpacity style={styles.ghostBtn} onPress={() => router.back()}>
          <Text style={styles.ghostBtnText}>Назад</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const o = data.object;
  const prices = data.history.map((h) => h.price);
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const unit = unitLabel(o.unit_type || undefined);
  const spread = prices.length > 1 ? prices[prices.length - 1] - prices[0] : 0;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Обект</Text>
          <View style={{ width: 34 }} />
        </View>

        {o.cover_image ? (
          <Image source={{ uri: o.cover_image }} style={styles.cover} resizeMode="cover" />
        ) : null}

        <View style={styles.card}>
          <Text style={styles.name}>{o.place_name}</Text>
          <Text style={styles.sub}>
            {o.city}
            {o.category ? ' · ' + (CATEGORY_LABELS[o.category] || o.category) : ''}
            {o.address ? ' · ' + o.address : ''}
          </Text>

          <View style={styles.pillRow}>
            <View style={[styles.pill, styles.pillGreen]}>
              <Text style={styles.pillText}>{formatNumber(o.signals_count)} сигнала</Text>
            </View>
            {o.reporters_count > 1 ? (
              <View style={[styles.pill, styles.pillCyan]}>
                <Text style={styles.pillText}>{formatNumber(o.reporters_count)} души сигнализират</Text>
              </View>
            ) : null}
            {o.helped_total > 0 ? (
              <View style={[styles.pill, styles.pillDim]}>
                <Text style={styles.pillText}>{formatNumber(o.helped_total)}× помогнало</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Средна цена</Text>
              <Text style={styles.statValue}>{o.avg_price != null ? formatMoney(o.avg_price) : '—'}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Най-ниска</Text>
              <Text style={[styles.statValue, { color: COLORS.greenBright }]}>
                {o.min_price != null ? formatMoney(o.min_price) : '—'}
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Най-висока</Text>
              <Text style={[styles.statValue, { color: COLORS.redBright }]}>
                {o.max_price != null ? formatMoney(o.max_price) : '—'}
              </Text>
            </View>
          </View>

          <Text style={styles.hint}>
            Първи сигнал: {formatRelativeTime(o.first_seen)} · последен: {formatRelativeTime(o.last_seen)}
            {o.green_count || o.red_count
              ? ' · ' + o.green_count + ' добри / ' + o.red_count + ' лоши'
              : ''}
          </Text>
        </View>

        {o.merchant_name || o.merchant_tax_id ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🧾 Търговец по касовата бележка</Text>
            <Text style={styles.body}>
              {o.merchant_name || 'Неразчетен търговец'}
              {o.merchant_tax_id ? ' · ЕИК ' + o.merchant_tax_id : ''}
            </Text>
            <Text style={styles.hint}>
              {o.receipts_verified
                ? o.receipts_verified + ' проверени от AI касови бележки'
                : 'Няма проверена от AI касова бележка за този обект'}
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>📉 История на цените</Text>
          {data.history.length === 0 ? (
            <Text style={styles.hint}>Още няма записани цени за този обект.</Text>
          ) : (
            <>
              <View style={styles.chart}>
                {data.history.slice(-24).map((h) => {
                  const height = maxPrice > 0 ? Math.max(6, Math.round((h.price / maxPrice) * 92)) : 6;
                  const cheap = minPrice > 0 && h.price <= minPrice * 1.05;
                  return (
                    <View key={h.id} style={styles.barWrap}>
                      <View
                        style={[
                          styles.bar,
                          {
                            height,
                            backgroundColor: cheap ? COLORS.greenPrimary : COLORS.accentCyan,
                          },
                        ]}
                      />
                    </View>
                  );
                })}
              </View>
              <Text style={styles.hint}>
                {formatMoney(minPrice)} – {formatMoney(maxPrice)}
                {spread < 0
                  ? ' · цената е паднала с ' + formatMoney(Math.abs(spread))
                  : spread > 0
                    ? ' · цената се е вдигнала с ' + formatMoney(spread)
                    : ''}
                {unit ? ' · за ' + unit : ''}
              </Text>

              <View style={styles.monthTable}>
                {data.months.slice(-6).map((m) => (
                  <View key={m.month} style={styles.monthRow}>
                    <Text style={styles.monthLabel}>{m.month}</Text>
                    <Text style={styles.monthValue}>
                      средно {formatMoney(m.avg_price)} · {formatMoney(m.min_price)}–{formatMoney(m.max_price)}
                    </Text>
                    <Text style={styles.monthPosts}>{m.posts} сигн.</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            👥 Всички сигнали ({formatNumber(o.signals_count)})
          </Text>
          {data.signals.map((s) => (
            <SignalRow key={s.id} signal={s} onPress={() => router.push(`/post/${s.id}` as never)} />
          ))}
        </View>

        <Text style={[styles.hint, { textAlign: 'center', marginBottom: 24 }]}>
          Всички цени са в €. Данните идват от сигнали на хората — обектът се разпознава по място и град.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SignalRow({ signal, onPress }: { signal: ObjectSignal; onPress: () => void }) {
  const good = signal.polarity === 'green';
  return (
    <TouchableOpacity style={styles.signal} onPress={onPress} activeOpacity={0.85}>
      {signal.image_url ? <Image source={{ uri: signal.image_url }} style={styles.signalImage} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.signalTitle} numberOfLines={2}>
          {signal.title}
        </Text>
        <Text style={styles.signalDesc} numberOfLines={2}>
          {signal.description}
        </Text>
        <View style={styles.pillRow}>
          <View style={[styles.pill, good ? styles.pillGreen : styles.pillRed]}>
            <Text style={styles.pillText}>{formatMoney(signal.price_paid)}</Text>
          </View>
          {signal.price_per_unit ? (
            <View style={[styles.pill, styles.pillDim]}>
              <Text style={styles.pillText}>{formatMoney(signal.price_per_unit)}/{signal.unit_type}</Text>
            </View>
          ) : null}
          {signal.is_fake_promo ? (
            <View style={[styles.pill, styles.pillRed]}>
              <Text style={styles.pillText}>фалшива промоция</Text>
            </View>
          ) : null}
          {signal.is_shrinkflation ? (
            <View style={[styles.pill, styles.pillGold]}>
              <Text style={styles.pillText}>по-малко за същите пари</Text>
            </View>
          ) : null}
          {signal.verified_by_ai ? (
            <View style={[styles.pill, styles.pillCyan]}>
              <Text style={styles.pillText}>проверена бележка</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.hint}>{formatRelativeTime(signal.created_at)}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bgPrimary, gap: 10 },
  muted: { color: COLORS.textSecondary, fontSize: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  back: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  headerTitle: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
  cover: { width: '100%', height: 190, borderRadius: 18, marginBottom: 12, backgroundColor: COLORS.bgCard },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    padding: 14,
    marginBottom: 12,
  },
  name: { color: COLORS.textPrimary, fontSize: 21, fontWeight: '800' },
  sub: { color: COLORS.textSecondary, fontSize: 13.5, marginTop: 4 },
  body: { color: COLORS.textPrimary, fontSize: 14.5, marginTop: 6 },
  cardTitle: { color: COLORS.textPrimary, fontSize: 15.5, fontWeight: '800', marginBottom: 8 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
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
  pillCyan: { backgroundColor: 'rgba(34,211,238,0.12)', borderColor: 'rgba(34,211,238,0.30)' },
  pillDim: {},
  pillText: { color: COLORS.textPrimary, fontSize: 11.5, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  stat: {
    flex: 1,
    backgroundColor: COLORS.bgCardElevated,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  statLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  statValue: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '800', marginTop: 3 },
  hint: { color: COLORS.textMuted, fontSize: 12, marginTop: 8 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 100, marginTop: 6 },
  barWrap: { flex: 1, justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 3, borderTopRightRadius: 3, width: '100%' },
  monthTable: { marginTop: 12, gap: 6 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthLabel: { color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '700', width: 62 },
  monthValue: { color: COLORS.textPrimary, fontSize: 12.5, flex: 1 },
  monthPosts: { color: COLORS.textMuted, fontSize: 11.5 },
  signal: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSubtle,
  },
  signalImage: { width: 62, height: 62, borderRadius: 12, backgroundColor: COLORS.bgCardElevated },
  signalTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700' },
  signalDesc: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 },
  ghostBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  ghostBtnText: { color: COLORS.textPrimary, fontWeight: '700' },
});
