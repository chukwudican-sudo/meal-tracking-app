import type { NutrientKey } from '@/store/types';

export interface NutrientMeta {
  key: NutrientKey;
  label: string;
  unit: 'g' | 'mg';
}

// Secondary nutrients the user can opt to track. Order here drives the
// Profile picker and the macro page-2 tile order.
export const NUTRIENT_META: NutrientMeta[] = [
  { key: 'fiber',        label: 'Fiber',         unit: 'g'  },
  { key: 'sugar',        label: 'Sugar',         unit: 'g'  },
  { key: 'sodium',       label: 'Sodium',        unit: 'mg' },
  { key: 'potassium',    label: 'Potassium',     unit: 'mg' },
  { key: 'cholesterol',  label: 'Cholesterol',   unit: 'mg' },
  { key: 'saturatedFat', label: 'Saturated Fat', unit: 'g'  },
  { key: 'iron',         label: 'Iron',          unit: 'mg' },
];

export const NUTRIENT_KEYS: NutrientKey[] = NUTRIENT_META.map(n => n.key);

const NUTRIENT_BY_KEY: Record<NutrientKey, NutrientMeta> = NUTRIENT_META.reduce(
  (acc, n) => { acc[n.key] = n; return acc; },
  {} as Record<NutrientKey, NutrientMeta>,
);

export function getNutrientMeta(key: NutrientKey): NutrientMeta {
  return NUTRIENT_BY_KEY[key];
}

// Default nutrients tracked for a fresh profile.
export const DEFAULT_TRACKED_NUTRIENTS: NutrientKey[] = ['fiber', 'sugar', 'sodium'];
