// Send a message to every Macrotri user: it lands in the bell inbox and as a
// phone notification. Reads EXPO_PUBLIC_SUPABASE_URL and ANNOUNCE_SECRET from
// .env (never committed).
//
//   node scripts/send-announcement.mjs --dry-run "Title" "Message"   # check only
//   node scripts/send-announcement.mjs "Title" "Message"             # really send
//   node scripts/send-announcement.mjs --force "Title" "Message"     # repeat an identical message

import { readFileSync } from 'node:fs';

function loadEnv() {
  const env = {};
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const [title, body] = args.filter(a => a !== '--dry-run' && a !== '--force');
if (!title || !body) {
  console.error('Usage: node scripts/send-announcement.mjs [--dry-run] [--force] "Title" "Message"');
  process.exit(1);
}

const env = loadEnv();
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const secret = env.ANNOUNCE_SECRET;
if (!url || !secret) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or ANNOUNCE_SECRET in .env');
  process.exit(1);
}

let res;
try {
  res = await fetch(`${url}/functions/v1/send-announcement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ title, body, dry_run: dryRun, force }),
    signal: AbortSignal.timeout(120_000),
  });
} catch (e) {
  console.error(
    `No answer from the server (${e.name === 'TimeoutError' ? 'timed out' : e.message}). ` +
    'The message may still have been saved and sent: check the inbox before sending again ' +
    '(an identical re-send within 30 minutes is refused anyway).',
  );
  process.exit(1);
}
const json = await res.json().catch(() => null);
console.log(`HTTP ${res.status}`, JSON.stringify(json, null, 2));
process.exit(res.ok ? 0 : 1);
