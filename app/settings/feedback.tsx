import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { FormPage } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import { useToastStore } from '@/store/useToastStore';
import { FEEDBACK_MAX_LEN, submitFeedback } from '@/lib/feedback';

const MAX_LEN = FEEDBACK_MAX_LEN;

export default function FeedbackScreen() {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const showToast = useToastStore(s => s.showToast);

  // Really sent (user_feedback table); only says thanks once it arrived.
  const send = async () => {
    if (sending) return;
    setSending(true);
    const { error } = await submitFeedback('feedback', text);
    setSending(false);
    if (error) {
      showToast(error);
      return;
    }
    showToast('Thanks for your feedback!');
    router.back();
  };
  const handleSubmit = () => {
    void send();
    return false as const; // async: the page closes itself once it's sent
  };

  return (
    <FormPage
      title="Feedback"
      saveLabel="Submit"
      onSave={handleSubmit}
      saveDisabled={text.trim().length === 0 || sending}
    >
      <Text style={styles.intro}>
        Tell us what&apos;s working, what&apos;s broken, or what you&apos;d like to see next.
      </Text>
      <View style={styles.inputWrap}>
        <TextInput
          value={text}
          onChangeText={(v) => v.length <= MAX_LEN && setText(v)}
          placeholder="Type your feedback…"
          placeholderTextColor={COLORS.textMuted}
          multiline
          textAlignVertical="top"
          style={styles.input}
        />
        <Text style={styles.counter}>{text.length} / {MAX_LEN}</Text>
      </View>
    </FormPage>
  );
}

const styles = StyleSheet.create({
  intro: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 12, paddingHorizontal: 4 },
  inputWrap: { gap: 6 },
  input: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    color: COLORS.text,
    fontSize: 14,
    minHeight: 180,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  counter: { color: COLORS.textSecondary, fontSize: 11, alignSelf: 'flex-end' },
});
