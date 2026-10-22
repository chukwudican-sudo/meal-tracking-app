import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import { COLORS } from '@/constants/theme';
import { aiErrorMessage } from '@/ai/aiEdgeClient';
import { fixMeal } from '@/ai/fixMeal';
import type { ChatMessage, DayContext, MealDraft } from '@/ai/types';

interface Props {
  visible: boolean;
  context: DayContext;
  currentDraft: MealDraft;
  imageUri?: string;
  history?: ChatMessage[];
  onClose: () => void;
  onResult: (next: MealDraft) => void;
}

// context / imageUri / history stay in Props for the caller, but fix-meal works
// from the draft + correction text alone.
export function FixResultScreen({ visible, currentDraft, onClose, onResult }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reEvaluate() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { draft: next } = await fixMeal(text.trim(), currentDraft, []);
      onResult({ ...next, time: currentDraft.time });
      setText('');
    } catch (e) {
      console.warn('Fix failed:', e);
      setError(aiErrorMessage(e, 'Could not re-evaluate. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.full}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Fix Result</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.instruction}>
            Describe what&apos;s wrong with the result and we&apos;ll re-evaluate.
          </Text>

          <View style={styles.draftCard}>
            <Text style={styles.draftName}>{currentDraft.name}</Text>
            <Text style={styles.draftMeta}>
              {currentDraft.calories} kcal · {currentDraft.macros.protein}g P · {currentDraft.macros.carbs}g C · {currentDraft.macros.fats}g F
            </Text>
          </View>

          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="e.g. it was actually 200g of rice, not 150"
            placeholderTextColor={COLORS.textMuted}
            multiline
            autoFocus
            editable={!busy}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.actionBtn, (!text.trim() || busy) && styles.actionBtnDisabled]}
            onPress={reEvaluate}
            disabled={!text.trim() || busy}
          >
            {busy ? (
              <ActivityIndicator color="#0E1A12" />
            ) : (
              <Text style={styles.actionBtnText}>Re-evaluate</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  close: { color: COLORS.textSecondary, fontSize: 18 },
  body: { padding: 18, gap: 14, flex: 1 },
  instruction: { color: COLORS.textSecondary, fontSize: 14 },
  draftCard: {
    padding: 12,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  draftName: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  draftMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  input: {
    backgroundColor: COLORS.card,
    color: COLORS.text,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    minHeight: 110,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionBtn: {
    backgroundColor: COLORS.green,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  actionBtnDisabled: { backgroundColor: COLORS.elevated },
  error: { color: COLORS.red, fontSize: 13 },
  actionBtnText: { color: '#0E1A12', fontWeight: '700', fontSize: 15 },
});
