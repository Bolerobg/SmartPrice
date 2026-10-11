import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import {
  setAlertHandler,
  type AlertButton,
  type AlertRequest,
} from '@/lib/alertHost';

/**
 * Рендира модалите, поискани през showAlert() / Alert.alert().
 * Монтиран е веднъж в app/_layout.tsx.
 */
export const AlertHost: React.FC = () => {
  const [queue, setQueue] = useState<AlertRequest[]>([]);
  const current = queue[0] ?? null;

  useEffect(() => {
    setAlertHandler((req) => setQueue((prev) => [...prev, req]));
    return () => setAlertHandler(null);
  }, []);

  const dismiss = useCallback((button: AlertButton | null) => {
    setQueue((prev) => prev.slice(1));
    // onPress се вика СЛЕД затварянето, за да не блокира анимацията
    if (button?.onPress) setTimeout(button.onPress, 0);
  }, []);

  if (!current) return null;

  const buttons = current.buttons;
  const stacked = buttons.length > 2;
  const hasDestructive = buttons.some((b) => b.style === 'destructive');

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => dismiss(null)}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View
            style={[
              styles.iconWrap,
              hasDestructive && {
                backgroundColor: COLORS.redSoftBg,
                borderColor: COLORS.redBorder,
              },
            ]}
          >
            <Ionicons
              name={hasDestructive ? 'help-circle-outline' : 'information-circle-outline'}
              size={26}
              color={hasDestructive ? COLORS.redBright : COLORS.accentCyan}
            />
          </View>

          <Text style={styles.title}>{current.title}</Text>
          {current.message ? <Text style={styles.message}>{current.message}</Text> : null}

          <View style={[styles.buttons, stacked ? styles.buttonsStacked : styles.buttonsRow]}>
            {buttons.map((b, i) => {
              const destructive = b.style === 'destructive';
              const cancel = b.style === 'cancel';
              return (
                <TouchableOpacity
                  key={`${b.text ?? 'btn'}-${i}`}
                  style={[
                    styles.btn,
                    stacked ? styles.btnStacked : styles.btnRow,
                    destructive ? styles.btnDestructive : cancel ? styles.btnGhost : styles.btnPrimary,
                  ]}
                  activeOpacity={0.85}
                  onPress={() => dismiss(b)}
                >
                  {destructive && (
                    <Ionicons name="log-out-outline" size={16} color={COLORS.white} />
                  )}
                  <Text
                    style={[
                      styles.btnText,
                      destructive
                        ? styles.btnTextDestructive
                        : cancel
                          ? styles.btnTextGhost
                          : styles.btnTextPrimary,
                    ]}
                  >
                    {b.text ?? 'Добре'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: Platform.OS === 'ios' ? 26 : 18,
    alignItems: 'center',
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 17,
    backgroundColor: COLORS.accentCyanSoftBg,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  message: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
  },
  buttons: { width: '100%', marginTop: 20, gap: 9 },
  buttonsRow: { flexDirection: 'row' },
  buttonsStacked: { flexDirection: 'column' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  btnRow: { flex: 1 },
  btnStacked: { width: '100%' },
  btnPrimary: { backgroundColor: COLORS.accentCyan },
  btnDestructive: { backgroundColor: COLORS.redPrimary },
  btnGhost: {
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  btnText: { fontSize: 14.5, fontWeight: '900' },
  btnTextPrimary: { color: COLORS.black },
  btnTextDestructive: { color: COLORS.white },
  btnTextGhost: { color: COLORS.textSecondary },
});
