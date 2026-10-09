// Client wrapper for the `recipe-assistant` edge function (in-recipe chat).
//
// Sends the recipe context (name, source, ingredients, steps) plus the full
// chat history (last entry the new user message) to Supabase, which enforces
// the subscription-mandatory gate + the steps-exist sequencing check for AI
// recipes, and returns the assistant's reply. Deliberately unmetered
// server-side. Invoke/timeout/error-parsing plumbing is shared via
// ./aiEdgeClient.

import type { Ingredient } from '@/store/types';
import { AIError, type AIErrorCode, invokeAIFunction } from './aiEdgeClient';

export type RecipeAssistantErrorCode = AIErrorCode;

// Typed error so the UI can branch (not_premium -> paywall, etc.).
export class RecipeAssistantError extends AIError {
  constructor(code: RecipeAssistantErrorCode, message: string) {
    super(code, message);
    this.name = 'RecipeAssistantError';
  }
}

// 'ai' triggers the server's steps-exist sequencing check; 'premade' skips it
// (a subscriber already has full access to every premade recipe).
export type RecipeAssistantSource = 'ai' | 'premade';

export interface RecipeAssistantMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface RecipeAssistantParams {
  recipeName: string;
  recipeSource: RecipeAssistantSource;
  ingredients: Pick<Ingredient, 'name' | 'quantity' | 'unit'>[];
  steps: string[];
  messages: RecipeAssistantMessage[];
}

export async function recipeAssistant(params: RecipeAssistantParams): Promise<string> {
  const body = {
    recipeName: params.recipeName.trim().slice(0, 120),
    recipeSource: params.recipeSource,
    ingredients: params.ingredients.map(i => ({
      name: String(i.name ?? '').trim().slice(0, 120),
      quantity: i.quantity,
      unit: i.unit,
    })),
    steps: params.steps.map(s => String(s ?? '').trim()).filter(Boolean),
    messages: params.messages
      .map(m => ({ role: m.role, text: String(m.text ?? '').trim().slice(0, 1000) }))
      .filter(m => m.text),
  };

  const data = await invokeAIFunction('recipe-assistant', body, {
    logPrefix: '[recipeAssistant]',
    makeError: (code, message) => new RecipeAssistantError(code, message),
    timeoutMessage: 'The assistant took too long to respond. Please try again.',
    notAvailableMessage: 'The Recipe Assistant is not available yet. Please try again later.',
  });

  return String(data.reply ?? '').trim();
}
