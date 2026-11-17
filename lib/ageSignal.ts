// Apple's age range signal (Nov 2026). Macrotri is 18+: the birthday wheel
// stops at 18 years ago, and US laws (Texas since June 2026, California
// AB 1043 from Jan 1 2027) also require apps to request the age signal from
// the App Store / OS when the app is downloaded and launched. If it says the
// person is under 18, the app is blocked (the signal counts as actual
// knowledge of age).
//
// Asked once per install, and only where it's needed: Apple's own check says
// age assurance is required (iOS 26.2+), or — when that can't be checked —
// the App Store account is a US one. Canadians never see Apple's sheet.
// Declined = no signal (the birthday wheel stays the age check) and it isn't
// asked again on this install, like Apple's own once-per-app design.
// Nothing about the age is sent anywhere; only this install's outcome
// ('checked' or 'minor') is kept on the phone so the question isn't repeated.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { AgeSignal } from '@/modules/age-signal';

export const MINIMUM_AGE = 18;

const STORAGE_KEY = 'ageSignal:v1';
type Outcome = 'checked' | 'minor';

let inFlight: Promise<boolean> | null = null;

async function readOutcome(): Promise<Outcome | null> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    return v === 'checked' || v === 'minor' ? v : null;
  } catch {
    return null;
  }
}

type AgeSignalModule = NonNullable<typeof AgeSignal>;

async function shouldAsk(mod: AgeSignalModule): Promise<boolean> {
  const eligible = await mod.isEligibleForAgeFeaturesAsync().catch(() => null);
  if (eligible !== null) return eligible;
  const country = await mod.getStorefrontCountryAsync().catch(() => null);
  return country === 'USA';
}

// Resolves true if this install must be blocked (Apple says under 18).
export function checkAgeSignal(): Promise<boolean> {
  // No native module (an older build, or not iOS): nothing to ask, and nothing
  // saved, so a later build with the module still checks this install.
  const mod = AgeSignal;
  if (Platform.OS !== 'ios' || !mod) return Promise.resolve(false);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (__DEV__) {
      // Diagnostic (development builds only): why the app does / doesn't ask.
      const [eligible, country] = await Promise.all([
        mod.isEligibleForAgeFeaturesAsync().catch(e => `error: ${String(e)}`),
        mod.getStorefrontCountryAsync().catch(e => `error: ${String(e)}`),
      ]);
      console.info(`[ageSignal] eligible=${String(eligible)} storefront=${String(country)} saved=${String(await readOutcome())}`);
    }
    const previous = await readOutcome();
    if (previous) return previous === 'minor';
    if (!(await shouldAsk(mod))) {
      await AsyncStorage.setItem(STORAGE_KEY, 'checked').catch(() => {});
      return false;
    }
    const result = await mod.requestAgeRangeAsync(MINIMUM_AGE).catch(() => null);
    const minor = result?.status === 'sharing'
      && typeof result.upperBound === 'number'
      && result.upperBound < MINIMUM_AGE;
    // Unavailable (no Apple Account) / unsupported: silent, try again on a later
    // launch. Sharing or declined: done for this install.
    if (minor || result?.status === 'sharing' || result?.status === 'declined') {
      await AsyncStorage.setItem(STORAGE_KEY, minor ? 'minor' : 'checked').catch(() => {});
    }
    return minor;
  })();
  void inFlight.finally(() => { inFlight = null; });
  return inFlight;
}

// The latest date of birth the onboarding wheel allows (18 years ago today).
// On Feb 29 that day doesn't exist 18 years back: use Feb 28, never Mar 1.
export function latestAllowedBirthday(today = new Date()): Date {
  const d = new Date(today.getFullYear() - MINIMUM_AGE, today.getMonth(), today.getDate());
  return d.getMonth() === today.getMonth() ? d : new Date(d.getFullYear(), d.getMonth(), 0);
}
