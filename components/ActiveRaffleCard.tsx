import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { api, type RaffleItem } from '@/src/api/client';

/**
 * Томболата на главната страница.
 *
 * Показва ИСТИНСКАТА активна томбола с реалните ѝ числа от сървъра: награда,
 * колко дни остават, колко души вече участват (спрямо минимума) и докъде е
 * човекът с условието. Нищо не е „примерно“ — всичко идва от /api/raffles.
 */
export const ActiveRaffleCard: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const [raffle, setRaffle] = useState<RaffleItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { items } = await api.raffles();
        const active = (items || []).find((r) => r.status === 'active' || r.status === 'running');
        if (alive) setRaffle(active ?? null);
      } catch {
        if (alive) setRaffle(null);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    // Числата се опресняват на всеки 60 секунди, за да не остареят.
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={COLORS.goldBright} size="small" />
      </View>
    );
  }

  if (!raffle) return null;

  const daysLeft = Math.max(0, Math.ceil(raffle.secondsLeft / 86400));
  const hoursLeft = Math.max(0, Math.floor((raffle.secondsLeft % 86400) / 3600));
  const needed = raffle.postsNeeded ?? raffle.conditionPosts;
  const participants = raffle.qualifiedCount ?? 0;
  const min = raffle.minParticipants ?? 0;
  const minReached = participants >= min;
  const progress = Math.min(raffle.myProgress ?? 0, raffle.conditionPosts);
  const participating = Boolean(raffle.myEntry);

  const statusLabel =
    raffle.status === 'running' ? 'НАРЕЖДАНЕТО Е ОТВОРЕНО' : 'СЪБИРА УЧАСТНИЦИ';

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.92} onPress={onOpen}>
      <View style={styles.topRow}>
        <View style={styles.pill}>
          <Ionicons name="gift" size={12} color={COLORS.black} />
          <Text style={styles.pillText}>ТОМБОЛА · безплатно</Text>
        </View>
        <Text style={styles.timer}>
          {daysLeft > 0 ? `${daysLeft} дни до края` : `${hoursLeft} ч до края`}
        </Text>
      </View>

      <View style={styles.mainRow}>
        {raffle.prize.image ? (
          <Image source={{ uri: raffle.prize.image }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.imageFallback]}>
            <Ionicons name="trophy" size={28} color={COLORS.goldBright} />
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={2}>
            {raffle.title}
          </Text>
          <Text style={styles.prize} numberOfLines={1}>
            🎁 {raffle.prize.title}
            {raffle.prize.price ? ` · ${raffle.prize.price.toFixed(2)} €` : ''}
          </Text>
          <Text style={styles.status}>{statusLabel}</Text>
        </View>
      </View>

      {/* Реалните числа: колко души участват и колко още са нужни */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{participants}</Text>
          <Text style={styles.statLbl}>участват</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statVal, !minReached && { color: COLORS.goldBright }]}>
            {minReached ? '✓' : min}
          </Text>
          <Text style={styles.statLbl}>{minReached ? 'минимумът е покрит' : 'нужни минимум'}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statVal, { color: participating ? COLORS.greenBright : COLORS.textPrimary }]}>
            {participating ? 'участваш' : `${progress}/${raffle.conditionPosts}`}
          </Text>
          <Text style={styles.statLbl}>
            {participating ? 'ти си в томболата' : 'твои находки'}
          </Text>
        </View>
      </View>

      <View style={styles.ctaRow}>
        <Text style={styles.ctaHint}>
          {participating
            ? 'Виж класацията и нареди пъзела'
            : needed > 0
              ? `Качи още ${needed} находки${needed === 1 ? 'у' : ''} със снимка и се включи`
              : 'Покри условието — включи се и нареди пъзела'}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={COLORS.goldBright} />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  loadingBox: { paddingVertical: 14, alignItems: 'center' },
  card: {
    marginTop: 12,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 18,
    padding: 13,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.goldBright,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  pillText: { color: COLORS.black, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.5 },
  timer: { color: COLORS.textMuted, fontSize: 11.5, fontWeight: '800' },
  mainRow: { flexDirection: 'row', gap: 12, marginTop: 11, alignItems: 'center' },
  image: { width: 68, height: 68, borderRadius: 14, backgroundColor: COLORS.bgCardElevated },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: 14.5, fontWeight: '900' },
  prize: { color: COLORS.goldBright, fontSize: 12.5, fontWeight: '800', marginTop: 4 },
  status: { color: COLORS.accentCyan, fontSize: 10, fontWeight: '900', letterSpacing: 0.6, marginTop: 5 },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.bgCardElevated,
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  statVal: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '900' },
  statLbl: { color: COLORS.textMuted, fontSize: 9.5, fontWeight: '700', marginTop: 2, textAlign: 'center' },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  ctaHint: { flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '700' },
});