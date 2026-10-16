import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';

/**
 * Плаващият бутон „Ценко“ — вход към AI съветника от всеки екран.
 *
 * Защо точно така:
 *   • Бутонът „диша“ (пулсиращ ореол) — окото го хваща, без да е натрапчив.
 *   • Първите няколко секунди показва малка реплика („Питай ме къде е евтино“),
 *     после се свива до кръгче, за да не пречи на съдържанието.
 *   • Скрит е, ако съветникът не е включен на сървъра (липсва ключ) — така
 *     никога не води до счупен екран.
 */
export const AssistantFab: React.FC<{
  /** Отстъп отдолу (за да не залепва на таб-бара). */
  bottom?: number;
  right?: number;
  /** Показва ли се балончето с покана. */
  showHint?: boolean;
  /** От кой екран е отворен — за да е уместна подканата на Ценко. */
  screen?: string;
}> = ({ bottom = 82, right = 16, showHint = true, screen }) => {
  const router = useRouter();
  const { features } = useApp();
  const [hintVisible, setHintVisible] = useState(showHint);

  const pulse = useRef(new Animated.Value(0)).current;
  const hintAnim = useRef(new Animated.Value(showHint ? 1 : 0)).current;
  const lift = useRef(new Animated.Value(0)).current;

  const enabled = features?.assistant !== false;

  useEffect(() => {
    if (!enabled) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [enabled, pulse]);

  // Малката покана изчезва сама след 7 секунди (или при първо натискане).
  useEffect(() => {
    if (!showHint) return;
    const t = setTimeout(() => {
      setHintVisible(false);
      Animated.timing(hintAnim, { toValue: 0, duration: 260, useNativeDriver: true }).start();
    }, 7000);
    return () => clearTimeout(t);
  }, [hintAnim, showHint]);

  if (!enabled) return null;

  const open = () => {
    setHintVisible(false);
    Animated.timing(hintAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    router.push(screen ? `/assistant?screen=${encodeURIComponent(screen)}` : '/assistant');
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom, right }]}>
      {hintVisible && (
        <Animated.View style={[styles.hint, { opacity: hintAnim }]}>
          <Text style={styles.hintText}>Питай ме кое е изгодно 🦉</Text>
        </Animated.View>
      )}

      <View pointerEvents="box-none">
        {/* Пулсиращ ореол зад кръгчето */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.75] }) }],
            },
          ]}
        />
        <Animated.View style={{ transform: [{ translateY: lift }] }}>
          <TouchableOpacity activeOpacity={0.9} onPress={open} accessibilityLabel="Отвори AI съветника Ценко">
            <LinearGradient
              colors={['#6366F1', '#06B6D4']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.button}
            >
              <Text style={styles.owl}>🦉</Text>
              <View style={styles.aiTag}>
                <Ionicons name="sparkles" size={8} color={COLORS.white} />
                <Text style={styles.aiTagText}>AI</Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 20,
  },
  hint: {
    backgroundColor: COLORS.bgGlass,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    maxWidth: 190,
    ...(Platform.OS === 'web'
      ? { backdropFilter: 'blur(6px)' as never }
      : {}),
  },
  hintText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  halo: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.accentCyan,
  },
  button: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#06B6D4',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  owl: {
    fontSize: 26,
    marginTop: 1,
  },
  aiTag: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
  },
  aiTagText: {
    color: COLORS.white,
    fontSize: 7.5,
    fontWeight: '900',
  },
});
