// Shared prompt + sanitization helpers for the meal-generation AI functions
// (generate-meal-suggestions and generate-plan-shortlist). Both build the same
// kind of Gemini prompt — hard constraints (allergies / dietary preferences /
// avoid list, all equal weight), light ratio-based style cues (cuisines +
// loved foods), and a soft cook-time preference — so this keeps that logic in
// one place instead of letting two hand-written copies drift apart.

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
export const COOK_TIMES = ['quick', 'moderate', 'full'] as const;
export type CookTime = (typeof COOK_TIMES)[number];

export const MAX_PREF_ITEMS = 20;
export const MAX_PREF_LEN = 40;

export const COOK_TIME_LABEL: Record<CookTime, string> = {
  quick: 'quick meals under 15 minutes',
  moderate: 'meals taking 15-30 minutes',
  full: 'meals that can take 30+ minutes',
};

// Server-side profile context loaded from the authoritative users row. Shared
// so both functions describe the same fields to the model.
export interface ProfileContext {
  dietary_preferences: string[];
  allergies: string[];
  goal_type: string | null;
  daily_calorie_target: number | null;
}

// Dedupe + trim a client-sent string list (cuisines / loves / avoid / macro
// preferences). Slices the list first, then each item — defensive against a
// hostile client even though the client also pre-trims.
export function sanitizeStringList(
  raw: unknown,
  maxItems = MAX_PREF_ITEMS,
  maxLen = MAX_PREF_LEN,
): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw.slice(0, maxItems)) {
    const name = typeof item === 'string' ? item.trim().slice(0, maxLen) : '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function sanitizeCookTime(raw: unknown): CookTime | null {
  return typeof raw === 'string' && (COOK_TIMES as readonly string[]).includes(raw)
    ? (raw as CookTime)
    : null;
}

