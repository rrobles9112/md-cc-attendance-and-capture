-- 012d_whatsapp_pastoreo_cron.sql
-- WhatsApp Pastoreo Notifications — pg_cron + pg_net daily-digest (PR2, T-015)
-- Primary scheduler: 12:00 UTC = 07:00 America/Bogota (UTC-5, no DST).
-- Idempotent: unschedule existing 'daily-digest' if present, then schedule.
-- Sequential: absence then birthday via two net.http_post in same job.
-- Timezone invariant: queries inside Edge anchor to (CURRENT_DATE AT TIME ZONE 'America/Bogota').
-- If extensions are not enabled via Dashboard > Database > Extensions, this migration
-- creates them. If blocked, fallback is Vercel Cron /api/cron/daily-digest (T-016).
--
-- Verification:
--   SELECT * FROM pg_extension WHERE extname IN ('pg_cron','pg_net');
--   SELECT jobname, schedule FROM cron.job WHERE jobname='daily-digest';
--   SELECT * FROM cron.job_run_details WHERE jobname='daily-digest' ORDER BY start_time DESC LIMIT 5;

-- Extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Ensure app_settings driver documents active scheduler
INSERT INTO public.app_settings (key, value) VALUES ('whatsapp_cron_driver', 'pg_cron')
ON CONFLICT (key) DO NOTHING;

-- Idempotent schedule: unschedule if exists, then schedule
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-digest') THEN
    PERFORM cron.unschedule('daily-digest');
  END IF;

  PERFORM cron.schedule(
    'daily-digest',
    '0 12 * * *',
    $$
      SELECT net.http_post(
        url := 'https://' || current_setting('request.headers', true)::json->>'host' || '/functions/v1/send-whatsapp',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY'),
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'),
            ''
          ),
          'x-cron-secret', coalesce(
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET'),
            ''
          )
        ),
        body := '{"kind":"absence","triggered_by":"cron"}'::jsonb
      );
      SELECT net.http_post(
        url := 'https://' || current_setting('request.headers', true)::json->>'host' || '/functions/v1/send-whatsapp',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY'),
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'),
            ''
          ),
          'x-cron-secret', coalesce(
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET'),
            ''
          )
        ),
        body := '{"kind":"birthday","triggered_by":"cron"}'::jsonb
      );
    $$
  );
END $$;

-- Document cron driver and timezone
COMMENT ON EXTENSION pg_cron IS 'WhatsApp daily-digest 0 12 * * * UTC = 07:00 America/Bogota; see 012d migration';
