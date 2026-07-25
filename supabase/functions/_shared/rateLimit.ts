// Shared per-user, per-function rate limiting via ai_usage_log. Each AI edge
// function picks its own `functionName` (matching its own name) and limit.

import type { AdminClient } from './auth.ts';

export async function isRateLimited(
  admin: AdminClient,
  userId: string,
  functionName: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await admin
    .from('ai_usage_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('function_name', functionName)
    .gte('called_at', windowStart);

  if (error) throw new Error(`Rate limit check failed: ${error.message}`);
  return (count ?? 0) >= limit;
}

// Only call this after a successful AI call — logging on failure would burn
// the user's quota for something that never actually gave them a result.
// Best-effort: a logging hiccup must never fail an otherwise-successful call.
export async function logAiUsage(admin: AdminClient, userId: string, functionName: string): Promise<void> {
  const { error } = await admin.from('ai_usage_log').insert({ user_id: userId, function_name: functionName });
  if (error) console.error(`[${functionName}] usage log insert failed:`, error);
}
