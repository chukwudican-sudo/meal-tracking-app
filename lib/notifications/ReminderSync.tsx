// Keeps the phone's scheduled meal reminders in step with the store. Mounted
// once in the root layout; renders nothing.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/lib/auth';
import { profileHasData, useMealStore } from '@/store/useMealStore';
import {
  getNotifications,
  getReminderPermission,
  MEAL_REMINDER_TYPE,
  refreshReminders,
  requestReminderPermission,
} from './reminders';

const ASKED_KEY = 'reminders:askedPermission';

// Show reminders as a banner even while the app is open. Set once at load.
getNotifications()?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function ReminderSync() {
  const { user, initializing } = useAuth();
  const signedIn = !!user;

  const [hydrated, setHydrated] = useState(() => useMealStore.persist.hasHydrated());
  useEffect(() => {
    if (hydrated) return;
    const unsub = useMealStore.persist.onFinishHydration(() => setHydrated(true));
    // It may have finished between the first render and this effect.
    if (useMealStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, [hydrated]);

  const logs = useMealStore(s => s.logs);
  const templates = useMealStore(s => s.templates);
  const enabled = useMealStore(s => s.profile.mealRemindersEnabled);
  const minutes = useMealStore(s => s.profile.remindMinutesBefore);
  const mealSlots = useMealStore(s => s.profile.mealSlots);

  const ready = hydrated && !initializing;
  const onboarded = useMealStore(s => profileHasData(s.profile));
  // Synced from onboarding: false = they tapped "Not now". Respect it even
  // where the (unsynced) reminders switch came back as its default after a
  // reinstall.
  const saidNo = useMealStore(s => s.profile.notificationsAllowed === false);

  // Accounts made before reminders existed have them switched on but were
  // never asked by iOS. Ask once, on this install; onboarding asks new users
  // itself (and "Not now" there switches reminders off, so this stays quiet).
  useEffect(() => {
    if (!ready || !signedIn || !enabled || !onboarded || saidNo) return;
    let cancelled = false;
    void (async () => {
      try {
        if ((await getReminderPermission()) !== 'undetermined') return;
        if (await AsyncStorage.getItem(ASKED_KEY)) return;
        if (cancelled) return;
        await AsyncStorage.setItem(ASKED_KEY, '1');
        const result = await requestReminderPermission();
        useMealStore.getState().updateProfile({ notificationsAllowed: result === 'granted' });
        void refreshReminders(signedIn);
      } catch (e) {
        console.warn('[reminders] permission ask failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, signedIn, enabled, onboarded, saidNo]);

  // Debounced: a plan activation or swap fires many store updates at once.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => { void refreshReminders(signedIn); }, 800);
    return () => clearTimeout(t);
  }, [ready, signedIn, logs, templates, enabled, minutes, mealSlots]);

  // Coming back to the app: top up the rolling 7-day window and pick up a
  // permission change made in iPhone Settings.
  useEffect(() => {
    if (!ready) return;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshReminders(signedIn);
    });
    return () => sub.remove();
  }, [ready, signedIn]);

  // Tapping a reminder opens Home (the reminder fires on the meal's own day).
  useEffect(() => {
    const N = getNotifications();
    if (!N) return;
    const sub = N.addNotificationResponseReceivedListener(res => {
      if (res.notification.request.content.data?.type === MEAL_REMINDER_TYPE) {
        router.navigate('/(tabs)');
      }
    });
    return () => sub.remove();
  }, []);

  return null;
}
