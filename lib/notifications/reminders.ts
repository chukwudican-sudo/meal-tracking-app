// Meal reminders: local notifications the phone schedules itself ("Lunch in
// 15 min"), rebuilt from the store whenever planned meals or the reminder
// settings change. Only planned meals (status 'pending') get one; eating,
// removing or swapping a meal drops or replaces its reminder on the next
// refresh. Remote push (the bell inbox) is separate and not scheduled here.

import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';

import type { DailyLog, MealSlot, MealTemplate } from '@/store/types';
import { isSeedTemplate, isTemplateApplicableOnDate, toIsoDate, useMealStore } from '@/store/useMealStore';

type NotificationsModule = typeof ExpoNotifications;

// iOS keeps at most 64 scheduled notifications per app, so schedule a rolling
// window and top it up on every refresh (app open, meal change).
const DAYS_AHEAD = 7;
const MAX_SCHEDULED = 60;

export const MEAL_REMINDER_TYPE = 'meal-reminder';

let cachedModule: NotificationsModule | null | undefined;

// Dev builds made before expo-notifications was added don't contain its
// native code, and importing the package there throws at startup. Check for
// the native module first; on such a build reminders just stay off.
export function getNotifications(): NotificationsModule | null {
  if (cachedModule !== undefined) return cachedModule;
  if (!requireOptionalNativeModule('ExpoNotificationScheduler')) {
    cachedModule = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('expo-notifications') as NotificationsModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export type ReminderPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

function toPermission(res: { granted: boolean; status: string }): ReminderPermission {
  if (res.granted) return 'granted';
  return res.status === 'denied' ? 'denied' : 'undetermined';
}

export async function getReminderPermission(): Promise<ReminderPermission> {
  const N = getNotifications();
  if (!N) return 'unavailable';
  return toPermission(await N.getPermissionsAsync());
}

// Shows the iOS prompt the first time; after a "Don't Allow" iOS won't ask
// again and this returns 'denied' (send the user to iPhone Settings).
export async function requestReminderPermission(): Promise<ReminderPermission> {
  const N = getNotifications();
  if (!N) return 'unavailable';
  await ensureAndroidChannel(N);
  const current = await N.getPermissionsAsync();
  if (current.granted || current.status === 'denied') return toPermission(current);
  return toPermission(await N.requestPermissionsAsync());
}

// Android 13+ only shows its permission prompt once a channel exists, and
// reminders scheduled without one land in a generic "Miscellaneous" channel.
let channelReady = false;
async function ensureAndroidChannel(N: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android' || channelReady) return;
  await N.setNotificationChannelAsync('default', {
    name: 'Meal reminders',
    importance: N.AndroidImportance.DEFAULT,
  });
  channelReady = true;
}

export interface PlannedReminder {
  id: string;
  fireAt: Date;
  title: string;
  body: string;
}

function slotLabel(time: string, slots: MealSlot[], category?: string): string {
  const slot = slots.find(s => !s.skipped && s.time === time);
  return slot?.name ?? category ?? 'Meal';
}

// Pure: what should be scheduled right now. A day nobody has opened yet has no
// log; its meals come from the templates exactly as resolveDayFromTemplates
// would build them (all planned).
export function computeReminders(input: {
  logs: Record<string, DailyLog>;
  templates: MealTemplate[];
  mealSlots: MealSlot[];
  minutesBefore: number;
  now: Date;
}): PlannedReminder[] {
  const { logs, templates, mealSlots, minutesBefore, now } = input;
  const out: PlannedReminder[] = [];

  for (let i = 0; i < DAYS_AHEAD; i++) {
    const date = toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
    const log = logs[date];
    const meals = log
      ? log.meals
          // Demo meals a new install starts with aren't the user's food (days
          // built from the seed templates carry their templateId, not `seed`).
          .filter(m => m.status === 'pending' && !m.seed
            && !(m.templateId && isSeedTemplate({ id: m.templateId })))
          .map(m => ({ key: m.id, name: m.name, time: m.time, category: m.category as string | undefined }))
      : templates
          // The demo meals a new install starts with are not the user's food.
          .filter(t => !isSeedTemplate(t) && isTemplateApplicableOnDate(t, date))
          .map(t => ({ key: t.id, name: t.name, time: t.time, category: undefined }));

    for (const m of meals) {
      if (!/^\d{2}:\d{2}$/.test(m.time)) continue;
      const fireAt = new Date(`${date}T${m.time}:00`);
      fireAt.setMinutes(fireAt.getMinutes() - minutesBefore);
      if (!(fireAt.getTime() > now.getTime())) continue;
      out.push({
        id: `meal-${date}-${m.key}`,
        fireAt,
        title: `${slotLabel(m.time, mealSlots, m.category)} in ${minutesBefore} min`,
        body: m.name,
      });
    }
  }

  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime()).slice(0, MAX_SCHEDULED);
}

// What this app session last scheduled: id -> its content. null = unknown
// (first run, or after an error), which clears everything and rebuilds.
let scheduled: Map<string, string> | null = null;
let lastSignedIn = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retriesLeft = 1; // back to 1 after any successful refresh
let queue: Promise<void> = Promise.resolve();

// Serialized so overlapping refreshes (a meal tick right as the app comes to
// the foreground) can't interleave cancel/schedule calls.
export function refreshReminders(signedIn: boolean): Promise<void> {
  lastSignedIn = signedIn;
  queue = queue
    .then(() => doRefresh(signedIn))
    .then(() => { retriesLeft = 1; })
    .catch(e => {
      console.warn('[reminders] refresh failed:', e);
      // Rebuild from scratch, once, shortly — a half-finished refresh must not
      // leave the next meals without reminders until the app is reopened.
      scheduled = null;
      if (!retryTimer && retriesLeft > 0) {
        retriesLeft -= 1;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void refreshReminders(lastSignedIn);
        }, 30_000);
      }
    });
  return queue;
}

// For callers outside ReminderSync (e.g. right after a permission grant).
export function refreshRemindersNow(): Promise<void> {
  return refreshReminders(lastSignedIn);
}

async function doRefresh(signedIn: boolean): Promise<void> {
  const N = getNotifications();
  if (!N) return;
  const s = useMealStore.getState();
  await ensureAndroidChannel(N);
  const permission = toPermission(await N.getPermissionsAsync());

  const wanted = signedIn && s.profile.mealRemindersEnabled && permission === 'granted'
    ? computeReminders({
        logs: s.logs,
        templates: s.templates,
        mealSlots: s.profile.mealSlots,
        minutesBefore: s.profile.remindMinutesBefore,
        now: new Date(),
      })
    : [];
  const next = new Map(wanted.map(r => [r.id, JSON.stringify([r.fireAt.getTime(), r.title, r.body])]));

  // Only meal reminders are ever scheduled locally (pushes come from the
  // server), so a full clear is safe when we don't know what's there.
  if (scheduled === null) {
    await N.cancelAllScheduledNotificationsAsync();
    scheduled = new Map();
  }
  const current = scheduled;
  // Change only what differs: a tick-off cancels one reminder instead of
  // rebuilding all of them. Scheduling an existing id replaces it.
  for (const [id, sig] of current) {
    if (next.get(id) !== sig) {
      await N.cancelScheduledNotificationAsync(id);
      current.delete(id);
    }
  }
  for (const r of wanted) {
    const sig = next.get(r.id)!;
    if (current.get(r.id) === sig) continue;
    await N.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: { type: MEAL_REMINDER_TYPE } },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: r.fireAt },
    });
    current.set(r.id, sig);
  }
}
