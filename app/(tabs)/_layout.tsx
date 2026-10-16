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
    backgroundColor: '#0D1322',
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
    height: Platform.OS === 'ios' ? 86 : 68,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  centerAddButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.greenPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Platform.OS === 'ios' ? 14 : 8,
    borderWidth: 2,
    borderColor: COLORS.greenBright,
    shadowColor: COLORS.greenPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 6,
  },
});
