-- ============================================================================
-- Meal app — core schema
-- ----------------------------------------------------------------------------
-- All tables key off the authenticated user's Supabase Auth UID. All timestamps
-- are timestamptz (stored UTC). Row Level Security policies live in the next
-- migration (…_rls.sql); this file only creates structure + supporting
-- functions/triggers.
-- ============================================================================

-- ─── Helper functions ───────────────────────────────────────────────────────

-- Keep updated_at fresh on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- True when the caller's JWT carries app_metadata.is_admin = true. Set this on
-- your account in the Supabase dashboard (Auth → Users → your user →
-- app_metadata: {"is_admin": true}). Returns false for anon/service-role JWTs.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false);
$$;

-- ─── users ───────────────────────────────────────────────────────────────────
-- Core profile. PK equals the Supabase Auth UID.
create table public.users (
  id                             uuid primary key references auth.users (id) on delete cascade,
  email                          text,
  first_name                     text,
  gender                         text check (gender in ('male', 'female', 'other')),
  birthday                       date,
  age                            integer,
  height_value                   numeric,
  height_unit                    text check (height_unit in ('cm', 'ft', 'ft_in', 'in')),
  current_weight_value           numeric,
  current_weight_unit            text check (current_weight_unit in ('lbs', 'kg', 'st')),
  target_weight_value            numeric,
  target_weight_unit             text check (target_weight_unit in ('lbs', 'kg', 'st')),
  goal_type                      text check (goal_type in ('lose_weight', 'maintain', 'gain_muscle', 'lean_bulk')),
  activity_level                 text check (activity_level in ('sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extra_active')),
  pace_value                     numeric,
  dietary_preferences            text[] not null default '{}',
  allergies                      text[] not null default '{}',
  secondary_nutrient_priorities  text[] not null default '{}',
  daily_calorie_target           integer,
  protein_target_grams           integer,
  carbs_target_grams             integer,
  fats_target_grams              integer,
  water_target_liters            numeric,
  goal_date                      date,
  notification_permission        boolean not null default false,
  free_scans_remaining           integer not null default 5,
  subscription_status            text not null default 'free'
                                   check (subscription_status in ('free', 'trial', 'active', 'expired', 'cancelled')),
  subscription_provider          text check (subscription_provider in ('apple', 'google', 'stripe', 'revenuecat')),
  subscription_expiry_date       timestamptz,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- Auto-create a minimal profile row when a new auth user signs up. This lets
-- the rest of the profile be filled in later (verification can lag signup, so
-- the client can't INSERT this row itself until a session exists).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Protect server-authoritative columns from client tampering. Authenticated
-- users may UPDATE their own row (RLS), but must not be able to grant
-- themselves scans or a subscription. Admins and privileged (service-role /
-- dashboard, where auth.uid() is null) callers are exempt.
create or replace function public.protect_user_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.free_scans_remaining     := old.free_scans_remaining;
    new.subscription_status      := old.subscription_status;
    new.subscription_provider    := old.subscription_provider;
    new.subscription_expiry_date := old.subscription_expiry_date;
  end if;
  return new;
end;
$$;

create trigger users_protect_columns
  before update on public.users
  for each row execute function public.protect_user_columns();

-- ─── plans ─────────────────────────────────────────────────────────────────
create table public.plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- At most one active plan per user.
create unique index plans_one_active_per_user
  on public.plans (user_id)
  where is_active;

create index plans_user_id_idx on public.plans (user_id);

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- ─── plan_slots ──────────────────────────────────────────────────────────────
create table public.plan_slots (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans (id) on delete cascade,
  slot_name   text not null,
  slot_time   text,
  is_custom   boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index plan_slots_plan_id_idx on public.plan_slots (plan_id);

-- ─── recipes ─────────────────────────────────────────────────────────────────
-- user_id null + is_premade true → a premade template (readable by everyone,
-- writable only by admin). Otherwise owned by user_id.
create table public.recipes (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users (id) on delete cascade,
  name               text not null,
  calories           numeric,
  protein_grams      numeric,
  carbs_grams        numeric,
  fats_grams         numeric,
  cook_time_minutes  integer,
  difficulty         text check (difficulty in ('Easy', 'Medium', 'Hard')),
  meal_type          text check (meal_type in ('Breakfast', 'Lunch', 'Dinner', 'Snacks')),
  image_url          text,
  is_premade         boolean not null default false,
  source             text check (source in ('premade', 'ai', 'manual')),
  has_full_recipe    boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- A premade recipe has no owner; a user recipe must have one.
  constraint recipes_premade_ownership check (
    (is_premade and user_id is null) or (not is_premade and user_id is not null)
  )
);

create index recipes_user_id_idx on public.recipes (user_id);
create index recipes_is_premade_idx on public.recipes (is_premade);

create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

-- ─── plan_day_meals ────────────────────────────────────────────────────────
create table public.plan_day_meals (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.plans (id) on delete cascade,
  plan_slot_id     uuid not null references public.plan_slots (id) on delete cascade,
  day_of_week      integer not null check (day_of_week between 0 and 6),
  recipe_id        uuid references public.recipes (id) on delete set null,
  is_day_override  boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index plan_day_meals_plan_id_idx on public.plan_day_meals (plan_id);
create index plan_day_meals_slot_id_idx on public.plan_day_meals (plan_slot_id);

create trigger plan_day_meals_set_updated_at
  before update on public.plan_day_meals
  for each row execute function public.set_updated_at();

-- ─── recipe_ingredients ──────────────────────────────────────────────────────
create table public.recipe_ingredients (
  id               uuid primary key default gen_random_uuid(),
  recipe_id        uuid not null references public.recipes (id) on delete cascade,
  ingredient_name  text not null,
  quantity         numeric,
  unit             text,
  calories         numeric,
  protein_grams    numeric,
  carbs_grams      numeric,
  fats_grams       numeric,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);

create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id);

-- ─── recipe_steps ────────────────────────────────────────────────────────────
create table public.recipe_steps (
  id                uuid primary key default gen_random_uuid(),
  recipe_id         uuid not null references public.recipes (id) on delete cascade,
  step_number       integer not null,
  instruction_text  text not null,
  created_at        timestamptz not null default now()
);

create index recipe_steps_recipe_id_idx on public.recipe_steps (recipe_id);

-- ─── saved_recipes ───────────────────────────────────────────────────────────
create table public.saved_recipes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  recipe_id      uuid not null references public.recipes (id) on delete cascade,
  is_bookmarked  boolean not null default false,
  saved_at       timestamptz not null default now(),
  unique (user_id, recipe_id)
);

create index saved_recipes_user_id_idx on public.saved_recipes (user_id);

-- ─── meal_logs ───────────────────────────────────────────────────────────────
create table public.meal_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  recipe_id      uuid references public.recipes (id) on delete set null,
  date           date not null,
  time           text,
  slot_name      text,
  meal_name      text not null,
  calories       numeric,
  protein_grams  numeric,
  carbs_grams    numeric,
  fats_grams     numeric,
  servings       numeric not null default 1,
  is_completed   boolean not null default false,
  is_ad_hoc      boolean not null default false,
  image_url      text,
  health_rating  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index meal_logs_user_id_date_idx on public.meal_logs (user_id, date);

create trigger meal_logs_set_updated_at
  before update on public.meal_logs
  for each row execute function public.set_updated_at();

-- ─── meal_log_ingredients ────────────────────────────────────────────────────
create table public.meal_log_ingredients (
  id               uuid primary key default gen_random_uuid(),
  meal_log_id      uuid not null references public.meal_logs (id) on delete cascade,
  ingredient_name  text not null,
  quantity         numeric,
  unit             text,
  calories         numeric,
  protein_grams    numeric,
  carbs_grams      numeric,
  fats_grams       numeric,
  sort_order       integer not null default 0
);

create index meal_log_ingredients_meal_log_id_idx on public.meal_log_ingredients (meal_log_id);

-- ─── kitchen_items ───────────────────────────────────────────────────────────
create table public.kitchen_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  ingredient_name  text not null,
  category         text,
  added_at         timestamptz not null default now()
);

create index kitchen_items_user_id_idx on public.kitchen_items (user_id);

-- ─── cart_items ──────────────────────────────────────────────────────────────
create table public.cart_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  ingredient_name  text not null,
  is_bought        boolean not null default false,
  added_at         timestamptz not null default now()
);

