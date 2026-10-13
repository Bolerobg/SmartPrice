import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import type { PuzzleTile } from '@/src/api/client';

interface Props {
  tiles: PuzzleTile[];
  /** Кои двойки трябва да се намерят (обикновено 2). */
  targetPairs: string[];
  /** Показва се на играча в началото (напр. „Тренировка 1 от 3“). */
  badge?: string;
  onFinish: (timeMs: number) => void;
  /** Ако играчът се откаже — нареждането не се брои. */
  onCancel?: () => void;
}

/**
 * Пъзелът: 12 плочки с реални продукти, сред тях 2 двойки еднакви.
 * Играчът обръща по две плочки; съвпадне ли продуктът — остават отворени.
 * Хронометърът тръгва от първото обръщане и спира, когато и двете двойки са намерени.
 *
 * Честността не е тук, а на сървъра: той мери времето от `run/start` до `run/finish`,
 * затова каквото и да прави клиентът, „0,3 секунди“ не минава.
 */
export const ProductPairPuzzle: React.FC<Props> = ({ tiles, targetPairs, badge, onFinish, onCancel }) => {
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<string[]>([]);
  const [wrong, setWrong] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [started, setStarted] = useState(false);
  const [locked, setLocked] = useState(false);
  const finishedRef = useRef(false);
  const startRef = useRef<number | null>(null);

  const totalPairs = Math.max(1, targetPairs.length);

  // Хронометърът тече, докато играем.
  useEffect(() => {
    if (!started || finishedRef.current) return;
    const id = setInterval(() => {
      if (startRef.current) setElapsed(Date.now() - startRef.current);
    }, 87);
    return () => clearInterval(id);
  }, [started]);

  const reveal = useCallback(
    (index: number) => {
      if (locked || finishedRef.current) return;
      const tile = tiles[index];
      if (!tile) return;
      if (revealedHas(flipped, index)) return;
      if (tile.pairId && matched.includes(tile.pairId)) return;

      if (!started) {
        startRef.current = Date.now();
        setStarted(true);
      }

      const next = [...flipped, index];
      if (next.length < 2) {
        setFlipped(next);
        return;
      }

      const [a, b] = next;
      const first = tiles[a!]!;
      const second = tiles[b!]!;

      if (first.pairId && second.pairId && first.pairId === second.pairId) {
        const nextMatched = [...matched, first.pairId];
        setFlipped([]);
        setMatched(nextMatched);
        if (nextMatched.length >= totalPairs) {
          finishedRef.current = true;
          const timeMs = Date.now() - (startRef.current ?? Date.now());
          setTimeout(() => onFinish(timeMs), 420);
        }
      } else {
        setFlipped(next);
        setWrong(next);
        setLocked(true);
        setTimeout(() => {
          setFlipped([]);
          setWrong([]);
          setLocked(false);
        }, 760);
      }
    },
    [flipped, locked, matched, onFinish, started, tiles, totalPairs]
  );

  const formatTime = (ms: number) => {
    const total = Math.max(0, ms);
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const tenths = Math.floor((total % 1000) / 100);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
  };

  const columns = useMemo(() => {
    const cols = tiles.length <= 9 ? 3 : 4;
    return cols;
  }, [tiles.length]);

  const size = columns === 4 ? '24%' : '31%';

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.timerPill}>
          <Ionicons name="stopwatch" size={15} color={COLORS.greenBright} />
          <Text style={styles.timerText}>{formatTime(elapsed)}</Text>
        </View>
        <Text style={styles.progressText}>
          Намерени двойки: {matched.length}/{totalPairs}
        </Text>
      </View>

      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      <Text style={styles.hint}>Намери 2 двойки еднакви продукта — колкото по-бързо, толкова по-добре</Text>

      <View style={styles.grid}>
        {tiles.map((tile, index) => {
          const isMatched = Boolean(tile.pairId && matched.includes(tile.pairId));
          const isOpen = isMatched || flipped.includes(index);
          const isWrong = wrong.includes(index);
          return (
            <TouchableOpacity
              key={tile.id}
              style={[styles.tile, { width: size }, isMatched && styles.tileMatched, isWrong && styles.tileWrong]}
              onPress={() => reveal(index)}
              activeOpacity={0.85}
              disabled={isMatched}
            >
              {isOpen ? (
                <Image source={{ uri: tile.imageUrl }} style={styles.tileImage} resizeMode="cover" />
              ) : (
                <View style={styles.tileBack}>
                  <Ionicons name="help" size={22} color={COLORS.textMuted} />
                </View>
              )}
              {isMatched ? (
                <View style={styles.tileCheck}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.black} />
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {onCancel ? (
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
          <Text style={styles.cancelText}>Откажи се (нареждането не се брои)</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

function revealedHas(list: number[], index: number): boolean {
  return list.includes(index);
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  timerText: { color: COLORS.greenBright, fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
  progressText: { color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '800' },
  badge: {
    color: COLORS.goldBright,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.4,
    marginTop: 12,
  },
  hint: { color: COLORS.textMuted, fontSize: 11.5, marginTop: 6, marginBottom: 12, lineHeight: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  tile: {
    aspectRatio: 0.86,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileMatched: { borderColor: COLORS.greenBright, borderWidth: 2 },
  tileWrong: { borderColor: COLORS.redBright, borderWidth: 2 },
  tileImage: { width: '100%', height: '100%' },
  tileBack: { alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' },
  tileCheck: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.greenBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 14 },
  cancelText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
});
