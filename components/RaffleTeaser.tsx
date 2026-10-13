import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { api, type RaffleItem } from '@/src/api/client';

/**
 * Рекламата ПРЕДИ регистрация: човекът вижда какво може да спечели, преди да е
 * създал профил. Целта е мотивация — „заради това си струва да вляза“.
 */
export const RaffleTeaser: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const router = useRouter();
  const [raffle, setRaffle] = useState<RaffleItem | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .raffles()
      .then(({ items }) => {
        if (!alive) return;
        const active = (items || []).find((r) => r.status === 'active' || r.status === 'running');
        setRaffle(active ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!raffle) return null;

  const daysLeft = Math.max(0, Math.ceil(raffle.secondsLeft / 86400));

  return (
    <TouchableOpacity
      style={[styles.card, compact && styles.cardCompact]}
      activeOpacity={0.9}
      onPress={() => router.push(`/raffle/${raffle.id}` as never)}
    >
      {raffle.prize.image ? (
        <Image source={{ uri: raffle.prize.image }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.image, styles.imageFallback]}>
          <Ionicons name="trophy" size={26} color={COLORS.goldBright} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <View style={styles.pill}>
          <Ionicons name="gift" size={11} color={COLORS.black} />
          <Text style={styles.pillText}>ТОМБОЛА · безплатно</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {raffle.prize.title}
        </Text>
        <Text style={styles.sub} numberOfLines={2}>
          Качи {raffle.conditionPosts} находки със снимка и нареди пъзела за време — печели най-бързият
          {daysLeft > 0 ? ` · ${daysLeft} дни до края` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={COLORS.textMuted} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 16,
    padding: 12,
    marginTop: 14,
  },
  cardCompact: { marginTop: 10 },
  image: { width: 62, height: 62, borderRadius: 12, backgroundColor: COLORS.bgCardElevated },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.goldBright,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  pillText: { color: COLORS.black, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  title: { color: COLORS.textPrimary, fontSize: 13.5, fontWeight: '900', marginTop: 6 },
  sub: { color: COLORS.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 3 },
});
