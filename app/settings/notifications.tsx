import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';

import { FormPage, FormSection } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import type { RemindMinutes } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

const OPTIONS: RemindMinutes[] = [5, 10, 15, 30];

export default function NotificationsScreen() {
  const profile = useMealStore(s => s.profile);
  const updateProfile = useMealStore(s => s.updateProfile);
  const showToast = useToastStore(s => s.showToast);

  const [enabled, setEnabled] = useState<boolean>(profile.mealRemindersEnabled ?? true);
  const [minutes, setMinutes] = useState<RemindMinutes>(profile.remindMinutesBefore ?? 15);

  const handleSave = () => {
    updateProfile({ mealRemindersEnabled: enabled, remindMinutesBefore: minutes });
    showToast('Notification settings saved');
    router.back();
  };

  return (
    <FormPage title="Notifications" saveLabel="Save" onSave={handleSave}>
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
