import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { cacheAge } from '@/src/lib/offlineCache';

/**
 * 📶 „Показвам запазеното“ — честният офлайн банер.
 *
 * Защо така, а не „няма връзка“ и празен екран: в магазина сигналът често е нула
 * точно когато сравняваш цена. Показваме последно зареденото, но КАЗВАМЕ ЯСНО
 * от кога е — иначе стар кеш изглежда като актуална цена и подвежда.
 */
export function OfflineNotice({ at }: { at?: string | null } = {}) {
  const { offlineAt } = useApp();
  // Екранът може да подаде своя дата (напр. любимите пазят свой кеш),
  // иначе ползваме общата от контекста.
  const when = at !== undefined ? at : offlineAt;
  if (!when) return null;

  return (
    <View style={styles.bar}>
      <Ionicons name="cloud-offline-outline" size={15} color={COLORS.goldBright ?? COLORS.textPrimary} />
      <Text style={styles.text}>
        Няма връзка. Показвам запазеното от <Text style={styles.strong}>{cacheAge(when)}</Text> —
        цените може вече да са се променили.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginBottom: 10,
  },
  text: { flex: 1, color: COLORS.textPrimary, fontSize: 12, lineHeight: 17 },
  strong: { fontWeight: '900' },
});