// Informational only — goal + calorie target are context for the model, never
// a constraint of any kind.
export function buildUserContext(p: ProfileContext): string {
  return [
    p.goal_type ? `Goal: ${p.goal_type}.` : '',
    p.daily_calorie_target ? `Daily calorie target: ${p.daily_calorie_target} kcal.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// Hard constraints: dietary preferences, allergies, and the user's avoid list
// all carry equal, non-negotiable weight.
export function buildHardConstraints(p: ProfileContext, avoid: string[]): string {
  return [
    p.dietary_preferences.length ? `Dietary preferences: ${p.dietary_preferences.join(', ')}.` : '',
    p.allergies.length ? `Allergies: ${p.allergies.join(', ')}.` : '',
    avoid.length ? `Foods to avoid (same weight as allergies): ${avoid.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// Style cues: light flavor/variety signal only, never a requirement.
export function buildStyleCues(
  cuisines: string[],
  loves: string[],
  cookTime: CookTime | null,
): string {
  return [
    cuisines.length ? `Cuisines: ${cuisines.join(', ')}.` : '',
    loves.length ? `Loved foods: ${loves.join(', ')}.` : '',
    cookTime ? `Prefer ${COOK_TIME_LABEL[cookTime]}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// ──────────────────────────────────────────────────────────────────────────────
// Umbrella-family expansion (generic across macro categories)
// ──────────────────────────────────────────────────────────────────────────────
// Some picker entries are umbrella terms that sit alongside their own specific
// members (e.g. "Chicken" alongside Chicken Breast/Thigh/etc., or "Potato"
// alongside Russet/Red/Golden). When a user picks an umbrella, we expand it into
// the full family of members with familiarity scores so the AI can pick varied
// specifics across a week of meals, biased toward everyday ones.
//
// Families are hardcoded (not derived by name-matching) because naming isn't
// consistent — e.g. Bacon/Ham/Canadian Bacon are Pork-family but don't contain
// "pork." The umbrella term itself NEVER appears as a member of its own family.

export interface FamilyCut { name: string; score: number }
export type FamilySet = Record<string, FamilyCut[]>;

export const PROTEIN_FAMILIES: FamilySet = {
  Chicken: [
    { name: 'Chicken Breast', score: 92 },
    { name: 'Chicken Drumstick', score: 88 },
    { name: 'Chicken Wing', score: 88 },
    { name: 'Chicken Thigh', score: 85 },
    { name: 'Ground Chicken', score: 70 },
  ],
  Beef: [
    { name: 'Ground Beef', score: 88 },
    { name: 'Sirloin Steak', score: 75 },
    { name: 'Ribeye Steak', score: 72 },
    { name: 'T-Bone Steak', score: 68 },
    { name: 'Beef Tenderloin', score: 65 },
    { name: 'Beef Brisket', score: 62 },
    { name: 'Beef Short Ribs', score: 58 },
    { name: 'Flank Steak', score: 55 },
    { name: 'Porterhouse Steak', score: 55 },
  ],
  Pork: [
    { name: 'Bacon', score: 92 },
    { name: 'Ham', score: 90 },
    { name: 'Pork Chop', score: 82 },
    { name: 'Ground Pork', score: 80 },
    { name: 'Pork Belly', score: 78 },
    { name: 'Pork Ribs', score: 78 },
    { name: 'Pork Loin', score: 70 },
    { name: 'Pork Shoulder', score: 68 },
    { name: 'Canadian Bacon', score: 52 },
  ],
  Turkey: [
    { name: 'Turkey Breast', score: 72 },
    { name: 'Turkey Leg', score: 65 },
    { name: 'Ground Turkey', score: 65 },
  ],
};

export const CARB_FAMILIES: FamilySet = {
  Potato: [
    { name: 'Russet Potato', score: 65 },
    { name: 'Red Potato', score: 60 },
    { name: 'Golden Potato', score: 58 },
  ],
};

/**
 * Generic umbrella-family expansion for any macro category.
 *
 * Returns { directPicks, expansions }:
 * - directPicks: picks that are NOT umbrella terms (passed through as-is)
 * - expansions: one entry per triggered umbrella, containing prompt text that
 *   lists the family's members with scores + any emphasized specifics the user
 *   also selected
 *
 * If a user picks only specific members (no umbrella), those stay as directPicks
 * and no expansion happens — existing behaviour is preserved.
 */
export function expandFamilyPicks(
  picks: string[],
  families: FamilySet,
): {
  directPicks: string[];
  expansions: string[];
} {
  const umbrellaNames = new Set(Object.keys(families));
  const directPicks: string[] = [];
  const triggeredUmbrellas = new Set<string>();
  const emphasizedMembers = new Map<string, string[]>();

  for (const pick of picks) {
    if (umbrellaNames.has(pick)) {
      triggeredUmbrellas.add(pick);
    }
  }

  for (const pick of picks) {
    if (triggeredUmbrellas.has(pick)) continue;

    let belongsToTriggered = false;
    for (const umbrella of triggeredUmbrellas) {
      if (families[umbrella].some(c => c.name === pick)) {
        if (!emphasizedMembers.has(umbrella)) emphasizedMembers.set(umbrella, []);
        emphasizedMembers.get(umbrella)!.push(pick);
        belongsToTriggered = true;
        break;
      }
    }

    if (!belongsToTriggered) {
      directPicks.push(pick);
    }
  }

  const expansions: string[] = [];
  for (const umbrella of triggeredUmbrellas) {
    const family = families[umbrella];
    const emphasized = emphasizedMembers.get(umbrella) ?? [];

    const memberList = family
      .map(c => `${c.name} (${c.score})`)
      .join(', ');

    let text: string;
    if (emphasized.length > 0) {
      text =
        `For ${umbrella.toLowerCase()}: the user selected the broad "${umbrella}" ` +
        `preference with extra emphasis on ${emphasized.join(' and ')} — favour ` +
        `${emphasized.length === 1 ? 'that variety' : 'those varieties'} more often, but ` +
        `still use other varieties from the family for variety across meals. ` +
        `Available options (number = everyday familiarity, prefer higher): ${memberList}.`;
    } else {
      text =
        `For ${umbrella.toLowerCase()}: the user selected the broad "${umbrella}" ` +
        `preference — choose across these specific varieties for variety across the ` +
        `week's meals, but lean toward options with higher familiarity scores ` +
        `(everyday picks) rather than treating all as equally likely. ` +
        `Available options (number = everyday familiarity, prefer higher): ${memberList}.`;
    }

    expansions.push(text);
  }

  return { directPicks, expansions };
}

// Computes an explicit "N of these M suggestions" target for how many should
// lean into the cuisine/loved-food style cues, instead of leaving the ratio to
// the model's judgement. Same formula every call (~1-in-3 to 1-in-4) — no
// escalating/session-tracked logic. Only meaningful for batches (count > 1);
// callers skip this entirely when a description is present.
export function buildRatioInstruction(count: number): string {
  const low = Math.max(1, Math.floor(count / 4));
  const high = Math.max(low, Math.round(count / 3));
  const range = low === high ? `${low}` : `${low}-${high}`;
  return (
    `Exactly ${range} of these ${count} suggestions should lean into the style ` +
    `cues above; the rest must be genuinely varied, general, traditional ` +
    `dishes across different culinary styles — not thematically repetitive.`
  );
}
