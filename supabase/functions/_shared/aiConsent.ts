// Apple 5.1.2(i): a user's data goes to Google Gemini only after they said yes
// in the app's AI permission sheet (or Settings → Privacy & AI). The app asks
// before every first use and saves the answer on the account straight away
// (users.ai_consent, lib/aiConsent.ts); every AI function also refuses here, so
// an old or modified app can't skip it (Nov 19). Read with the profile — the
// select must include `ai_consent`.

import { errorResponse } from './errors.ts';

export const AI_CONSENT_MESSAGE = 'AI features are off. You can turn them on in Settings → Privacy & AI.';

export function aiConsentGiven(profileRow: unknown): boolean {
  return !!profileRow && typeof profileRow === 'object'
    && (profileRow as { ai_consent?: unknown }).ai_consent === true;
}

export function consentRequiredResponse(): Response {
  return errorResponse('consent_required', AI_CONSENT_MESSAGE, 403);
}
