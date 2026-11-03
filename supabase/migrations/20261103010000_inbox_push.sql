-- Bell inbox + push (Nov 3, 2026).
--
-- announcements: messages Alex sends to every user (fun facts, feature
-- updates). Signed-in users can read them; only the service role (the
-- send-announcement function) can write — no insert/update/delete policies.
--
-- push_tokens: one row per phone, holding its Expo push token. Written only
-- through register_push_token / unregister_push_token below, so a phone that
-- changes account moves its token to the new user instead of failing on the
-- old user's row (RLS would block a direct upsert of another user's token).

create table public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 80),
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index announcements_created_at_idx on public.announcements (created_at desc);

alter table public.announcements enable row level security;

create policy announcements_select on public.announcements
  for select to authenticated using (true);

create table public.push_tokens (
  token       text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  platform    text not null check (platform in ('ios', 'android')),
  updated_at  timestamptz not null default now()
);

create index push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy push_tokens_select_own on public.push_tokens
  for select to authenticated using (user_id = auth.uid());

create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_token is null or char_length(p_token) not between 10 and 200
     or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$' then
    raise exception 'invalid push token';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'invalid platform';
  end if;

  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();
end;
$$;

create or replace function public.unregister_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
end;
$$;

revoke all on function public.register_push_token(text, text) from public, anon;
revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
