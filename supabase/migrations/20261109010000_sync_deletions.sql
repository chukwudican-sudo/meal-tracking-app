-- Deletes reach the user's other phones (Nov 9, 2026).
--
-- Pulls only ask for rows changed since the phone's cursor, and a deleted row
-- is simply gone — so another phone kept it forever, and could upload it again.
-- Rows are still really deleted; a trigger on each synced table also writes a
-- small note here (table + the key the app knows the item by). A phone's delta
-- pull reads the notes since its cursor and removes those items locally.

create table if not exists public.sync_deletions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  table_name  text not null,
  entity_key  text not null,
  deleted_at  timestamptz not null default now()
);

create index if not exists sync_deletions_user_deleted_idx
  on public.sync_deletions (user_id, deleted_at);

-- Read-only to users (own notes); only the trigger below writes.
alter table public.sync_deletions enable row level security;
drop policy if exists sync_deletions_select_own on public.sync_deletions;
create policy sync_deletions_select_own on public.sync_deletions
  for select to authenticated
  using (user_id = auth.uid());

create or replace function public.log_sync_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''   -- definer hardening: every name below is schema-qualified
as $$
declare
  r jsonb := to_jsonb(old);
  k text;
begin
  -- Account deletion cascades here after the auth user row is gone: nothing
  -- left to tell, and the insert would fail its foreign key.
  if not exists (select 1 from auth.users where id = old.user_id) then
    return old;
  end if;

  -- The key each phone knows the item by (see lib/sync/mappers.ts).
  k := case tg_table_name
         -- the UTC day, as the app writes/reads it (logged_at = <day>T00:00Z)
         when 'weight_logs' then (((r ->> 'logged_at')::timestamptz) at time zone 'UTC')::date::text
         when 'kitchen_items' then r ->> 'ingredient_name'
         when 'cart_items' then r ->> 'ingredient_name'
         when 'planned_ingredients' then r ->> 'ingredient_name'
         else r ->> 'id'
       end;
  if k is null then
    return old;
  end if;

  insert into public.sync_deletions (user_id, table_name, entity_key)
  values (old.user_id, tg_table_name, k);

  -- Keep the table small: notes older than 180 days go (per user, indexed).
  -- A phone not opened for that long can miss an old delete — accepted.
  delete from public.sync_deletions
  where user_id = old.user_id and deleted_at < now() - interval '180 days';

  return old;
end;
$$;

-- Parent rows only: child rows (ingredients, plan slots…) go with their parent.
do $$
declare
  t text;
begin
  foreach t in array array[
    'meal_logs', 'weight_logs', 'saved_recipes', 'plans',
    'kitchen_items', 'cart_items', 'planned_ingredients', 'meal_templates'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_log_deletion', t);
    execute format(
      'create trigger %I after delete on public.%I for each row execute function public.log_sync_deletion()',
      t || '_log_deletion', t
    );
  end loop;
end;
$$;
