import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/src/auth/AuthContext';
import { AssistantFab } from '@/components/AssistantFab';

export default function TabsLayout() {
  const { isAuthenticated } = useAuth();
  const { openAuthPrompt } = useApp();

  // Гостът чете потока и класацията свободно, но „Сподели“ и „Профил“ искат
  // профил. Вместо да го изхвърляме на екран за вход, му показваме поканата
  // (с бутони „Регистрирай се“ / „Вече имам профил“).
  const guardTab = (reason: string) => (e: { preventDefault: () => void }) => {
    if (isAuthenticated) return;
    e.preventDefault();
    openAuthPrompt(reason);
  };

  // Кой таб е отворен — подаваме го на Ценко, за да е уместна подканата му.
  const pathname = usePathname();
  const assistantScreen = pathname.includes('radar')
    ? 'radar'
    : pathname.includes('add')
      ? 'add'
      : pathname.includes('community')
        ? 'community'
        : pathname.includes('profile')
          ? 'profile'
          : 'feed';

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: COLORS.greenBright,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Поток',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="flame" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="radar"
        options={{
          title: 'Радар',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="add"
        listeners={{ tabPress: guardTab('За да качиш находка, трябва профил. Отнема 30 секунди.') }}
        options={{
          title: 'Сподели',
          tabBarIcon: ({ focused }) => (
            <View
              style={[
                styles.centerAddButton,
                focused && { transform: [{ scale: 1.06 }] },
              ]}
            >
              <Ionicons name="scan" size={24} color={COLORS.white} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: 'Общност',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        listeners={{ tabPress: guardTab('Профилът пази значките, точките и любимите ти цени.') }}
        options={{
          title: 'Профил',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle" size={size} color={color} />
          ),
        }}
      />
    </Tabs>

    {/* „Ценко“ — плаващ бутон на всеки таб. Вижда се над таб-бара и подканва
        човека да пита, когато нещо не му е ясно. */}
    <AssistantFab screen={assistantScreen} />
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: 'rgba(9, 13, 24, 0.96)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    height: Platform.OS === 'ios' ? 88 : 70,
    paddingTop: 7,
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 16,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: -0.1,
    marginTop: 2,
  },
  centerAddButton: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: COLORS.greenPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Platform.OS === 'ios' ? 16 : 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.32)',
    shadowColor: COLORS.greenBright,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.48,
    shadowRadius: 14,
    elevation: 10,
  },
});
