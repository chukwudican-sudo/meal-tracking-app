import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, Tabs } from 'expo-router';

import { CustomTabBar } from '@/components/CustomTabBar';
import { AddMealScreen } from '@/components/addMeal/AddMealScreen';
import { COLORS } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { toIsoDate, useMealStore } from '@/store/useMealStore';

export default function TabLayout() {
  // Lifted here so the + button on the custom tab bar can open AddMealScreen
  // from any tab and the main bar disappears underneath it.
  const [addMealVisible, setAddMealVisible] = useState(false);

  // Gate the app on (1) onboarding completion and (2) an authenticated session.
  // A fresh install or a signed-out user must not see cached tab data — send
  // them to onboarding/login instead. We wait for the persisted store to
  // rehydrate AND the auth session to resolve first; before that,
  // onboardingComplete/session read as their initial values and would wrongly
  // bounce a returning, logged-in user.
  const onboardingComplete = useMealStore(s => s.profile.onboardingComplete);
  // Local-first exception: right after email signup there's no session yet
  // (email confirmation pending), but the user has just onboarded and should be
  // let in with the "verify your email" banner rather than kicked to login.
  const pendingEmailVerification = useMealStore(s => s.profile.pendingEmailVerification ?? false);
  const { session, initializing } = useAuth();

  const [hydrated, setHydrated] = useState(() => useMealStore.persist.hasHydrated());
  useEffect(() => {
    if (useMealStore.persist.hasHydrated()) setHydrated(true);
    const unsub = useMealStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);

  const ready = hydrated && !initializing;
  const authed = !!session || pendingEmailVerification;
  const canEnter = ready && onboardingComplete && authed;

  useEffect(() => {
    if (ready && (!onboardingComplete || !authed)) router.replace('/onboarding');
  }, [ready, onboardingComplete, authed]);

  if (!canEnter) {
    return <View style={{ flex: 1, backgroundColor: COLORS.bg }} />;
  }

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
