import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppProvider, useApp } from '@/context/AppContext';
import { AuthProvider, useAuth } from '@/src/auth/AuthContext';
import { AddToHomeScreenModal } from '@/components/AddToHomeScreenModal';
import { DonationModal } from '@/components/DonationModal';
import { AlertHost } from '@/components/AlertHost';
import { ShareModal } from '@/components/ShareModal';
import { RafflePromoHost } from '@/components/RafflePromoModal';
import { AuthPromptModal } from '@/components/AuthPromptModal';
import { FounderCelebration } from '@/components/FounderCelebration';
// Подменя Alert.alert с работеща версия на web (react-native-web я прави празна).
// Импортът е само за страничния ефект и трябва да е преди първия Alert.alert.
import '@/lib/alertHost';
import { ONBOARDING_SEEN_KEY } from './(auth)/onboarding';
import { COLORS } from '@/constants/theme';

/** Колко минимум да се вижда splash екранът (за да не премигва) */

/** Домейнът, който се показва на splash екрана. Идва от билда
 *  (EXPO_PUBLIC_API_URL), затова смяната на домейна не иска промяна в кода. */
const APP_DISPLAY_HOST = (process.env.EXPO_PUBLIC_API_URL || 'https://smartprice.bg')
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '');
const MIN_SPLASH_MS = 3200;

/** Трите обещания, които се появяват едно след друго на сплаша. */
const SPLASH_FEATURES: { icon: string; text: string }[] = [
  { icon: 'pricetags', text: 'Реални цени от хора като теб' },
  { icon: 'alert-circle', text: 'Червени флагове и скрити такси' },
  { icon: 'scan', text: 'Снимаш бона — AI го прочита' },
];

const SPLASH_HINTS = [
  'Топ находки от реални хора',
  'Червени флагове и скрити такси',
  'AI скенер на касови бележки',
  'Без реклами. Без платени ревюта.',
];

