-- ============================================================================
-- Meal app — Row Level Security
-- ----------------------------------------------------------------------------
-- RLS is enabled on EVERY table. Because the publishable key ships in the
-- client bundle, these policies are the only thing preventing one user from
-- reading/writing another user's data.
--
-- Conventions:
--   * Owner tables gate directly on user_id = auth.uid() (users gates on id).
--   * Child tables (no user_id) gate via their parent row's ownership.
--   * Premade recipes (is_premade + user_id null) are world-readable to
--     authenticated users; only admins can write them.
--   * public.is_admin() reads app_metadata.is_admin from the JWT.
-- ============================================================================

-- ─── users ───────────────────────────────────────────────────────────────────
alter table public.users enable row level security;

create policy users_select_own on public.users
  for select to authenticated using (id = auth.uid());
create policy users_insert_own on public.users
  for insert to authenticated with check (id = auth.uid());
create policy users_update_own on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy users_delete_own on public.users
  for delete to authenticated using (id = auth.uid());

-- ─── plans ─────────────────────────────────────────────────────────────────
alter table public.plans enable row level security;

create policy plans_all_own on public.plans
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── plan_slots (via parent plan) ────────────────────────────────────────────
alter table public.plan_slots enable row level security;

create policy plan_slots_all_via_plan on public.plan_slots
  for all to authenticated
  using (exists (
    select 1 from public.plans p
    where p.id = plan_slots.plan_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.plans p
    where p.id = plan_slots.plan_id and p.user_id = auth.uid()
  ));

-- ─── plan_day_meals (via parent plan) ────────────────────────────────────────
alter table public.plan_day_meals enable row level security;

create policy plan_day_meals_all_via_plan on public.plan_day_meals
  for all to authenticated
  using (exists (
    select 1 from public.plans p
    where p.id = plan_day_meals.plan_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.plans p
    where p.id = plan_day_meals.plan_id and p.user_id = auth.uid()
  ));

-- ─── recipes ─────────────────────────────────────────────────────────────────
-- Premade templates: readable by all authenticated users, writable only by
-- admin. User recipes: fully managed by their owner.
alter table public.recipes enable row level security;

create policy recipes_select on public.recipes
  for select to authenticated
  using ((is_premade and user_id is null) or user_id = auth.uid());

create policy recipes_insert_own on public.recipes
  for insert to authenticated
  with check (user_id = auth.uid() and not is_premade);

create policy recipes_update_own on public.recipes
  for update to authenticated
  using (user_id = auth.uid() and not is_premade)
  with check (user_id = auth.uid() and not is_premade);

create policy recipes_delete_own on public.recipes
  for delete to authenticated
  using (user_id = auth.uid() and not is_premade);

-- Admins can do anything (this is what makes premade content manageable).
create policy recipes_admin_all on public.recipes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─── recipe_ingredients (via parent recipe) ──────────────────────────────────
alter table public.recipe_ingredients enable row level security;

create policy recipe_ingredients_select on public.recipe_ingredients
  for select to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_ingredients.recipe_id
      and ((r.is_premade and r.user_id is null) or r.user_id = auth.uid())
  ));

create policy recipe_ingredients_write_own on public.recipe_ingredients
  for all to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_ingredients.recipe_id and r.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.recipes r
    where r.id = recipe_ingredients.recipe_id and r.user_id = auth.uid()
  ));

create policy recipe_ingredients_admin_all on public.recipe_ingredients
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─── recipe_steps (via parent recipe) ────────────────────────────────────────
alter table public.recipe_steps enable row level security;

create policy recipe_steps_select on public.recipe_steps
  for select to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_steps.recipe_id
      and ((r.is_premade and r.user_id is null) or r.user_id = auth.uid())
  ));

create policy recipe_steps_write_own on public.recipe_steps
  for all to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_steps.recipe_id and r.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.recipes r
    where r.id = recipe_steps.recipe_id and r.user_id = auth.uid()
  ));

create policy recipe_steps_admin_all on public.recipe_steps
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─── saved_recipes ───────────────────────────────────────────────────────────
alter table public.saved_recipes enable row level security;

create policy saved_recipes_all_own on public.saved_recipes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── meal_logs ───────────────────────────────────────────────────────────────
alter table public.meal_logs enable row level security;

create policy meal_logs_all_own on public.meal_logs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── meal_log_ingredients (via parent meal_log) ──────────────────────────────
alter table public.meal_log_ingredients enable row level security;

create policy meal_log_ingredients_all_via_log on public.meal_log_ingredients
  for all to authenticated
  using (exists (
    select 1 from public.meal_logs m
    where m.id = meal_log_ingredients.meal_log_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.meal_logs m
    where m.id = meal_log_ingredients.meal_log_id and m.user_id = auth.uid()
  ));

-- ─── kitchen_items ───────────────────────────────────────────────────────────
alter table public.kitchen_items enable row level security;

create policy kitchen_items_all_own on public.kitchen_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── cart_items ──────────────────────────────────────────────────────────────
alter table public.cart_items enable row level security;

create policy cart_items_all_own on public.cart_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── planned_ingredients ─────────────────────────────────────────────────────
alter table public.planned_ingredients enable row level security;

create policy planned_ingredients_all_own on public.planned_ingredients
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── weight_logs ─────────────────────────────────────────────────────────────
alter table public.weight_logs enable row level security;

create policy weight_logs_all_own on public.weight_logs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── progress_daily ──────────────────────────────────────────────────────────
alter table public.progress_daily enable row level security;

create policy progress_daily_all_own on public.progress_daily
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── premade_recipe_access ───────────────────────────────────────────────────
-- All authenticated users can read which premade recipes are free; only admins
-- can change it.
alter table public.premade_recipe_access enable row level security;

create policy premade_recipe_access_select on public.premade_recipe_access
  for select to authenticated using (true);

create policy premade_recipe_access_admin_all on public.premade_recipe_access
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─── ai_usage_log ────────────────────────────────────────────────────────────
-- Users may INSERT and SELECT their own rows only (no update/delete).
alter table public.ai_usage_log enable row level security;

create policy ai_usage_log_select_own on public.ai_usage_log
  for select to authenticated using (user_id = auth.uid());

create policy ai_usage_log_insert_own on public.ai_usage_log
  for insert to authenticated with check (user_id = auth.uid());
