import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { api, type RaffleItem } from '@/src/api/client';

const LOCAL_KEY = '@smartprice_raffle_promo_v1';
/** Поне 4 часа между две показвания — „по различно време и влизания“, не три пъти наведнъж. */
const MIN_GAP_MS = 4 * 60 * 60 * 1000;
const MAX_VIEWS = 3;

interface LocalState {
  [raffleId: string]: { views: number; lastShown: number };
}

/**
 * Рекламата на томболата В приложението.
 *
 * Правилата: показва се на човек, който още не участва; най-много 3 пъти; между
 * две показвания минават поне 4 часа; затваря се с X. Броят се държи и на сървъра
 * (за да не се заобиколи с изтрит кеш), и локално (за да работи и без вход).
 */
export const RafflePromoHost: React.FC = () => {
  const router = useRouter();
  const [raffle, setRaffle] = useState<RaffleItem | null>(null);
  const [visible, setVisible] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (shownRef.current) return;
      try {
        const { items } = await api.raffles();
        const candidate = (items || []).find((r) => r.status === 'active' || r.status === 'running');
        if (!candidate || !alive) return;

        // локалната проверка първо (работи и преди вход)
        const raw = await AsyncStorage.getItem(LOCAL_KEY);
        const local: LocalState = raw ? (JSON.parse(raw) as LocalState) : {};
        const entry = local[candidate.id];
        if (entry && (entry.views >= MAX_VIEWS || Date.now() - entry.lastShown < MIN_GAP_MS)) return;

        // сървърът е последната дума (ако има вход)
        try {
          const state = await api.rafflePromo(candidate.id);
          if (!state.shouldShow) return;
        } catch {
          // без вход или без връзка → ползваме локалното броене
        }

        if (!alive) return;
        setRaffle(candidate);
        setVisible(true);
        shownRef.current = true;
      } catch {
        // тишина: рекламата не бива да чупи приложението
      }
    };
    const timer = setTimeout(() => void run(), 2500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const remember = useCallback(
    async (raffleId: string) => {
      try {
        const raw = await AsyncStorage.getItem(LOCAL_KEY);
        const local: LocalState = raw ? (JSON.parse(raw) as LocalState) : {};
        const prev = local[raffleId] ?? { views: 0, lastShown: 0 };
        local[raffleId] = { views: prev.views + 1, lastShown: Date.now() };
        await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(local));
      } catch {
        // кешът не е критичен
      }
      try {
        await api.markRafflePromoViewed(raffleId);
      } catch {
        // гост без вход — остава само локалното броене
      }
    },
    []
  );

  const close = useCallback(() => {
    if (raffle) void remember(raffle.id);
    setVisible(false);
  }, [raffle, remember]);

  if (!raffle) return null;

  const daysLeft = Math.max(0, Math.ceil(raffle.secondsLeft / 86400));
  const hoursLeft = Math.max(0, Math.floor((raffle.secondsLeft % 86400) / 3600));
  const needed = raffle.postsNeeded ?? raffle.conditionPosts;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <TouchableOpacity style={styles.closeBtn} onPress={close} hitSlop={12} accessibilityLabel="Затвори">
            <Ionicons name="close" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6 }}>
            <View style={styles.pillRow}>
              <View style={styles.pill}>
                <Ionicons name="gift" size={13} color={COLORS.black} />
                <Text style={styles.pillText}>ТОМБОЛА</Text>
              </View>
              <Text style={styles.timer}>
                {daysLeft > 0 ? `${daysLeft} дни` : `${hoursLeft} ч`} до края
              </Text>
            </View>

            <Text style={styles.title}>{raffle.title}</Text>

            {raffle.prize.image ? (
              <Image source={{ uri: raffle.prize.image }} style={styles.prizeImage} resizeMode="cover" />
            ) : (
              <View style={[styles.prizeImage, styles.prizeFallback]}>
                <Ionicons name="trophy" size={40} color={COLORS.goldBright} />
              </View>
            )}

            <Text style={styles.prizeTitle}>{raffle.prize.title}</Text>
            {raffle.prize.price ? (
              <Text style={styles.prizePrice}>Цена на наградата: {raffle.prize.price.toFixed(2)} €</Text>
            ) : null}

            <View style={styles.condRow}>
              <Ionicons name="image" size={15} color={COLORS.greenBright} />
              <Text style={styles.condText}>
                Качи {raffle.conditionPosts} находки със снимка
                {needed > 0 ? ` — още ${needed} са ти нужни` : ' — вече покриваш условието!'}
              </Text>
            </View>
            <View style={styles.condRow}>
              <Ionicons name="stopwatch" size={15} color={COLORS.accentCyan} />
              <Text style={styles.condText}>
                После нареждаш пъзела за време — печели най-бързият
              </Text>
            </View>
            <View style={styles.condRow}>
              <Ionicons name="people" size={15} color={COLORS.textSecondary} />
              <Text style={styles.condText}>
                {raffle.qualifiedCount} души вече участват (минимум {raffle.minParticipants})
              </Text>
            </View>

            <TouchableOpacity
              style={styles.ctaBtn}
              onPress={() => {
                close();
                router.push(`/raffle/${raffle.id}` as never);
              }}
              activeOpacity={0.88}
            >
              <Ionicons name="trophy" size={17} color={COLORS.black} />
              <Text style={styles.ctaText}>Виж томболата и участвай</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.ghostBtn} onPress={close} activeOpacity={0.7}>
              <Text style={styles.ghostText}>Не сега</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '88%',
    backgroundColor: COLORS.bgPrimary,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 22,
    padding: 18,
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 5,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.bgCardElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.goldBright,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: { color: COLORS.black, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  timer: { color: COLORS.textMuted, fontSize: 11.5, fontWeight: '800' },
  title: { color: COLORS.textPrimary, fontSize: 19, fontWeight: '900', letterSpacing: -0.3, lineHeight: 25 },
  prizeImage: {
    width: '100%',
    height: 170,
    borderRadius: 16,
    marginTop: 12,
    backgroundColor: COLORS.bgCard,
  },
  prizeFallback: { alignItems: 'center', justifyContent: 'center' },
  prizeTitle: { color: COLORS.goldBright, fontSize: 15.5, fontWeight: '900', marginTop: 12 },
  prizePrice: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 4, fontWeight: '700' },
  condRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 10 },
  condText: { flex: 1, color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18 },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.greenBright,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 16,
  },
  ctaText: { color: COLORS.black, fontSize: 14.5, fontWeight: '900' },
  ghostBtn: { alignItems: 'center', paddingVertical: 11 },
  ghostText: { color: COLORS.textMuted, fontSize: 12.5, fontWeight: '700' },
});
