/**
 * One-time familiarity scorer for the Build My Plan macro picker.
 *
 * Reads every row from macro_proteins / macro_carbs / macro_fats and asks Gemini
 * to score each food 0-100 on how commonly known and eaten it is by everyday
 * people across diverse global diets — a reasoned familiarity judgment (Gemini's
 * general knowledge), NOT real consumption statistics. Writes the result into the
 * familiarity_score column (see migration 20260802010000). The picker then sorts
 * by that score so recognizable staples surface first.
 *
 *   npm run score:macro-familiarity
 *   npm run score:macro-familiarity -- --dry-run   # score + print, no writes
 *
 * Requires (read from meal-app/.env, git-ignored — never commit real values):
 *   GEMINI_API_KEY             the same key stored as a Supabase Edge Function
 *                              secret; needed locally because this admin script
 *                              calls Gemini directly rather than via an edge fn.
 *   SUPABASE_SERVICE_ROLE_KEY  Supabase → Settings → API → service_role secret
 *   EXPO_PUBLIC_SUPABASE_URL   (already present) the project URL
 *
 * Calls Gemini directly (mirrors supabase/functions/_shared/gemini.ts) in
 * batches, so it doesn't touch the per-user 30/hour rate-limit bucket the
 * user-facing edge functions use.
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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!GEMINI_API_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing GEMINI_API_KEY / EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. ' +
      'Add them to meal-app/.env (see .env.example) and re-run.',
  );
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');

// Kept in lockstep with the app's pinned Flash model (see the edge functions).
const GEMINI_MODEL = 'gemini-3.6-flash';
const BATCH_SIZE = 40;
const TIMEOUT_MS = 45000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const RETRYABLE_STATUSES = new Set([429, 503]);

const SYSTEM_INSTRUCTION = `You rate how familiar foods are to ordinary people worldwide.

For each food name, return an integer "score" from 0 to 100 estimating how commonly
known and eaten it is by everyday people across diverse global diets. This is a
reasoned judgment based on your general knowledge of what people around the world
actually recognize and eat — NOT real consumption statistics, and NOT US-specific
popularity. Think globally: staples of many cuisines score high even if they are
less common in any single country.

Guidance:
- 90-100: near-universally recognized everyday staples (rice, eggs, chicken breast,
  milk, bread, potatoes, bananas, beans).
- 60-89: widely known and regularly eaten by many people (salmon, oats, yogurt,
  lentils, tofu, almonds, shrimp, olive oil).
- 30-59: familiar to a fair number of people but more regional or occasional
  (quinoa, couscous, sardines, ricotta, bison, tempeh).
- 0-29: obscure, niche, industrial, or highly specific items most people would not
  recognize as an everyday food (game meats, organ/variety-meat cuts, brand or
  product-specific descriptions, food-industry ingredients).

Judge the food the name refers to. Score every item. Do not add commentary.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          score: { type: 'integer' },
        },
        required: ['name', 'score'],
      },
    },
  },
  required: ['scores'],
};

const TABLES = ['macro_proteins', 'macro_carbs', 'macro_fats'] as const;

type Row = { id: string; name: string };

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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

/** One Gemini call → map of name → score for the given batch of names. */
async function scoreBatch(names: string[], logPrefix: string): Promise<Map<string, number>> {
  const userText =
    'Score each of these foods (return one entry per name, same spelling):\n' +
    names.map((n) => `- ${n}`).join('\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  // Unlike the user-facing edge functions (fail fast, never retry a timeout),
  // this is a one-off background job where finishing the full run matters more
  // than latency — so timeouts get retried too, up to MAX_ATTEMPTS.
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body,
        signal: controller.signal,
      });
      const ms = Date.now() - startedAt;
      if (!res.ok) {
        const detail = await res.text();
        const err = new Error(`Gemini HTTP ${res.status}: ${detail.slice(0, 300)}`);
        if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
          console.warn(`${logPrefix} transient ${res.status} after ${ms}ms, retrying (${attempt}/${MAX_ATTEMPTS})…`);
          lastError = err;
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
      const data = await res.json();
      const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini returned no content');
      const parsed = JSON.parse(text) as { scores?: { name: string; score: number }[] };
      const map = new Map<string, number>();
      for (const entry of parsed.scores ?? []) {
        if (typeof entry?.name !== 'string' || typeof entry?.score !== 'number') continue;
        const clamped = Math.max(0, Math.min(100, Math.round(entry.score)));
        map.set(entry.name.toLowerCase(), clamped);
      }
      return map;
    } catch (e) {
      const isTimeout = e instanceof Error && e.name === 'AbortError';
      const err = isTimeout ? new Error(`Gemini request timed out after ${TIMEOUT_MS}ms`) : e;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `${logPrefix} ${isTimeout ? 'timed out' : 'error'}, retrying (${attempt}/${MAX_ATTEMPTS})…`,
        );
        lastError = err;
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError ?? new Error('Gemini call failed');
}

