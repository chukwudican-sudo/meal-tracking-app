// Client wrapper for the `scan-kitchen` edge function (multi-photo AI scan).
//
// Sends 1–4 captured photos (inline base64) to Supabase, which holds the Gemini
// key server-side, enforces the entitlement gate + rate limit, and returns the
// distinct ingredients visible with an auto-assigned category. Invoke/timeout/
// error-parsing plumbing is shared via ./aiEdgeClient.

import type { IngredientCategory } from '@/store/types';
import { AIError, type AIErrorCode, invokeAIFunction } from './aiEdgeClient';

export type ScanKitchenErrorCode = AIErrorCode;

// Typed error so the UI can branch (not_premium -> paywall, rate_limited ->
// toast, etc.), consistent with ScanError/EstimateError/FixError.
export class ScanKitchenError extends AIError {
  constructor(code: ScanKitchenErrorCode, message: string) {
    super(code, message);
    this.name = 'ScanKitchenError';
  }
}

export interface ScannedIngredient {
  name: string;
  category: IngredientCategory;
}

export interface KitchenScanPhoto {
  base64: string;
  mimeType: string;
}

// Must stay in sync with the IngredientCategory union in store/types.ts.
const VALID_CATEGORIES = new Set<IngredientCategory>([
  'Proteins',
  'Carbs & Grains',
  'Fruits & Vegetables',
  'Dairy',
  'Oils & Fats',
  'Spices & Seasonings',
  'Condiments',
  'Other',
]);

function toCategory(raw: unknown): IngredientCategory {
  return typeof raw === 'string' && VALID_CATEGORIES.has(raw as IngredientCategory)
    ? (raw as IngredientCategory)
    : 'Other';
}

// Strip a `data:<mime>;base64,` prefix if present, leaving the bare base64 the
// edge function expects.
function stripDataUriPrefix(input: string): string {
  const comma = input.indexOf('base64,');
  return comma >= 0 ? input.slice(comma + 'base64,'.length) : input;
}

// Map the wire shape { ingredients: [{ name, category }] } into a clean,
// deduped ScannedIngredient[]. Category is validated against the known set
// (defense in depth beyond the response-schema enum) and defaults to 'Other'.
function mapScannedIngredients(data: Record<string, unknown>): ScannedIngredient[] {
  const raw = Array.isArray(data.ingredients) ? data.ingredients : [];
  const seen = new Set<string>();
  const out: ScannedIngredient[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? '').trim().slice(0, 60);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, category: toCategory(o.category) });
  }
  return out;
}

export async function scanKitchen(photos: KitchenScanPhoto[]): Promise<ScannedIngredient[]> {
  const data = await invokeAIFunction(
    'scan-kitchen',
    { images: photos.map(p => ({ base64: stripDataUriPrefix(p.base64), mimeType: p.mimeType })) },
    {
      logPrefix: '[scanKitchen]',
      makeError: (code, message) => new ScanKitchenError(code, message),
      timeoutMessage: 'The AI scanner took too long to respond. Please try again.',
      notAvailableMessage: 'AI kitchen scanning is not available yet. Please try again later.',
    },
  );

  return mapScannedIngredients(data);
}
