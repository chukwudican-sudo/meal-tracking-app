import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, Tabs, useSegments } from 'expo-router';

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

  // This layout is the navigation anchor, so it stays mounted underneath
  // /onboarding and this gate keeps running during login. During the login
  // window the session flips to authed BEFORE onboardingComplete is set (that
  // only happens after the post-login pull confirms real data), which would
  // trip the redirect below and remount /onboarding to its first step — a
  // visible Welcome-screen flash. Skip the redirect while onboarding is already
  // the active route so we never redundantly replace it onto itself.
  // /auth/* (forgot-password, reset, verify-code, callback) are reached while
  // logged out, so the gate must not bounce them back to /onboarding either —
  // it did, which made password reset unreachable.
  const segments = useSegments();
  const inAuthFlow = segments[0] === 'onboarding' || segments[0] === 'auth';

  useEffect(() => {
    if (ready && (!onboardingComplete || !authed) && !inAuthFlow) {
      router.replace('/onboarding');
    }
  }, [ready, onboardingComplete, authed, inAuthFlow]);

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
