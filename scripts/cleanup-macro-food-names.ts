/**
 * One-time content-cleanup pass over the already-imported macro_proteins /
 * macro_carbs / macro_fats tables (see scripts/import-macro-foods.ts). Does
 * NOT re-fetch from USDA — it reads the existing rows, rewrites each name into
 * natural phrasing, and merges rows that differ only by preparation/processing
 * method (battered vs floured vs plain chicken breast, sodium-added vs plain
 * beans, etc). Updates/deletes rows directly via the service role key.
 *
 *   npm run cleanup:macro-foods            # applies the changes
 *   npm run cleanup:macro-foods -- --dry-run   # preview only, no writes
 *
 * Requires the same env as import-macro-foods.ts: EXPO_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in meal-app/.env.
 *
 * Design goal: be safe by default. Only a curated, verified list of genuine
 * prep/processing noise (cooking state, coating, sodium/moisture/grade specs,
 * trim details, USDA category filler like "broiler or fryers") gets dropped.
 * A small list of variety/color/cut adjectives that read naturally *before*
 * the base noun (black beans, ground beef, cheddar cheese) gets reordered.
 * Anything else unrecognized is kept, unreordered, rather than silently
 * dropped — so genuinely distinct cuts/varieties (chicken breast vs thigh vs
 * wing, ground beef vs steak) never get accidentally merged just because a
 * qualifier wasn't anticipated. This means the pass won't perfectly tidy
 * every long-tail entry, but it never destroys a real distinction to do so —
 * consistent with these tables being reviewable/editable afterwards.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// ─── env ─────────────────────────────────────────────────────────────────────
function loadDotEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, '..', '.env');
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return;
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

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Add them to meal-app/.env and re-run.',
  );
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');

// ─── word lists ──────────────────────────────────────────────────────────────
// Whole-comma-segment matches only (not sub-word), matched against a
// lowercased, hyphen-normalized, whitespace-collapsed key. Deliberately
// conservative: anything not listed here is preserved rather than dropped.

const NOISE_EXACT = new Set<string>([
  // cooking state / method
  'raw', 'cooked', 'uncooked', 'unprepared', 'prepared',
  'boiled', 'roasted', 'broiled', 'braised', 'fried', 'pan fried', 'stir fried',
  'grilled', 'baked', 'steamed', 'stewed', 'simmered', 'microwaved', 'toasted', 'blanched',
  'dry heat', 'moist heat', 'dry roasted', 'oil roasted',
  // salt / sodium
  'without salt', 'with salt', 'no salt added', 'salt added', 'sodium added',
  'low sodium', 'reduced sodium', 'reduced or low sodium', 'unsalted', 'salted',
  // sourcing / prep provenance
  'commercial', 'commercially prepared', 'home prepared', 'home recipe', 'restaurant prepared',
  // grading
  'all grades', 'all classes', 'all types', 'choice grade', 'select grade', 'prime grade',
  'choice', 'select', 'prime',
  // trim / cut detail
  'meat only', 'meat and skin', 'skin only', 'lean only', 'lean and fat',
  'separable lean and fat', 'separable lean only', 'separable fat',
  'bone in', 'boneless', 'skinless', 'with skin', 'without skin', 'skin and meat',
  'flesh only', 'lip on',
  // packaging / liquid state
  'drained solids', 'drained', 'drained and rinsed', 'solids and liquids',
  'canned', 'frozen', 'dried', 'dry', 'dehydrated', 'fresh', 'refrigerated',
  'packed', 'vacuum packed', 'precooked', 'fully cooked', 'parcooked', 'par cooked',
  'in water', 'in oil', 'in brine', 'in syrup',
  // additives / fortification
  'enriched', 'unenriched', 'fortified', 'vitamin and mineral fortified',
  'vitamin d added', 'vitamin a added', 'with additives',
  'regular',
  // coating / seasoning prep (the "battered vs floured vs plain" case)
  'batter', 'flour', 'breaded', 'breading', 'bread crumbs', 'crumbed', 'crumbles',
  'seasoned', 'unseasoned', 'marinated', 'glazed', 'sauced', 'in sauce',
  'smoked', 'cured', 'stuffed', 'filled',
  // legume-specific filler
  'mature seed', 'mature seeds', 'mature',
  // USDA category filler / boilerplate
  'broiler or fryers', 'broilers or fryers', 'retail cuts',
  'ns as to fat eaten', 'includes usda commodity', 'usda commodity', 'includes foods for usda',
  'as purchased', 'nfs', 'not further specified',
  'variety meats and by products', 'variety meats and byproducts',
  'no broth', 'with broth', 'dark meat', 'light meat', 'cold pack',
  // sourcing marketing terms
  'farmed', 'farm raised', 'raised', 'free range', 'cage free',
]);

// Matched the same way as NOISE_EXACT, then moved before the base noun.
const PREPEND_WORDS = new Set<string>([
  'ground', 'minced',
  'black', 'white', 'brown', 'red', 'green', 'yellow', 'pink', 'purple',
  'pinto', 'kidney', 'navy', 'lima', 'garbanzo', 'chickpea', 'great northern',
  'cannellini', 'fava', 'adzuki', 'mung', 'mungo', 'cranberry', 'hyacinth', 'yardlong', 'winged',
  'split', 'whole', 'whole wheat', 'whole grain', 'sweet',
  'extra virgin', 'virgin', 'refined', 'unrefined',
  'greek', 'cottage', 'part skim', 'reduced fat', 'low fat', 'lowfat',
  'nonfat', 'non fat', 'fat free',
  'lean', 'extra lean',
  'wild', 'atlantic', 'pacific',
  'long grain', 'short grain', 'medium grain', 'instant', 'parboiled', 'converted',
  'plain', 'skim',
  'jasmine', 'basmati', 'arborio',
  'cheddar', 'mozzarella', 'swiss', 'parmesan', 'feta', 'gouda', 'brie', 'provolone',
  'ricotta', 'colby', 'monterey jack', 'monterey', 'muenster', 'gruyere', 'blue',
  'american', 'romano', 'camembert', 'edam', 'fontina', 'limburger', 'cheshire',
  'caraway', 'brick', 'goat', 'mexican',
  'king', 'snow', 'dungeness',
  'roma', 'russet', 'yukon gold', 'idaho',
  'sesame', 'peanut', 'sunflower', 'canola', 'vegetable', 'olive', 'coconut',
  'corn', 'soybean', 'palm', 'grapeseed', 'avocado',
  'chia', 'flax', 'flaxseed', 'butter',
  'meatless', 'rotisserie',
]);

// USDA files these under a generic bucket word first ("Nuts, almonds",
// "Seeds, chia seeds", "Fish, herring, Pacific"); the real food name is the
// *next* segment, so it replaces the base entirely instead of combining with it.
const GENERIC_REPLACE_BASES = new Set<string>(['nuts', 'nut', 'seeds', 'seed', 'fish']);

// ─── pass 2: post-canonical dedup ─────────────────────────────────────────────
// The lists below drive a second cleanup phase that runs on the *already-clean*
// (space-joined, no-comma) names produced by the canonicalize pass above. See
// dedupePass2() for the three rules it enforces.

// Trailing cooking/preparation words. If a name ends in one of these AND the
// name with it removed already exists as its own row, the prepared version is
// dropped in favour of the plainer/rawer one. Multi-word phrases first so the
// longest suffix wins (endsWith is checked in this order).
const PREP_SUFFIXES: string[] = [
  'hard-boiled', 'hard boiled', 'soft-boiled', 'soft boiled',
  'pan fried', 'stir fried', 'deep fried', 'dry roasted', 'oil roasted',
  'battered', 'breaded', 'poached', 'scrambled', 'omelet', 'omelette',
  'boiled', 'fried', 'roasted', 'broiled', 'braised', 'grilled', 'baked',
  'steamed', 'stewed', 'simmered', 'microwaved', 'toasted', 'blanched',
  'sauteed', 'smoked', 'cured', 'pickled', 'glazed', 'sauced', 'marinated',
  'seasoned', 'cooked',
].sort((a, b) => b.length - a.length);

// Generic qualifier words that should never stand alone as a whole food name
// (a bare "Half"/"Flat"/"Point" would be an over-trimmed fragment). Used only
// to *flag* suspect rows for manual review — pass 2 never auto-deletes on this.
const FRAGMENT_WORDS = new Set<string>([
  'half', 'halves', 'flat', 'flats', 'point', 'whole', 'side', 'sides',
  'end', 'ends', 'piece', 'pieces', 'part', 'parts', 'portion', 'portions',
  'tip', 'tips', 'cap', 'caps', 'eye', 'blade', 'top', 'bottom', 'center',
  'boneless', 'skinless', 'lean', 'trimmed', 'raw', 'cooked',
]);

function normKey(s: string): string {
  return s.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function isNoise(key: string): boolean {
  if (!key) return true;
  if (NOISE_EXACT.has(key)) return true;
  if (key.includes('%')) return true;
  if (key.includes('trimmed to')) return true;
  if (/\bgrade\b/.test(key)) return true;
  if (/^\d+\s*moisture$/.test(key)) return true;
  return false;
}

function titleCaseWord(word: string): string {
  return word
    .split('-')
    .map((seg) => (seg.length ? seg[0].toUpperCase() + seg.slice(1).toLowerCase() : seg))
    .join('-');
}

function titleCase(input: string): string {
  return input.split(' ').filter(Boolean).map(titleCaseWord).join(' ');
}

function stripParens(s: string): string {
  // Balanced "(...)" asides are dropped outright (usually alternate/regional
  // names, e.g. "Chickpeas (garbanzo beans, Bengal gram)"). Any leftover
  // unmatched paren character (rare, truncated USDA descriptions) is also
  // stripped so it doesn't get treated as its own bogus comma-part.
  return s.replace(/\([^)]*\)/g, ' ').replace(/[()]/g, ' ');
}

/**
 * Rewrites one stored name into natural phrasing and drops recognized
 * prep/processing noise. Conservative: unrecognized qualifiers are kept
 * (appended, unreordered) rather than dropped, so real distinctions survive.
 */
