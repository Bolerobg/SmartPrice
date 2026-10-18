import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { goBack } from '@/src/lib/navigation';
import { COLORS } from '@/constants/theme';
import { ProductPairPuzzle } from '@/components/ProductPairPuzzle';
import { api, type PuzzleTile } from '@/src/api/client';

/**
 * 🎮 ДЕМО (ТРЕНИРОВКА) НА ПЪЗЕЛА — свободна игра, без ограничения.
 *
 * Защо съществува: човек, който не е играл, не участва в томболата. Тук играе
 * колкото иска, вижда че може да се справи, и сам отива към истинското участие.
 *
 * ЧЕСТНО: тук НЕ броим нищо за класацията. Времето се мери само за да покажем
 * на човека как се подобрява (и личния му рекорд).
 */

/** Снимките на „продуктите“ в тренировката — леки, за да тръгва бързо. */
const POOL: Array<{ key: string; label: string; url: string }> = [
  { key: 'milk', label: 'Мляко', url: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=300&q=60' },
  { key: 'bread', label: 'Хляб', url: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=300&q=60' },
  { key: 'coffee', label: 'Кафе', url: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=300&q=60' },
  { key: 'oil', label: 'Олио', url: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=300&q=60' },
  { key: 'cheese', label: 'Сирене', url: 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=300&q=60' },
  { key: 'soap', label: 'Сапун', url: 'https://images.unsplash.com/photo-1600857544200-b2f666a9a2ec?w=300&q=60' },
  { key: 'rice', label: 'Ориз', url: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=300&q=60' },
  { key: 'choco', label: 'Шоколад', url: 'https://images.unsplash.com/photo-1511381939415-e44015466834?w=300&q=60' },
  { key: 'juice', label: 'Сок', url: 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=300&q=60' },
  { key: 'yogurt', label: 'Кисело мляко', url: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=300&q=60' },
  { key: 'tea', label: 'Чай', url: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=300&q=60' },
  { key: 'pasta', label: 'Паста', url: 'https://images.unsplash.com/photo-1551462147-ff29053bfc14?w=300&q=60' },
];

/** 12 плочки, сред тях 2 двойки (както в истинската томбола). */
function buildTiles(): { tiles: PuzzleTile[]; pairs: string[] } {
  const shuffled = [...POOL].sort(() => Math.random() - 0.5);
  const pairA = shuffled[0];
  const pairB = shuffled[1];
  const distractors = shuffled.slice(2, 10);

  const raw: Array<{ pairId: string | null; p: { key: string; label: string; url: string } }> = [
    { pairId: pairA.key, p: pairA },
    { pairId: pairA.key, p: pairA },
    { pairId: pairB.key, p: pairB },
    { pairId: pairB.key, p: pairB },
    ...distractors.map((d) => ({ pairId: null, p: d })),
  ];
  const mixed = raw.sort(() => Math.random() - 0.5);
  return {
    tiles: mixed.map((m, i) => ({
      id: `demo-${i}-${Math.random().toString(36).slice(2, 7)}`,
      imageUrl: m.p.url,
      pairId: m.pairId,
      label: m.p.label,
    })),
    pairs: [pairA.key, pairB.key],
  };
}

/** Насърчителните надписи — според времето. Точно това „заразява“. */
function praise(ms: number, best: number | null): { title: string; text: string } {
  const sec = ms / 1000;
  const isRecord = best === null || ms <= best;
  if (sec <= 6)
    return {
      title: 'Светкавично! ⚡',
      text: 'С такова време се нареждаш пред почти всички. Ако това беше истинско нареждане — щеше да си в челото.',
    };
  if (sec <= 10)
    return {
      title: 'Много добре! 🔥',
      text: 'Вече си под 10 секунди. Още две-три тренировки и ще си редовно в топ 10.',
    };
  if (sec <= 16)
    return {
      title: 'Добре се справяш! 💪',
      text: 'Първите рундове винаги са по-бавни. Запомни къде стоят двойките — следващият ще е много по-бърз.',
    };
  return {
    title: 'Важното е, че играеш 🎯',
    text: 'Всеки рунд сваля по секунда-две. Тренирай още малко — ще успееш в томболата.',
  };
}

export default function PuzzleDemoScreen() {
  const router = useRouter();
  const [round, setRound] = useState(0);
  const [{ tiles, pairs }, setBoard] = useState(() => buildTiles());
  /** true = плочките са ИСТИНСКИТЕ от томболата (същите продукти и снимки). */
  const [realTiles, setRealTiles] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [plays, setPlays] = useState(0);
  const [offMsg, setOffMsg] = useState('');

  /**
   * Взимаме плочките от СЪЩАТА томбола (режим „тренировка“) — така тренировката
   * е с истинските продукти и снимки, точно както ще е в истинската томбола, и с
   * всичките 12 полета. Ако няма активна томбола или не сме влезли — падаме към
   * местните 12 полета, за да може човек да тренира винаги.
   */
  const loadReal = useCallback(async (): Promise<{ tiles: PuzzleTile[]; pairs: string[] } | null> => {
    try {
      const list = await api.raffles();
      const active = (list.items || []).find((r) => (r as { status?: string }).status === 'active') || (list.items || [])[0];
      if (!active?.id) return null;
      const puzzle = await api.rafflePuzzle(active.id, 'practice');
      if (!puzzle?.tiles?.length || !puzzle?.pairs?.length) return null;
      return { tiles: puzzle.tiles, pairs: puzzle.pairs };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const real = await loadReal();
      if (alive && real) {
        setBoard(real);
        setRealTiles(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadReal]);

  const nextRound = useCallback(async () => {
    setResult(null);
    setRound((r) => r + 1);
    const real = await loadReal();
    if (real) {
      setBoard(real);
      setRealTiles(true);
    } else {
      setBoard(buildTiles());
    }
  }, [loadReal]);

  const onFinish = useCallback(
    async (timeMs: number) => {
      setResult(timeMs);
      try {
        const res = await api.puzzleDemoRecord(timeMs);
        setBest(res.bestMs);
        setPlays(res.plays);
      } catch {
        setBest((b) => (b === null || timeMs < b ? timeMs : b));
      }
    },
    []
  );

  const turnOff = async () => {
    try {
      await api.puzzleDemoOff(true);
      setOffMsg('Готово — повече няма да ти показваме подкана за тренировката. Ако поискаш, връщаш я от профила.');
    } catch (err) {
      setOffMsg((err as Error).message);
    }
  };

  const p = useMemo(() => (result ? praise(result, best) : null), [result, best]);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => goBack(router)} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Тренировка · пъзелът</Text>
          <View style={{ width: 34 }} />
        </View>

        <View style={[styles.card, styles.heroCard]}>
          <Text style={styles.heroTitle}>🎮 Играй колкото искаш</Text>
          <Text style={styles.heroText}>
            Това е тренировка — <Text style={{ fontWeight: '900' }}>без ограничения и не се брои</Text> за класацията.
            Намери двете еднакви продукти, колкото по-бързо, толкова по-добре. Така се подготвяш за томболата.
          </Text>
          {plays > 0 ? (
            <Text style={styles.heroHint}>
              Изиграни тренировки: <Text style={{ fontWeight: '900' }}>{plays}</Text>
              {best ? ` · личен рекорд: ${(best / 1000).toFixed(2)} сек` : ''}
            </Text>
          ) : null}
        </View>

        {result === null ? (
          <View style={styles.card}>
            <ProductPairPuzzle
              key={round}
              tiles={tiles}
              targetPairs={pairs}
              badge={realTiles ? 'Тренировка · същите продукти' : 'Тренировка'}
              onFinish={(ms) => void onFinish(ms)}
            />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.timeBig}>{(result / 1000).toFixed(2)} сек</Text>
            {p ? (
              <>
                <Text style={styles.praiseTitle}>{p.title}</Text>
                <Text style={styles.praiseText}>{p.text}</Text>
              </>
            ) : null}
            {best !== null && result <= best ? (
              <Text style={styles.record}>🏆 Нов личен рекорд!</Text>
            ) : null}

            <TouchableOpacity style={styles.btnOk} onPress={nextRound}>
              <Text style={styles.btnOkText}>🔁 Още един рунд</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnGold} onPress={() => router.push('/raffle' as never)}>
              <Text style={styles.btnOkText}>🎁 Участвай в томболата</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔔 Подканата за тренировка</Text>
          <Text style={styles.heroText}>
            Понякога ще ти припомняме, че можеш да потренираш — но не всеки път. Ако не искаш да те подсещаме,
            изключваш го с едно натискане и повече няма да го видиш.
          </Text>
          <TouchableOpacity style={styles.btnGhost} onPress={() => void turnOff()}>
            <Text style={styles.btnGhostText}>🔕 Не ми показвай повече подканата</Text>
          </TouchableOpacity>
          {offMsg ? <Text style={styles.heroHint}>{offMsg}</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  scroll: { padding: 16, paddingBottom: 44 },
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
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    padding: 14,
    marginBottom: 12,
  },
  heroCard: { backgroundColor: 'rgba(34,197,94,0.08)', borderColor: COLORS.greenBorder },
  heroTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '900' },
  heroText: { color: COLORS.textSecondary, fontSize: 13.5, lineHeight: 19, marginTop: 6 },
  heroHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 8 },
  cardTitle: { color: COLORS.textPrimary, fontSize: 15.5, fontWeight: '800', marginBottom: 6 },
  timeBig: { color: COLORS.greenBright, fontSize: 34, fontWeight: '900', textAlign: 'center', marginBottom: 8 },
  praiseTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  praiseText: { color: COLORS.textSecondary, fontSize: 13.5, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  record: { color: COLORS.goldBright, fontSize: 14, fontWeight: '900', textAlign: 'center', marginTop: 10 },
  btnOk: {
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: COLORS.greenPrimary,
  },
  btnGold: {
    marginTop: 9,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: COLORS.goldPrimary,
  },
  btnOkText: { color: COLORS.black, fontSize: 14, fontWeight: '900' },
  btnGhost: {
    marginTop: 12,
    paddingVertical: 11,
    borderRadius: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  btnGhostText: { color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '800' },
});
