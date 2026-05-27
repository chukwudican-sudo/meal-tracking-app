import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { FormPage } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import { useToastStore } from '@/store/useToastStore';

const MAX_LEN = 1000;

export default function FeedbackScreen() {
  const [text, setText] = useState('');
  const showToast = useToastStore(s => s.showToast);

  const handleSubmit = () => {
    // For MVP we just thank the user; a backend hook can replace this later.
    showToast('Thanks for your feedback!');
    router.back();
  };

  return (
    <FormPage
      title="Feedback"
      saveLabel="Submit"
      onSave={handleSubmit}
      saveDisabled={text.trim().length === 0}
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