function canonicalize(rawName: string): string {
  const cleaned = stripParens(rawName);
  const parts = cleaned
    .split(',')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (parts.length === 0) return titleCase(rawName.trim());

  let base = parts[0];
  let scanFrom = 1;
  if (parts.length > 1 && GENERIC_REPLACE_BASES.has(normKey(base))) {
    base = parts[1];
    scanFrom = 2;
  }

  let prepend: string | null = null;
  const kept: string[] = [];
  for (let i = scanFrom; i < parts.length; i++) {
    const part = parts[i];
    const key = normKey(part);
    if (isNoise(key)) continue;
    if (!prepend && PREPEND_WORDS.has(key)) {
      prepend = part;
      continue;
    }
    kept.push(part);
  }

  const phrase = [prepend, base, ...kept].filter(Boolean).join(' ');
  return titleCase(phrase.replace(/\s+/g, ' ').trim());
}

// ─── Supabase I/O ────────────────────────────────────────────────────────────
type Row = { id: string; name: string };

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchAllRows(table: string): Promise<Row[]> {
  const pageSize = 1000;
  const all: Row[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('id,name')
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table} select failed: ${error.message}`);
    all.push(...((data ?? []) as Row[]));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function cleanupTable(table: string) {
  const rows = await fetchAllRows(table);

  const groups = new Map<string, Row[]>();
  const canonicalDisplay = new Map<string, string>();
  for (const row of rows) {
    const canonical = canonicalize(row.name);
    const key = canonical.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
    canonicalDisplay.set(key, canonical);
  }

  const deleteIds: string[] = [];
  const renameOps: { id: string; name: string }[] = [];
  const sampleChanges: string[] = [];

  for (const [key, groupRows] of groups) {
    const canonical = canonicalDisplay.get(key)!;
    const sorted = groupRows.slice().sort((a, b) => a.id.localeCompare(b.id));
    const survivor = sorted[0];
    const losers = sorted.slice(1);
    losers.forEach((l) => deleteIds.push(l.id));
    if (survivor.name !== canonical) renameOps.push({ id: survivor.id, name: canonical });

    if (groupRows.length > 1 || survivor.name !== canonical) {
      const originals = groupRows.map((r) => `"${r.name}"`).join('  +  ');
      sampleChanges.push(`${originals}  →  "${canonical}"`);
    }
  }

  console.log(
    `\n${table}: ${rows.length} rows → ${groups.size} rows ` +
      `(${deleteIds.length} merged away, ${renameOps.length} renamed)`,
  );
  const previewCount = Math.min(sampleChanges.length, 30);
  for (let i = 0; i < previewCount; i++) console.log('  ' + sampleChanges[i]);
  if (sampleChanges.length > previewCount) {
    console.log(`  … and ${sampleChanges.length - previewCount} more changes`);
  }

  if (DRY_RUN) return;

  for (const idsChunk of chunk(deleteIds, 200)) {
    const { error } = await supabase.from(table).delete().in('id', idsChunk);
    if (error) throw new Error(`${table} delete failed: ${error.message}`);
  }
  for (const opsChunk of chunk(renameOps, 200)) {
    const { error } = await supabase.from(table).upsert(opsChunk, { onConflict: 'id' });
    if (error) throw new Error(`${table} rename failed: ${error.message}`);
  }
}

/** Longest matching prep suffix on a lowercased name, or null. */
function prepSuffixBase(lowerName: string): string | null {
  for (const suf of PREP_SUFFIXES) {
    if (lowerName.endsWith(' ' + suf)) {
      return lowerName.slice(0, lowerName.length - suf.length - 1).trim();
    }
  }
  return null;
}

/**
 * Second pass, run on the already-canonicalized rows. Enforces three rules that
 * the comma-structure-based canonicalize pass can't see once names are joined:
 *   1. whitespace/casing near-duplicates ("Bass Freshwater" vs "Bass Fresh
 *      Water") — collapse ALL whitespace for the dedup key, keep lowest id.
 *   2. composite "join several parts" entries (2+ literal " and ") — deleted
 *      outright; they never represent one clean single food.
 *   3. leftover prep-state duplicates — if a name ends in a known cooking word
 *      and the plainer base already exists as its own row, drop the prepared
 *      one (keep the raw/unprepared form). If no base exists, it's left alone.
 * Also flags (never deletes) suspect over-trimmed fragment names for review.
 */
async function dedupePass2(table: string) {
  const rows = await fetchAllRows(table);
  const deleteIds = new Set<string>();
  const logs: string[] = [];

  // (1) whitespace / casing near-duplicates
  const wsGroups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.name.toLowerCase().replace(/\s+/g, '');
    if (!wsGroups.has(key)) wsGroups.set(key, []);
    wsGroups.get(key)!.push(r);
  }
  for (const group of wsGroups.values()) {
    if (group.length < 2) continue;
    // Keep the tidiest spelling: shortest name drops stray spaces (e.g.
    // "Beef Ribeye Steak" over "Beef Rib Eye Steak", "Ready-To-Heat" over
    // "Ready -To-Heat"); id is only a stable tiebreak.
    const sorted = group
      .slice()
      .sort((a, b) => a.name.length - b.name.length || a.id.localeCompare(b.id));
    for (const loser of sorted.slice(1)) {
      deleteIds.add(loser.id);
      logs.push(`  whitespace-dup:  "${loser.name}"  merged into  "${sorted[0].name}"`);
    }
  }

  // (2) composite "X and Y and Z" join entries
  for (const r of rows) {
    if (deleteIds.has(r.id)) continue;
    const ands = r.name.match(/\band\b/gi);
    if (ands && ands.length >= 2) {
      deleteIds.add(r.id);
      logs.push(`  composite:       deleted  "${r.name}"`);
    }
  }

  // (3) prep-state duplicates (raw form wins when it exists)
  const liveByLower = new Map<string, Row>();
  for (const r of rows) {
    if (deleteIds.has(r.id)) continue;
    liveByLower.set(r.name.toLowerCase(), r);
  }
  for (const r of rows) {
    if (deleteIds.has(r.id)) continue;
    const base = prepSuffixBase(r.name.toLowerCase());
    if (!base) continue;
    const baseRow = liveByLower.get(base);
    if (baseRow && baseRow.id !== r.id && !deleteIds.has(baseRow.id)) {
      deleteIds.add(r.id);
      logs.push(`  prep-dup:        deleted  "${r.name}"  (kept  "${baseRow.name}")`);
    }
  }

  // Fragment safety-net: flag any surviving 1-2 word name made only of generic
  // qualifier words (no recognizable base). Review-only; never auto-deleted.
  const fragmentFlags: string[] = [];
  for (const r of rows) {
    if (deleteIds.has(r.id)) continue;
    const words = r.name.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length >= 1 && words.length <= 2 && words.every((w) => FRAGMENT_WORDS.has(w))) {
      fragmentFlags.push(`  !! fragment?     "${r.name}"  (all-qualifier name — review manually)`);
    }
  }

  console.log(
    `\n${table} (pass 2): ${rows.length} rows → ${rows.length - deleteIds.size} rows ` +
      `(${deleteIds.size} removed)`,
  );
  for (const line of logs) console.log(line);
  if (fragmentFlags.length) {
    console.log(`  --- ${fragmentFlags.length} fragment(s) flagged for review ---`);
    for (const line of fragmentFlags) console.log(line);
  }

  if (DRY_RUN) return;

  const ids = [...deleteIds];
  for (const idsChunk of chunk(ids, 200)) {
    const { error } = await supabase.from(table).delete().in('id', idsChunk);
    if (error) throw new Error(`${table} pass-2 delete failed: ${error.message}`);
  }
}

async function main() {
  console.log(DRY_RUN ? 'DRY RUN — no changes will be written.\n' : 'Applying changes…\n');
  const tables = ['macro_proteins', 'macro_carbs', 'macro_fats'];
  for (const table of tables) {
    await cleanupTable(table);
  }
  // Pass 2 runs after pass 1 has written its renames/merges, so it operates on
  // the freshly-canonicalized names (in a dry run it reads current DB state,
  // which is already post-pass-1 from the previous real run).
  console.log('\n─── pass 2: whitespace / composite / prep-state dedup ───');
  for (const table of tables) {
    await dedupePass2(table);
  }
  console.log(
    DRY_RUN
      ? '\nDry run complete. Re-run without --dry-run to apply.'
      : '\nDone. Review/edit the three tables in the Supabase Table Editor.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
