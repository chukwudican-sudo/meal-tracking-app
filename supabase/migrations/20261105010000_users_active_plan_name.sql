-- Which plan is active, by name (Nov 5, 2026).
--
-- Plans the user built or customized sync as `plans` rows with is_active, but
-- an Explore (premade) plan is read-only app content and never synced, so a
-- reinstall lost which one was running (Home came back empty). The app now
-- writes profile.activePlanName here with the rest of the profile; on a full
-- pull it is used when no synced plan row is active, and the premade plan is
-- rebuilt from the app's own catalog.

-- No length check: a rejected value would block every profile upload; the
-- client trims and caps it instead.
alter table public.users add column if not exists active_plan_name text;
