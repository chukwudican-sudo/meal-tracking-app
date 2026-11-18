// The one place for legal + support links (paywall, AI permission sheet,
// Settings). Pages on macrotri.com (GitHub Pages): these paths must exist and
// load publicly before any release build (Apple 3.1.2 / 5.1.1: links must work).
export const TERMS_URL = 'https://macrotri.com/terms';
export const PRIVACY_URL = 'https://macrotri.com/privacy';
// Washington's My Health My Data Act counts "a link within the app" (e.g. its
// settings) as part of the "homepage" that must link the consumer health data
// policy: Settings → Help and the onboarding consent screen show it.
export const HEALTH_DATA_URL = 'https://macrotri.com/health-data';

// Support inbox (Apple 1.5: a working way to contact you). Zoho Mail, Canada
// data center (Nov 17); read in the iPhone Mail app.
export const SUPPORT_EMAIL = 'support@macrotri.com';

// Version of the health-data consent text the user agreed to (onboarding
// ConsentStep), saved with the date on the profile. Bump it when that text or
// what the Privacy Policy says about health data changes materially.
export const HEALTH_CONSENT_VERSION = '2026-11-17';
