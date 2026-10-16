import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '@/constants/theme';

/**
 * Поздравът, когато човекът вземе значка „Основател“.
 *
 * Показва се веднага след качването на първата находка (сървърът връща
 * founderBonus). Моментът е важен: точно тук човекът решава дали ще качи и
 * втора находка. Затова е кратно, с числа и с бутон към значката в профила.
 */
export const FounderCelebration: React.FC<{
  data: { title: string; points: number } | null;
  onClose: () => void;
}> = ({ data, onClose }) => {
  const router = useRouter();
  const scale = useRef(new Animated.Value(0.6)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!data) return;
    scale.setValue(0.6);
    glow.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
      Animated.timing(glow, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [data, glow, scale]);

  if (!data) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <LinearGradient
            colors={[COLORS.goldPrimary, '#F97316', COLORS.goldPrimary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <Animated.View
              style={[
                styles.badge,
                {
                  opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
                  transform: [
                    { scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.08] }) },
                  ],
                },
              ]}
            >
              <Ionicons name="sparkles" size={38} color={COLORS.black} />
            </Animated.View>
            <Text style={styles.kicker}>ЗНАЧКА ОТКЛЮЧЕНА</Text>
            <Text style={styles.title}>{data.title}</Text>
          </LinearGradient>

          <View style={styles.body}>
            <Text style={styles.text}>
              Ти беше сред първите, които напълниха SmartPrice. Затова получаваш значката
              „Основател“ — тя остава в профила ти завинаги.
            </Text>

            <View style={styles.pointsRow}>
              <Ionicons name="star" size={16} color={COLORS.goldBright} />
              <Text style={styles.pointsText}>+{data.points} точки доверие</Text>
            </View>

            <TouchableOpacity
              style={styles.primary}
              activeOpacity={0.9}
              onPress={() => {
                onClose();
                router.push('/(tabs)/profile' as never);
              }}
            >
              <Ionicons name="ribbon" size={17} color={COLORS.black} />
              <Text style={styles.primaryText}>Виж значката в профила</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondary} activeOpacity={0.85} onPress={onClose}>
              <Text style={styles.secondaryText}>Продължи да разглеждаш</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4,7,15,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 22,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    overflow: 'hidden',
  },
  hero: { paddingVertical: 26, alignItems: 'center' },
  badge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  kicker: {
    color: 'rgba(0,0,0,0.62)',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  title: { color: COLORS.black, fontSize: 26, fontWeight: '900', marginTop: 4 },
  body: { padding: 20 },
  text: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  pointsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.goldSoftBg,
  },
  pointsText: { color: COLORS.goldBright, fontSize: 15, fontWeight: '900' },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.goldBright,
  },
  primaryText: { color: COLORS.black, fontSize: 15, fontWeight: '900' },
  secondary: { alignItems: 'center', paddingVertical: 13 },
  secondaryText: { color: COLORS.textMuted, fontSize: 13.5, fontWeight: '800' },
});
