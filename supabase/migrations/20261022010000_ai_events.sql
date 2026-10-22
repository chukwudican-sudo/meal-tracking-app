-- AI quality log: one row per AI request outcome (success or failure) so we can
-- measure and improve accuracy — what the user typed, what the meal looked like
-- before and after, which prompt version produced it, how long it took, and why
-- it failed. ai_usage_log stays the rate-limit counter (successes only); this
-- table is analysis-only and never read by the app.
--
-- Privacy: written only by edge functions with the service role. RLS is on with
-- NO policies, so clients can neither read nor write it. Rows are deleted with
-- the account (FK cascade from auth.users — the delete-account flow covers it).
-- No photos are stored. Before launch: disclose in the privacy policy + App
-- Store labels, and schedule a 90-day retention clean-up.

create table public.ai_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  function_name   text not null,
  -- Bumped whenever a function's prompt changes, so accuracy can be compared
  -- across versions.
  prompt_version  text,
  -- Ties one scan to its follow-up fixes (scan card), or a logged meal's id for
  -- fixes made from the meal popup.
  flow_id         text,
  success         boolean not null,
  error_code      text,
  latency_ms      integer,
  input           jsonb,
  output          jsonb,
  created_at      timestamptz not null default now()
);

create index ai_events_user_created_idx on public.ai_events (user_id, created_at desc);
create index ai_events_function_created_idx on public.ai_events (function_name, created_at desc);
create index ai_events_flow_idx on public.ai_events (flow_id);

alter table public.ai_events enable row level security;
