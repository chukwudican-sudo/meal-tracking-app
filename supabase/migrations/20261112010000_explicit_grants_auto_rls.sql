-- Locked unless granted (Nov 12, 2026). Supabase's current standard: new
-- tables in public are NOT reachable through the Data API until a migration
-- grants access on purpose (default for new projects since May 30, 2026,
-- announced for existing ones). Our older migrations relied on the old
-- automatic grants, so this file:
--   1. installs the automatic-RLS safety net (dev already had it, prod not);
--   2. stops automatic grants on future tables/sequences;
--   3. writes every current table's grants out explicitly. Logged-in users
--      get exactly the commands their RLS policies allow (nothing the app does
--      changes; the one removal is users DELETE, see 5); logged-out users
--      (anon) get nothing — no policy ever let them in, so the old grants were
--      an unused open door;
--   4. sets function EXECUTE explicitly. consume_free_scan was callable by
--      anyone with the public key (it takes any user id): now server-only;
--   5. closes a way to fake Pro: a signed-in user could DELETE their own
--      users row and INSERT it again with subscription_status 'active' (or
--      any free_scans_remaining) — the column guard only covered UPDATE, and
--      edge functions trust that row for AI access. Now the row can't be
--      deleted by the app (account deletion runs server-side and cascades
--      from auth.users) and the guard covers INSERT too.
--
-- RULE FOR EVERY NEW TABLE / FUNCTION from here on: grant in the same
-- migration (see the pattern below), or the app gets "permission denied".
-- New functions still default to EXECUTE for PUBLIC (a global Postgres
-- default this file deliberately leaves alone — removing it globally would
-- also hit functions in other schemas): every new function's migration runs
-- `revoke all on function … from public, anon, authenticated` and then grants
-- execute only to the roles that need it.

-- ─── 1. Automatic RLS on new public tables ──────────────────────────────────
-- Supabase's documented event trigger (Database → Event triggers), word for
-- word as dev has it. It only ever turns RLS ON (a new table is locked until
-- its policies exist); it never opens anything.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
  end if;
end $$;

-- Event triggers run it themselves; nobody needs to call it.
revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;

-- ─── 2. No automatic role grants on future tables / sequences / functions ───
-- (= the dashboard's "Automatically expose new tables" switched off, plus the
-- same for functions; only affects objects created by postgres in public,
-- i.e. our migrations.) PUBLIC still gets EXECUTE on new functions (built-in
-- Postgres default) — revoke it per function, as the rule above says.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;

-- ─── 3. Table grants, written out ───────────────────────────────────────────
-- Start from nothing, then grant per table. service_role (edge functions,
-- scripts; bypasses RLS) gets full row access everywhere — the same four
-- commands a fresh project built from these migrations would give it.

do $$
declare
  t text;
begin
  foreach t in array array[
    'ai_events', 'ai_usage_log', 'announcements', 'cart_items', 'kitchen_items',
    'macro_carbs', 'macro_fats', 'macro_proteins', 'meal_log_ingredients',
    'meal_logs', 'meal_templates', 'plan_day_meals', 'plan_slots',
    'planned_ingredients', 'plans', 'premade_recipe_access', 'progress_daily',
    'push_tokens', 'recipe_ingredients', 'recipe_steps', 'recipes',
    'saved_recipes', 'sync_deletions', 'user_feedback', 'users', 'weight_logs'
  ] loop
    execute format('revoke all on table public.%I from anon, authenticated, service_role', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- Logged-in users: the commands their RLS policies allow (own rows; admin-
-- writable catalog tables via is_admin()).
grant select, insert, update, delete on table
  public.cart_items, public.kitchen_items,
  public.macro_carbs, public.macro_fats, public.macro_proteins,
  public.meal_log_ingredients, public.meal_logs, public.meal_templates,
  public.plan_day_meals, public.plan_slots, public.planned_ingredients, public.plans,
  public.premade_recipe_access, public.progress_daily,
  public.recipe_ingredients, public.recipe_steps, public.recipes, public.saved_recipes,
  public.weight_logs
  to authenticated;
-- users: no DELETE (see section 5). The app only upserts and reads its row.
grant select, insert, update on table public.users to authenticated;
grant select, insert on table public.ai_usage_log to authenticated;
grant select on table public.announcements to authenticated;
grant select on table public.push_tokens to authenticated;   -- writes go through the RPCs below
grant select on table public.sync_deletions to authenticated; -- written by a trigger
grant insert on table public.user_feedback to authenticated;
-- public.ai_events: no app access (private AI quality log; edge functions only).

-- sync_deletions ids come from the log_sync_deletion trigger (runs as owner).
revoke all on sequence public.sync_deletions_id_seq from anon, authenticated, service_role;
grant usage, select on sequence public.sync_deletions_id_seq to service_role;

-- ─── 4. Function EXECUTE ────────────────────────────────────────────────────

-- Server only: edge functions call it with the service key after a successful
-- AI call. It takes any user id, so the app must never reach it.
revoke all on function public.consume_free_scan(uuid) from public, anon, authenticated;
grant execute on function public.consume_free_scan(uuid) to service_role;

-- Called by the app (sync clock) / by RLS policies (is_admin) — logged in only.
revoke all on function public.server_now() from public, anon;
grant execute on function public.server_now() to authenticated, service_role;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Already logged-in only (inbox_push migration); restated so this file is
-- the complete picture.
revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated, service_role;
revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated, service_role;

-- Trigger functions: fired by the database, never called over the API. The
-- roles whose writes fire them keep EXECUTE (belt and braces; Postgres checks
-- it when the trigger is created, not when it fires).
revoke all on function public.handle_new_user() from public, anon;
grant execute on function public.handle_new_user() to authenticated, service_role, supabase_auth_admin;
revoke all on function public.log_sync_deletion() from public, anon;
grant execute on function public.log_sync_deletion() to authenticated, service_role;
revoke all on function public.protect_user_columns() from public, anon;
grant execute on function public.protect_user_columns() to authenticated, service_role;
revoke all on function public.set_updated_at() from public, anon;
grant execute on function public.set_updated_at() to authenticated, service_role;

-- ─── 5. Pro / free scans can't be faked through the users row ───────────────

drop policy if exists users_delete_own on public.users;

-- Same guard as before for UPDATE (a signed-in, non-admin caller can't change
-- these columns); now also INSERT: a row a signed-in user creates themselves
-- always starts like a new account (normally handle_new_user creates it at
-- signup, with no JWT, so it's untouched — as are edge functions, which use
-- the service key). 5 = the column default in the schema migration.
create or replace function public.protect_user_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.free_scans_remaining     := 5;
      new.subscription_status      := 'free';
      new.subscription_provider    := null;
      new.subscription_expiry_date := null;
    else
      new.free_scans_remaining     := old.free_scans_remaining;
      new.subscription_status      := old.subscription_status;
      new.subscription_provider    := old.subscription_provider;
      new.subscription_expiry_date := old.subscription_expiry_date;
    end if;
  end if;
  return new;
end;
$$;

-- CREATE OR REPLACE kept the grants set in section 4.
drop trigger if exists users_protect_columns on public.users;
create trigger users_protect_columns
  before insert or update on public.users
  for each row execute function public.protect_user_columns();
