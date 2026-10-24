import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { useAuth } from '@/src/auth/AuthContext';
import { loadObjectForPost, myBusinesses } from '@/src/api/client';

/**
 * 🏢 „Това е моят бизнес“ — входът за търговеца ПОД САМАТА ОФЕРТА.
 *
 * Защо съществува (24.10.2026): бутонът стоеше само на екрана с ВСИЧКИ оферти
 * на обекта (`/place/<slug>`), който се стига само от класацията в „Радар“.
 * Затова човек, който отвори своя оферта (или оферта за своя обект) от потока,
 * търсеше „Това е моят бизнес“ там — и не го намираше, макар екранът „Моят
 * бизнес“ изрично да пишеше „…или от оферта за него“.
 *
 * Картата се показва САМО когато:
 *   • офертата принадлежи на обект (има слуг) И
 *   • обектът още НЯМА проверен търговец (иначе подканваме към чужд обект).
 *
 * Ако АЗ вече съм подал заявка за този обект, вместо бутон се показва
 * състоянието („чака екипа“) — иначе човекът подава втора заявка и се чуди
 * защо не става нищо.
 */
export function BusinessClaimCard({ postId }: { postId: string }) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [target, setTarget] = useState<{ slug: string; name: string; city: string } | null>(null);
  /** Статусът на МОЯТА заявка за този обект: pending / verified / rejected / null. */
  const [myStatus, setMyStatus] = useState<string | null>(null);

  // Към кой обект е офертата и има ли вече проверен търговец.
  useEffect(() => {
    let alive = true;
    if (!postId) return () => undefined;
    loadObjectForPost(postId)
      .then((d) => {
        if (!alive) return;
        const o = d?.object;
        if (!o?.slug) return;
        if (d?.business?.verified) return; // вече има собственик — не подканваме
        setTarget({ slug: o.slug, name: o.place_name, city: o.city || '' });
      })
      .catch(() => {
        /* картата просто не се показва */
      });
    return () => {
      alive = false;
    };
  }, [postId]);

  // Аз имам ли вече заявка за този обект (за да не подканвам повторно).
  useEffect(() => {
    let alive = true;
    if (!isAuthenticated || !target?.slug) {
      setMyStatus(null);
      return () => undefined;
    }
    myBusinesses()
      .then((res) => {
        if (!alive) return;
        const mine = (res.items ?? []).find((b) => b.venue_slug === target.slug);
        setMyStatus(mine ? mine.status : null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isAuthenticated, target?.slug]);

  if (!target) return null;
  if (myStatus === 'verified') return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="briefcase-outline" size={16} color={COLORS.greenBright} />
        <Text style={styles.title} numberOfLines={2}>
          Собственик ли си на „{target.name}“?
        </Text>
      </View>

      {myStatus === 'pending' ? (
        <>
          <Text style={styles.body}>
            Заявката ти за този обект е при екипа. Отговорът идва на имейла, който
            посочи — обикновено до един работен ден. Ако ЕИК-ът съвпадне с касова
            бележка от обекта, одобрението става веднага.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/business/dashboard' as never)}
          >
            <Ionicons name="time-outline" size={15} color={COLORS.onPrimary} />
            <Text style={styles.primaryBtnText}>Виж „Моят бизнес“</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.body}>
            Заяви обекта и получаваш значка „✅ Проверен търговец“ — право на
            ОФИЦИАЛЕН отговор под сигналите за него. Първият отговор на месец е
            безплатен.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.85}
            onPress={() =>
              router.push(
                `/business/register?slug=${target.slug}&name=${encodeURIComponent(
                  target.name
                )}&city=${encodeURIComponent(target.city)}` as never
              )
            }
          >
            <Ionicons name="briefcase-outline" size={15} color={COLORS.onPrimary} />
            <Text style={styles.primaryBtnText}>Това е моят бизнес</Text>
          </TouchableOpacity>
        </>
      )}

      <Text style={styles.hint}>
        Фалшива заявка се премахва и профилът се блокира. Ако обектът не е твой —
        просто продължи да разглеждаш.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 14,
    padding: 12,
    marginTop: 14,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '900', flex: 1 },
  body: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 8 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 11,
  },
  primaryBtnText: { color: COLORS.onPrimary, fontSize: 13, fontWeight: '900' },
  hint: { color: COLORS.textMuted, fontSize: 10.5, lineHeight: 15, marginTop: 8 },
});
