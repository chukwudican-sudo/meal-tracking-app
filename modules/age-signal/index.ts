// JS side of the local native module (modules/age-signal/ios). Optional:
// older dev builds and Android don't have it, and callers treat that as
// "no signal".
import { requireOptionalNativeModule } from 'expo';

export interface AgeSignalResult {
  status: 'sharing' | 'declined' | 'unavailable' | 'unsupported';
  lowerBound?: number | null;
  upperBound?: number | null;
}

interface AgeSignalModule {
  requestAgeRangeAsync(threshold: number): Promise<AgeSignalResult>;
  isEligibleForAgeFeaturesAsync(): Promise<boolean | null>;
  getStorefrontCountryAsync(): Promise<string | null>;
}

export const AgeSignal = requireOptionalNativeModule<AgeSignalModule>('AgeSignal');
