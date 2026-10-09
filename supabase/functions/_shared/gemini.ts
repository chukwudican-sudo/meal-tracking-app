// Shared Gemini structured-JSON call for AI edge functions: timeout + abort,
// a single scoped retry for transient upstream rejections, and consistent
// duration logging so incidents are diagnosable from the function's own logs.
//
// Retry policy (agreed 2026-07-21):
// - Retry exactly once, only for 503 (overloaded) / 429 (upstream rate
//   limited) — the clear "try again" signals. Other status codes (400/401/
//   500/502/etc.) fail immediately; retrying an ambiguous server error risks
//   masking a real request bug rather than a genuine transient blip.
// - Never retry after a timeout. A hang and an instant rejection are
//   different problems — retrying a hang would double the worst-case wait.

const DEFAULT_TIMEOUT_MS = 15000;
const RETRY_DELAY_MS = 500;
const RETRYABLE_STATUSES = new Set([429, 503]);

export class GeminiTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiTimeoutError';
  }
}

export class GeminiHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GeminiHttpError';
    this.status = status;
  }
}

export interface CallGeminiJSONOptions {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userText: string;
  responseSchema: Record<string, unknown>;
  temperature?: number;
  timeoutMs?: number;
  /** Log line prefix, e.g. '[estimate-nutrition]', so logs are attributable per function. */
  logPrefix: string;
  /**
   * Optional inline images (bare base64, no data: prefix) for vision requests.
   * One or more; each is sent as its own inlineData part, in order, before the
   * text prompt.
   */
  images?: { base64: string; mimeType: string }[];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function callGeminiJSON(opts: CallGeminiJSONOptions): Promise<unknown> {
  const {
    apiKey,
    model,
    systemInstruction,
    userText,
    responseSchema,
    temperature = 0.3,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    logPrefix,
    images,
  } = opts;

  // Images first, then text — per Gemini's guidance for image prompts. Each
  // image is its own inlineData part; a single-image caller just passes one.
  const parts: Array<Record<string, unknown>> = [];
  for (const img of images ?? []) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
  }
  parts.push({ text: userText });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const requestBody = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, responseMimeType: 'application/json', responseSchema },
  });

  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: requestBody,
        signal: controller.signal,
      });
      const ms = Date.now() - startedAt;

      if (!res.ok) {
        const detail = await res.text();
        console.error(`${logPrefix} Gemini HTTP ${res.status} after ${ms}ms (attempt ${attempt}):`, detail.slice(0, 500));
        const httpErr = new GeminiHttpError(res.status, `Gemini HTTP ${res.status}: ${detail.slice(0, 500)}`);

        if (RETRYABLE_STATUSES.has(res.status) && attempt === 1) {
          console.warn(`${logPrefix} transient Gemini ${res.status}, retrying once after ${RETRY_DELAY_MS}ms`);
          lastError = httpErr;
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw httpErr;
      }

      const data = await res.json();
      const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.error(`${logPrefix} Gemini returned no content after ${ms}ms`);
        throw new Error('Gemini returned no content');
      }

      console.info(`${logPrefix} Gemini call succeeded in ${ms}ms${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Gemini returned non-JSON: ${text.slice(0, 500)}`);
      }
    } catch (e) {
      const ms = Date.now() - startedAt;
      if (e instanceof Error && e.name === 'AbortError') {
        // Per policy: a timeout is never retried — retrying a hang would
        // double the worst-case wait instead of failing fast.
        console.error(`${logPrefix} Gemini call timed out after ${ms}ms (limit ${timeoutMs}ms)`);
        throw new GeminiTimeoutError(`Gemini request timed out after ${ms}ms`);
      }
      if (e instanceof GeminiHttpError || e instanceof GeminiTimeoutError) throw e;
      console.error(`${logPrefix} Gemini call error after ${ms}ms:`, e);
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error('Gemini call failed');
}
