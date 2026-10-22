import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { formatMoney, formatNumber } from '@/src/lib/format';
import { loadObjectForPost, type ObjectDetail } from '@/src/api/client';

/**
 * 🏪 Малка карта в офертата: към кой обект принадлежи и колко пъти хората са
 * сигнализирали за него. Води към пълната страница на обекта (#11).
 */
export function ObjectSignalsCard({ postId }: { postId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ObjectDetail | null>(null);

  useEffect(() => {
    let alive = true;
    if (!postId) return () => undefined;
    loadObjectForPost(postId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setData(null);
      });
    return () => {
      alive = false;
    };
  }, [postId]);

  if (!data || !data.object) return null;
  const o = data.object;
  if (!o.signals_count || o.signals_count < 1) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>🏪 Обектът</Text>
      <Text style={styles.name}>
        {o.place_name}
        {o.city ? ', ' + o.city : ''}
      </Text>
      <Text style={styles.meta}>
        {formatNumber(o.signals_count)} сигнала
        {o.reporters_count > 1 ? ' от ' + formatNumber(o.reporters_count) + ' души' : ''}
        {/*
          📍 ПИТФОЛ (22.10.2026): местата от Google Maps нямат реална цена —
          при тях сме сложили 0.01 € само защото базата изисква стойност.
          Затова НЕ показваме „средно 0.01 € · 0.01 €–0.01 €“ (подвежда).
        */}
        {(o.min_price ?? 0) > 0.01 && o.avg_price != null
          ? ' · средно ' + formatMoney(o.avg_price)
          : ''}
        {(o.min_price ?? 0) > 0.01 && o.min_price != null && o.max_price != null
          ? ' · ' + formatMoney(o.min_price) + '–' + formatMoney(o.max_price)
          : ''}
        {(o.min_price ?? 0) <= 0.01 ? ' · няма посочена цена' : ''}
        {o.helped_total > 0 ? ' · помогнало ' + formatNumber(o.helped_total) + '×' : ''}
      </Text>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => router.push(('/object/' + o.slug) as never)}
        activeOpacity={0.85}
      >
        <Text style={styles.btnText}>История на цените и всички сигнали →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  title: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  name: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '800', marginTop: 4 },
  meta: { color: COLORS.textSecondary, fontSize: 13, marginTop: 6 },
  btn: {
    marginTop: 12,
    paddingVertical: 11,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
  },
  btnText: { color: COLORS.greenBright, fontSize: 13.5, fontWeight: '800' },
});
