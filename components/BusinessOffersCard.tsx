import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { publicVenueOffers, type BusinessOffer } from '@/src/api/client';

/** „2026-11-15“ → „15.11.2026“ (както го пише българинът). */
function bgDay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

/**
 * 🏷️ Оферти от търговеца — показват се в НЕГОВИЯ обект.
 *
 * Защо не в общата лента: лентата е честна цена от хора. Ако в нея влязат
 * платени промоции, доверието (целият смисъл на SmartPrice) пада. Тук човекът
 * вече е в обекта и вижда какво дава самият търговец, ясно обозначено.
 */
export function BusinessOffersCard({ slug }: { slug: string }) {
  const [offers, setOffers] = useState<BusinessOffer[]>([]);

  useEffect(() => {
    let alive = true;
    if (!slug) return;
    void publicVenueOffers(slug)
      .then((list) => {
        if (alive) setOffers(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slug]);

  if (offers.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="pricetags" size={16} color={COLORS.goldBright} />
        <Text style={styles.title}>Оферти от търговеца</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>ОТ БИЗНЕСА</Text>
        </View>
      </View>

      {offers.map((o) => (
        <View key={o.id} style={styles.row}>
          {o.image_url ? <Image source={{ uri: o.image_url }} style={styles.thumb} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.offerTitle} numberOfLines={2}>
              {o.title}
            </Text>
            {o.description ? (
              <Text style={styles.offerDesc} numberOfLines={3}>
                {o.description}
              </Text>
            ) : null}
            <View style={styles.metaRow}>
              {o.price != null ? (
                <Text style={styles.price}>{o.price.toFixed(2)} €</Text>
              ) : null}
              {o.old_price != null && o.price != null ? (
                <Text style={styles.oldPrice}>{o.old_price.toFixed(2)} €</Text>
              ) : null}
              {o.valid_until ? (
                <Text style={styles.valid}>до {bgDay(o.valid_until)}</Text>
              ) : null}
            </View>
          </View>
        </View>
      ))}

      <Text style={styles.hint}>
        Това е оферта, качена от самия търговец — не е находка на потребител и не влиза в
        класацията „изгодно“.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 16,
    padding: 13,
    marginBottom: 12,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  title: { flex: 1, color: COLORS.textPrimary, fontSize: 14, fontWeight: '900' },
  badge: {
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { color: COLORS.textPrimary, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
    paddingVertical: 10,
  },
  thumb: { width: 56, height: 56, borderRadius: 10 },
  offerTitle: { color: COLORS.textPrimary, fontSize: 13.5, fontWeight: '800' },
  offerDesc: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' },
  price: { color: COLORS.greenBright, fontSize: 14, fontWeight: '900' },
  oldPrice: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'line-through',
  },
  valid: { color: COLORS.textMuted, fontSize: 11.5, fontWeight: '700' },
  hint: { color: COLORS.textMuted, fontSize: 10.5, lineHeight: 15, marginTop: 4 },
});
