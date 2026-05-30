import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { COLORS } from '@/constants/theme';
import type { MealSlot } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

// The five fixed slot identities. The ordering here is the canonical day order.
const FIXED_IDS: { id: string; name: string; defaultTime: string }[] = [
  { id: 'slot-bf', name: 'Breakfast',         defaultTime: '07:30' },
  { id: 'slot-am', name: 'Mid-morning Snack', defaultTime: '10:30' },
  { id: 'slot-ln', name: 'Lunch',             defaultTime: '13:00' },
  { id: 'slot-pm', name: 'Afternoon Snack',   defaultTime: '15:30' },
  { id: 'slot-dn', name: 'Dinner',            defaultTime: '19:00' },
];

function parseTimeToDate(time: string): Date {
  const d = new Date();
  const [hh, mm] = time.split(':').map(n => Number(n));
  d.setHours(Number.isFinite(hh) ? hh : 12, Number.isFinite(mm) ? mm : 0, 0, 0);
  return d;
}

function dateToHHMM(d: Date): string {
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDisplay(time: string): string {
  // Render in 12-hour clock to match iOS standards (e.g. "7:30 AM").
  const d = parseTimeToDate(time);
  const hh = d.getHours();
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const display = ((hh % 12) || 12);
  return `${display}:${mm} ${ampm}`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function MealSlotModal({ visible, onClose }: Props) {
  const profile = useMealStore(s => s.profile);
  const updateProfile = useMealStore(s => s.updateProfile);

  // Build a working copy keyed by fixed id, falling back to defaults if a slot
  // is missing from persisted state.
  const initial = useMemo<MealSlot[]>(() => {
    return FIXED_IDS.map(({ id, name, defaultTime }) => {
      const existing = profile.mealSlots.find(s => s.id === id);
      return {
        id,
        name,
        time: existing?.time ?? defaultTime,
        skipped: existing?.skipped ?? false,
      };
    });
  }, [profile.mealSlots]);

  const [draft, setDraft] = useState<MealSlot[]>(initial);
  const [pickerForId, setPickerForId] = useState<string | null>(null);

  // Reset draft whenever the modal opens, so we always start from the saved state.
  useEffect(() => {
    if (visible) {
      setDraft(initial);
      setPickerForId(null);
    }
  }, [visible, initial]);

  const handleTimeChange = (id: string, date: Date) => {
    setDraft(prev => prev.map(s => (s.id === id ? { ...s, time: dateToHHMM(date) } : s)));
  };

  const handleSkipToggle = (id: string, value: boolean) => {
    setDraft(prev => prev.map(s => (s.id === id ? { ...s, skipped: value } : s)));
  };

  const handleSave = () => {
    updateProfile({ mealSlots: draft });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet}>
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Meal Time Slots</Text>
            <TouchableOpacity onPress={handleSave} hitSlop={10}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            Toggle off any meals you don&apos;t eat. Tap a time to change it.
          </Text>

          <ScrollView contentContainerStyle={styles.body}>
            {draft.map(slot => {
              const isPickerOpen = pickerForId === slot.id;
              return (
                <View key={slot.id} style={[styles.slotCard, slot.skipped && styles.slotCardSkipped]}>
                  <View style={styles.slotRow}>
                    <Text style={[styles.slotName, slot.skipped && styles.slotNameSkipped]}>
                      {slot.name}
                    </Text>
                    <View style={styles.slotControls}>
                      <TouchableOpacity
                        style={[styles.timeChip, slot.skipped && styles.timeChipDisabled]}
                        onPress={() => {
                          if (slot.skipped) return;
                          setPickerForId(isPickerOpen ? null : slot.id);
                        }}
                        activeOpacity={0.7}
                        disabled={slot.skipped}
                      >
                        <Text style={[styles.timeChipText, slot.skipped && styles.timeChipTextDisabled]}>
                          {formatDisplay(slot.time)}
                        </Text>
                      </TouchableOpacity>
                      <Switch
                        value={!slot.skipped}
                        onValueChange={(v) => handleSkipToggle(slot.id, !v)}
                        trackColor={{ false: COLORS.border, true: COLORS.green }}
                        thumbColor="#fff"
                      />
                    </View>
                  </View>

                  {isPickerOpen && !slot.skipped && (
                    <View style={styles.pickerWrap}>
                      <DateTimePicker
                        value={parseTimeToDate(slot.time)}
                        mode="time"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        is24Hour={false}
                        onChange={(_, selected) => {
                          if (Platform.OS !== 'ios') {
                            setPickerForId(null);
                          }
                          if (selected) handleTimeChange(slot.id, selected);
                        }}
                      />
                      {Platform.OS === 'ios' && (
                        <TouchableOpacity
                          style={styles.pickerDone}
                          onPress={() => setPickerForId(null)}
                        >
                          <Text style={styles.pickerDoneText}>Done</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            })}

            <Text style={styles.helper}>
              Skipped slots are excluded from Build My Plan and your daily schedule. You can
              re-enable them anytime.
            </Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000B', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 24,
    maxHeight: '90%',
  },

  handleRow: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.border },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  cancelText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  saveText: { color: COLORS.green, fontSize: 14, fontWeight: '700' },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '700' },

  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },

  body: { padding: 16, gap: 10 },

  slotCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
  },
  slotCardSkipped: { opacity: 0.7 },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  slotName: { color: COLORS.text, fontSize: 15, fontWeight: '600', flex: 1 },
  slotNameSkipped: { color: COLORS.textSecondary, textDecorationLine: 'line-through' },
  slotControls: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  timeChip: {
    backgroundColor: COLORS.elevated,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 96,
    alignItems: 'center',
  },
  timeChipDisabled: { backgroundColor: COLORS.bg },
  timeChipText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  timeChipTextDisabled: { color: COLORS.textMuted },

  pickerWrap: {
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    paddingTop: 6,
  },
  pickerDone: {
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pickerDoneText: { color: COLORS.green, fontWeight: '700', fontSize: 13 },

  helper: {
    color: COLORS.textMuted,
    fontSize: 11,
    paddingHorizontal: 4,
    marginTop: 4,
    lineHeight: 16,
  },
});
