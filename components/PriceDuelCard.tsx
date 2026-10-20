import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import type { PriceDuel, TwinOffer } from '@/types';

/**
 * ⚔️ Ценова проверка — „същият продукт при друг доставчик“.
 *
 * Какво прави различно от обикновения списък „същият продукт другаде“:
 *  1. КАЗВА ПРИСЪДАТА — не просто цени, а „ти си най-евтиният“ / „по-скъпо с
 *     18%“ / „чист обир“ — човекът разбира смисъла с един поглед;
 *  2. ПОКАЗВА РАЗЛИКАТА В € И % за всяка конкурентна оферта, а не само цената;
 *  3. ЦВЕТЕН ФЛАГ — ако конкуренцията е ПО-СКЪПА от нашата цена, редът носи
 *     червен флаг (🚩 +X%), ако е по-евтина — зелена стрелка надолу;
 *  4. ЛЕНТОВА ДИАГРАМА — всички цени една до друга, за да се види „къде съм“;
 *  5. СРЕДНА ПАЗАРНА ЦЕНА — за да знае човекът дали цената е нормална.
 *
 * Натискането на конкурентна оферта отваря нейната страница (за да види
 * условията ѝ — град, магазин, снимка), вместо просто да я сравни на сляпо.
 */
interface Props {
  duel: PriceDuel;
  /** Валутата на нашата оферта (€). */
  myCurrency?: string;
  onOpen: (postId: string) => void;
}

/** Един ред от лентата: цвят, текст и цена. */
function barInfo(price: number, duel: PriceDuel) {
  const isMine = Math.abs(price - duel.myPrice) < 0.005;
  const cheapest = price <= duel.cheapestPrice + 0.005;
  const color = isMine
    ? duel.verdict === 'cheapest'
      ? COLORS.greenPrimary
      : duel.verdict === 'similar'
        ? COLORS.accentCyan
        : COLORS.redPrimary
    : cheapest
      ? COLORS.greenPrimary
      : price > duel.myPrice
        ? COLORS.redPrimary
        : COLORS.accentCyan;
  return { isMine, cheapest, color };
}

