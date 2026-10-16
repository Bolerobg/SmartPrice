import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { api, type RaffleItem } from '@/src/api/client';

const STORE_KEY = '@smartprice_raffle_promo_v2';

/** Колко да се изчака след отваряне на приложението, преди първата покана. */
const FIRST_DELAY_MS = 7_000;
/** Периодичност на проверката — „периодично“, но в рамките на една сесия. */
const CHECK_EVERY_MS = 18 * 60 * 1000;
/** Най-малко време между две покани (за да не досажда). */
const MIN_GAP_MS = 5 * 60 * 60 * 1000;
/** Най-много покани за една томбола. */
const MAX_VIEWS = 3;
/** Най-много покани на ден общо (за всички томболи). */
const MAX_PER_DAY = 2;
/** „По-късно“ — колко да мълчи (по-дълго от MIN_GAP, за да има смисъл). */
const SNOOZE_MS = 8 * 60 * 60 * 1000;

type Invite = { emoji: string; title: string; line: string; cta: string };

/**
 * Поканите се въртят — всеки път различна, но винаги подканваща.
 * Никога не се пада два пъти поред една и съща.
 */
const INVITES: Invite[] = [
  {
    emoji: '🎁',
    title: 'Наградата още чака своя човек',
    line: 'Няколко находки те делят от това да я грабнеш.',
    cta: 'Участвам',
  },
  {
    emoji: '📸',
    title: 'Една снимка може да е достатъчна',
    line: 'Качваш находка със снимка и си в играта.',
    cta: 'Качи находка',
  },
  {
    emoji: '🏁',
    title: 'Първият печели — не най-умният',
    line: 'Който първи изпълни условието, взема наградата. Днес може да си ти.',
    cta: 'Влизам в играта',
  },
  {
    emoji: '⏳',
    title: 'Томболата тече точно сега',
    line: 'Всеки ден без находка е ден, в който някой друг се приближава.',
    cta: 'Виж томболата',
  },
  {
    emoji: '🧾',
    title: 'Касовият бон в джоба ти',
    line: 'Една бележка от кошчето на касата — и си участник.',
    cta: 'Участвам',
  },
  {
    emoji: '🎯',
    title: 'Ти си на една стъпка',
    line: 'Пусни находка със снимка и виж как расте твоят напредък.',
    cta: 'Продължавам',
  },
  {
    emoji: '🏆',
    title: 'Някой ще спечели. Защо не ти?',
    line: 'Участието е безплатно и не изисква покупка — само находки.',
    cta: 'Участвам',
  },
  {
    emoji: '🔥',
    title: 'Хората вече се включат',
    line: 'Не чакай да видиш името на друг на стената с победители.',
    cta: 'Включи се',
  },
  {
    emoji: '🚀',
    title: 'Още малко и си на финала',
    line: 'Събери находките и наградата идва с куриер до вратата.',
    cta: 'Напред',
  },
  {
    emoji: '💡',
    title: 'Знаеш ли цена, която друг не знае?',
    line: 'Сподели я и влез в томболата за наградата.',
    cta: 'Споделям',
  },
  {
    emoji: '🎈',
    title: 'Малка находка, голяма награда',
    line: 'Качваш находка със снимка — брои се за томболата.',
    cta: 'Да пробвам',
  },
  {
    emoji: '👀',
    title: 'Гледаш ли, или участваш?',
    line: 'Едно действие те дели от наградата, която някой ще вземе.',
    cta: 'Участвам',
  },
];

/** Когато условието вече е изпълнено — подканваме за самото нареждане. */
const QUALIFIED_INVITES: Invite[] = [
  {
    emoji: '🧩',
    title: 'Условието е изпълнено — остава пъзелът',
    line: 'Нареди го за време и ще си на стената с победители.',
    cta: 'Нареди пъзела',
  },
  {
    emoji: '⚡',
    title: 'Ти си в играта! Само да наредиш',
    line: 'Времето се мери от сървъра — честно е за всички.',
    cta: 'Играя сега',
  },
  {
    emoji: '🥇',
    title: 'Бързите печелят',
    line: 'Виж класацията и си вземи твоето време.',
    cta: 'Към пъзела',
  },
];

interface Entry {
  views: number;
  lastShown: number;
  muted?: boolean;
  /** Ако е зададено — да не се показва преди този момент („По-късно“). */
  until?: number;
}
interface Store {
  raffles: Record<string, Entry>;
  /** Коя покана е показана последно, за да не се пада два пъти. */
  lastIndex: number;
  day: string;
  dayCount: number;
}

const EMPTY: Store = { raffles: {}, lastIndex: -1, day: '', dayCount: 0 };

async function loadStore(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return { ...EMPTY, raffles: {} };
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      raffles: parsed.raffles || {},
      lastIndex: typeof parsed.lastIndex === 'number' ? parsed.lastIndex : -1,
      day: parsed.day || '',
      dayCount: typeof parsed.dayCount === 'number' ? parsed.dayCount : 0,
    };
  } catch {
    return { ...EMPTY, raffles: {} };
  }
}

