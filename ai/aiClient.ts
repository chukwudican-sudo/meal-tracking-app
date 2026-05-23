// Single-entry AI client. The rest of the app imports `aiClient` from here
// without knowing whether it's hitting OpenAI, a mock, or (eventually) a
// backend proxy.
//
// TODO: before public release, replace `createOpenAIClient` with a tiny
// backend proxy (Vercel / Cloudflare Worker) so the API key never ships in
// the bundle. The interface stays the same; only this file changes.

import { Platform } from 'react-native';
import type {
  AIClient,
  ChatMessage,
  DayContext,
  FixInput,
  MealDraft,
  ParseInput,
} from './types';
import { fixSystemPrompt, systemPrompt } from './prompts';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';

// ─── Stub client (fallback when no key is configured) ────────────────────────

function createStubClient(): AIClient {
  const fakeDraft = (override: Partial<MealDraft> = {}): MealDraft => ({
    name: 'Chicken stir-fry',
    time: nowHHMM(),
    calories: 520,
    macros: { protein: 38, carbs: 55, fats: 14 },
    ...override,
  });

  async function* fakeStream(text: string): AsyncIterable<string> {
    for (const chunk of text.match(/.{1,12}/g) ?? []) {
      await wait(20);
      yield chunk;
    }
  }

  return {
    async *chat(messages, _context) {
      void _context;
      const last = messages[messages.length - 1]?.content ?? '';
      const reply = `Stub mode (no API key). I'll guess "${last.slice(0, 40) || 'a meal'}" — adjust the numbers below if needed.

\`\`\`json
{ "name": "Chicken stir-fry", "time": "${nowHHMM()}", "calories": 520, "protein": 38, "carbs": 55, "fats": 14 }
\`\`\``;
      yield* fakeStream(reply);
    },
    async parseMeal(input) {
      await wait(450);
      const name = input.text?.split(/[.,\n]/)[0]?.trim() || 'Chicken stir-fry';
      return fakeDraft({ name: name.length > 36 ? name.slice(0, 36) : name });
    },
    async fixMeal(input) {
      await wait(450);
      return { ...input.currentDraft, name: input.currentDraft.name + ' (revised)' };
    },
    async transcribe() {
      await wait(300);
      return '[stub] dictation goes here once you add an OpenAI key.';
    },
  };
}

// ─── Real OpenAI client ─────────────────────────────────────────────────────

function createOpenAIClient(apiKey: string): AIClient {
  // Lazy require so the SDK is only loaded when actually used.
  // (Avoids a hard crash on Hermes if a transitive import misbehaves.)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const OpenAI = require('openai').default;
  const client = new OpenAI({
    apiKey,
    // RN doesn't have `process` env in the OpenAI SDK's expected way, so we
    // pass it explicitly. dangerouslyAllowBrowser=true is required because
    // the SDK detects the bundle as browser-like.
    dangerouslyAllowBrowser: true,
  });

  function toOpenAIMessages(messages: ChatMessage[], context: DayContext) {
    const sys = { role: 'system' as const, content: systemPrompt(context) };
    const rest = messages.map(m => {
      if (m.imageUri) {
        return {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            { type: 'image_url', image_url: { url: m.imageUri } },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });
    return [sys, ...rest];
  }

  return {
    async *chat(messages, context, opts) {
      const lastUser = messages[messages.length - 1];
      const withImage: ChatMessage[] =
        opts?.imageUri && lastUser
          ? [...messages.slice(0, -1), { ...lastUser, imageUri: opts.imageUri }]
          : messages;

      const stream = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        stream: true,
        messages: toOpenAIMessages(withImage, context),
      });
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      }
    },

    async parseMeal(input, context) {
      const userContent = input.text || 'Identify this meal from the photo.';
      const messages = toOpenAIMessages(
        [{ role: 'user', content: userContent, imageUri: input.imageUri }],
        context,
      );
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
      });
      const raw = completion.choices?.[0]?.message?.content ?? '';
      return parseDraftFromReply(raw);
    },

    async fixMeal(input, context) {
      const sys = { role: 'system' as const, content: fixSystemPrompt(context) };
      const draftAsText = JSON.stringify(input.currentDraft);
      const userMsg = {
        role: 'user' as const,
        content: input.imageUri
          ? [
              { type: 'text', text: `Current draft:\n${draftAsText}\n\nUser correction:\n${input.fixText}` },
              { type: 'image_url', image_url: { url: input.imageUri } },
            ]
          : `Current draft:\n${draftAsText}\n\nUser correction:\n${input.fixText}`,
      };
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [sys, ...input.history.map(m => ({ role: m.role, content: m.content })), userMsg],
      });
      const raw = completion.choices?.[0]?.message?.content ?? '';
      return parseDraftFromReply(raw, input.currentDraft);
    },

    async transcribe(audioUri) {
      // Whisper expects a File-like input. On native we send the URI as a
      // FormData blob; the OpenAI SDK supports this through fetch under the
      // hood. We use fetch directly here because the SDK's typings expect a
      // browser File which doesn't exist on RN.
      const formData = new FormData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (formData as any).append('file', {
        uri: audioUri,
        name: 'recording.m4a',
        type: 'audio/m4a',
      });
      formData.append('model', 'whisper-1');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
      if (!res.ok) {
        throw new Error(`Whisper failed: ${res.status} ${await res.text()}`);
      }
      const json = await res.json();
      return (json.text ?? '').trim();
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Parse the JSON draft block out of the assistant's reply. Falls back to the
// previous draft (or a sane default) when the model didn't comply.
export function parseDraftFromReply(reply: string, fallback?: MealDraft): MealDraft {
  const fenced = reply.match(/```json\s*([\s\S]*?)```/i);
  const jsonStr = fenced?.[1] ?? reply.match(/\{[\s\S]*\}/)?.[0] ?? '';
  if (!jsonStr) return fallback ?? defaultDraft();
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      name: String(parsed.name ?? fallback?.name ?? 'New meal').slice(0, 60),
      time: String(parsed.time ?? fallback?.time ?? nowHHMM()),
      calories: clampInt(parsed.calories, fallback?.calories ?? 0),
      macros: {
        protein: clampInt(parsed.protein, fallback?.macros.protein ?? 0),
        carbs: clampInt(parsed.carbs, fallback?.macros.carbs ?? 0),
        fats: clampInt(parsed.fats, fallback?.macros.fats ?? 0),
      },
    };
  } catch {
    return fallback ?? defaultDraft();
  }
}

function defaultDraft(): MealDraft {
  return {
    name: 'New meal',
    time: nowHHMM(),
    calories: 0,
    macros: { protein: 0, carbs: 0, fats: 0 },
  };
}

function clampInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return Math.max(0, Math.round(fallback));
  return Math.round(n);
}

// ─── Active client export ────────────────────────────────────────────────────

export const aiClient: AIClient = OPENAI_API_KEY
  ? createOpenAIClient(OPENAI_API_KEY)
  : createStubClient();

export const isStubAI = !OPENAI_API_KEY;

// Web fallback: camera + audio recording APIs aren't usable in browsers the
// same way — we expose this so screens can render a friendly message.
export const isWeb = Platform.OS === 'web';
