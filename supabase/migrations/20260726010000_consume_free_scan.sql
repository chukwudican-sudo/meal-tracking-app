-- Free-scan allowance: let AI edge functions consume one of a user's
-- free_scans_remaining atomically. The column already exists (schema migration,
-- default 5, trigger-protected from client writes) but nothing ever decremented
-- it, so non-premium users never actually got their free scans. This RPC is the
-- server-side (service-role) consume step, called only after a successful AI
-- call so failures/timeouts don't burn the allowance.
--
-- Atomicity: a single `update ... where free_scans_remaining > 0 returning`
-- is evaluated under a row lock against the latest committed value, so two
-- concurrent requests can't both decrement past zero.

create or replace function public.consume_free_scan(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining integer;
begin
  update public.users
  set free_scans_remaining = free_scans_remaining - 1
  where id = p_user_id and free_scans_remaining > 0
  returning free_scans_remaining into remaining;

  -- remaining is null when no row matched (already at 0) → nothing consumed.
  return remaining is not null;
end;
$$;