export const PriceDuelCard: React.FC<Props> = ({ duel, myCurrency = '€', onOpen }) => {
  const verdict = duel.verdict;
  const accent =
    verdict === 'cheapest' ? COLORS.greenBright : verdict === 'similar' ? COLORS.accentCyan : COLORS.redBright;
  const softBg =
    verdict === 'cheapest'
      ? COLORS.greenSoftBg
      : verdict === 'similar'
        ? 'rgba(34,211,238,0.12)'
        : COLORS.redSoftBg;
  const border =
    verdict === 'cheapest' ? COLORS.greenBorder : verdict === 'similar' ? 'rgba(34,211,238,0.30)' : COLORS.redBorder;

  const nearestCheaper = duel.others.find((o) => o.cheaper) ?? null;
  const fmt = (v: number) => `${v.toFixed(2)} ${myCurrency}`;

  const headline =
    verdict === 'cheapest'
      ? '🏆 Ти си с най-ниската цена'
      : verdict === 'similar'
        ? '🤝 Цената ти е близка до пазарната'
        : verdict === 'pricier'
          ? '🔴 По-скъпо от конкуренцията'
          : '🚨 Значително по-скъпо от другаде';

  const sub =
    verdict === 'cheapest'
      ? `От ${duel.twinCount} ${duel.twinCount === 1 ? 'друга оферта' : 'други оферти'} за този продукт никой не е по-евтин. Средна цена на пазара: ${fmt(duel.avgPrice)}.`
      : nearestCheaper
        ? `Същият продукт го има за ${fmt(nearestCheaper.price)}${
            nearestCheaper.place ? ' в ' + nearestCheaper.place : ''
          } — това е ${fmt(duel.saving)} (${duel.savingPct}%) по-малко.`
        : `Средна цена на пазара: ${fmt(duel.avgPrice)}.`;

  // Лентовата диаграма: всички цени, подредени от най-ниската, с ясен маркер „ТИ“.
  const bars: Array<{ label: string; price: number; mine?: boolean }> = [
    ...duel.others.slice(0, 6).map((o) => ({
      label: o.place || o.city || 'Друга оферта',
      price: o.price,
    })),
    { label: 'ТВОЯТА ЦЕНА', price: duel.myPrice, mine: true },
  ].sort((a, b) => a.price - b.price);

  const maxPrice = duel.maxPrice > 0 ? duel.maxPrice : duel.myPrice;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="git-compare-outline" size={16} color={accent} />
        <Text style={styles.title}>Ценова проверка</Text>
        <View style={[styles.countChip, { backgroundColor: softBg, borderColor: border }]}>
          <Text style={[styles.countChipText, { color: accent }]}>
            {duel.twinCount} {duel.twinCount === 1 ? 'конкурент' : 'конкуренти'}
          </Text>
        </View>
      </View>

      {/* Присъдата — едно изречение, което човекът разбира веднага. */}
      <View style={[styles.verdict, { backgroundColor: softBg, borderColor: border }]}>
        <Text style={[styles.verdictTitle, { color: accent }]}>{headline}</Text>
        <Text style={styles.verdictSub}>{sub}</Text>
        {duel.overAvgPct !== 0 ? (
          <Text style={styles.verdictMeta}>
            {duel.overAvgPct > 0
              ? `Ти плащаш с ${Math.abs(duel.overAvgPct)}% повече от средното за пазара`
              : `Ти плащаш с ${Math.abs(duel.overAvgPct)}% по-малко от средното за пазара`}
          </Text>
        ) : null}
      </View>

      {/* Лентата: виждаш всички цени една до друга и къде си ти. */}
      <View style={styles.bars}>
        {bars.map((b, i) => {
          const info = barInfo(b.price, duel);
          return (
            <View key={`${b.label}-${i}`} style={styles.barRow}>
              <Text style={[styles.barLabel, info.isMine && { color: accent, fontWeight: '900' }]} numberOfLines={1}>
                {info.isMine ? 'ТИ' : b.label}
              </Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.max(6, Math.min(100, Math.round((b.price / maxPrice) * 100)))}%`,
                      backgroundColor: info.color,
                      opacity: info.isMine ? 1 : 0.75,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.barPrice, info.isMine && { color: accent, fontWeight: '900' }]}>
                {b.price.toFixed(2)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Конкурентите, подредени от най-евтината, с разликата в € и %. */}
      <View style={{ marginTop: 4 }}>
        {duel.others.slice(0, 8).map((o: TwinOffer) => (
          <TouchableOpacity
            key={o.id}
            style={[styles.row, o.cheaper && styles.rowCheap]}
            onPress={() => onOpen(o.id)}
            accessibilityRole="button"
            activeOpacity={0.85}
          >
            {o.imageUrl ? (
              <Image source={{ uri: o.imageUrl }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]}>
                <Ionicons name="image-outline" size={15} color={COLORS.textMuted} />
              </View>
            )}

            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {o.place || o.title}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {o.source === 'scraper' ? '🌐 онлайн магазин' : '📍 ' + (o.city || 'място от офертата')}
                {o.code ? ` · #${o.code}` : ''}
                {/* Честно: ако заглавията съвпадат частично, казваме „подобен“. */}
                {o.similarity < 0.75 ? ' · ≈ подобен продукт' : ''}
              </Text>
            </View>

            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.rowPrice, { color: o.cheaper ? COLORS.greenBright : COLORS.textPrimary }]}>
                {o.price.toFixed(2)} {myCurrency}
              </Text>
              <View
                style={[
                  styles.deltaChip,
                  {
                    backgroundColor: o.cheaper ? COLORS.greenSoftBg : COLORS.redSoftBg,
                    borderColor: o.cheaper ? COLORS.greenBorder : COLORS.redBorder,
                  },
                ]}
              >
                <Text
                  style={[styles.deltaText, { color: o.cheaper ? COLORS.greenBright : COLORS.redBright }]}
                >
                  {/* Черен флаг, когато ТАЗИ оферта е по-скъпа от нашата цена. */}
                  {o.cheaper ? `↓ ${Math.abs(o.deltaPct)}% по-евтино` : `🚩 +${o.deltaPct}% по-скъпо`}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.footRow}>
        <Ionicons name="pricetags-outline" size={13} color={COLORS.textMuted} />
        <Text style={styles.footText}>
          Най-ниска: {fmt(duel.minPrice)} · Средна: {fmt(duel.avgPrice)} · Най-висока: {fmt(duel.maxPrice)}
          {'  ·  '}
          {duel.others.length} оферти сравнени
        </Text>
      </View>
      <Text style={styles.hintFoot}>
        Сравнението се прави по смислените думи в заглавието на продукта. Провери цената в магазина, преди да
        платиш — натисни офертата, за да видиш подробностите ѝ.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 18,
    padding: 13,
    marginTop: 12,
    marginBottom: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { flex: 1, color: COLORS.textPrimary, fontSize: 15, fontWeight: '900' },
  countChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  countChipText: { fontSize: 10.5, fontWeight: '800' },
  verdict: { borderWidth: 1, borderRadius: 14, padding: 11, marginTop: 10, gap: 4 },
  verdictTitle: { fontSize: 14, fontWeight: '900' },
  verdictSub: { color: COLORS.textPrimary, fontSize: 12.5, lineHeight: 18 },
  verdictMeta: { color: COLORS.textSecondary, fontSize: 11.5, fontWeight: '700' },
  bars: { marginTop: 12, gap: 6 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  barLabel: { width: 78, color: COLORS.textSecondary, fontSize: 10.5, fontWeight: '700' },
  barTrack: {
    flex: 1,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.bgCardElevated,
    overflow: 'hidden',
  },
  barFill: { height: 12, borderRadius: 6 },
  barPrice: { width: 52, textAlign: 'right', color: COLORS.textPrimary, fontSize: 11.5, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 13,
    marginTop: 6,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  rowCheap: { borderColor: COLORS.greenBorder, backgroundColor: COLORS.greenSoftBg },
  thumb: { width: 42, height: 42, borderRadius: 10, backgroundColor: COLORS.bgCard },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '800' },
  rowMeta: { color: COLORS.textMuted, fontSize: 10.5, marginTop: 2 },
  rowPrice: { fontSize: 13.5, fontWeight: '900' },
  deltaChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 3,
  },
  deltaText: { fontSize: 10, fontWeight: '800' },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 11, flexWrap: 'wrap' },
  footText: { color: COLORS.textMuted, fontSize: 10.5, fontWeight: '700', flex: 1 },
  hintFoot: { color: COLORS.textMuted, fontSize: 10.5, lineHeight: 15, marginTop: 6 },
});
