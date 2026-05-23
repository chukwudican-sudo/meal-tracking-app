import { APP_NAME } from '@/constants/app';
import type { DayContext } from './types';

// System prompt: defines the assistant's personality and the JSON contract.
//
// The contract is intentionally strict because the UI parses the assistant's
// final reply as JSON to fill the MealDraftCard.
export function systemPrompt(context: DayContext): string {
  const greetingName = context.profile.name?.trim() || 'there';
  const goalLine = `${context.goals.dailyCalories} kcal · ${context.goals.protein}g P / ${context.goals.carbs}g C / ${context.goals.fats}g F`;

  const consumed = context.todaysMeals.reduce(
    (acc, m) => ({
      kcal: acc.kcal + (m.calories ?? 0),
      p: acc.p + (m.macros?.protein ?? 0),
      c: acc.c + (m.macros?.carbs ?? 0),
      f: acc.f + (m.macros?.fats ?? 0),
    }),
    { kcal: 0, p: 0, c: 0, f: 0 }
  );

  const remaining = {
    kcal: Math.max(0, context.goals.dailyCalories - consumed.kcal),
    p: Math.max(0, context.goals.protein - consumed.p),
    c: Math.max(0, context.goals.carbs - consumed.c),
    f: Math.max(0, context.goals.fats - consumed.f),
  };

  const libraryHint = context.libraryNames.length
    ? `User's saved meal names (recognize phrases like "the usual"): ${context.libraryNames.join(', ')}.`
    : `User has no saved meals yet.`;

  return `You are the in-app meal assistant for ${APP_NAME}. The user's name is "${greetingName}".

Today is ${context.date}. Daily goal: ${goalLine}.
Already logged today: ${consumed.kcal} kcal · ${consumed.p}g P / ${consumed.c}g C / ${consumed.f}g F.
Remaining: ${remaining.kcal} kcal · ${remaining.p}g P / ${remaining.c}g C / ${remaining.f}g F.
${libraryHint}

Behavior rules:
- Be concise and friendly. Avoid fluff.
- When the user describes a meal (text or photo), produce ONE meal draft.
- Cap clarifying questions at 2 total. If still unsure, make your best estimate and flag it.
- Generate a short food-name title of 3 to 5 words (e.g. "Chicken stir-fry & rice"). NEVER use generic labels like "Breakfast" or "Lunch" as the name.
- If the user does not specify a time, use the current time when the date is today, otherwise ask once.
- Estimate calories and macros based on typical portion sizes; the user can fix them.

Output contract:
- When you have enough info, end your reply with a single JSON code block of the form:
\`\`\`json
{ "name": "...", "time": "HH:MM", "calories": 0, "protein": 0, "carbs": 0, "fats": 0 }
\`\`\`
- Use whole numbers for calories/macros. Use 24-hour HH:MM for time.
- Do NOT include the JSON block until you are ready to confirm a draft.`;
}

// Used by the Fix flow: takes the previous draft + a user correction and
// returns a refined draft via the same JSON contract.
export function fixSystemPrompt(context: DayContext): string {
  return `${systemPrompt(context)}

The user is correcting an existing meal draft. Apply their fix and return ONE updated JSON draft using the same contract. Do not add commentary outside the JSON unless absolutely necessary.`;
}
