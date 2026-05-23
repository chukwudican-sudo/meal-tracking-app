import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';

import { COLORS } from '@/constants/theme';
import { aiClient, isStubAI, parseDraftFromReply } from '@/ai/aiClient';
import type { ChatMessage, DayContext, MealDraft } from '@/ai/types';
import { APP_LOGO } from '@/constants/app';

interface Props {
  context: DayContext;
  onDraftReady: (draft: MealDraft, attached: { imageUri?: string; history: ChatMessage[] }) => void;
}

export function AITab({ context, onDraftReady }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const isEmpty = messages.length === 0 && !streaming;

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 30);
  }, [messages, streaming]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed && !pendingImage) return;
    if (streaming) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: trimmed || 'Identify this meal.',
      imageUri: pendingImage ?? undefined,
    };

    const nextHistory = [...messages, userMsg];
    setMessages([...nextHistory, { role: 'assistant', content: '' }]);
    setInput('');
    const photoUri = pendingImage;
    setPendingImage(null);
    setStreaming(true);

    try {
      let acc = '';
      for await (const chunk of aiClient.chat(nextHistory, context, { imageUri: photoUri ?? undefined })) {
        acc += chunk;
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: acc };
          return copy;
        });
      }
      // Try to extract a draft from the assistant's final reply.
      const candidate = parseDraftFromReply(acc);
      if (looksLikeRealDraft(candidate)) {
        onDraftReady(candidate, {
          imageUri: photoUri ?? undefined,
          history: [...nextHistory, { role: 'assistant', content: acc }],
        });
      }
    } catch (e) {
      console.warn('AI chat failed:', e);
      setMessages(prev => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: 'assistant',
          content: 'Something went wrong reaching the assistant. Try again.',
        };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }

  async function attachImage() {
    if (Platform.OS === 'web') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.5,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const dataUri = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
    setPendingImage(dataUri);
  }

  async function startRecording() {
    if (Platform.OS === 'web') {
      Alert.alert('Not available', 'Voice dictation only works on the mobile app.');
      return;
    }
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Microphone access is required for voice dictation.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = rec;
      setRecording(true);
    } catch (e) {
      console.warn('Could not start recording:', e);
    }
  }

  async function stopRecording() {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (!uri) return;
      const text = await aiClient.transcribe(uri);
      setInput(prev => (prev ? `${prev} ${text}` : text));
    } catch (e) {
      console.warn('Could not transcribe:', e);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.full}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {isEmpty ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>{APP_LOGO}</Text>
          <Text style={styles.emptyTitle}>Describe what you ate</Text>
          <Text style={styles.emptySub}>Or tap the mic to talk</Text>
          {isStubAI && (
            <Text style={styles.stubNotice}>
              Stub mode — drop an OpenAI key in .env to enable the real assistant.
            </Text>
          )}
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.chat}
          contentContainerStyle={styles.chatBody}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role} text={m.content} imageUri={m.imageUri} streaming={streaming && i === messages.length - 1} />
          ))}
        </ScrollView>
      )}

      {pendingImage && (
        <View style={styles.attachmentRow}>
          <Text style={styles.attachmentText}>📎 1 image attached</Text>
          <TouchableOpacity onPress={() => setPendingImage(null)}>
            <Text style={styles.attachmentRemove}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputBar}>
        <TouchableOpacity onPress={attachImage} style={styles.iconBtn}>
          <Text style={styles.iconText}>🖼️</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Describe a meal…"
          placeholderTextColor={COLORS.textMuted}
          multiline
          editable={!streaming}
        />
        <TouchableOpacity
          onPressIn={startRecording}
          onPressOut={stopRecording}
          style={[styles.iconBtn, recording && styles.iconBtnActive]}
        >
          <Text style={styles.iconText}>{recording ? '🔴' : '🎙️'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={send}
          disabled={streaming || (!input.trim() && !pendingImage)}
          style={[
            styles.sendBtn,
            (streaming || (!input.trim() && !pendingImage)) && styles.sendBtnDisabled,
          ]}
        >
          {streaming ? (
            <ActivityIndicator color="#0E1A12" />
          ) : (
            <Text style={styles.sendBtnText}>↑</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({
  role,
  text,
  imageUri,
  streaming,
}: {
  role: 'user' | 'assistant' | 'system';
  text: string;
  imageUri?: string;
  streaming?: boolean;
}) {
  if (role === 'system') return null;
  const isUser = role === 'user';
  // Strip the JSON code block from displayed assistant text — the draft card
  // covers it visually elsewhere.
  const display = isUser ? text : text.replace(/```json[\s\S]*?```/gi, '').trim();
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRight : styles.bubbleLeft]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAi]}>
        {imageUri && isUser && (
          <View style={styles.bubbleImageHint}>
            <Text style={styles.bubbleImageHintText}>🖼️ Image attached</Text>
          </View>
        )}
        <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAi]}>
          {display || (streaming ? '…' : '')}
        </Text>
      </View>
    </View>
  );
}

function looksLikeRealDraft(d: MealDraft): boolean {
  if (!d.name || d.name === 'New meal') return false;
  return true;
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: COLORS.bg },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    gap: 8,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 8 },
  emptyTitle: { color: COLORS.text, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  emptySub: { color: COLORS.textSecondary, fontSize: 14 },
  stubNotice: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 14,
    textAlign: 'center',
  },
  chat: { flex: 1 },
  chatBody: { padding: 14, gap: 8 },
  bubbleRow: { flexDirection: 'row' },
  bubbleLeft: { justifyContent: 'flex-start' },
  bubbleRight: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '82%',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  bubbleAi: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 4,
  },
  bubbleUser: {
    backgroundColor: COLORS.green,
    borderTopRightRadius: 4,
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTextAi: { color: COLORS.text },
  bubbleTextUser: { color: '#0E1A12' },
  bubbleImageHint: {
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  bubbleImageHintText: { fontSize: 11, color: '#0E1A12' },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 8,
  },
  attachmentText: { color: COLORS.textSecondary, fontSize: 12, flex: 1 },
  attachmentRemove: { color: COLORS.red, fontSize: 14, fontWeight: '700' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: { backgroundColor: COLORS.red + '33' },
  iconText: { fontSize: 18 },
  input: {
    flex: 1,
    color: COLORS.text,
    backgroundColor: COLORS.card,
    borderRadius: 19,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
    maxHeight: 110,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: COLORS.elevated },
  sendBtnText: { color: '#0E1A12', fontSize: 18, fontWeight: '700' },
});
