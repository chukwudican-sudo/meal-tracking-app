-- Phase 2 sync: incremental (delta) pull support.
-- The client pulls rows with updated_at > last-cursor instead of the whole
-- dataset on every login. That requires a maintained updated_at on every
-- delta-driving table, matching indexes for the filtered reads, and a
-- server-time source so the cursor is immune to device clock skew.

-- ─── updated_at on tables that only tracked a creation/log timestamp ──────────
-- set_updated_at() already exists (see the schema migration). Columns backfill
-- to now() for existing rows; the trigger keeps them fresh on every UPDATE.

alter table public.weight_logs   add column if not exists updated_at timestamptz not null default now();
alter table public.saved_recipes add column if not exists updated_at timestamptz not null default now();
alter table public.kitchen_items add column if not exists updated_at timestamptz not null default now();
alter table public.cart_items    add column if not exists updated_at timestamptz not null default now();

drop trigger if exists weight_logs_set_updated_at on public.weight_logs;
create trigger weight_logs_set_updated_at
  before update on public.weight_logs
  for each row execute function public.set_updated_at();

drop trigger if exists saved_recipes_set_updated_at on public.saved_recipes;
create trigger saved_recipes_set_updated_at
  before update on public.saved_recipes
  for each row execute function public.set_updated_at();

drop trigger if exists kitchen_items_set_updated_at on public.kitchen_items;
create trigger kitchen_items_set_updated_at
  before update on public.kitchen_items
  for each row execute function public.set_updated_at();

drop trigger if exists cart_items_set_updated_at on public.cart_items;
create trigger cart_items_set_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();

-- ─── Indexes for the filtered (updated_at > cursor) reads ─────────────────────
create index if not exists meal_logs_user_updated_idx           on public.meal_logs           (user_id, updated_at);
create index if not exists weight_logs_user_updated_idx         on public.weight_logs         (user_id, updated_at);
create index if not exists saved_recipes_user_updated_idx       on public.saved_recipes       (user_id, updated_at);
create index if not exists kitchen_items_user_updated_idx       on public.kitchen_items       (user_id, updated_at);
create index if not exists cart_items_user_updated_idx          on public.cart_items          (user_id, updated_at);
create index if not exists planned_ingredients_user_updated_idx on public.planned_ingredients (user_id, updated_at);
create index if not exists recipes_updated_idx                  on public.recipes             (updated_at);

-- ─── Skew-free cursor source ──────────────────────────────────────────────────
-- The client captures server_now() BEFORE a pull and stores it as the next
-- cursor only after the pull succeeds, so it never depends on the device clock.
create or replace function public.server_now()
returns timestamptz
language sql
stable
as $$
  select now();
$$;

grant execute on function public.server_now() to authenticated;
