import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { EASY } from '@/constants/easyDesign';
import { setEasyMode, useEasyMode } from '@/lib/easyMode';

/**
 * 🧓 ПРЕВКЛЮЧВАТЕЛ „ЕДЪР ДИЗАЙН“.
 *
 * Защо изглежда така:
 *   • Самият превключвател е ЕДЪР (не дребно копче) и има НАДПИС до себе си —
 *     човек трябва да вижда в кое положение е, без да се взира.
 *   • Има ОБЯСНЕНИЕ с прости думи какво прави, вместо само „Easy mode“:
 *     „По-големи букви и бутони. По-малко неща на екрана.“
 *   • Резултатът се вижда ВЕДНАГА — щом се натисне, екранът се пречертава,
 *     без да е нужно да се затваря приложението.
 */
export const EasyModeSwitch: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const easy = useEasyMode();

  return (
    <View style={[styles.row, compact ? styles.rowCompact : null]}>
      <View style={styles.icon}>
        <Ionicons name="glasses-outline" size={24} color={COLORS.accentCyan} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Едър дизайн (за по-лесно)</Text>
        <Text style={styles.sub}>
          {easy
            ? 'Включен: по-големи букви, големи снимки и по един бутон за нещо.'
            : 'Изключен: показваме повече оферти на екрана наведнъж.'}
        </Text>
      </View>

      <Switch
        value={easy}
        onValueChange={setEasyMode}
        trackColor={{ false: COLORS.borderStrong, true: COLORS.greenPrimary }}
        thumbColor={COLORS.white}
        ios_backgroundColor={COLORS.borderStrong}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: EASY.space.sm,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: EASY.radius.button,
    padding: EASY.space.md,
    marginBottom: EASY.space.md,
  },
  rowCompact: { padding: EASY.space.sm, marginBottom: EASY.space.sm },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accentCyanSoftBg,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
  },
  title: { color: COLORS.textPrimary, fontSize: EASY.font.body, fontWeight: '900' },
  sub: { color: COLORS.textSecondary, fontSize: EASY.font.hint, fontWeight: '700', marginTop: 2 },
});