async function scoreTable(table: string) {
  const rows = await fetchAllRows(table);
  const batches = chunk(rows, BATCH_SIZE);
  console.log(`\n${table}: ${rows.length} rows in ${batches.length} batch(es)…`);

  const updates: { id: string; name: string; familiarity_score: number }[] = [];
  let unmatched = 0;
  let failedBatches = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const logPrefix = `[${table} ${b + 1}/${batches.length}]`;
    let scores: Map<string, number>;
    try {
      scores = await scoreBatch(
        batch.map((r) => r.name),
        logPrefix,
      );
    } catch (e) {
      // A single batch failing after its own retries shouldn't lose everything
      // scored so far — log it, leave that batch's rows null, keep going.
      // Re-running the script later only needs to fill in nulls anyway.
      failedBatches++;
      console.error(`${logPrefix} failed after retries, leaving ${batch.length} rows null:`, e);
      continue;
    }
    for (const row of batch) {
      const score = scores.get(row.name.toLowerCase());
      if (score === undefined) {
        unmatched++;
        console.warn(`${logPrefix} no score returned for "${row.name}" — leaving null`);
        continue;
      }
      updates.push({ id: row.id, name: row.name, familiarity_score: score });
    }
    console.log(`${logPrefix} scored ${scores.size}/${batch.length}`);
  }

  // Show the extremes so the ordering can be sanity-checked at a glance.
  const sorted = updates.slice().sort((a, b) => b.familiarity_score - a.familiarity_score);
  const top = sorted.slice(0, 8).map((u) => `${u.familiarity_score} ${u.name}`);
  const bottom = sorted.slice(-8).map((u) => `${u.familiarity_score} ${u.name}`);
  console.log(`  top:    ${top.join(' | ')}`);
  console.log(`  bottom: ${bottom.join(' | ')}`);
  console.log(
    `  ${updates.length} scored, ${unmatched} left null` +
      (failedBatches ? `, ${failedBatches} batch(es) failed — re-run to fill gaps` : ''),
  );

  if (DRY_RUN) return;

  // Include name in the payload: upsert's insert path would otherwise violate
  // the NOT NULL name constraint (ON CONFLICT only handles the unique index).
  for (const opsChunk of chunk(updates, 200)) {
    const { error } = await supabase
      .from(table)
      .upsert(opsChunk, { onConflict: 'id' });
    if (error) throw new Error(`${table} score write failed: ${error.message}`);
  }
}

async function main() {
  console.log(DRY_RUN ? 'DRY RUN — scoring only, no writes.' : 'Scoring and writing familiarity scores…');
  for (const table of TABLES) {
    await scoreTable(table);
  }
  console.log(
    DRY_RUN
      ? '\nDry run complete. Re-run without --dry-run to write scores.'
      : '\nDone. familiarity_score populated across all three tables.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
