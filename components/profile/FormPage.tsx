import { usePreventRemove } from '@react-navigation/native';
import { router, useNavigation } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';

interface FormPageProps {
  title: string;
  children: React.ReactNode;
  // Optional sticky footer button (e.g. "Save"). Hidden if not provided.
  saveLabel?: string;
  // Return false when the save was refused (validation) and the page stays.
  onSave?: () => void | false;
  saveDisabled?: boolean;
  // Edit forms pass this (see useIsDirty): Save then sits top-right in the
  // header, greyed out until something changes (the iOS/Instagram pattern).
  // Without it, the button is the sticky footer (e.g. Feedback's Submit).
  // Screens of switches/choices save on tap and have no button.
  dirty?: boolean;
  // An async save finished: leave without the "Discard changes?" prompt.
  saved?: boolean;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  // Render extra content above the scroll body (banners, hero rows, etc).
  topSlot?: React.ReactNode;
}

export function FormPage({
  title,
  children,
  saveLabel,
  onSave,
  saveDisabled,
  dirty,
  saved: savedProp,
  onBack,
  rightAction,
  topSlot,
}: FormPageProps) {
  const navigation = useNavigation();
  const showSave = !!(saveLabel && onSave);
  const headerSave = showSave && dirty !== undefined;
  const headerSaveEnabled = dirty === true && !saveDisabled;
  // Leaving with unsaved edits (back arrow or swipe) asks first. Save itself
  // navigates back while the form is still dirty, so after a save the page
  // may leave freely. The flag can't be cleared right after onSave():
  // expo-router queues router.back() and runs it later, so the leave check
  // fires after onSave has returned (that showed the prompt on Save, Nov 2).
  const saved = useRef(false);
  usePreventRemove(dirty === true && !savedProp, ({ data }) => {
    if (saved.current) {
      navigation.dispatch(data.action);
      return;
    }
    Alert.alert('Discard changes?', "Your changes haven't been saved.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  const handleSave = () => {
    saved.current = true;
    if (onSave?.() === false) saved.current = false;
  };

  const handleBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <PageHeader
          title={title}
          onBack={handleBack}
          style={styles.header}
          // Both sides widen so the title stays centred next to "Save".
          wideSides={headerSave}
          right={headerSave ? (
            <TouchableOpacity
              onPress={handleSave}
              disabled={!headerSaveEnabled}
              style={styles.headerSaveBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <Text style={[styles.headerSaveText, !headerSaveEnabled && styles.headerSaveTextOff]}>
                {saveLabel}
              </Text>
            </TouchableOpacity>
          ) : rightAction}
        />

        {topSlot}

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>

        {showSave && !headerSave ? (
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.saveBtn, saveDisabled && styles.saveBtnDisabled]}
              disabled={saveDisabled}
              onPress={handleSave}
              activeOpacity={0.85}
            >
              <Text style={styles.saveBtnText}>{saveLabel}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

// True once `values` differ from what they were on first render.
export function useIsDirty(values: unknown): boolean {
  const [initial] = useState(() => JSON.stringify(values));
  return JSON.stringify(values) !== initial;
}

// ─── Reusable form primitives ────────────────────────────────────────────────

export function FormSection({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      {label ? <Text style={styles.sectionLabel}>{label}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export function RadioRow({
  label,
  hint,
  selected,
  onPress,
}: { label: string; hint?: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowText}>{label}</Text>
        {hint ? <Text style={styles.rowSub}>{hint}</Text> : null}
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  headerSaveBtn: { height: 40, alignItems: 'flex-end', justifyContent: 'center' },
  headerSaveText: { color: COLORS.green, fontSize: 16, fontWeight: '700' },
  headerSaveTextOff: { color: COLORS.textMuted },

  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },

  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  sectionBody: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
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
  rowSub:  { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  radio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLORS.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: COLORS.green },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.green },

  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  saveBtn: {
    backgroundColor: COLORS.green,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});

export const FormStyles = {
  // Re-export common styles for child screens that need them.
  row: styles.row,
  rowText: styles.rowText,
  rowSub: styles.rowSub,
};
