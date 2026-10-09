/**
 * One-time importer: seeds the macro_proteins / macro_carbs / macro_fats tables
 * (see supabase/migrations/20260731230000_macro_food_options.sql) from USDA
 * FoodData Central. Run once, then edit the results in the Supabase Table Editor.
 *
 *   npm run import:macro-foods
 *
 * Requires (read from meal-app/.env, git-ignored — never commit real values):
 *   USDA_API_KEY               a standard api.data.gov key (not DEMO_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY  Supabase → Settings → API → service_role secret
 *   EXPO_PUBLIC_SUPABASE_URL   (already present) the project URL
 *
 * Pipeline: enumerate all Foundation + SR Legacy reference foods, keep only the
 * target food groups, assign each to whichever macro (protein/carb/fat) has the
 * largest gram value per 100 g (legumes forced to proteins), clean + dedupe the
 * USDA descriptions into short labels, then upsert into the three tables with the
 * service role key (RLS blocks anon/authenticated writes).
 *
 * Endpoint note: we use /foods/search?query=* rather than /foods/list. The
 * abridged /foods/list payload has no `foodCategory`, so client-side food-group
 * filtering is impossible there; the search endpoint returns both foodCategory
 * and the macro nutrients (for SR Legacy foods, which are the bulk of the set).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// ─── env ─────────────────────────────────────────────────────────────────────
// Minimal .env loader so this script needs no extra dependency. Only fills vars
// that aren't already set in the real environment.
function loadDotEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, '..', '.env');
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return; // no .env file → rely on process.env
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const USDA_API_KEY = process.env.USDA_API_KEY ?? '';
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function requireEnv(name: string, value: string) {
  if (!value) {
    console.error(
      `Missing ${name}. Add it to meal-app/.env (see .env.example) and re-run.`,
    );
    process.exit(1);
  }
}

requireEnv('USDA_API_KEY', USDA_API_KEY);
requireEnv('EXPO_PUBLIC_SUPABASE_URL (or SUPABASE_URL)', SUPABASE_URL);
requireEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY);

// ─── categorization config ─────────────────────────────────────────────────
type MacroGroup = 'proteins' | 'carbs' | 'fats';

// USDA foodCategory (a.k.a. food group) strings we keep. Everything else
// (beverages, sweets, vegetables, spices, restaurant/fast foods, …) is dropped.
const TARGET_FOOD_GROUPS = new Set<string>([
  'Dairy and Egg Products',
  'Poultry Products',
  'Beef Products',
  'Pork Products',
  'Finfish and Shellfish Products',
  'Lamb, Veal, and Game Products',
  'Legumes and Legume Products',
  'Nut and Seed Products',
  'Cereal Grains and Pasta',
  'Baked Products',
  'Fats and Oils',
]);

// Beans/lentils are carb-dominant by raw grams but conventionally a protein
// source → force this whole group into proteins regardless of dominance.
const LEGUME_GROUP = 'Legumes and Legume Products';

// USDA nutrient ids (per 100 g).
const NUTRIENT_PROTEIN = 1003;
const NUTRIENT_FAT = 1004;
const NUTRIENT_CARB = 1005;

const FDC_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const PAGE_SIZE = 200;

// ─── name cleanup ────────────────────────────────────────────────────────────
// Parts of a USDA description (comma-separated) that carry no shopping-label
// value: cooking methods, fat-trim/grade qualifiers, prep notes, etc. Matched
// case-insensitively against whole comma-parts (with a few substring checks).
const NOISE_EXACT = new Set<string>([
  'raw',
  'cooked',
  'uncooked',
  'unprepared',
  'prepared',
  'boiled',
  'roasted',
  'broiled',
  'braised',
  'fried',
  'pan-fried',
  'pan fried',
  'stir-fried',
  'grilled',
  'baked',
  'steamed',
  'stewed',
  'simmered',
  'microwaved',
  'toasted',
  'blanched',
  'dry heat',
  'moist heat',
  'dry roasted',
  'oil roasted',
  'without salt',
  'with salt',
  'no salt added',
  'salt added',
  'unsalted',
  'salted',
  'commercial',
  'commercially prepared',
  'home prepared',
  'home recipe',
  'restaurant prepared',
  'all grades',
  'choice grade',
  'select grade',
  'prime grade',
  'meat only',
  'meat and skin',
  'skin only',
  'lean only',
  'lean and fat',
  'separable lean and fat',
  'separable lean only',
  'separable fat',
  'bone-in',
  'bone in',
  'boneless',
  'skinless',
  'with skin',
  'without skin',
  'skin and meat',
  'flesh only',
  'drained solids',
  'drained',
  'solids and liquids',
  'canned',
  'frozen',
  'dried',
  'dehydrated',
  'fresh',
  'refrigerated',
  'enriched',
  'unenriched',
  'fortified',
  'regular',
  'broilers or fryers',
  'broiler',
  'fryers',
  'roasting',
  'stewing',
  'young',
  'mature',
  'retail cuts',
  'trimmed to 0" fat',
  'trimmed to 1/8" fat',
  'trimmed to 1/4" fat',
  'ns as to fat eaten',
  'includes usda commodity',
  'usda commodity',
  'includes foods for usda',
]);

// Substring noise: a part is dropped if it contains any of these.
const NOISE_SUBSTRINGS = [
  '% lean',
  '% fat',
  'trimmed to',
  'ns as to',
  'usda commodity',
  'includes foods for',
  'grade',
  'reduced fat',
  'low fat',
  'fat free',
  'nonfat',
  'lowfat',
  'added vitamin',
  'vitamin a added',
  'vitamin d added',
  'with added',
];

function isNoisePart(part: string): boolean {
  const p = part.trim().toLowerCase();
  if (!p) return true;
  if (NOISE_EXACT.has(p)) return true;
  for (const sub of NOISE_SUBSTRINGS) {
    if (p.includes(sub)) return true;
  }
  return false;
}

function titleCase(input: string): string {
  return input
    .split(' ')
    .map((word) =>
      word.length === 0
        ? word
        : word[0].toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(' ');
}

function cleanName(description: string): string {
  const parts = description.split(',').map((s) => s.trim());
  const base = parts[0] ?? description.trim();
  const kept: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (isNoisePart(part)) continue;
    kept.push(part);
  }
  // Keep it short: base plus at most the two most meaningful qualifiers.
  const label = [base, ...kept.slice(0, 2)].join(', ');
  return titleCase(label.replace(/\s+/g, ' ').trim());
}

// ─── USDA fetch ──────────────────────────────────────────────────────────────
type SearchNutrient = { nutrientId: number; value: number };
type SearchFood = {
  fdcId: number;
  description: string;
  dataType: string;
  foodCategory?: string;
  foodNutrients: SearchNutrient[];
};

async function fetchWithRetry(url: string, attempt = 0): Promise<Response> {
  const res = await fetch(url);
  if (res.ok) return res;
  // Transient (429/5xx) → back off and retry a few times.
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const waitMs = 1000 * (attempt + 1);
    console.warn(`  ${res.status} from USDA, retrying in ${waitMs}ms…`);
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchWithRetry(url, attempt + 1);
  }
  throw new Error(`USDA request failed (${res.status}): ${await res.text()}`);
}

async function fetchAllFoods(): Promise<SearchFood[]> {
  const all: SearchFood[] = [];
  let pageNumber = 1;
  let totalPages = 1;
  do {
    const params = new URLSearchParams({
      api_key: USDA_API_KEY,
      query: '*',
      dataType: 'Foundation,SR Legacy',
      pageSize: String(PAGE_SIZE),
      pageNumber: String(pageNumber),
    });
    const res = await fetchWithRetry(`${FDC_SEARCH_URL}?${params.toString()}`);
    const json = (await res.json()) as {
      totalPages?: number;
      foods?: SearchFood[];
    };
    totalPages = json.totalPages ?? 1;
    const foods = json.foods ?? [];
    all.push(...foods);
    console.log(`  page ${pageNumber}/${totalPages} — ${foods.length} foods`);
    pageNumber++;
    // Be polite to the API between pages.
    await new Promise((r) => setTimeout(r, 150));
  } while (pageNumber <= totalPages);
  return all;
}

// ─── main ────────────────────────────────────────────────────────────────────
function macroValue(food: SearchFood, nutrientId: number): number | null {
  const match = food.foodNutrients.find((n) => n.nutrientId === nutrientId);
  return match ? match.value : null;
}

function classify(food: SearchFood): MacroGroup | null {
  const category = food.foodCategory ?? '';
  if (category === LEGUME_GROUP) return 'proteins';

  const protein = macroValue(food, NUTRIENT_PROTEIN);
  const fat = macroValue(food, NUTRIENT_FAT);
  const carb = macroValue(food, NUTRIENT_CARB);

  // No macro data at all (some Foundation foods only carry a fatty-acid
  // profile) → can't categorize by dominance, skip.
  if (protein === null && fat === null && carb === null) return null;

  const p = protein ?? 0;
  const f = fat ?? 0;
  const c = carb ?? 0;

  // Essentially macro-free record (water, salt, stubs) → skip.
  if (p < 0.5 && f < 0.5 && c < 0.5) return null;

  // Dominant macro wins; ties break protein > carb > fat.
  if (p >= c && p >= f) return 'proteins';
  if (c >= p && c >= f) return 'carbs';
  return 'fats';
}

async function main() {
  console.log('Fetching Foundation + SR Legacy foods from USDA…');
  const foods = await fetchAllFoods();
  console.log(`Fetched ${foods.length} foods total.`);

  const buckets: Record<MacroGroup, Set<string>> = {
    proteins: new Set(),
    carbs: new Set(),
    fats: new Set(),
  };
  // Track lowercased names already claimed by any bucket so a food can't land
  // in two lists, and to dedupe within a list (first occurrence wins).
  const seenLower: Record<MacroGroup, Set<string>> = {
    proteins: new Set(),
    carbs: new Set(),
    fats: new Set(),
  };

  let kept = 0;
  let skippedGroup = 0;
  let skippedNoMacro = 0;
  for (const food of foods) {
    if (!food.foodCategory || !TARGET_FOOD_GROUPS.has(food.foodCategory)) {
      skippedGroup++;
      continue;
    }
    const group = classify(food);
    if (!group) {
      skippedNoMacro++;
      continue;
    }
    const name = cleanName(food.description);
    if (!name) continue;
    const lower = name.toLowerCase();
    if (seenLower[group].has(lower)) continue;
    seenLower[group].add(lower);
    buckets[group].add(name);
    kept++;
  }

  console.log(
    `\nKept ${kept} foods — proteins ${buckets.proteins.size}, ` +
      `carbs ${buckets.carbs.size}, fats ${buckets.fats.size}. ` +
      `(skipped ${skippedGroup} out-of-group, ${skippedNoMacro} without macros)`,
  );

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tableByGroup: Record<MacroGroup, string> = {
    proteins: 'macro_proteins',
    carbs: 'macro_carbs',
    fats: 'macro_fats',
  };

  for (const group of ['proteins', 'carbs', 'fats'] as MacroGroup[]) {
    const table = tableByGroup[group];
    const names = [...buckets[group]].sort();
    if (names.length === 0) {
      console.log(`No rows for ${table}, skipping.`);
      continue;
    }

    // Idempotent re-runs: the unique index is on lower(name) (a functional
    // index PostgREST's upsert can't target), so we filter out names that
    // already exist case-insensitively and insert only the new ones.
    const { data: existing, error: readError } = await supabase
      .from(table)
      .select('name');
    if (readError) {
      console.error(`Reading ${table} failed:`, readError.message);
      process.exit(1);
    }
    const existingLower = new Set(
      (existing ?? []).map((r: { name: string }) => r.name.toLowerCase()),
    );
    const newRows = names
      .filter((name) => !existingLower.has(name.toLowerCase()))
      .map((name) => ({ name }));

    if (newRows.length === 0) {
      console.log(`${table}: already up to date (${names.length} names).`);
      continue;
    }
    const { error } = await supabase.from(table).insert(newRows);
    if (error) {
      console.error(`Insert into ${table} failed:`, error.message);
      process.exit(1);
    }
    console.log(
      `Inserted ${newRows.length} new rows into ${table} ` +
        `(${existingLower.size} already present).`,
    );
  }

  console.log('\nDone. Review/edit the three tables in the Supabase Table Editor.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
