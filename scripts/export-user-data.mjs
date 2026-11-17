// Export everything Macrotri holds about one account (Privacy Policy: "a
// complete copy in a common machine-readable format (JSON)", answered within
// 30 days). Writes data.json + the meal photos to ~/macrotri-exports/<date>-
// <account id>/ — OUTSIDE the repo on purpose: the repo is public, and a
// user's data must never be committed. Read-only on the server.
//
//   node scripts/export-user-data.mjs person@example.com           # dev
//   node scripts/export-user-data.mjs --prod person@example.com    # production
//
// Keys come from .env (never committed): dev = EXPO_PUBLIC_SUPABASE_URL +
// SUPABASE_SECRET_KEY; production = PROD_SUPABASE_SECRET_KEY (the
// production project's secret key, Project Settings → API Keys).
// Send the person the folder (zipped) and then delete your copy.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PROD_URL = 'https://tmsydkqpskwcsrrbuqst.supabase.co';

// Tables keyed by user_id (public.users is keyed by id), then the child tables
// reached through them. Matches the foreign keys to auth.users (Nov 16) —
// add a new user table here when one is created.
const USER_TABLES = [
  'meal_logs', 'weight_logs', 'progress_daily', 'plans', 'recipes', 'saved_recipes',
  'meal_templates', 'kitchen_items', 'cart_items', 'planned_ingredients',
  'user_feedback', 'ai_events', 'ai_usage_log', 'push_tokens', 'sync_deletions',
];
const CHILD_TABLES = [
  { table: 'meal_log_ingredients', key: 'meal_log_id', parent: 'meal_logs' },
  { table: 'plan_slots', key: 'plan_id', parent: 'plans' },
  { table: 'plan_day_meals', key: 'plan_id', parent: 'plans' },
  { table: 'recipe_ingredients', key: 'recipe_id', parent: 'recipes' },
  { table: 'recipe_steps', key: 'recipe_id', parent: 'recipes' },
];

function loadEnv() {
  const env = {};
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const args = process.argv.slice(2);
const prod = args.includes('--prod');
const email = args.filter(a => a !== '--prod')[0]?.trim().toLowerCase();
if (!email || !email.includes('@') || args.some(a => a.startsWith('-') && a !== '--prod')) {
  console.error('Usage: node scripts/export-user-data.mjs [--prod] person@example.com');
  process.exit(1);
}

const env = loadEnv();
const url = prod ? PROD_URL : env.EXPO_PUBLIC_SUPABASE_URL;
const key = prod ? env.PROD_SUPABASE_SECRET_KEY : env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error(prod ? 'Missing PROD_SUPABASE_SECRET_KEY in .env' : 'Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env');
  process.exit(1);
}
console.log(prod ? 'Target: PRODUCTION' : `Target: development (${url})`);
const admin = createClient(url, key, { auth: { persistSession: false } });

async function findUser() {
  for (let page = 1; page < 1000; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listing accounts failed: ${error.message}`);
    const hit = data.users.find(u => (u.email ?? '').toLowerCase() === email);
    if (hit) return hit;
    if (!data.nextPage || data.users.length === 0) return null;
  }
  return null;
}

// Every row matching column = value (or IN values), a page at a time in a
// fixed order (so pages never skip or repeat rows), until an empty page.
const ORDER_BY = { push_tokens: 'token', users: 'id' };
async function rows(table, column, values) {
  const out = [];
  const list = Array.isArray(values) ? values : [values];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    for (let from = 0; ; from += 1000) {
      const q = admin.from(table).select('*').order(ORDER_BY[table] ?? 'id').range(from, from + 999);
      const { data, error } = await (chunk.length === 1 && !Array.isArray(values) ? q.eq(column, chunk[0]) : q.in(column, chunk));
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...data);
      if (data.length === 0) break;
    }
  }
  return out;
}

const user = await findUser();
if (!user) {
  console.error(`No account with the email ${email}.`);
  process.exit(1);
}

const data = {
  exported_at: new Date().toISOString(),
  account: {
    id: user.id,
    email: user.email,
    created_at: user.created_at,
    email_confirmed_at: user.email_confirmed_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
  },
  profile: (await rows('users', 'id', user.id))[0] ?? null,
};
for (const t of USER_TABLES) data[t] = await rows(t, 'user_id', user.id);
for (const c of CHILD_TABLES) {
  const ids = data[c.parent].map(r => r.id);
  data[c.table] = ids.length ? await rows(c.table, c.key, ids) : [];
}

const folder = join(homedir(), 'macrotri-exports', `${data.exported_at.slice(0, 10)}-${user.id}`);
mkdirSync(join(folder, 'photos'), { recursive: true });

// Meal photos: meal-photos/<account id>/ (flat folder).
const bucket = admin.storage.from('meal-photos');
const photos = [];
for (let offset = 0; ; offset += 1000) {
  const { data: files, error } = await bucket.list(user.id, { limit: 1000, offset });
  if (error) throw new Error(`photos: ${error.message}`);
  for (const f of files) {
    const { data: blob, error: dlErr } = await bucket.download(`${user.id}/${f.name}`);
    if (dlErr) throw new Error(`photo ${f.name}: ${dlErr.message}`);
    writeFileSync(join(folder, 'photos', f.name), Buffer.from(await blob.arrayBuffer()));
    photos.push(f.name);
  }
  if (files.length === 0) break;
}
data.meal_photos = photos;

writeFileSync(join(folder, 'data.json'), JSON.stringify(data, null, 2));
const counts = Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k}: ${v.length}`);
console.log(`Exported ${user.email} to ${folder}`);
console.log(counts.join(' · '));
console.log('Zip the folder, send it to the person, then delete your copy.');
