// Records each AI request outcome in public.ai_events for quality analysis
// (see the ai_events migration). Never blocks or fails the user's request: the
// insert runs in the background and errors are only logged.

import type { AdminClient } from './auth.ts';

export interface AiEvent {
  userId: string;
  functionName: string;
  promptVersion: string;
  flowId?: string | null;
  success: boolean;
  errorCode?: string | null;
  startedAt: number; // Date.now() when the AI call started
  input?: unknown;
  output?: unknown;
}

const MAX_FLOW_ID_LEN = 64;

// Client-sent flow ids are untrusted: accept only a short plain string.
export function sanitizeFlowId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw.slice(0, MAX_FLOW_ID_LEN) : null;
}

export function recordAiEvent(admin: AdminClient, e: AiEvent): void {
  const insert = admin
    .from('ai_events')
    .insert({
      user_id: e.userId,
      function_name: e.functionName,
      prompt_version: e.promptVersion,
      flow_id: e.flowId ?? null,
      success: e.success,
      error_code: e.errorCode ?? null,
      latency_ms: Math.max(0, Math.round(Date.now() - e.startedAt)),
      input: e.input ?? null,
      output: e.output ?? null,
    })
    .then(({ error }) => {
      if (error) console.error(`[${e.functionName}] ai_events insert failed:`, error);
    });

  // Keep the isolate alive for the insert after the response is sent, where the
  // edge runtime supports it; otherwise it simply runs fire-and-forget.
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(insert);
}
