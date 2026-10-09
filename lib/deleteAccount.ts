// Client-side call to the delete-account edge function. Not part of
// ai/aiEdgeClient.ts — that file is explicitly scoped to AI features — but
// mirrors the same { error: { code, message } } contract used everywhere
// else (see supabase/functions/_shared/errors.ts) since the edge function
// composes from the same shared/ helpers.

import { supabase } from '@/lib/supabase';

// Generous but bounded — this hits the Supabase Auth Admin API, not Gemini,
// so it should be fast; this is just a backstop against a hung request.
const DELETE_ACCOUNT_TIMEOUT_MS = 15000;

/**
 * Permanently deletes the calling user's account (and, via existing DB
 * cascades, everything tied to it). Returns `{ error: null }` on success, or
 * `{ error: <message> }` on failure — nothing destructive has happened
 * locally if this returns an error, so callers can safely just show the
 * message and let the user retry.
 */
export async function deleteAccountRequest(): Promise<{ error: string | null }> {
  const { data, error } = await supabase.functions.invoke('delete-account', {
    timeout: DELETE_ACCOUNT_TIMEOUT_MS,
  });

  if (error) {
    const ctx = (error as { context?: Response })?.context;
    if (ctx && typeof ctx.text === 'function') {
      try {
        const raw = await ctx.text();
        const body = raw ? JSON.parse(raw) : null;
        const message = body?.error?.message as string | undefined;
        if (message) return { error: message };
      } catch (parseErr) {
        console.warn('[deleteAccount] non-JSON error body:', parseErr);
      }
    }
    const msg = (error as { message?: string })?.message ?? 'Something went wrong.';
    return { error: msg };
  }

  if (!data?.success) return { error: 'Something went wrong. Please try again.' };
  return { error: null };
}
