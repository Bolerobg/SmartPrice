import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { AssistantFab } from '@/components/AssistantFab';

export default function TabsLayout() {
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
    <View style={{ flex: 1, backgroundColor: COLORS.surface }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.onSurfaceVariant,
          tabBarLabelStyle: styles.tabBarLabel,
          tabBarItemStyle: styles.tabBarItem,
        }}
      >
        <Tabs.Screen
          name="community"
          options={{
            title: 'Начало',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'home' : 'home-outline'}
                size={22}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            title: 'Цени',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'pricetag' : 'pricetag-outline'}
                size={22}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="radar"
          options={{
            title: 'Места',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'compass' : 'compass-outline'}
                size={23}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Профил',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'person-circle' : 'person-circle-outline'}
                size={24}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="add"
          options={{
            href: null,
          }}
        />
      </Tabs>

      <AssistantFab screen={assistantScreen} bottom={Platform.OS === 'ios' ? 92 : 76} />
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: 'rgba(248, 249, 255, 0.94)',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    height: Platform.OS === 'ios' ? 84 : 64,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 22 : 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 12,
    ...(Platform.OS === 'web'
      ? ({
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        } as object)
      : {}),
  },
  tabBarItem: {
    minHeight: 48,
    paddingVertical: 2,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginTop: 2,
  },
});
