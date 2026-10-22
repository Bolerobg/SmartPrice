import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { api } from '@/src/api/client';

/**
 * 🎮 КОМПАКТНА ПОДКАНА ЗА ТРЕНИРОВКАТА С ПЪЗЕЛА.
 *
 * Показва се рядко (сървърът решава — най-много веднъж на 48 часа) и НЕ е
 * модален прозорец: не спира човека, стои в края на екрана и може да се скрие.
 * Има и „Не ми показвай повече“ — завинаги.
 */
interface Props {
  onTrain: () => void;
  onHide: () => void;
}

export const PuzzleDemoNudge: React.FC<Props> = ({ onTrain, onHide }) => {
  const [busy, setBusy] = useState(false);

  const never = async () => {
    setBusy(true);
    await api.puzzleDemoOff(true).catch(() => undefined);
    setBusy(false);
    onHide();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.icon}>
        <Ionicons name="game-controller" size={18} color={COLORS.onPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Потренирай пъзела 🎯</Text>
        <Text style={styles.text}>
          Свободна игра, без ограничения. Две еднакви стоки — колкото по-бързо, толкова по-добре за томболата.
        </Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.go} onPress={onTrain} activeOpacity={0.9}>
            <Text style={styles.goText}>Тренирай сега</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void never()} disabled={busy}>
            <Text style={styles.never}>Не ми показвай повече</Text>
          </TouchableOpacity>
        </View>
      </View>
      <TouchableOpacity onPress={onHide} style={styles.x} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={15} color={COLORS.textMuted} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    backgroundColor: 'rgba(34,197,94,0.08)',
    marginBottom: 12,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.greenPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: COLORS.textPrimary, fontSize: 14.5, fontWeight: '900' },
  text: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 3 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 9, flexWrap: 'wrap' },
  go: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 11, backgroundColor: COLORS.greenPrimary },
  goText: { color: COLORS.onPrimary, fontSize: 12.5, fontWeight: '900' },
  never: { color: COLORS.textMuted, fontSize: 11.5, fontWeight: '700' },
  x: { padding: 2 },
});
