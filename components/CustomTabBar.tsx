import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import { COLORS } from '@/constants/theme';

interface Props extends BottomTabBarProps {
  onPlusPress: () => void;
}

// Visual config for each tab — emoji icons match the previous tab bar.
const TAB_VISUALS: Record<string, { icon: string; label: string }> = {
  progress: { icon: '📈', label: 'Progress' },
  index:    { icon: '🏠', label: 'Home' },
  plan:     { icon: '📋', label: 'Plan' },
  recipes:  { icon: '🍳', label: 'Recipes' },
};

// Display order, left → right. The custom + button sits flush right.
const TAB_ORDER: string[] = ['index', 'plan', 'recipes', 'progress'];

export function CustomTabBar({ state, navigation, onPlusPress }: Props) {
  const insets = useSafeAreaInsets();
  // Map route names to indices in `state.routes` so we can render in our
  // chosen order regardless of the order Expo Router declared them.
  const routeIndexByName = new Map(state.routes.map((r, i) => [r.name, i]));

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.row}>
        {TAB_ORDER.map(name => {
          const idx = routeIndexByName.get(name);
          if (idx === undefined) return null;
          const route = state.routes[idx];
          const isFocused = state.index === idx;
          const visuals = TAB_VISUALS[name] ?? { icon: '•', label: name };

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              onPress={onPress}
              style={styles.tabBtn}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabIcon, isFocused && styles.tabIconActive]}>
                {visuals.icon}
              </Text>
              <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]}>
                {visuals.label}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Always-prominent + action — never enters a selected state. */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Add meal"
          onPress={onPlusPress}
          style={styles.plusBtn}
          activeOpacity={0.85}
        >
          <Text style={styles.plusIcon}>＋</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: COLORS.card,
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    paddingTop: 6,
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    gap: 2,
  },
  tabIcon: { fontSize: 20, opacity: 0.5 },
  tabIconActive: { opacity: 1 },
  tabLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },
  tabLabelActive: { color: COLORS.green },

  plusBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    // Soft shadow to make it pop above the bar
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  plusIcon: { color: '#0E1A12', fontSize: 30, fontWeight: '300', lineHeight: 32 },
});
