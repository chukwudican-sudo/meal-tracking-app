// Unit conversion helpers. The store keeps ALL internal values in metric
// (cm / kg) and in "cups" for water; these helpers convert only at the
// boundaries: for display (based on profile.weightUnit) and when mapping to
// Supabase (which we always write in metric so the data is unit-consistent).

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const ML_PER_CUP = 250; // matches Home tab (ML_PER_CUP) convention
const ML_PER_L = 1000;

export function kgToLbs(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbsToKg(lbs: number): number {
  return lbs * KG_PER_LB;
}

export function cmToInches(cm: number): number {
  return cm / CM_PER_IN;
}

export function inchesToCm(inches: number): number {
  return inches * CM_PER_IN;
}

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = Math.round(cmToInches(cm));
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

export function cupsToLiters(cups: number): number {
  return (cups * ML_PER_CUP) / ML_PER_L;
}

export function litersToCups(liters: number): number {
  return (liters * ML_PER_L) / ML_PER_CUP;
}

// Round a metric weight to the display unit with 1 decimal place.
export function displayWeight(kg: number, unit: 'kg' | 'lbs'): number {
  const value = unit === 'kg' ? kg : kgToLbs(kg);
  return Math.round(value * 10) / 10;
}
