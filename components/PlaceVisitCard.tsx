import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { api } from '@/src/api/client';
import type { PostItem } from '@/types';

/**
 * 🗣 „Беше ли на мястото?“ — за обекти от Google Maps.
 *
 * Защо: за места НЕ следим цена (не са магазини), затова единственото смислено
 * потвърждение е от човек, който е бил там: „още работи / струва си“ или
 * „затворено / не си струва“. Така под мястото има и човешки глас, не само
 * Google отзивите. Гласовете влизат в класацията на Радара (зелено/червено).
 */
export function PlaceVisitCard({ post }: { post: PostItem }) {
  const [reactions, setReactions] = useState(post.reactions);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const vote = async (key: 'worthIt' | 'avoid') => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.toggleReaction(post.id, key);
      if (res?.post?.reactions) setReactions(res.post.reactions);
      setDone(key);
    } catch {
      /* тихо: при гост ще дойде покана за профил */
    } finally {
      setBusy(false);
    }
  };

  const good = reactions?.worthIt ?? 0;
  const bad = reactions?.avoid ?? 0;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="chatbubbles-outline" size={18} color={COLORS.primary} />
        <Text style={styles.title}>Беше ли на мястото?</Text>
      </View>
      <Text style={styles.sub}>
        Кажи как е сега — така помагаш на следващите, които ще ходят. Твоят глас влиза
        в класацията на Радара.
      </Text>

      <View style={styles.row}>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={busy}
          onPress={() => void vote('worthIt')}
          style={[styles.btn, styles.btnGood, done === 'worthIt' && styles.btnChosen]}
        >
          <Ionicons name="checkmark-circle-outline" size={17} color={COLORS.greenBright} />
          <Text style={[styles.btnText, { color: COLORS.greenBright }]}>
            Още работи / струва си
          </Text>
          <Text style={[styles.count, { color: COLORS.greenBright }]}>{good}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          disabled={busy}
          onPress={() => void vote('avoid')}
          style={[styles.btn, styles.btnBad, done === 'avoid' && styles.btnChosen]}
        >
          <Ionicons name="close-circle-outline" size={17} color={COLORS.redBright} />
          <Text style={[styles.btnText, { color: COLORS.redBright }]}>
            Затворено / не си струва
          </Text>
          <Text style={[styles.count, { color: COLORS.redBright }]}>{bad}</Text>
        </TouchableOpacity>
      </View>

      {done ? (
        <Text style={styles.thanks}>Благодарим! Гласът ти е записан. ✓</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    gap: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '800' },
  sub: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 8, marginTop: 2 },
  btn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  btnGood: { backgroundColor: COLORS.greenSoftBg, borderColor: COLORS.greenBorder },
  btnBad: { backgroundColor: COLORS.redSoftBg, borderColor: COLORS.redBorder },
  btnChosen: { borderWidth: 2 },
  btnText: { fontSize: 12, fontWeight: '800', flexShrink: 1 },
  count: { fontSize: 12, fontWeight: '900' },
  thanks: { color: COLORS.greenBright, fontSize: 12, fontWeight: '700', marginTop: 2 },
});