async function saveStore(next: Store): Promise<void> {
  try {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    // кешът не е критичен
  }
}

const todayKey = () => new Date().toISOString().slice(0, 10);

/** Избира покана, различна от последната. */
function pickInvite(list: Invite[], lastIndex: number): number {
  if (list.length === 1) return 0;
  let idx = Math.floor(Math.random() * list.length);
  if (idx === lastIndex) idx = (idx + 1) % list.length;
  return idx;
}

/**
 * Рекламата на томболите за находки В приложението.
 *
 * Правила (за да не досажда):
 *  • показва се само на човек, който още не участва и не е играл;
 *  • най-много 3 пъти за една томбола и най-много 2 пъти на ден общо;
 *  • между две покани минават поне 5 часа;
 *  • „По-късно“ мълчи 8 часа, а „не искам повече“ спира тази томбола завинаги;
 *  • всяка покана е различна — въртят се 12 подканващи текста;
 *  • сървърът е последната дума (за да не се заобиколи с изтрит кеш),
 *    локалното броене пази и госта без профил.
 */
export const RafflePromoHost: React.FC = () => {
  const router = useRouter();
  const [raffle, setRaffle] = useState<RaffleItem | null>(null);
  const [invite, setInvite] = useState<Invite>(INVITES[0]);
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const inviteIndexRef = useRef(-1);
  const busyRef = useRef(false);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      if (!alive || busyRef.current || visibleRef.current) return;
      busyRef.current = true;
      try {
        const { items } = await api.raffles();
        const candidates = (items || []).filter(
          (r) =>
            (r.status === 'active' || r.status === 'running') &&
            !r.myEntry?.runTimeMs &&
            !r.myEntry?.disqualified
        );
        if (!candidates.length) return;

        // Първо томболите „за находки“ (първият, изпълнил условието).
        const candidate =
          candidates.find((r) => (r.winMode ?? 'first_to_complete') === 'first_to_complete') ||
          candidates[0];

        const store = await loadStore();
        const entry = store.raffles[candidate.id];
        if (entry?.muted) return;
        if (entry && entry.views >= MAX_VIEWS) return;
        if (entry?.until && Date.now() < entry.until) return;
        if (entry && Date.now() - entry.lastShown < MIN_GAP_MS) return;

        const dayCount = store.day === todayKey() ? store.dayCount : 0;
        if (dayCount >= MAX_PER_DAY) return;

        // Сървърът е последната дума (ако има вход).
        try {
          const state = await api.rafflePromo(candidate.id);
          if (!state.shouldShow) return;
        } catch {
          // без вход или без връзка → ползваме локалното броене
        }

        if (!alive) return;
        const list = candidate.myEntry?.qualified ? QUALIFIED_INVITES : INVITES;
        const idx = pickInvite(list, store.lastIndex);
        inviteIndexRef.current = idx;
        setInvite(list[idx]);
        setRaffle(candidate);
        setVisible(true);
      } catch {
        // тишина: рекламата не бива да чупи приложението
      } finally {
        busyRef.current = false;
      }
    };

    const first = setTimeout(() => void tick(), FIRST_DELAY_MS);
    const every = setInterval(() => void tick(), CHECK_EVERY_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  /**
   * Записва показването. `mode`:
   *  • view   — затворена с X (пак ще се покаже, но след почивка)
   *  • snooze — „По-късно“ (мълчи 3 часа)
   *  • mute   — „не искам повече“ за тази томбола
   */
  const remember = useCallback(async (raffleId: string, mode: 'view' | 'snooze' | 'mute') => {
    const store = await loadStore();
    const prev = store.raffles[raffleId] ?? { views: 0, lastShown: 0 };
    const now = Date.now();
    store.raffles[raffleId] = {
      views: prev.views + 1,
      lastShown: now,
      muted: mode === 'mute' ? true : prev.muted,
      until: mode === 'snooze' ? now + SNOOZE_MS : undefined,
    };
    store.lastIndex = inviteIndexRef.current;
    const day = todayKey();
    const prevDayCount = store.day === day ? store.dayCount : 0;
    store.day = day;
    store.dayCount = prevDayCount + 1;
    await saveStore(store);

    try {
      await api.markRafflePromoViewed(raffleId);
    } catch {
      // гост без вход — остава само локалното броене
    }
  }, []);

  const close = useCallback(
    (mode: 'view' | 'snooze' | 'mute') => {
      if (raffle) void remember(raffle.id, mode);
      setVisible(false);
    },
    [raffle, remember]
  );

  if (!raffle) return null;

  const daysLeft = Math.max(0, Math.ceil(raffle.secondsLeft / 86400));
  const hoursLeft = Math.max(0, Math.floor((raffle.secondsLeft % 86400) / 3600));
  const need = raffle.postsNeeded ?? raffle.conditionPosts;
  const have = Math.max(0, raffle.myProgress ?? 0);
  const qualified = Boolean(raffle.myEntry?.qualified) || (need > 0 && have >= need);
  const pct = need > 0 ? Math.min(100, Math.round((have / need) * 100)) : 0;
  const distinct = raffle.conditionDistinctDays ?? 0;
  const sponsor = raffle.sponsor?.name || '';
  const prizeImage = raffle.prize?.image;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => close('view')}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => close('view')}
            hitSlop={12}
            accessibilityLabel="Затвори"
          >
            <Ionicons name="close" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 4 }}>
            <View style={styles.pillRow}>
              <View style={styles.pill}>
                <Ionicons name="gift" size={13} color={COLORS.black} />
                <Text style={styles.pillText}>ТОМБОЛА ЗА НАХОДКА</Text>
              </View>
              <Text style={styles.timer}>
                {daysLeft > 0 ? `${daysLeft} дни` : `${hoursLeft} ч`} до края
              </Text>
            </View>

            <View style={styles.emojiRow}>
              <Text style={styles.emoji}>{invite.emoji}</Text>
            </View>

            <Text style={styles.title}>{invite.title}</Text>
            <Text style={styles.line}>{invite.line}</Text>

            {prizeImage ? (
              <Image source={{ uri: prizeImage }} style={styles.prizeImage} resizeMode="cover" />
            ) : (
              <View style={[styles.prizeImage, styles.prizeFallback]}>
                <Ionicons name="trophy" size={40} color={COLORS.goldBright} />
              </View>
            )}

            <Text style={styles.prizeTitle}>{raffle.prize?.title || raffle.title}</Text>
            {sponsor ? (
              <Text style={styles.sponsor}>Награда от {sponsor}</Text>
            ) : raffle.prize?.price ? (
              <Text style={styles.prizePrice}>Стойност {raffle.prize.price.toFixed(2)} €</Text>
            ) : null}

            {/* Напредък към условието — човекът вижда, че е близо. */}
            <View style={styles.progressWrap}>
              <View style={styles.progressHead}>
                <Text style={styles.progressLabel}>
                  {qualified ? 'Условието е изпълнено ✅' : `Твоят напредък: ${have} от ${need}`}
                </Text>
                {!qualified && distinct > 0 ? (
                  <Text style={styles.progressHint}>
                    от ≥{distinct} различни дни
                    {raffle.daysNeeded ? ` · още ${raffle.daysNeeded} дни` : ''}
                  </Text>
                ) : null}
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${qualified ? 100 : pct}%` },
                    qualified && { backgroundColor: COLORS.greenBright },
                  ]}
                />
              </View>
            </View>

            <View style={styles.condRow}>
              <Ionicons name="people" size={15} color={COLORS.textSecondary} />
              <Text style={styles.condText}>
                {raffle.qualifiedCount} души вече участват
                {raffle.minParticipants > 1 ? ` (минимум ${raffle.minParticipants})` : ''}
              </Text>
            </View>
            <View style={styles.condRow}>
              <Ionicons name="pricetag" size={15} color={COLORS.accentCyan} />
              <Text style={styles.condText}>
                Участието е безплатно и не изисква покупка.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.ctaBtn}
              onPress={() => {
                close('view');
                router.push(`/raffle/${raffle.id}` as never);
              }}
              activeOpacity={0.88}
            >
              <Ionicons name="trophy" size={17} color={COLORS.black} />
              <Text style={styles.ctaText}>{invite.cta}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.ghostBtn} onPress={() => close('snooze')} activeOpacity={0.7}>
              <Text style={styles.ghostText}>По-късно</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.muteBtn} onPress={() => close('mute')} activeOpacity={0.6}>
              <Text style={styles.muteText}>Не ми напомняй повече за тази томбола</Text>
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
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
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
  emojiRow: { alignItems: 'flex-start', marginTop: 4 },
  emoji: { fontSize: 34, lineHeight: 42 },
  title: {
    color: COLORS.textPrimary,
    fontSize: 19.5,
    fontWeight: '900',
    letterSpacing: -0.3,
    lineHeight: 26,
  },
  line: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6 },
  prizeImage: {
    width: '100%',
    height: 160,
    borderRadius: 16,
    marginTop: 12,
    backgroundColor: COLORS.bgCard,
  },
  prizeFallback: { alignItems: 'center', justifyContent: 'center' },
  prizeTitle: { color: COLORS.goldBright, fontSize: 15.5, fontWeight: '900', marginTop: 12 },
  sponsor: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 4, fontWeight: '700' },
  prizePrice: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 4, fontWeight: '700' },
  progressWrap: { marginTop: 14 },
  progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  progressLabel: { color: COLORS.textPrimary, fontSize: 12.5, fontWeight: '800' },
  progressHint: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: COLORS.bgCardElevated,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: COLORS.accentCyan },
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
  ghostBtn: { alignItems: 'center', paddingVertical: 10 },
  ghostText: { color: COLORS.textMuted, fontSize: 12.5, fontWeight: '700' },
  muteBtn: { alignItems: 'center', paddingBottom: 2 },
  muteText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600', opacity: 0.8 },
});
