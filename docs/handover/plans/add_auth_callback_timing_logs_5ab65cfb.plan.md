---
name: Add Auth Callback Timing Logs
overview: Add timestamped console logs to pinpoint whether the 2-minute stall on the email-confirmation screen happens before `url` resolves or inside the code-exchange call itself.
todos:
  - id: log-callback-effect
    content: Add timestamped log at top of app/auth/callback.tsx's useEffect
    status: completed
  - id: log-exchange-fn
    content: Add timestamped start/end logs around exchangeCodeFromUrl's logic in lib/auth.tsx
    status: completed
isProject: false
---

## Changes

### `app/auth/callback.tsx` — log at the very top of the effect

```ts
useEffect(() => {
  console.info(`[auth/callback] effect fired at ${new Date().toISOString()}, url=`, url);
  if (!url) return;
  ...
```

Since this effect re-runs every time `url` changes (including the initial `null`), this single line shows both: how long after mount `url` stays `null`, and the exact instant it finally resolves to a real deep link.

### `lib/auth.tsx` — log immediately before and after `exchangeCodeFromUrl` does its work

```ts
export async function exchangeCodeFromUrl(url: string): Promise<AuthResult> {
  console.info(`[exchangeCodeFromUrl] start ${new Date().toISOString()}`);
  const { queryParams } = Linking.parse(url);
  const code = typeof queryParams?.code === 'string' ? queryParams.code : null;
  if (!code) {
    console.info(`[exchangeCodeFromUrl] end ${new Date().toISOString()} — no code param`);
    return { error: 'This link is missing its auth code or has expired.' };
  }
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  console.info(`[exchangeCodeFromUrl] end ${new Date().toISOString()} — exchangeCodeForSession error=`, error?.message ?? null);
  return { error: error ? error.message : null };
}
```

Both the early-return (no code) and the network-call path get their own "end" log, so the Metro output will show unambiguously:
- The gap between mount and `url` resolving (from the `app/auth/callback.tsx` log firing more than once).
- Whether the "no code param" branch or the `exchangeCodeForSession` network branch is what actually ran, and how long the network branch itself took if it's that one.

## Todos
