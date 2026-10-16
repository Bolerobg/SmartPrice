import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '@/constants/theme';

/**
 * Поканата „направи профил“.
 *
 * Потокът се чете и без профил (това е входната врата от TikTok), но за
 * действие — глас, коментар, находка — трябва профил. Вместо суха грешка
 * „Сесията е изтекла“ показваме какво ще получи човекът, ако влезе.
 *
 * Модал в стила на приложението — не системен popup (на web те изглеждат
 * чужди и се блокират от браузъра).
 */
export const AuthPromptModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  /** Какво точно е искал да направи — за да е конкретно съобщението. */
  reason?: string;
}> = ({ visible, onClose, reason }) => {
  const router = useRouter();

  const go = (path: string) => {
    onClose();
    router.push(path as never);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <LinearGradient
            colors={['rgba(99,102,241,0.25)', 'rgba(6,182,212,0.10)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.iconCircle}>
              <Ionicons name="person-add" size={26} color={COLORS.white} />
            </View>
            <Text style={styles.title}>Профил за 30 секунди</Text>
            <Text style={styles.sub}>
              {reason ?? 'Потокът се чете свободно — но за да участваш, трябва профил.'}
            </Text>
          </LinearGradient>

          <View style={styles.perks}>
            <View style={styles.perk}>
              <Ionicons name="chatbubbles" size={17} color={COLORS.accentCyan} />
              <Text style={styles.perkText}>Гласувай и коментирай находките</Text>
            </View>
            <View style={styles.perk}>
              <Ionicons name="camera" size={17} color={COLORS.accentCyan} />
              <Text style={styles.perkText}>Качвай касови бележки — AI ги прочита вместо теб</Text>
            </View>
            <View style={styles.perk}>
              <Ionicons name="trophy" size={17} color={COLORS.accentCyan} />
              <Text style={styles.perkText}>Значки, точки и участие в томболата</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.primary}
            activeOpacity={0.9}
            onPress={() => go('/(auth)/register')}
          >
            <Ionicons name="rocket" size={17} color={COLORS.white} />
            <Text style={styles.primaryText}>Регистрирай се — безплатно</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondary}
            activeOpacity={0.85}
            onPress={() => go('/(auth)/login')}
          >
            <Text style={styles.secondaryText}>Вече имам профил</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={styles.later}>
            <Text style={styles.laterText}>По-късно</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4,7,15,0.82)',
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
    borderColor: COLORS.borderSubtle,
    overflow: 'hidden',
  },
  hero: { padding: 22, alignItems: 'center' },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.accentIndigo,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { color: COLORS.white, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  sub: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 7,
  },
  perks: { paddingHorizontal: 20, paddingTop: 16, gap: 11 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  perkText: { color: COLORS.textSecondary, fontSize: 13.5, flex: 1, lineHeight: 19 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginHorizontal: 20,
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.greenPrimary,
  },
  primaryText: { color: COLORS.white, fontSize: 15, fontWeight: '900' },
  secondary: {
    marginHorizontal: 20,
    marginTop: 9,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    alignItems: 'center',
  },
  secondaryText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '800' },
  later: { alignItems: 'center', paddingVertical: 14, marginBottom: 4 },
  laterText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
});
