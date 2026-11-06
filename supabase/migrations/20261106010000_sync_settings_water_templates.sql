-- More of the user's data syncs (Nov 6, 2026): settings, daily water, their own
-- repeating meals / scheduled recipes, and secondary nutrients. Before this a
-- reinstall or second phone lost all of them.
--
-- Every new users column is nullable with no default: null means "never
-- written" and the app keeps its local value (a pull never wipes settings an
-- older build didn't upload). No length checks, like active_plan_name: a
-- rejected value would block every profile upload; the client validates.

-- ─── users: settings ─────────────────────────────────────────────────────────
alter table public.users add column if not exists last_name             text;
alter table public.users add column if not exists weight_unit           text;
alter table public.users add column if not exists meal_slots            jsonb;
alter table public.users add column if not exists meal_reminders_enabled boolean;
alter table public.users add column if not exists remind_minutes_before integer;
alter table public.users add column if not exists secondary_targets     jsonb;

-- ─── meal_logs: secondary nutrients (fiber, sugar, …) ────────────────────────
alter table public.meal_logs add column if not exists nutrients jsonb;

-- ─── progress_daily: water per day ───────────────────────────────────────────
-- The table has existed since July (unique per user+date, RLS own rows) but
-- was never written. Only water_consumed (ml) is used; the other totals stay
-- at their defaults — the app works them out from meal_logs.
create index if not exists progress_daily_user_updated_idx
  on public.progress_daily (user_id, updated_at);

-- ─── meal_templates: the user's own repeating meals + scheduled recipes ──────
-- Plan templates are never stored: a plan rebuilds its own. Template ids are
-- app strings (`tpl-<ts>`, `tpl-rcp-…`), not UUIDs, so the key is
-- (user_id, id). The whole template is one jsonb document.
create table if not exists public.meal_templates (
  user_id     uuid not null references auth.users (id) on delete cascade,
  id          text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists meal_templates_user_updated_idx
  on public.meal_templates (user_id, updated_at);

drop trigger if exists meal_templates_set_updated_at on public.meal_templates;
create trigger meal_templates_set_updated_at
  before update on public.meal_templates
  for each row execute function public.set_updated_at();

alter table public.meal_templates enable row level security;

drop policy if exists meal_templates_all_own on public.meal_templates;
create policy meal_templates_all_own on public.meal_templates
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