create index cart_items_user_id_idx on public.cart_items (user_id);

-- ─── planned_ingredients ─────────────────────────────────────────────────────
create table public.planned_ingredients (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  plan_id          uuid references public.plans (id) on delete cascade,
  ingredient_name  text not null,
  category         text,
  status           text not null default 'planned'
                     check (status in ('planned', 'kitchen', 'cart', 'none')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index planned_ingredients_user_id_idx on public.planned_ingredients (user_id);

create trigger planned_ingredients_set_updated_at
  before update on public.planned_ingredients
  for each row execute function public.set_updated_at();

-- ─── weight_logs ─────────────────────────────────────────────────────────────
create table public.weight_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  weight_value  numeric not null,
  weight_unit   text check (weight_unit in ('lbs', 'kg', 'st')),
  logged_at     timestamptz not null default now()
);

create index weight_logs_user_id_idx on public.weight_logs (user_id);

-- ─── progress_daily ──────────────────────────────────────────────────────────
create table public.progress_daily (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  date                  date not null,
  meals_completed       integer not null default 0,
  meals_total           integer not null default 0,
  completion_percentage numeric not null default 0,
  calories_consumed     numeric not null default 0,
  protein_consumed      numeric not null default 0,
  carbs_consumed        numeric not null default 0,
  fats_consumed         numeric not null default 0,
  water_consumed        numeric not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, date)
);

create trigger progress_daily_set_updated_at
  before update on public.progress_daily
  for each row execute function public.set_updated_at();

-- ─── premade_recipe_access ───────────────────────────────────────────────────
-- Flags which premade recipes are free (only ~5 have is_free = true). Managed
-- by admin; readable by all authenticated users.
create table public.premade_recipe_access (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references public.recipes (id) on delete cascade,
  is_free    boolean not null default false,
  unique (recipe_id)
);

-- ─── ai_usage_log ────────────────────────────────────────────────────────────
create table public.ai_usage_log (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  function_name  text not null,
  called_at      timestamptz not null default now()
);

create index ai_usage_log_user_id_idx on public.ai_usage_log (user_id);
