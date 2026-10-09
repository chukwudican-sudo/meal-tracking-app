// Types shared by the AI client and the UI. Kept independent of the store
// shape so the AI layer can be swapped out (real provider, different vendor,
// backend proxy) without touching the screens.

import type { Macros, MealEntry, UserGoals, UserProfile } from '@/store/types';

// Re-export so AI wrappers and screens can import the concept shape from one
// place without reaching into the store types directly.
export type { RecipeConcept } from '@/store/types';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  imageUri?: string;
}

export interface MealDraft {
  name: string;
  time: string;            // "HH:MM"
  calories: number;
  macros: Macros;
}

export interface DayContext {
  date: string;            // YYYY-MM-DD the user is adding to
  goals: UserGoals;
  profile: UserProfile;
  todaysMeals: MealEntry[];
  libraryNames: string[];  // names of saved meals for "the usual" recognition
}

export interface ParseInput {
  text?: string;
  imageUri?: string;
}

export interface FixInput {
  fixText: string;
  imageUri?: string;
  currentDraft: MealDraft;
  history: ChatMessage[];
}

export interface AIClient {
  /** Streaming chat. Yields token deltas. The system prompt is prepended internally. */
  chat(messages: ChatMessage[], context: DayContext, opts?: { imageUri?: string }): AsyncIterable<string>;

  /** Parse an image / text into a structured meal draft. */
  parseMeal(input: ParseInput, context: DayContext): Promise<MealDraft>;

  /** Re-evaluate a draft using a user's "fix" instructions. */
  fixMeal(input: FixInput, context: DayContext): Promise<MealDraft>;

  /** Transcribe an audio file to text (for the dictation mic). */
  transcribe(audioUri: string): Promise<string>;
}
