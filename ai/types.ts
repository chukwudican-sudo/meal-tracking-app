// Types shared by the AI edge-function wrappers and the UI. Kept independent
// of the store shape so the AI layer can change without touching the screens.

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
