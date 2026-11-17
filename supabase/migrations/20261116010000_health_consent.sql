-- Health-data consent (Nov 16, 2026).
--
-- Onboarding now asks for consent to use health information (weight, goals,
-- diet, allergies, meals) before the first health question — expected for
-- sensitive data in Canada (PIPEDA express consent), Quebec (Law 25),
-- Connecticut, Washington and Nevada. The profile keeps the record, synced
-- like ai_consent:
--   health_consent_at       when the user tapped "I agree"
--   health_consent_version  which version of the consent text they agreed to
--                           (constants/legal.ts HEALTH_CONSENT_VERSION)
-- Withdrawing consent = deleting the account (every row cascades).
-- public.users already grants select/insert/update to authenticated at table
-- level, so the new columns need no extra grant.
alter table public.users add column if not exists health_consent_at timestamptz;
alter table public.users add column if not exists health_consent_version text;