/* ------------------------------------------------------------------ */
/*  Splash екран                                                       */
/* ------------------------------------------------------------------ */
const Splash: React.FC = () => {
  const logoScale = useRef(new Animated.Value(0.7)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const barWidth = useRef(new Animated.Value(0)).current;
  const [hintIndex, setHintIndex] = useState(0);
  // Трите обещания излизат едно по едно — така сплашът има „дишане“, не е
  // просто лого, което изчезва, преди човек да го прочете.
  const featAnims = useRef(SPLASH_FEATURES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 600,
        delay: 220,
        useNativeDriver: true,
      }),
      Animated.timing(barWidth, {
        toValue: 1,
        duration: MIN_SPLASH_MS - 200,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start();

    // Меко „дишане“ на логото
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();

    // Трите обещания: появяват се последователно (леко отдолу нагоре).
    Animated.stagger(
      420,
      featAnims.map((a) =>
        Animated.timing(a, { toValue: 1, duration: 460, delay: 620, useNativeDriver: true })
      )
    ).start();

    // Сменящи се подсказки
    const t = setInterval(() => setHintIndex((i) => (i + 1) % SPLASH_HINTS.length), 1300);
    return () => clearInterval(t);
  }, [barWidth, featAnims, glow, logoOpacity, logoScale, textOpacity]);

  return (
    <LinearGradient colors={['#0C1222', '#060911', '#060911']} style={styles.splash}>
      <Animated.View
        style={[
          styles.glow,
          {
            opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.52] }),
            transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.18] }) }],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.logoWrap,
          { opacity: logoOpacity, transform: [{ scale: logoScale }] },
        ]}
      >
        <LinearGradient
          colors={['#10B981', '#22D3EE', '#6366F1']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.logoGradient}
        >
          <Ionicons name="pricetags" size={40} color={COLORS.white} />
        </LinearGradient>
      </Animated.View>

      <Animated.View style={{ opacity: textOpacity, alignItems: 'center' }}>
        <Text style={styles.splashTitle}>SmartPrice</Text>

        {/* Слоганът: защо съществува приложението, не какво прави.
            „Помагаме си взаимно“ е идеята; „безплатно“ е обещанието. */}
        <Text style={styles.splashSlogan}>Помагаме си взаимно. Безплатно.</Text>

        <Text style={styles.splashTagline}>
          Всеки споделя цена — всички печелим.{'\n'}Без реклами. Без платени ревюта.
        </Text>
      </Animated.View>

      {/* Какво получава човекът — три реда, които се появяват един след друг */}
      <View style={{ marginTop: 26, gap: 10, width: '100%', maxWidth: 340 }}>
        {SPLASH_FEATURES.map((f, i) => (
          <Animated.View
            key={f.text}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              backgroundColor: 'rgba(17, 23, 40, 0.72)',
              borderWidth: 1,
              borderColor: 'rgba(255, 255, 255, 0.08)',
              borderRadius: 16,
              paddingHorizontal: 14,
              paddingVertical: 10,
              opacity: featAnims[i],
              transform: [
                {
                  translateY: featAnims[i].interpolate({
                    inputRange: [0, 1],
                    outputRange: [14, 0],
                  }),
                },
              ],
            }}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(16, 185, 129, 0.14)',
                borderWidth: 1,
                borderColor: 'rgba(52, 211, 153, 0.28)',
              }}
            >
              <Ionicons name={f.icon as never} size={16} color={COLORS.greenBright} />
            </View>
            <Text style={{ color: COLORS.textPrimary, fontSize: 13.5, fontWeight: '700', letterSpacing: -0.2 }}>
              {f.text}
            </Text>
          </Animated.View>
        ))}
      </View>

      <Animated.View style={[styles.hintPill, { opacity: textOpacity }]}>
        <Text style={styles.hintPillText}>{SPLASH_HINTS[hintIndex]}</Text>
      </Animated.View>

      <View style={styles.barTrack}>
        <Animated.View
          style={[
            styles.barFill,
            { width: barWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>

      <Text style={styles.splashFoot}>{APP_DISPLAY_HOST}</Text>
    </LinearGradient>
  );
};

/* ------------------------------------------------------------------ */
/*  Порта: невлезнали → onboarding (първи път) или вход                 */
/* ------------------------------------------------------------------ */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isBootstrapping, isAuthenticated } = useAuth();
  const {
    isAddToHomeOpen,
    addToHomeMode,
    closeAddToHome,
    sharingPost,
    closeShare,
    isAuthPromptOpen,
    authPromptReason,
    closeAuthPrompt,
    founderCelebration,
    closeFounderCelebration,
  } = useApp();
  const segments = useSegments();
  const router = useRouter();

  const [minTimePassed, setMinTimePassed] = useState(false);
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);
  // Показали ли сме обяснението „Как работи“ в тази сесия. Пази се в ref, за да
  // не върне човека обратно в обяснението, след като го е пропуснал (иначе
  // цикъл: поток → обяснение → поток).
  const introShownRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setMinTimePassed(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    (async () => {
      const flag = await AsyncStorage.getItem(ONBOARDING_SEEN_KEY);
      setOnboardingSeen(flag === '1');
    })();
  }, []);

  const ready = !isBootstrapping && minTimePassed && onboardingSeen !== null;

  useEffect(() => {
    if (!ready) return;
    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated) {
      // Споделена оферта (post/<id>) се показва и на гости — иначе линкът,
      // пратен на приятел, водеше само до екран за вход.
      const isPublicPost = segments[0] === 'post';
      // Презентацията (/tour) се показва и на невлезли — точно това искаме:
      // човекът да я види ПРЕДИ да се регистрира.
      const isPublicTour = segments[0] === 'tour';
      // Томболата се рекламира ПРЕДИ регистрация: гостът трябва да може да
      // отвори /raffle и /raffle/<id> и да види наградата. Иначе натискането на
      // „Виж томболата“ само го връщаше на екрана за вход (нищо не се случваше).
      const isPublicRaffle = segments[0] === 'raffle';
      // Потокът се чете и БЕЗ профил — това е входната врата от TikTok:
      // човекът първо вижда реалните находки, чак после решава да влезе.
      const isTabs = segments[0] === '(tabs)';
      // AI съветникът „Ценко“ е достъпен и за гости. Иначе натискането на
      // бутона му (или директен адрес /assistant) хвърляше госта обратно в
      // потока и чатът изглеждаше „счупен“ — нищо не се отваряше.
      const isPublicAssistant = segments[0] === 'assistant';
      // ПЪРВО ПУСКАНЕ: обяснението „Как работи“ излиза веднага след сплаша.
      // Потокът се чете и без профил, затова човек се озоваваше направо в него
      // и обяснението никога не се показваше. Споделен линк (post/<id>) и
      // прегледът (/tour) остават непокътнати.
      if (!onboardingSeen && !introShownRef.current && !inAuthGroup && !isPublicTour) {
        introShownRef.current = true;
        router.replace('/(auth)/onboarding');
        return;
      }

      if (
        !inAuthGroup &&
        !isPublicPost &&
        !isPublicTour &&
        !isPublicRaffle &&
        !isPublicAssistant &&
        !isTabs
      ) {
        // Първото пускане води до обяснението, после директно в потока.
        router.replace(onboardingSeen ? '/(tabs)' : '/(auth)/onboarding');
      }
      return;
    }

    if (inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [ready, isAuthenticated, onboardingSeen, segments, router]);

  const showSplash = useMemo(
    () => !ready,
    [ready]
  );

  if (showSplash) return <Splash />;

    return (
      <>
        {children}
        {/* Модалът е тук, защото AuthGate е вътре в AppProvider и вижда
            състоянието му (в RootLayout то още не съществува). */}
        <AddToHomeScreenModal
          visible={isAddToHomeOpen}
          onClose={closeAddToHome}
          mode={addToHomeMode}
        />
        <ShareModal post={sharingPost} onClose={closeShare} />
        {/* Реклама на томболата: макс. 3 пъти, с X, на различни влизания */}
        <RafflePromoHost />
        {/* Гост натисна нещо, което иска профил → покана вместо суха грешка */}
        <AuthPromptModal
          visible={isAuthPromptOpen}
          reason={authPromptReason}
          onClose={closeAuthPrompt}
        />
        {/* Значка „Основател“ — поздрав веднага след първата находка */}
        <FounderCelebration data={founderCelebration} onClose={closeFounderCelebration} />
      </>
    );
  }

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppProvider>
        <AuthGate>
          <View style={styles.root}>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: COLORS.bgPrimary },
                animation: 'slide_from_right',
              }}
            >
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="tour" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="post/[id]"
                options={{ headerShown: false, presentation: 'card' }}
              />
              {/* AI съветникът „Ценко“ — отваря се като лист отдолу (модал),
                  за да не се губи контекстът на екрана, от който е отворен. */}
              <Stack.Screen
                name="assistant"
                options={{
                  headerShown: false,
                  presentation: Platform.OS === 'web' ? 'card' : 'modal',
                  animation: 'slide_from_bottom',
                }}
              />
            </Stack>
                        <DonationModal />
            {/* Модалите за Alert.alert() — на web вградената функция е празна */}
            <AlertHost />
          </View>
        </AuthGate>
      </AppProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary, overflow: 'hidden' },
    splash: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      // Скрива ореола, ако е по-широк от екрана — иначе на web се появява
      // хоризонтален скрол.
      overflow: 'hidden',
    },
  glow: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#06B6D4',
    opacity: 0.4,
    top: '26%',
  },
  logoWrap: {
    shadowColor: '#06B6D4',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  logoGradient: {
    width: 92,
    height: 92,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashTitle: {
    color: COLORS.white,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.8,
    marginTop: 22,
  },
  splashSlogan: {
    color: COLORS.accentCyan,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 12,
    letterSpacing: -0.2,
  },
  splashTagline: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
  },
  hintPill: {
    marginTop: 26,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  hintPillText: { color: COLORS.accentCyan, fontSize: 12.5, fontWeight: '800' },
  barTrack: {
    position: 'absolute',
    bottom: 74,
    width: 150,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  barFill: { height: 3, borderRadius: 2, backgroundColor: COLORS.accentCyan },
  splashFoot: {
    position: 'absolute',
    bottom: 40,
    color: COLORS.textMuted,
    fontSize: 11,
    letterSpacing: 0.5,
  },
});
