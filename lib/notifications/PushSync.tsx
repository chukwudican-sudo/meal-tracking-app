// Bell inbox + push: registers this phone for pushes once notifications are
// allowed, keeps the inbox fresh (launch, foreground, push received) and
// opens it when a push is tapped. Mounted once in the root layout.

import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/lib/auth';
import { useInboxStore } from '@/store/useInboxStore';
import { useMealStore } from '@/store/useMealStore';
import { allowPushRegistration, ANNOUNCEMENT_TYPE, registerPushToken } from './push';
import { getNotifications } from './reminders';

// One tap can reach both the cold-start check and the live listener. Always
// a short delay: on a cold start the listener fires before the navigator
// has mounted, and an immediate push would be dropped.
let lastOpenedId: string | null = null;
function openInboxFor(id: string) {
  if (id === lastOpenedId) return;
  lastOpenedId = id;
  setTimeout(() => {
    try {
      // navigate, not push: already in the inbox means stay there.
      router.navigate('/notifications');
    } catch (e) {
      console.warn('[push] could not open inbox:', e);
    }
  }, 400);
}

export function PushSync() {
  const { user, initializing } = useAuth();
  const userId = initializing ? undefined : user?.id ?? null;
  // Re-run after a permission grant (onboarding / Settings / one-time ask
  // all record the result here).
  const allowed = useMealStore(s => s.profile.notificationsAllowed);
  const coldStartChecked = useRef(false);

  useEffect(() => {
    if (userId === undefined) return;
    if (userId === null) {
      useInboxStore.getState().clear();
      return;
    }
    allowPushRegistration();
    const sync = () => {
      registerPushToken(userId).catch(e => console.warn('[push] register failed:', e));
      void useInboxStore.getState().refresh();
    };
    sync();

    // App opened by tapping a message while it was fully closed: the live
    // listener below wasn't there yet, so open the inbox once signed in.
    if (!coldStartChecked.current) {
      coldStartChecked.current = true;
      void getNotifications()?.getLastNotificationResponseAsync().then(res => {
        // Only a tap that just launched the app — not one from before a long
        // signed-out stretch (login / onboarding) that would pop up mid-flow.
        const recent = !!res && Date.now() - res.notification.date < 2 * 60_000;
        if (recent && res.notification.request.content.data?.type === ANNOUNCEMENT_TYPE) {
          openInboxFor(res.notification.request.identifier);
        }
      }).catch(() => {});
    }

    const sub = AppState.addEventListener('change', s => { if (s === 'active') sync(); });
    return () => sub.remove();
  }, [userId, allowed]);

  useEffect(() => {
    const N = getNotifications();
    if (!N) return;
    const received = N.addNotificationReceivedListener(n => {
      if (n.request.content.data?.type === ANNOUNCEMENT_TYPE) void useInboxStore.getState().refresh();
    });
    const tapped = N.addNotificationResponseReceivedListener(res => {
      if (res.notification.request.content.data?.type === ANNOUNCEMENT_TYPE) {
        openInboxFor(res.notification.request.identifier);
      }
    });
    return () => { received.remove(); tapped.remove(); };
  }, []);

  return null;
}
