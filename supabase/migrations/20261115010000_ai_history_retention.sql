-- AI data retention (Nov 15). One nightly pg_cron job:
--   * ai_events (the private AI history: typed meals, scan/fix results, no
--     photos) older than 90 days is deleted — the privacy policy states this.
--   * ai_usage_log (rate limiting: who used which AI feature when) older than
--     30 days is deleted — the rate limit only ever looks back 1 hour.
-- Rows of a deleted account already go with it (on delete cascade).
--
-- pg_cron as Supabase's install guide sets it up; its objects live in the
-- `cron` schema, so the public-schema auto-RLS trigger doesn't touch them.
-- cron.schedule upserts by job name, so re-running this is safe.

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- The nightly deletes filter on time only; without these they read the whole
-- table (ai_events holds jsonb input/output).
create index if not exists ai_events_created_idx on public.ai_events (created_at);
create index if not exists ai_usage_log_called_idx on public.ai_usage_log (called_at);

-- 09:00 UTC = 1-4 AM across North America in winter, 2-5 AM in summer.
select cron.schedule(
  'ai-data-retention',
  '0 9 * * *',
  $$
    delete from public.ai_events where created_at < now() - interval '90 days';
    delete from public.ai_usage_log where called_at < now() - interval '30 days';
  $$
);
