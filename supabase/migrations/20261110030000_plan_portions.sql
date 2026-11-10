-- Plan portions + plan style sync (Nov 10, 2026).
--
-- Premade plans reach their calories with portions ("dinner: 1.5 servings"),
-- and a plan's calories/macros are worked out from its meals × portions. The
-- user's copies of plans (customized premade plans, Build My Plan) sync as
-- rows, so they need:
--   plan_day_meals.servings — the portion of that meal (null = 1)
--   plans.category          — the plan's style; a plan with one sets the
--                              user's goals to its numbers while running
--                              (built plans have none and keep the user's goals)
--   plans.description,      — kept so a synced copy reads like the original
--   plans.disclaimer           (e.g. Keto's "consult a clinician")
-- Nullable and unchecked against old builds' writes; the client validates.
alter table public.plan_day_meals add column if not exists servings numeric
  check (servings is null or (servings > 0 and servings <= 10));
alter table public.plans add column if not exists category text;
alter table public.plans add column if not exists description text;
alter table public.plans add column if not exists disclaimer text;
