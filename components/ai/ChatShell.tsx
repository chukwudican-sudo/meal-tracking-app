import { useEffect, useRef } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';

export type ChatMessage =
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'card'; render: () => React.ReactNode }
  | { id: string; kind: 'thinking' };

export interface ChipSuggestion {
  id: string;
  label: string;
  onPress: () => void;
}

interface ChatShellProps {
  title: string;
  onBack: () => void;
  disclaimer?: string;
  messages: ChatMessage[];
  chips?: ChipSuggestion[];
  inputValue: string;
  onChangeInput: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  footer?: React.ReactNode;
  inputDisabled?: boolean;
}

export function ChatShell({
  title,
  onBack,
  disclaimer,
  messages,
  chips,
  inputValue,
  onChangeInput,
  onSubmit,
  placeholder = 'Type a message…',
  footer,
  inputDisabled,
}: ChatShellProps) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length, chips?.length]);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.backBtn} />
      </View>

      {disclaimer ? (
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>{disclaimer}</Text>
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map(m => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </ScrollView>

        {chips && chips.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            {chips.map(c => (
              <TouchableOpacity
                key={c.id}
                onPress={c.onPress}
                style={styles.chip}
                activeOpacity={0.8}
              >
                <Text style={styles.chipText}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {footer}

        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.inputIconBtn} activeOpacity={0.6}>
            <Text style={styles.inputIcon}>🎤</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.inputIconBtn} activeOpacity={0.6}>
            <Text style={styles.inputIcon}>📷</Text>
          </TouchableOpacity>
          <TextInput
            value={inputValue}
            onChangeText={onChangeInput}
            placeholder={placeholder}
            placeholderTextColor={COLORS.textSecondary}
            style={styles.input}
            editable={!inputDisabled}
            returnKeyType="send"
            onSubmitEditing={onSubmit}
            multiline
          />
          <TouchableOpacity
            onPress={onSubmit}
            disabled={!inputValue.trim() || inputDisabled}
            style={[styles.sendBtn, (!inputValue.trim() || inputDisabled) && styles.sendBtnDisabled]}
            activeOpacity={0.8}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.kind === 'card') {
    return <View style={styles.cardBubble}>{message.render()}</View>;
  }
  if (message.kind === 'thinking') {
    return (
      <View style={styles.assistantBubble}>
        <Text style={styles.assistantText}>Thinking…</Text>
      </View>
    );
  }
  if (message.kind === 'user') {
    return (
      <View style={styles.userBubble}>
        <Text style={styles.userText}>{message.text}</Text>
      </View>
    );
  }
  return (
    <View style={styles.assistantBubble}>
      <Text style={styles.assistantText}>{message.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  title: { flex: 1, color: COLORS.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },

  disclaimer: {
    backgroundColor: COLORS.elevated,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  disclaimerText: { color: COLORS.textSecondary, fontSize: 11, textAlign: 'center' },

  scroll: { padding: 16, gap: 8 },

  assistantBubble: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 12,
    alignSelf: 'flex-start',
    maxWidth: '88%',
  },
  assistantText: { color: COLORS.text, fontSize: 14, lineHeight: 20 },

  userBubble: {
    backgroundColor: COLORS.green,
    borderRadius: 14,
    padding: 12,
    alignSelf: 'flex-end',
    maxWidth: '88%',
  },
  userText: { color: '#fff', fontSize: 14, lineHeight: 20 },

  cardBubble: { alignSelf: 'stretch' },

  chipsRow: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  chip: {
    backgroundColor: COLORS.elevated,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
  },
  chipText: { color: COLORS.text, fontSize: 13, fontWeight: '500' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    gap: 6,
    backgroundColor: COLORS.bg,
  },
  inputIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputIcon: { fontSize: 16 },
  input: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    color: COLORS.text,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: COLORS.elevated },
  sendBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
