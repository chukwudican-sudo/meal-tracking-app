import { router } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/theme';

interface FormPageProps {
  title: string;
  children: React.ReactNode;
  // Optional sticky footer button (e.g. "Save"). Hidden if not provided.
  saveLabel?: string;
  onSave?: () => void;
  saveDisabled?: boolean;
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
  onBack,
  rightAction,
  topSlot,
}: FormPageProps) {
  const handleBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.iconBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
          >
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <View style={styles.iconBtn}>{rightAction}</View>
        </View>

        {topSlot}

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>

        {saveLabel && onSave ? (
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.saveBtn, saveDisabled && styles.saveBtnDisabled]}
              disabled={saveDisabled}
              onPress={onSave}
              activeOpacity={0.85}
            >
              <Text style={styles.saveBtnText}>{saveLabel}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
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
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  title: { flex: 1, color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },

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
