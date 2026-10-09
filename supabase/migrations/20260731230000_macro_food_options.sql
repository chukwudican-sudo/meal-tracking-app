-- Build My Plan macro food options: the protein/carb/fat picker lists.
--
-- These replace the hardcoded PROTEIN_OPTIONS/CARB_OPTIONS/FAT_OPTIONS arrays
-- that used to live in app/plan/build.tsx. Seeded once from a USDA FoodData
-- Central import (scripts/import-macro-foods.ts) and editable afterwards
-- through the Supabase Table Editor without shipping an app update.
--
-- Reference/lookup data (no user_id): world-readable by any authenticated user,
-- admin-only writes — same pattern as premade_recipe_access. Three separate
-- tables (one per macro group) so each is trivially browsable/editable on its
-- own in the Table Editor. Names only; no nutrition data is stored, since the
-- picker just needs labels.
--
-- The case-insensitive unique index on name makes the import idempotent
-- (re-running upserts on conflict rather than duplicating rows).

-- ─── macro_proteins ──────────────────────────────────────────────────────────
create table public.macro_proteins (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create unique index macro_proteins_name_lower_idx on public.macro_proteins (lower(name));

alter table public.macro_proteins enable row level security;

create policy macro_proteins_select on public.macro_proteins
  for select to authenticated using (true);

create policy macro_proteins_admin_all on public.macro_proteins
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─── macro_carbs ─────────────────────────────────────────────────────────────
create table public.macro_carbs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create unique index macro_carbs_name_lower_idx on public.macro_carbs (lower(name));

alter table public.macro_carbs enable row level security;

create policy macro_carbs_select on public.macro_carbs
  for select to authenticated using (true);

create policy macro_carbs_admin_all on public.macro_carbs
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─── macro_fats ──────────────────────────────────────────────────────────────
create table public.macro_fats (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create unique index macro_fats_name_lower_idx on public.macro_fats (lower(name));

alter table public.macro_fats enable row level security;

create policy macro_fats_select on public.macro_fats
  for select to authenticated using (true);

create policy macro_fats_admin_all on public.macro_fats
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
