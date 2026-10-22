import React, { useMemo } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '@/constants/theme';

/** Помним, че вече сме показали поканата, за да не досаждаме повторно. */
const ADD_TO_HOME_KEY = '@smartprice_add_to_home_seen_v1';

export async function getAddToHomeSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ADD_TO_HOME_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function saveAddToHomeSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(ADD_TO_HOME_KEY, '1');
  } catch {
    // не е критично — при следващо отваряне може да покажем пак
  }
}

export type HomeScreenPlatform = 'ios' | 'android' | 'desktop' | 'native';

/** Определя от какво устройство/браузър се отваря приложението. */
export function detectHomeScreenPlatform(): HomeScreenPlatform {
  if (Platform.OS !== 'web') return 'native';
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  const isIpad = /iPad/i.test(ua);
  const isIphone = /iPhone|iPod/i.test(ua);
  // iPadOS се представя като Macintosh, затова проверяваме и за тъч
  const isIpadOs =
    /Macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document;
  if (isIphone || isIpad || isIpadOs) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

/** Вече отворено ли е като самостоятелно приложение (инсталирано)? */
export function isAlreadyInstalled(): boolean {
  if (Platform.OS !== 'web') return true; // нативно приложение = вече е инсталирано
  if (typeof window === 'undefined') return false;
  try {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      window.matchMedia?.('(display-mode: fullscreen)').matches === true ||
      // iOS Safari
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    return standalone;
  } catch {
    return false;
  }
}

interface Step {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  text: string;
}

const IOS_STEPS: Step[] = [
  {
    icon: 'compass-outline',
    iconColor: '#38BDF8',
    title: 'Отвори сайта в Safari',
    text: '„Добави на началния екран“ работи само в Safari. Ако си в друго приложение, копирай адреса и го отвори в Safari.',
  },
  {
    icon: 'share-outline',
    iconColor: '#FBBF24',
    title: 'Натисни бутона „Сподели“',
    text: 'Това е квадратчето със стрелка нагоре — долу в средата на екрана (или горе вдясно на iPad).',
  },
  {
    icon: 'add-circle-outline',
    iconColor: '#34D399',
    title: 'Избери „Към началния екран“',
    text: 'Превърти списъка надолу и натисни „Към началния екран“ (Add to Home Screen), после „Добави“.',
  },
  {
    icon: 'checkmark-done-outline',
    iconColor: '#A78BFA',
    title: 'Готово — приложението е на телефона',
    text: 'Иконата ще се появи на началния екран и ще се отваря на цял екран, като истинско приложение.',
  },
];

const ANDROID_STEPS: Step[] = [
  {
    icon: 'logo-chrome',
    iconColor: '#38BDF8',
    title: 'Отвори сайта в Chrome',
    text: 'Най-надеждно е с Chrome. Може и с друг браузър, но менютата се различават.',
  },
  {
    icon: 'ellipsis-vertical',
    iconColor: '#FBBF24',
    title: 'Натисни менюто с трите точки',
    text: 'Горе вдясно в Chrome — вертикалните три точки.',
  },
  {
    icon: 'add-circle-outline',
    iconColor: '#34D399',
    title: 'Избери „Добави към началния екран“',
    text: 'Или „Инсталирай приложението“, ако го виждаш. После потвърди с „Добави“ / „Инсталирай“.',
  },
  {
    icon: 'checkmark-done-outline',
    iconColor: '#A78BFA',
    title: 'Готово — иконата е на началния екран',
    text: 'Отваря се като самостоятелно приложение, без адресна лента.',
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Показва се покана вместо обяснение (за влизане от профила) */
  mode?: 'invite' | 'help';
}

export const AddToHomeScreenModal: React.FC<Props> = ({ visible, onClose, mode = 'help' }) => {
  const platform = useMemo(detectHomeScreenPlatform, []);
  const steps = platform === 'ios' ? IOS_STEPS : ANDROID_STEPS;

  const isIos = platform === 'ios';
  const platformName = isIos ? 'iPhone / iPad' : 'Android';
  const browserName = isIos ? 'Safari' : 'Chrome';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 8 }}
          >
            {/* Заглавна част */}
            <View style={styles.header}>
              <View style={styles.appIconWrap}>
                <View style={styles.appIcon}>
                  <Ionicons name="pricetags" size={26} color={COLORS.white} />
                </View>
                <View style={styles.plusBadge}>
                  <Ionicons name="add" size={13} color={COLORS.onPrimary} />
                </View>
              </View>

              <Text style={styles.title}>
                {mode === 'invite'
                  ? 'Сложи SmartPrice на началния екран'
                  : 'Как да добавиш приложението'}
              </Text>
              <Text style={styles.subtitle}>
                {mode === 'invite'
                  ? 'Отваря се с едно докосване, на цял екран и без да търсиш адреса. Работи като истинско приложение — без магазин за приложения.'
                  : `Ето стъпките за ${platformName}. Отнема около 10 секунди.`}
              </Text>
            </View>

            {/* Кой екран е това */}
            <View style={styles.platformPill}>
              <Ionicons
                name={isIos ? 'logo-apple' : 'logo-android'}
                size={16}
                color={isIos ? '#E5E7EB' : '#7DD3A0'}
              />
              <Text style={styles.platformPillText}>
                {platformName} · {browserName}
              </Text>
            </View>

            {/* Стъпките */}
            <View style={styles.steps}>
              {steps.map((step, i) => (
                <View key={step.title} style={styles.stepRow}>
                  <View style={styles.stepNumberWrap}>
                    <Text style={styles.stepNumber}>{i + 1}</Text>
                    {i < steps.length - 1 && <View style={styles.stepLine} />}
                  </View>

                  <View style={styles.stepBody}>
                    <View style={styles.stepIconRow}>
                      <View style={styles.stepIcon}>
                        <Ionicons name={step.icon} size={17} color={step.iconColor} />
                      </View>
                      <Text style={styles.stepTitle}>{step.title}</Text>
                    </View>
                    <Text style={styles.stepText}>{step.text}</Text>
                  </View>
                </View>
              ))}
            </View>

            {platform === 'desktop' && (
              <View style={styles.noteBox}>
                <Ionicons name="desktop-outline" size={15} color={COLORS.goldBright} />
                <Text style={styles.noteText}>
                  От компютър тази стъпка няма смисъл — отвори адреса на телефона си
                  и следвай стъпките там.
                </Text>
              </View>
            )}

            <View style={styles.benefitsRow}>
              <View style={styles.benefit}>
                <Ionicons name="flash-outline" size={14} color={COLORS.accentCyan} />
                <Text style={styles.benefitText}>Отваря се по-бързо</Text>
              </View>
              <View style={styles.benefit}>
                <Ionicons name="expand-outline" size={14} color={COLORS.accentCyan} />
                <Text style={styles.benefitText}>На цял екран</Text>
              </View>
              <View style={styles.benefit}>
                <Ionicons name="wifi-outline" size={14} color={COLORS.accentCyan} />
                <Text style={styles.benefitText}>Икона като app</Text>
              </View>
            </View>
          </ScrollView>

          <TouchableOpacity style={styles.primaryBtn} onPress={onClose} activeOpacity={0.88}>
            <Text style={styles.primaryBtnText}>Разбрах</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ghostBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.ghostBtnText}>По-късно</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.bgPrimary,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '92%',
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.borderSubtle,
    marginBottom: 14,
  },
  header: { alignItems: 'center', marginBottom: 14 },
  appIconWrap: { marginBottom: 12 },
  appIcon: {
    width: 62,
    height: 62,
    borderRadius: 17,
    backgroundColor: COLORS.accentIndigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBadge: {
    position: 'absolute',
    right: -5,
    bottom: -5,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.accentCyan,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.bgPrimary,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 19,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 7,
  },
  platformPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 16,
  },
  platformPillText: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: '800',
  },
  steps: { gap: 2 },
  stepRow: { flexDirection: 'row', gap: 11 },
  stepNumberWrap: { alignItems: 'center', width: 26 },
  stepNumber: {
    color: COLORS.accentCyan,
    fontSize: 12,
    fontWeight: '900',
    width: 22,
    height: 22,
    borderRadius: 11,
    textAlign: 'center',
    lineHeight: 22,
    backgroundColor: COLORS.accentCyanSoftBg,
    overflow: 'hidden',
  },
  stepLine: {
    flex: 1,
    width: 2,
    backgroundColor: COLORS.borderSubtle,
    marginVertical: 4,
  },
  stepBody: { flex: 1, paddingBottom: 14 },
  stepIconRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  stepIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: COLORS.bgCardElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTitle: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 13.5,
    fontWeight: '800',
  },
  stepText: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17.5,
    marginTop: 5,
  },
  noteBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 12,
    padding: 11,
    marginTop: 6,
  },
  noteText: { flex: 1, color: COLORS.goldBright, fontSize: 11.5, lineHeight: 16.5, fontWeight: '700' },
  benefitsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: 14,
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  benefitText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '700' },
  primaryBtn: {
    backgroundColor: COLORS.accentCyan,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 50,
  },
  primaryBtnText: { color: COLORS.onPrimary, fontSize: 15, fontWeight: '900' },
  ghostBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 2 },
  ghostBtnText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
});