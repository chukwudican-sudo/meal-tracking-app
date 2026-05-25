import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';

export default function TabLayout() {
  const plannedCount = useMealStore(s =>
    Object.values(s.grocery.items).filter(i => i.section === 'planned').length
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor:   COLORS.green,
        tabBarInactiveTintColor: COLORS.textSecondary,
        tabBarStyle: {
          backgroundColor: COLORS.card,
          borderTopColor:  COLORS.border,
          borderTopWidth:  1,
          paddingBottom:   4,
          height:          60,
        },
        tabBarLabelStyle: {
          fontSize:   11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <TabIcon label="🏠" color={color} />,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Plan',
          tabBarIcon: ({ color }) => <TabIcon label="📋" color={color} />,
        }}
      />
      <Tabs.Screen
        name="grocery"
        options={{
          title: 'Grocery',
          tabBarIcon: ({ color }) => <TabIcon label="🛒" color={color} />,
          tabBarBadge: plannedCount > 0 ? plannedCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: COLORS.red,
            color: '#FFFFFF',
            fontSize: 10,
            minWidth: 18,
            height: 18,
            lineHeight: 16,
          },
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ color }) => <TabIcon label="📚" color={color} />,
        }}
      />
    </Tabs>
  );
}

// Minimal emoji icon — replace with vector icons in a later phase
function TabIcon({ label, color }: { label: string; color: string }) {
  return <Text style={{ fontSize: 20, opacity: color === COLORS.green ? 1 : 0.5 }}>{label}</Text>;
}
