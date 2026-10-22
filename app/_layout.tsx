import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { AppProvider, useApp } from '@/context/AppContext';
import { AuthProvider, useAuth } from '@/src/auth/AuthContext';
import { AddToHomeScreenModal } from '@/components/AddToHomeScreenModal';
import { DonationModal } from '@/components/DonationModal';
import { AlertHost } from '@/components/AlertHost';
import { ShareModal } from '@/components/ShareModal';
import { RafflePromoHost } from '@/components/RafflePromoModal';
import { ScreenTracker } from '@/components/ScreenTracker';
import { AuthPromptModal } from '@/components/AuthPromptModal';
import { FounderCelebration } from '@/components/FounderCelebration';
import { UpdateBubble } from '@/components/UpdateBubble';
import '@/lib/alertHost';
import { captureFirstTouch } from '@/lib/firstTouch';
import { COLORS } from '@/constants/theme';

captureFirstTouch();

const APP_DISPLAY_HOST = (process.env.EXPO_PUBLIC_API_URL || 'https://smartprice.bg')
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '');
const MIN_SPLASH_MS = 400;

const SPLASH_FEATURES: { icon: string; text: string }[] = [
  { icon: 'pricetag', text: 'Сравнение на цени по вериги в реално време' },
  { icon: 'receipt', text: 'Потвърдени касови бележки от общността' },
  { icon: 'trending-down', text: 'История на цената и максимална икономия' },
];

/* ------------------------------------------------------------------ */
/*  Splash екран (Spesti & Otkriy Light Utilitarian)                   */
/* ------------------------------------------------------------------ */
const Splash: React.FC = () => {
  const logoScale = useRef(new Animated.Value(0.88)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const barWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, friction: 7, tension: 80, useNativeDriver: true }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(barWidth, {
        toValue: 1,
        duration: MIN_SPLASH_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start();
  }, [barWidth, logoOpacity, logoScale]);

  return (
    <LinearGradient colors={['#f8f9ff', '#eff4ff', '#f8f9ff']} style={styles.splash}>
      <Animated.View
        style={[
          styles.logoWrap,
          { opacity: logoOpacity, transform: [{ scale: logoScale }] },
        ]}
      >
        <LinearGradient
          colors={['#006c49', '#10b981']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.logoGradient}
        >
          <Ionicons name="pricetags" size={38} color={COLORS.white} />
        </LinearGradient>
      </Animated.View>

      <Animated.View style={{ opacity: logoOpacity, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20 }}>
          <Text style={styles.splashTitle}>Спести & Открий</Text>
          <View style={styles.bgBadge}>
            <Text style={styles.bgBadgeText}>BG</Text>
          </View>
        </View>
        <Text style={styles.splashSlogan}>Прозрачни цени и реални икономии всеки ден</Text>
      </Animated.View>

      <View style={{ marginTop: 24, gap: 10, width: '100%', maxWidth: 340 }}>
        {SPLASH_FEATURES.map((f) => (
          <View
            key={f.text}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              backgroundColor: COLORS.surfaceContainerLowest,
              borderWidth: 1,
              borderColor: COLORS.borderSubtle,
              borderRadius: 16,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: COLORS.primaryFixed,
              }}
            >
              <Ionicons name={f.icon as never} size={16} color={COLORS.onPrimaryFixedVariant} />
            </View>
            <Text style={{ color: COLORS.onSurface, fontSize: 13, fontWeight: '700', flex: 1 }}>
              {f.text}
            </Text>
          </View>
        ))}
      </View>

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
/*  Порта: отваря директно основния интерфейс                          */
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

  useEffect(() => {
    const t = setTimeout(() => setMinTimePassed(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  const ready = !isBootstrapping && minTimePassed;

  useEffect(() => {
    if (!ready) return;
    const inAuthGroup = segments[0] === '(auth)';
    const isPublicPost = segments[0] === 'post';
    const isPublicTour = segments[0] === 'tour';
    const isPublicRaffle = segments[0] === 'raffle';
    const isTabs = segments[0] === '(tabs)';
    const isPublicAssistant = segments[0] === 'assistant';
    const isPublicObject = segments[0] === 'object';
    const isPublicPlace = segments[0] === 'place';
    const isPublicShops = segments[0] === 'shops';
    const isPublicChainsCompare = segments[0] === 'chains-compare';
    const isPublicHowItWorks = segments[0] === 'how-it-works';
    const isPublicListings = segments[0] === 'listings';
    const isPublicFavorites = segments[0] === 'favorites';
    const isPublicPuzzle = segments[0] === 'puzzle-demo';

    if (!isAuthenticated) {
      if (
        !inAuthGroup &&
        !isPublicPost &&
        !isPublicTour &&
        !isPublicRaffle &&
        !isPublicAssistant &&
        !isPublicObject &&
        !isPublicPlace &&
        !isPublicShops &&
        !isPublicChainsCompare &&
        !isPublicHowItWorks &&
        !isPublicListings &&
        !isPublicFavorites &&
        !isPublicPuzzle &&
        !isTabs
      ) {
        router.replace('/(tabs)');
      }
      return;
    }

    if (inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [ready, isAuthenticated, segments, router]);

  const showSplash = useMemo(() => !ready, [ready]);

  if (showSplash) return <Splash />;

  return (
    <>
      {children}
      <AddToHomeScreenModal
        visible={isAddToHomeOpen}
        onClose={closeAddToHome}
        mode={addToHomeMode}
      />
      <ShareModal post={sharingPost} onClose={closeShare} />
      <RafflePromoHost />
      <ScreenTracker />
      <AuthPromptModal
        visible={isAuthPromptOpen}
        reason={authPromptReason}
        onClose={closeAuthPrompt}
      />
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
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: COLORS.surface },
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
            <AlertHost />
            <UpdateBubble />
          </View>
        </AuthGate>
      </AppProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface, overflow: 'hidden' },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    overflow: 'hidden',
  },
  logoWrap: {
    shadowColor: '#006c49',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  logoGradient: {
    width: 84,
    height: 84,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashTitle: {
    color: COLORS.onSurface,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  bgBadge: {
    backgroundColor: COLORS.primaryFixed,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  bgBadgeText: {
    color: COLORS.onPrimaryFixedVariant,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  splashSlogan: {
    color: COLORS.onSurfaceVariant,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
  },
  barTrack: {
    position: 'absolute',
    bottom: 68,
    width: 150,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.surfaceContainerHigh,
    overflow: 'hidden',
  },
  barFill: { height: 4, borderRadius: 2, backgroundColor: COLORS.primary },
  splashFoot: {
    position: 'absolute',
    bottom: 36,
    color: COLORS.outline,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
});
