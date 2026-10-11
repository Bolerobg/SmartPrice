import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppProvider } from '@/context/AppContext';
import { AuthProvider, useAuth } from '@/src/auth/AuthContext';
import { DonationModal } from '@/components/DonationModal';
import { COLORS } from '@/constants/theme';

/**
 * Пази приложението: невлезли потребители отиват на /(auth)/login.
 * Реална автентикация вместо досегашния „винаги влязъл“ mock профил.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isBootstrapping, isAuthenticated } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isBootstrapping) return;
    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isBootstrapping, isAuthenticated, segments, router]);

  if (isBootstrapping) {
    return (
      <View style={styles.splash}>
        <View style={styles.splashBadge}>
          <Ionicons name="pricetags" size={34} color={COLORS.greenBright} />
        </View>
        <Text style={styles.splashTitle}>SmartPrice</Text>
        <Text style={styles.splashSub}>Зареждане на профила…</Text>
        <ActivityIndicator color={COLORS.greenBright} style={{ marginTop: 18 }} />
      </View>
    );
  }

  return <>{children}</>;
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
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="post/[id]"
                options={{ headerShown: false, presentation: 'card' }}
              />
            </Stack>
            <DonationModal />
          </View>
        </AuthGate>
      </AppProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  splash: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  splashBadge: {
    width: 78,
    height: 78,
    borderRadius: 24,
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashTitle: {
    color: COLORS.textPrimary,
    fontSize: 26,
    fontWeight: '900',
    marginTop: 16,
    letterSpacing: 0.4,
  },
  splashSub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 6 },
});
