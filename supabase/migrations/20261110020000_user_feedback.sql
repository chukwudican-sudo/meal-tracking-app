-- Feedback + food reports reach Alex (Nov 10, 2026).
--
-- Settings → Help → Send Feedback and meal details → Report Food used to say
-- "sent" while sending nothing (Apple 2.1: features must really work). Users
-- can only ADD rows for themselves; nobody can read them through the API —
-- Alex reads them in the Supabase dashboard (Table Editor → user_feedback).

create table if not exists public.user_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('feedback', 'food_report')),
  message     text not null check (char_length(message) between 1 and 2000),
  -- What it was about (food reports: the meal's name and numbers). Small, no photos.
  context     jsonb check (context is null or octet_length(context::text) < 16384),
  app_version text,
  created_at  timestamptz not null default now()
);

create index if not exists user_feedback_created_idx on public.user_feedback (created_at desc);

alter table public.user_feedback enable row level security;

drop policy if exists user_feedback_insert_own on public.user_feedback;
create policy user_feedback_insert_own on public.user_feedback
  for insert to authenticated
  with check (user_id = auth.uid());
