// Send a message to every Macrotri user: it lands in the bell inbox and as a
// phone notification. Secrets come from .env (never committed).
//
// Development (default): EXPO_PUBLIC_SUPABASE_URL + ANNOUNCE_SECRET.
// Production (--prod): the Macrotri-Prod project + PROD_ANNOUNCE_SECRET. A real
// production send first checks the message (dry run, shows the device count)
// and only sends after you type "yes" — it reaches every real user.
//
//   node scripts/send-announcement.mjs --dry-run "Title" "Message"   # check only
//   node scripts/send-announcement.mjs "Title" "Message"             # really send
//   node scripts/send-announcement.mjs --force "Title" "Message"     # repeat an identical message
//   node scripts/send-announcement.mjs --prod "Title" "Message"      # production (asks first)

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

// Public address (it's in every app build); the secret stays in .env.
const PROD_URL = 'https://tmsydkqpskwcsrrbuqst.supabase.co';
const FLAGS = ['--dry-run', '--force', '--prod'];
const USAGE = 'Usage: node scripts/send-announcement.mjs [--prod] [--dry-run] [--force] "Title" "Message"';

function loadEnv() {
  const env = {};
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const args = process.argv.slice(2);
// A mistyped flag (--prd, -prod, or —prod from smart punctuation) must not
// become the title of a send, and a forgotten quote must not split the text.
const unknown = args.filter(a => /^[-\u2012-\u2015]/.test(a) && !FLAGS.includes(a));
if (unknown.length) {
  console.error(`Unknown option ${unknown.join(', ')}\n${USAGE}`);
  process.exit(1);
}
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const prod = args.includes('--prod');
const texts = args.filter(a => !FLAGS.includes(a));
if (texts.length !== 2 || !texts[0] || !texts[1]) {
  console.error(`Give exactly a title and a message, each in quotes.\n${USAGE}`);
  process.exit(1);
}
const [title, body] = texts;

const env = loadEnv();
const url = prod ? PROD_URL : env.EXPO_PUBLIC_SUPABASE_URL;
const secret = prod ? env.PROD_ANNOUNCE_SECRET : env.ANNOUNCE_SECRET;
if (!url || !secret) {
  console.error(prod
    ? 'Missing PROD_ANNOUNCE_SECRET in .env'
    : 'Missing EXPO_PUBLIC_SUPABASE_URL or ANNOUNCE_SECRET in .env');
  process.exit(1);
}
// Production only ever goes through --prod (dry run + typed yes), even if
// .env were pointed at the production project.
if (!prod && new URL(url).host === new URL(PROD_URL).host) {
  console.error('.env points at the production project: use --prod (it asks before sending).');
  process.exit(1);
}
console.log(prod ? 'Target: PRODUCTION (real users)' : `Target: development (${url})`);

async function call(asDryRun) {
  let res;
  try {
    res = await fetch(`${url}/functions/v1/send-announcement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ title, body, dry_run: asDryRun, force }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    console.error(
      `No answer from the server (${e.name === 'TimeoutError' ? 'timed out' : e.message}). ` +
      (asDryRun
        ? 'Nothing was sent.'
        : 'The message may still have been saved and sent: check the inbox before sending again ' +
          '(an identical re-send within 30 minutes is refused anyway).'),
    );
    process.exit(1);
  }
  const json = await res.json().catch(() => null);
  return { res, json };
}

if (prod && !dryRun) {
  if (!process.stdin.isTTY) {
    console.error('A production send needs you to confirm: run it in a terminal.');
    process.exit(1);
  }
  // Check first: wrong secret, bad text or a repeat stops here, before asking.
  const check = await call(true);
  if (!check.res.ok) {
    console.log(`HTTP ${check.res.status}`, JSON.stringify(check.json, null, 2));
    console.error('Check failed — nothing was sent.');
    process.exit(1);
  }
  // The text as the server will send it (it trims both).
  console.log(`\nTitle:   ${check.json?.title ?? title}\nMessage: ${check.json?.body ?? body}\n`);
  console.log(`This goes to ${check.json?.devices ?? '?'} device(s) and every user's bell inbox on PRODUCTION.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Ctrl+C / Ctrl+D (or the input closing) count as "no".
  const answer = await new Promise(resolve => {
    rl.once('close', () => resolve(''));
    rl.question('Type yes to send: ').then(resolve, () => resolve(''));
  });
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Cancelled — nothing was sent.');
    process.exit(1);
  }
}

const { res, json } = await call(dryRun);
console.log(`HTTP ${res.status}`, JSON.stringify(json, null, 2));
process.exit(res.ok ? 0 : 1);
