// Recipe Assistant: a full-screen chat about one recipe, opened from the
// green button on the full recipe page. Until Nov 21, 2026 this was a
// half-height panel on that page; moving a panel with the keyboard needs JS
// to chase the keyboard (it lagged and looked glitchy), while a full page only
// pads its bottom, like every other screen with a text box.

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  LayoutAnimation,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type KeyboardEvent,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AIError } from '@/ai/aiEdgeClient';
import { recipeAssistant } from '@/ai/recipeAssistant';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';
import { useResolvedRecipe } from '@/hooks/useResolvedRecipe';
import { isAIConsentDeclined } from '@/lib/aiConsent';
import { openPaywall } from '@/lib/paywall';
import { useRecipeChatStore, type RecipeChatMessage } from '@/store/useRecipeChatStore';
import { useToastStore } from '@/store/useToastStore';

const NO_MESSAGES: RecipeChatMessage[] = [];
const MAX_MESSAGE_LEN = 1000; // the server keeps the first 1,000 characters

export default function RecipeAssistantScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const recipeId = (params.id || '').toString();
  const recipe = useResolvedRecipe(recipeId);
  const insets = useSafeAreaInsets();
  const messages = useRecipeChatStore(s => s.chats[recipeId]) ?? NO_MESSAGES;
  const busy = useRecipeChatStore(s => s.busy[recipeId]) ?? false;
  const input = useRecipeChatStore(s => s.drafts[recipeId]) ?? '';
  const setDraft = useRecipeChatStore(s => s.setDraft);
  const showToast = useToastStore(s => s.showToast);
  const [keyboardPad, setKeyboardPad] = useState(0);
  const listRef = useRef<FlatList<RecipeChatMessage>>(null);
  // A send can finish after the page closed: no paywall or toast then.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // The page pads its bottom by the keyboard's height, animated over the
  // keyboard's own duration (what KeyboardAvoidingView does, measured from
  // the keyboard's height since this page fills the window). easeOut, not
  // the 'keyboard' curve: under the New Architecture that one runs linear and
  // trails the keyboard's fast start. Hide animates too (KeyboardAvoidingView
  // snaps). The safe-area padding under the input goes behind the keyboard.
  // Android: not handled yet (Google Play is after launch; with edge-to-edge
  // on, check whether the window still resizes for the keyboard).
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const update = (e: KeyboardEvent, pad: number) => {
      if (e.duration > 0) {
        LayoutAnimation.configureNext({
          duration: e.duration,
          update: { duration: e.duration, type: LayoutAnimation.Types.easeOut },
        });
      }
      setKeyboardPad(pad);
    };
    const show = Keyboard.addListener('keyboardWillShow', e => {
      const h = e.endCoordinates.height;
      update(e, Number.isFinite(h) ? Math.max(0, h - insets.bottom) : 0);
    });
    const hide = Keyboard.addListener('keyboardWillHide', e => update(e, 0));
    return () => { show.remove(); hide.remove(); };
  }, [insets.bottom]);

  // Inverted list: newest at the bottom, and it stays in view while the
  // keyboard shortens the list. The greeting is local, never sent.
  const listData = useMemo(() => {
    if (!recipe) return NO_MESSAGES;
    const intro: RecipeChatMessage = {
      id: 'intro',
      role: 'assistant',
      text: `Ask me anything about ${recipe.name} — swaps, substitutions, portions, or technique.`,
    };
    return [...messages].reverse().concat(intro);
  }, [messages, recipe]);

  const close = () => {
    Keyboard.dismiss();
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/recipe/detail/[id]', params: { id: recipeId } });
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    const store = useRecipeChatStore.getState();
    if (!recipe || !text || store.busy[recipeId]) return;
    const epoch = store.epoch;
    const userMsg: RecipeChatMessage = { id: `u-${Date.now()}`, role: 'user', text };
    const history = [...(store.chats[recipeId] ?? []), userMsg];
    store.setDraft(recipeId, '');
    store.append(recipeId, userMsg, epoch);
    store.setBusy(recipeId, true);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });

    // On any failure the unanswered message goes back into the box (even
    // with the page closed), so nothing hangs without a reply and Send
    // retries it. The keyboard goes down so the error toast isn't under it.
    const takeBack = () => {
      const now = useRecipeChatStore.getState();
      now.remove(recipeId, userMsg.id, epoch);
      if (now.epoch === epoch && !now.drafts[recipeId]) now.setDraft(recipeId, text);
    };
    const showError = (message: string) => {
      if (!mountedRef.current) return;
      Keyboard.dismiss();
      showToast(message);
    };

    try {
      const reply = await recipeAssistant({
        recipeName: recipe.name,
        ingredients: recipe.ingredients,
        steps: recipe.steps ?? [],
        messages: history.map(m => ({ role: m.role, text: m.text })),
      });
      if (!reply) {
        takeBack();
        showError('Could not get a reply right now. Please try again.');
        return;
      }
      useRecipeChatStore.getState().append(
        recipeId,
        { id: `a-${Date.now()}`, role: 'assistant', text: reply },
        epoch,
      );
    } catch (e) {
      takeBack();
      // "Not now" on the AI permission sheet: nothing more to say.
      if (isAIConsentDeclined(e)) return;
      // No active subscription → paywall; after a purchase, send it again.
      // Not over whatever page the user moved on to.
      if (e instanceof AIError && e.code === 'not_premium') {
        if (!mountedRef.current) return;
        openPaywall({
          reason: 'premium_feature',
          headline: 'Unlock the Recipe Assistant with Pro',
          onSuccess: () => { void send(text); },
        });
        return;
      }
      showError(
        e instanceof AIError && e.message
          ? e.message
          : 'Could not get a reply right now. Please try again.',
      );
    } finally {
      useRecipeChatStore.getState().setBusy(recipeId, false);
    }
  };

  if (!recipe) {
    return (
      <Screen edges={['top', 'bottom']}>
        <PageHeader title="Recipe Assistant" onBack={close} backIcon="down" style={styles.headerBorder} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Recipe not found.</Text>
        </View>
      </Screen>
    );
  }

  const canSend = !!input.trim() && !busy;

  return (
    <View style={[styles.flex, { paddingBottom: keyboardPad }]}>
      <Screen edges={['top', 'bottom']}>
        <PageHeader
          onBack={close}
          backIcon="down"
          style={styles.headerBorder}
          center={
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle} numberOfLines={1}>Recipe Assistant</Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {recipe.name} · {Math.round(recipe.calories)} kcal
              </Text>
            </View>
          }
        />

        <FlatList
          ref={listRef}
          inverted
          data={listData}
          keyExtractor={m => m.id}
          style={styles.flex}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ItemSeparatorComponent={MessageGap}
          // Inverted: the "header" sits under the newest message.
          ListHeaderComponent={busy ? <ThinkingBubble /> : null}
          renderItem={({ item }) => (
            <View style={item.role === 'user' ? styles.userBubble : styles.assistantBubble}>
              <Text style={item.role === 'user' ? styles.userText : styles.assistantText}>{item.text}</Text>
            </View>
          )}
        />

        <View style={styles.inputRow}>
          <TextInput
            value={input}
            onChangeText={text => setDraft(recipeId, text)}
            placeholder="Ask about this recipe…"
            placeholderTextColor={COLORS.textSecondary}
            style={styles.input}
            multiline
            maxLength={MAX_MESSAGE_LEN}
            returnKeyType="send"
            submitBehavior="submit"
            enablesReturnKeyAutomatically
            // Stays editable while a reply loads: making a focused input
            // non-editable drops the keyboard. Sending waits for the reply.
            onSubmitEditing={() => { void send(input); }}
          />
          <TouchableOpacity
            onPress={() => { void send(input); }}
            disabled={!canSend}
            style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Ionicons name="arrow-up" size={20} color={canSend ? '#0E1A12' : COLORS.textMuted} />
          </TouchableOpacity>
        </View>
      </Screen>
    </View>
  );
}

function MessageGap() {
  return <View style={styles.gap} />;
}

function ThinkingBubble() {
  return (
    <View style={styles.thinkingRow}>
      <View style={styles.typingBubble}>
        <ActivityIndicator size="small" color={COLORS.textSecondary} />
        <Text style={styles.typingText}>Thinking…</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  headerBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  headerCenter: { alignItems: 'center' },
  headerTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  headerSubtitle: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  empty: { flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },

  // flexGrow + flex-end (inverted) keeps a short chat at the top.
  list: { padding: 14, flexGrow: 1, justifyContent: 'flex-end' },
  gap: { height: 8 },
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
  userText: { color: '#0E1A12', fontSize: 14, lineHeight: 20 },

  // Inverted list: paddingTop is the gap above it, under the newest message.
  thinkingRow: { paddingTop: 8 },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  typingText: { color: COLORS.textSecondary, fontSize: 13 },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 6,
    paddingBottom: Platform.OS === 'ios' ? 10 : 6,
    color: COLORS.text,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: COLORS.elevated },
});
