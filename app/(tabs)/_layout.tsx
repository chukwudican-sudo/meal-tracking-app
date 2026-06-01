import { useState } from 'react';
import { Tabs } from 'expo-router';

import { CustomTabBar } from '@/components/CustomTabBar';
import { AddMealScreen } from '@/components/addMeal/AddMealScreen';
import { toIsoDate } from '@/store/useMealStore';

export default function TabLayout() {
  // Lifted here so the + button on the custom tab bar can open AddMealScreen
  // from any tab and the main bar disappears underneath it.
  const [addMealVisible, setAddMealVisible] = useState(false);

  // The + button is "Add to today" by spec — pre-fill today's ISO date.
  const todayIso = toIsoDate(new Date());

  return (
    <>
      <Tabs
        initialRouteName="index"
        screenOptions={{ headerShown: false }}
        tabBar={(props) => (
          <CustomTabBar {...props} onPlusPress={() => setAddMealVisible(true)} />
        )}
      >
        {/* Tabs are declared by file presence; visual order is controlled by
            CustomTabBar.TAB_ORDER, not by the order of these declarations. */}
        <Tabs.Screen name="index"    options={{ title: 'Home' }} />
        <Tabs.Screen name="plan"     options={{ title: 'Plan' }} />
        <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
        <Tabs.Screen name="recipes"  options={{ title: 'Recipes' }} />
      </Tabs>

      <AddMealScreen
        visible={addMealVisible}
        date={todayIso}
        onClose={() => setAddMealVisible(false)}
      />
    </>
  );
}
