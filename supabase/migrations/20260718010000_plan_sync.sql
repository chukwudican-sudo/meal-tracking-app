-- Phase 2 sync (plans): make plans / plan_slots / plan_day_meals syncable.
-- Local plan meals reference recipes by a loose id (premade slug, saved-recipe
-- uuid, an AI 'custom-*' id, or an '__empty__'/'__removed__' sentinel) and carry
-- a denormalized name. The normalized schema only has recipe_id (a real FK), so
-- we add recipe_name + recipe_ref to preserve those meals losslessly even when
-- recipe_id must be null. plan_slots also needs updated_at for delta pulls.

-- ─── plan_day_meals: preserve the local reference + name ──────────────────────
alter table public.plan_day_meals add column if not exists recipe_name text;
alter table public.plan_day_meals add column if not exists recipe_ref  text;

-- ─── plan_slots: add updated_at (+ trigger) so it can drive delta pulls ────────
-- plans and plan_day_meals already have updated_at + triggers from the schema
-- migration; plan_slots only tracked created_at.
alter table public.plan_slots add column if not exists updated_at timestamptz not null default now();

drop trigger if exists plan_slots_set_updated_at on public.plan_slots;
create trigger plan_slots_set_updated_at
  before update on public.plan_slots
  for each row execute function public.set_updated_at();

-- ─── Indexes for the filtered (updated_at > cursor) reads ─────────────────────
create index if not exists plans_user_updated_idx          on public.plans          (user_id, updated_at);
create index if not exists plan_slots_plan_updated_idx      on public.plan_slots     (plan_id, updated_at);
create index if not exists plan_day_meals_plan_updated_idx  on public.plan_day_meals (plan_id, updated_at);
