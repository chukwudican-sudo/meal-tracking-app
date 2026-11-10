-- Permission to use AI features (Nov 10, 2026).
--
-- Apple guideline 5.1.2(i) (Nov 2025): an app must say plainly when personal
-- data goes to a third-party AI and get explicit permission first. Macrotri's
-- AI runs on Google Gemini, so the app asks once before the first AI request
-- and keeps the answer on the profile, synced like the other settings.
--   ai_consent    true = allowed, false = turned off, null = never asked /
--                 written by an older build (the phone keeps its own value)
--   ai_consent_at when the current answer was given (record of consent)
alter table public.users add column if not exists ai_consent boolean;
alter table public.users add column if not exists ai_consent_at timestamptz;
