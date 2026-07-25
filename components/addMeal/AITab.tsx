import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import { router } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { aiClient } from '@/ai/aiClient';
import { AIError } from '@/ai/aiEdgeClient';
import { estimateNutrition } from '@/ai/estimateNutrition';
import { fixMeal } from '@/ai/fixMeal';
import type { DayContext, MealDraft } from '@/ai/types';
import { newId } from '@/lib/sync/uuid';
import type { Ingredient, MealEntry, RecipeCategory } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

interface Props {
  context: DayContext;
  date: string;
  onLogged: () => void;
}

const ZERO_MACROS = { protein: 0, carbs: 0, fats: 0 };

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function AITab({ date, onLogged }: Props) {
  const addMealToDay = useMealStore(s => s.addMealToDay);
  const ingestMidWeekIngredients = useMealStore(s => s.ingestMidWeekIngredients);

  const [input, setInput] = useState('');
  const [draft, setDraft] = useState<MealDraft | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [category, setCategory] = useState<RecipeCategory | undefined>(undefined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const fullTextRef = useRef('');

  const cals = draft?.calories ?? 0;
  const macros = draft?.macros ?? ZERO_MACROS;
  const hasEstimate = draft != null;

  // Shared handler for both the initial estimate (EstimateError) and the
  // correction (FixError) — both subclass AIError with the same code set.
  function handleAIError(e: unknown) {
    console.warn('AI request failed:', e);
    if (e instanceof AIError && e.code === 'not_premium') {
      setNote('AI Describe is a Premium feature.');
      Alert.alert(
        'Premium feature',
        'AI Describe uses AI to estimate nutrition from a description. Upgrade to Premium to use it.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Upgrade',
            onPress: () =>
              router.push({ pathname: '/settings/coming-soon', params: { title: 'Subscription' } }),
          },
        ],
      );
      return;
    }
    if (e instanceof AIError && e.code === 'rate_limited') {
      setNote(e.message || "You've hit the hourly limit for AI. Try again later.");
      return;
    }
    if (e instanceof AIError && e.code === 'ai_failed') {
      // The edge function's Gemini call itself failed (e.g. a transient 503) or
      // timed out. Prefer the server's specific message; it's retry-worthy.
      setNote(e.message || 'The AI is temporarily unavailable. Please try again in a moment.');
      return;
    }
    if (e instanceof AIError && e.code === 'unauthorized') {
      setNote('Your session expired. Please sign in again.');
      return;
    }
    setNote('Something went wrong. Try again.');
  }

  async function estimate() {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    // Clear any note from a previous attempt so a stale error/success message
    // never lingers on screen while this new request is in flight.
    setNote('');
    const combined = [fullTextRef.current, trimmed].filter(Boolean).join('. ');
    try {
      if (draft) {
        // Correction goes through the fix-meal edge function (Gemini). It
        // returns the complete corrected meal, so refresh both the draft totals
        // and the ingredient breakdown from the response.
        const result = await fixMeal(trimmed, draft, ingredients);
        setDraft(result.draft);
        setIngredients(result.ingredients);
        setNote(`Updated estimate for "${result.draft.name}". Add more details to refine.`);
      } else {
        // Initial estimate goes through the Supabase edge function (Gemini).
        const result = await estimateNutrition(combined);
        setDraft(result.draft);
        setIngredients(result.ingredients);
        setCategory(result.category);
        setNote(`Estimated "${result.draft.name}". Add corrections below to refine.`);
      }
      fullTextRef.current = combined;
      setInput('');
    } catch (e) {
      handleAIError(e);
    } finally {
      setBusy(false);
    }
  }

  function log() {
    if (!draft) return;
    const entry: MealEntry = {
      // UUID required — meal_logs.id is a uuid column on the server.
      id: newId(),
      name: draft.name,
      time: nowHHMM(),
      calories: draft.calories,
      ingredients,
      macros: draft.macros,
      status: 'pending',
      isAdHoc: true,
      servings: 1,
      ...(category ? { category } : {}),
    };
    addMealToDay(date, entry);
    if (ingredients.length > 0) {
      ingestMidWeekIngredients(ingredients.map(i => ({ name: i.name, mealName: draft.name })));
    }
    onLogged();
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
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
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
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
        {/* Live nutrition card */}
        <View style={styles.card}>
          <Text style={styles.cardName} numberOfLines={1}>{draft?.name ?? 'Describe your meal'}</Text>
          <View style={styles.calRow}>
            <Text style={styles.calValue}>{cals}</Text>
            <Text style={styles.calUnit}>cal</Text>
          </View>
          <View style={styles.macroRow}>
            <MacroChip label="Protein" value={macros.protein} />
            <MacroChip label="Carbs" value={macros.carbs} />
            <MacroChip label="Fats" value={macros.fats} />
          </View>
        </View>

        {/* Estimated ingredients */}
        <Text style={styles.sectionLabel}>Estimated ingredients</Text>
        {ingredients.length === 0 ? (
          <View style={styles.emptyIng}>
            <Text style={styles.emptyIngText}>
              Ingredients appear here once you describe what you ate.
            </Text>
          </View>
        ) : (
          ingredients.map(ing => (
            <View key={ing.id} style={styles.ingRow}>
              <Text style={styles.ingName} numberOfLines={1}>{ing.name}</Text>
              <Text style={styles.ingCal}>{ing.calories ?? 0} cal</Text>
            </View>
          ))
        )}

        {note ? <Text style={styles.note}>{note}</Text> : null}
      </ScrollView>

      {/* Input area */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={hasEstimate ? 'Add a correction…' : 'Describe what you ate…'}
          placeholderTextColor={COLORS.textMuted}
          multiline
          editable={!busy}
        />
        <TouchableOpacity
          onPressIn={startRecording}
          onPressOut={stopRecording}
          style={[styles.iconBtn, recording && styles.iconBtnActive]}
        >
          <Text style={styles.iconText}>{recording ? '🔴' : '🎙️'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={estimate}
          disabled={busy || !input.trim()}
          style={[styles.sendBtn, (busy || !input.trim()) && styles.sendBtnDisabled]}
        >
          {busy ? <ActivityIndicator color="#0E1A12" /> : <Text style={styles.sendBtnText}>↑</Text>}
        </TouchableOpacity>
      </View>

      {/* Log button */}
      <TouchableOpacity
        onPress={log}
        disabled={!hasEstimate}
        style={[styles.logBtn, !hasEstimate && styles.logBtnDisabled]}
        activeOpacity={0.85}
      >
        <Text style={[styles.logBtnText, !hasEstimate && styles.logBtnTextDisabled]}>Log</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

function MacroChip({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.macroChip}>
      <Text style={styles.macroChipValue}>{value}g</Text>
      <Text style={styles.macroChipLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  scrollBody: { padding: 16, paddingBottom: 24 },

  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  cardName: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  calRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 8 },
  calValue: { color: COLORS.text, fontSize: 38, fontWeight: '800' },
  calUnit: { color: COLORS.textSecondary, fontSize: 16, marginBottom: 7 },
  macroRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  macroChip: {
    flex: 1,
    backgroundColor: COLORS.elevated,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  macroChipValue: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  macroChipLabel: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  sectionLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  emptyIng: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    padding: 18,
  },
  emptyIngText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  ingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  ingName: { color: COLORS.text, fontSize: 14, fontWeight: '600', flex: 1, marginRight: 10 },
  ingCal: { color: COLORS.textSecondary, fontSize: 13 },

  note: { color: COLORS.textSecondary, fontSize: 13, marginTop: 14, lineHeight: 19 },

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

  logBtn: {
    margin: 16,
    marginTop: 8,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: COLORS.green,
    alignItems: 'center',
  },
  logBtnDisabled: { backgroundColor: COLORS.elevated },
  logBtnText: { color: '#0E1A12', fontSize: 16, fontWeight: '800' },
  logBtnTextDisabled: { color: COLORS.textMuted },
});
