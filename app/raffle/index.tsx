import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { goBack } from '@/src/lib/navigation';
import { COLORS } from '@/constants/theme';
import { api, type RaffleItem, type RaffleWinner } from '@/src/api/client';

/** Списък с томболи + стена на печелившите (мотивация за всички). */
export default function RafflesScreen() {
  const router = useRouter();
  const [items, setItems] = useState<RaffleItem[]>([]);
  const [winners, setWinners] = useState<RaffleWinner[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [list, wall] = await Promise.all([api.raffles(), api.raffleWinners()]);
      setItems(list.items || []);
      setWinners(wall.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fmtTime = (ms: number | null | undefined) => {
    if (ms == null) return '—';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={COLORS.greenBright} />}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => goBack(router)} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Томболи</Text>
          <View style={{ width: 22 }} />
        </View>
        <Text style={styles.subtitle}>
          Изпълни условието, нареди пъзела за време и спечели наградата. Печели най-бързият.
        </Text>

        {loading ? <ActivityIndicator color={COLORS.greenBright} style={{ marginTop: 30 }} /> : null}

        {!loading && items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="gift-outline" size={34} color={COLORS.goldBright} />
            <Text style={styles.emptyText}>
              В момента няма активна томбола. Първата ще се появи тук — следи екрана.
            </Text>
          </View>
        ) : null}

        {items.map((raffle) => {
          const statusLabel =
            raffle.status === 'active'
              ? 'СЪБИРА УЧАСТНИЦИ'
              : raffle.status === 'running'
                ? 'НАРЕЖДАНЕТО Е ОТВОРЕНО'
                : raffle.status === 'finished'
                  ? 'ПРИКЛЮЧИЛА'
                  : raffle.status === 'cancelled'
                    ? 'АНУЛИРАНА'
                    : 'ЧЕРНОВА';
          const days = Math.max(0, Math.ceil(raffle.secondsLeft / 86400));
          return (
            <TouchableOpacity
              key={raffle.id}
              style={styles.card}
              activeOpacity={0.9}
              onPress={() => router.push(`/raffle/${raffle.id}` as never)}
            >
              {raffle.prize.image ? (
                <Image source={{ uri: raffle.prize.image }} style={styles.cardImage} resizeMode="cover" />
              ) : (
                <View style={[styles.cardImage, styles.cardImageFallback]}>
                  <Ionicons name="trophy" size={32} color={COLORS.goldBright} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View style={styles.badgeRow}>
                  <View style={[styles.statusPill, raffle.status === 'finished' && { backgroundColor: COLORS.bgCardElevated }]}>
                    <Text style={[styles.statusText, raffle.status === 'finished' && { color: COLORS.textSecondary }]}>
                      {statusLabel}
                    </Text>
                  </View>
                  {raffle.status === 'active' || raffle.status === 'running' ? (
                    <Text style={styles.timerText}>{days > 0 ? `${days} дни` : 'последни часове'}</Text>
                  ) : null}
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {raffle.title}
                </Text>
                <Text style={styles.prizeText} numberOfLines={1}>
                  🎁 {raffle.prize.title}
                  {raffle.prize.price ? ` · ${raffle.prize.price.toFixed(2)} €` : ''}
                </Text>
                <Text style={styles.metaText}>
                  {raffle.qualifiedCount} участници
                  {raffle.myEntry
                    ? raffle.myEntry.runTimeMs != null
                      ? ` · твоето време ${fmtTime(raffle.myEntry.runTimeMs)}`
                      : ' · участваш'
                    : raffle.myProgress != null
                      ? ` · твоят напредък ${Math.min(raffle.myProgress, raffle.conditionPosts)}/${raffle.conditionPosts} находки`
                      : ''}
                </Text>
                {raffle.status === 'finished' && raffle.winningTimeMs ? (
                  <Text style={styles.winnerText}>Победител с време {fmtTime(raffle.winningTimeMs)}</Text>
                ) : null}
                {raffle.status === 'cancelled' && raffle.cancelReason ? (
                  <Text style={styles.cancelText}>{raffle.cancelReason}</Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          );
        })}

        {winners.length > 0 ? (
          <View style={styles.wall}>
            <Text style={styles.wallTitle}>🏆 Спечелили награди</Text>
            <Text style={styles.wallSub}>Кой, кога и за колко време — за да видиш, че става</Text>
            {winners.map((w) => (
              <View key={`${w.raffleId}-${w.winner?.handle ?? 'x'}`} style={styles.wallRow}>
                <View style={styles.wallIcon}>
                  <Ionicons name="trophy" size={16} color={COLORS.black} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.wallName}>{w.winner?.name ?? 'Участник'}</Text>
                  <Text style={styles.wallMeta} numberOfLines={1}>
                    {w.prizeTitle} · време {fmtTime(w.winningTimeMs)}
                  </Text>
                </View>
                <Text style={styles.wallDate}>
                  {w.finishedAt ? new Date(w.finishedAt).toLocaleDateString('bg-BG') : ''}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  scroll: { padding: 18, paddingTop: 26, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '900' },
  subtitle: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 8, marginBottom: 16 },
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  cardImage: { width: 72, height: 72, borderRadius: 13, backgroundColor: COLORS.bgCardElevated },
  cardImageFallback: { alignItems: 'center', justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusPill: { backgroundColor: COLORS.greenSoftBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { color: COLORS.greenBright, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  timerText: { color: COLORS.textMuted, fontSize: 10.5, fontWeight: '800' },
  cardTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 6 },
  prizeText: { color: COLORS.goldBright, fontSize: 12, fontWeight: '800', marginTop: 4 },
  metaText: { color: COLORS.textMuted, fontSize: 11, marginTop: 4, fontWeight: '700' },
  winnerText: { color: COLORS.greenBright, fontSize: 11.5, marginTop: 4, fontWeight: '800' },
  cancelText: { color: COLORS.goldBright, fontSize: 11, marginTop: 4, fontWeight: '700' },
  wall: {
    marginTop: 18,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 16,
    padding: 14,
  },
  wallTitle: { color: COLORS.goldBright, fontSize: 15, fontWeight: '900' },
  wallSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 3, marginBottom: 10 },
  wallRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  wallIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.goldBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wallName: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '800' },
  wallMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  wallDate: { color: COLORS.textMuted, fontSize: 10.5, fontWeight: '700' },
});
