import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';

import { FormPage, FormSection } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import type { RemindMinutes } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import {
  getReminderPermission,
  refreshRemindersNow,
  requestReminderPermission,
  type ReminderPermission,
} from '@/lib/notifications/reminders';

const OPTIONS: RemindMinutes[] = [5, 10, 15, 30];

export default function NotificationsScreen() {
  const profile = useMealStore(s => s.profile);
  const updateProfile = useMealStore(s => s.updateProfile);

  // Saved on each tap, like iOS Settings — no Save button.
  const enabled = profile.mealRemindersEnabled ?? true;
  const minutes: RemindMinutes = profile.remindMinutesBefore ?? 15;
  const setMinutes = (v: RemindMinutes) => updateProfile({ remindMinutesBefore: v });

  // The switch is the user's choice; iPhone's own permission is separate and
  // can be turned off in iPhone Settings, so re-read it when coming back.
  const [permission, setPermission] = useState<ReminderPermission | null>(null);
  const showToast = useToastStore(s => s.showToast);
  const readPermission = useCallback(() => {
    getReminderPermission().then(setPermission, () => setPermission('unavailable'));
  }, []);
  useEffect(() => {
    readPermission();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') readPermission(); });
    return () => sub.remove();
  }, [readPermission]);

  const askPermission = async () => {
    let result: ReminderPermission;
    let before: ReminderPermission;
    try {
      // The first read may not have landed yet (switch flipped right away).
      before = permission ?? await getReminderPermission();
      if (before === 'unavailable') { setPermission(before); return; }
      result = await requestReminderPermission();
    } catch {
      showToast("Couldn't check notification permission. Please try again.");
      return;
    }
    setPermission(result);
    updateProfile({ notificationsAllowed: result === 'granted' });
    void refreshRemindersNow();
    // Only point to iPhone Settings if it was already off — not right after
    // the user just tapped "Don't Allow" on the prompt.
    if (result === 'denied' && before === 'denied') {
      Alert.alert(
        'Notifications are off',
        'Turn on notifications for Macrotri in iPhone Settings to get meal reminders.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
        ],
      );
    }
  };

  const setEnabled = (v: boolean) => {
    updateProfile({ mealRemindersEnabled: v });
    if (v && permission !== 'granted' && permission !== 'unavailable') void askPermission();
  };

  return (
    <FormPage title="Notifications">
      <FormSection label="MEAL REMINDERS">
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowText}>Meal reminders</Text>
            <Text style={styles.rowSub}>Get notified before each meal time in your plan.</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ true: COLORS.green, false: COLORS.elevated }}
            thumbColor="#fff"
          />
        </View>

        {enabled && permission && permission !== 'granted' ? (
          <View style={[styles.row, styles.noticeRow]}>
            <Text style={styles.noticeText}>
              {permission === 'unavailable'
                ? 'Reminders need the latest version of the app.'
                : permission === 'denied'
                  ? 'Notifications are off for Macrotri in iPhone Settings, so reminders can’t be sent.'
                  : 'Allow notifications so reminders can be sent.'}
            </Text>
            {permission !== 'unavailable' ? (
              <TouchableOpacity
                onPress={() => {
                  if (permission === 'denied') void Linking.openSettings();
                  else void askPermission();
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.noticeAction}>
                  {permission === 'denied' ? 'Open iPhone Settings' : 'Allow notifications'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {enabled ? (
          <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
            <Text style={styles.rowText}>Remind me before meal time</Text>
            <View style={styles.minutesRow}>
              {OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.minuteChip, minutes === opt && styles.minuteChipActive]}
                  onPress={() => setMinutes(opt)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.minuteText, minutes === opt && styles.minuteTextActive]}>
                    {opt} min
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.rowSub}>
              For a meal at 07:30 with a 15-minute reminder, you&apos;ll get a notification at 07:15.
            </Text>
          </View>
        ) : null}
      </FormSection>
    </FormPage>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  rowText: { color: COLORS.text, fontSize: 15 },
  noticeRow: { flexDirection: 'column', alignItems: 'flex-start', gap: 8 },
  noticeText: { color: COLORS.orange, fontSize: 13, lineHeight: 18 },
  noticeAction: { color: COLORS.green, fontSize: 14, fontWeight: '700' },
  rowSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  minutesRow: { flexDirection: 'row', gap: 8 },
  minuteChip: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: COLORS.elevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  minuteChipActive: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  minuteText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  minuteTextActive: { color: '#fff' },
});
