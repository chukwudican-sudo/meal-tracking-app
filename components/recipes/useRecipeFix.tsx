// Fix for the user's own recipes (Custom Recipe / AI / manual): a sheet where
// they describe a change; fix-recipe rewrites ingredients, steps and macros.
// Shared by the recipe preview and full recipe pages so both behave the same.
// The app's built-in recipes can't be fixed (reference content).

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AIError, aiErrorMessage } from '@/ai/aiEdgeClient';
import { fixRecipe } from '@/ai/fixRecipe';
import { ProgressiveLoader } from '@/components/ProgressiveLoader';
import { COLORS } from '@/constants/theme';
import { recipeRequiresPro } from '@/lib/entitlements';
import { openPaywall } from '@/lib/paywall';
import { useEntitlementStore } from '@/store/useEntitlementStore';
import { isOwnRecipe, useMealStore } from '@/store/useMealStore';
import { useUndoStore } from '@/store/useUndoStore';

const FIX_MESSAGES = ['Updating ingredients…', 'Rewriting steps…', 'Recalculating nutrition…'];

/** @param savedId the saved recipe this screen shows (undefined for a built-in recipe) */
export function useRecipeFix(savedId: string | undefined) {
  const insets = useSafeAreaInsets();
  const recipe = useMealStore(s => (savedId ? s.savedRecipes.find(r => r.id === savedId) : undefined));
  const isPro = useEntitlementStore(s => s.isPro);
  const applyRecipeFix = useMealStore(s => s.applyRecipeFix);
  const revertRecipeFix = useMealStore(s => s.revertRecipeFix);
  const showUndo = useUndoStore(s => s.showUndo);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // Shown inside the sheet: a toast would render behind this Modal.
  const [error, setError] = useState<string | null>(null);

  // Same Pro gate as viewing the full recipe (own recipes have no premade
  // isFree flag): no fixing what this user can't open.
  const canFix = !!recipe && isOwnRecipe(recipe) && !(recipeRequiresPro({ source: recipe.source }) && !isPro);

  const openFix = () => {
    setError(null);
    setOpen(true);
  };

  const submit = async (textArg?: string) => {
    const correction = (textArg ?? text).trim();
    // Read the latest copy: a retry after the paywall runs from an older
    // closure, and the recipe may have changed meanwhile.
    const store = useMealStore.getState();
    const current = savedId ? store.savedRecipes.find(r => r.id === savedId) : undefined;
    if (!current || !correction || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fixed = await fixRecipe(
        correction,
        {
          name: current.name,
          calories: current.calories,
          macros: current.macros,
          cookTimeMin: current.cookTimeMin,
          ingredients: current.ingredients,
          steps: current.steps ?? [],
        },
        // The recipe's fix memory (kept in the store, survives leaving the
        // screen; Undo rolls it back with the recipe).
        store.recipeFixHistory[current.id] ?? [],
        current.id,
      );
      const outcome = applyRecipeFix(current.id, correction, fixed);
      if (!outcome) {
        setError('Could not save this change. Please try again.');
        return;
      }
      const { applied, previous, previousHistory } = outcome;
      setText('');
      setOpen(false);
      showUndo({ message: 'Recipe updated', undo: () => revertRecipeFix(applied.id, previous, previousHistory) });
    } catch (e) {
      console.warn('Recipe fix failed:', e);
      if (e instanceof AIError && e.code === 'not_premium') {
        // Close first so the paywall isn't stacked under the sheet; after a
        // purchase, reopen it so the retry shows its loader.
        setOpen(false);
        openPaywall({
          reason: 'scan_limit',
          onSuccess: () => { setText(correction); setOpen(true); void submit(correction); },
        });
        return;
      }
      setError(aiErrorMessage(e, 'Could not update this recipe. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const fixSheet = (
    <Modal transparent visible={open} animationType="slide" onRequestClose={() => !busy && setOpen(false)}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => !busy && setOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
          <Text style={styles.title}>Fix this recipe</Text>
          <Text style={styles.hint}>
            Describe what to change, e.g. &quot;bone-in chicken thighs, 250g&quot; or &quot;use less oil&quot;.
          </Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="What should change?"
            placeholderTextColor={COLORS.textMuted}
            multiline
            autoFocus
            editable={!busy}
            maxLength={1000}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {busy ? <ProgressiveLoader messages={FIX_MESSAGES} variant="inline" /> : null}
          <TouchableOpacity
            style={[styles.submit, (!text.trim() || busy) && styles.submitDisabled]}
            onPress={() => void submit()}
            disabled={!text.trim() || busy}
            activeOpacity={0.85}
          >
            <Text style={styles.submitText}>Update recipe</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  return { canFix, openFix, fixSheet };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1C1C1C', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  hint: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  input: {
    minHeight: 90, maxHeight: 160, color: COLORS.text, fontSize: 15, textAlignVertical: 'top',
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 12,
  },
  error: { color: COLORS.red, fontSize: 13 },
  submit: { backgroundColor: COLORS.green, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: '#04110A', fontSize: 16, fontWeight: '700' },
});
