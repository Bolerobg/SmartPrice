import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/src/auth/AuthContext';

/**
 * „Стани основател“ — поканата за първата находка.
 *
 * Защо съществува: празна платформа не убеждава никого да качи първото нещо.
 * Затова първата находка, качена в рамките на няколко минути след
 * регистрацията, се награждава веднага със значка „Основател“ и точки.
 *
 * Показва се САМО докато прозорецът тече и само на хора, които още не са я
 * взели — след това изчезва от само себе си (никакво чистене на ръка).
 */
export const FounderBanner: React.FC = () => {
  const router = useRouter();
  const { features, userProfile } = useApp();
  const { isAuthenticated } = useAuth();
  const [now, setNow] = useState(() => Date.now());

  const bonus = features?.founderBonus ?? null;
  const alreadyEarned = useMemo(
    () => Boolean(userProfile.badges?.some((b) => b.id === 'badge-founder' && b.unlocked)),
    [userProfile.badges]
  );

  const startedAt = userProfile.createdAt ? Date.parse(userProfile.createdAt) : NaN;
  const windowMs = (bonus?.windowMin ?? 0) * 60_000;
  const endsAt = Number.isFinite(startedAt) ? startedAt + windowMs : NaN;

  const active = Boolean(bonus) && isAuthenticated && !alreadyEarned && Number.isFinite(endsAt);
  const leftMs = active ? endsAt - now : 0;

  // Броячът върви само докато има смисъл — не хабим ресурс излишно.
  useEffect(() => {
    if (!active || leftMs <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active, leftMs > 0]);

  if (!bonus || !active || leftMs <= 0) return null;

  const totalSec = Math.max(0, Math.floor(leftMs / 1000));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.92}
      onPress={() => router.push('/(tabs)/add' as never)}
    >
      <View style={styles.iconWrap}>
        <Ionicons name="sparkles" size={20} color={COLORS.black} />
      </View>

      <View style={{ flex: 1 }}>
        <View style={styles.topRow}>
          <Text style={styles.title}>Стани основател</Text>
          <View style={styles.timer}>
            <Ionicons name="time" size={11} color={COLORS.goldBright} />
            <Text style={styles.timerText}>{mm}:{ss}</Text>
          </View>
        </View>
        <Text style={styles.text}>
          Качи първата си находка сега и получаваш значка „Основател“ +{' '}
          <Text style={styles.points}>{bonus.points} точки</Text> доверие веднага.
        </Text>
        <View style={styles.cta}>
          <Ionicons name="camera" size={14} color={COLORS.white} />
          <Text style={styles.ctaText}>Качи находка</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.white} />
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 2,
    marginTop: 12,
    padding: 15,
    borderRadius: 22,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: COLORS.goldBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { color: COLORS.goldBright, fontSize: 15, fontWeight: '900', letterSpacing: -0.2 },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 999,
    backgroundColor: 'rgba(6, 9, 17, 0.5)',
  },
  timerText: { color: COLORS.goldBright, fontSize: 11.5, fontWeight: '900' },
  text: { color: COLORS.textSecondary, fontSize: 12.8, lineHeight: 18.5, marginTop: 5 },
  points: { color: COLORS.goldBright, fontWeight: '900' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 13,
    paddingVertical: 7.5,
    borderRadius: 999,
    backgroundColor: COLORS.greenPrimary,
  },
  ctaText: { color: COLORS.white, fontSize: 12.5, fontWeight: '900' },
});
