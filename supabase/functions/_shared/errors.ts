// Shared error contract for edge functions (originally AI-only, now also used
// by non-AI functions like delete-account since the same { code, message }
// shape works generically). Every function returns `{ error: { code,
// message } }` on failure so the client can branch on `code` (e.g.
// not_premium -> paywall, rate_limited -> "try again later") instead of
// matching on message text.

import { corsHeaders } from './cors.ts';

export type AIErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'not_premium'
  | 'rate_limited'
  | 'ai_failed'
  | 'server_error';

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(code: AIErrorCode, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}
