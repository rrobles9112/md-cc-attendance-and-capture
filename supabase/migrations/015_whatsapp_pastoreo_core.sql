-- 012a_whatsapp_pastoreo_core.sql
-- WhatsApp Pastoreo Notifications — core DDL (PR1, T-010)
-- Additive, idempotent, nullable/defaulted — safe on prod with live traffic.
-- Timezone invariant: every date comparison uses (CURRENT_DATE AT TIME ZONE 'America/Bogota')
-- as documented in spec §Cron & Scheduling and design §4.2. sessions.session_date
-- is DATE (tz-naive), so the cron must anchor to Bogota (UTC-5, no DST).
--
-- Dependencies: 001_initial_schema (members, profiles, app_settings, audit_log),
--               011_youth_retreat_preregistration (no conflicts).
-- Follow existing migration style: IF NOT EXISTS guards, COMMENT ON, audit triggers
-- via public.log_mutation() (SECURITY DEFINER SET search_path=''), no bare
-- SECURITY DEFINER without auth.uid() guard.
-- vault extension is idempotent.

-- =============================================================================
-- Extensions
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- =============================================================================
-- members — new columns
-- =============================================================================
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS sex TEXT
    CHECK (sex IN ('M','F','other','prefer_not_to_say'));

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS whatsapp_opt_out_at TIMESTAMPTZ;

-- age_years — Amendment A1 (2026-08-29): plain column maintained by trigger.
-- PG15 rejects age() (STABLE) in a GENERATED ALWAYS expression (SQLSTATE 42P17).
-- NULL when birthday IS NULL; used for age_bucket CASE. The trigger recomputes
-- on birthday write — identical write-time semantics to the original STORED
-- design; the backfill below closes the ALTER-time population gap.
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS age_years INT;

CREATE OR REPLACE FUNCTION public.members_age_years_maintain()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.age_years := EXTRACT(YEAR FROM age(NEW.birthday))::int;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS members_age_years_maintain ON public.members;
CREATE TRIGGER members_age_years_maintain
  BEFORE INSERT OR UPDATE OF birthday ON public.members
  FOR EACH ROW
  EXECUTE FUNCTION public.members_age_years_maintain();

-- One-time backfill (Amendment A1): GENERATED would have populated existing
-- rows at ALTER time; a plain column starts NULL for pre-existing rows.
UPDATE public.members
  SET age_years = EXTRACT(YEAR FROM age(birthday))::int
  WHERE birthday IS NOT NULL AND age_years IS NULL;

COMMENT ON COLUMN public.members.sex IS 'Ley 1581 sensitive; nullable, prefer_not_to_say allowed; excluded from default export; bucket NULL→No especificado';
COMMENT ON COLUMN public.members.age_years IS 'maintained by members_age_years_maintain trigger (Amendment A1; age() not IMMUTABLE in PG15); NULL when birthday IS NULL; used for age_bucket CASE (0-12..51+)';
COMMENT ON COLUMN public.members.whatsapp_opt_in IS 'Gate for absence sends; DEFAULT false until re-consent (D3)';
COMMENT ON COLUMN public.members.whatsapp_opt_out_at IS 'Set on unsubscribe; blocks sends even if opt_in=true and consent exists';

-- =============================================================================
-- profiles — new columns (chosen over auth.users.phone per design §2.2)
-- =============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT
    CHECK (whatsapp_number ~ '^\+[1-9]\d{7,14}$');

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.whatsapp_number IS 'Staff WhatsApp for birthday digests; E.164; NULL until opted in; validated via libphonenumber-js + REGEX guard';
COMMENT ON COLUMN public.profiles.whatsapp_opt_in IS 'Staff must opt in to birthday digests (D4)';

-- =============================================================================
-- notification_log — new table (append-only, audit + idempotency)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  recipient_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('absence','birthday','shepherding_checkin')),
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp')),
  template_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'queued','sent','failed',
    'skipped_no_consent','skipped_invalid_phone','skipped_duplicate',
    'skipped_no_birthdays','skipped_no_recipients','skipped_cap'
  )),
  notification_date DATE,
  provider_message_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id)
);

COMMENT ON TABLE public.notification_log IS 'Audit + idempotency for every WhatsApp attempt; append-only; see spec §6.3';
COMMENT ON COLUMN public.notification_log.notification_date IS 'Bogota date (CURRENT_DATE AT TIME ZONE ''America/Bogota'') for birthday dedup; NULL for absence (uses session_id)';
COMMENT ON COLUMN public.notification_log.provider_message_id IS 'wamid from Graph API';
COMMENT ON COLUMN public.notification_log.created_by IS 'NULL for cron/service_role, auth.uid() for manual Pastoreo triggers';

-- =============================================================================
-- app_settings — new keys (parametrizable without migration)
-- =============================================================================
INSERT INTO public.app_settings (key, value) VALUES
  ('whatsapp_enabled', 'true'),
  ('whatsapp_monthly_cap', '900'),
  ('whatsapp_monthly_alert_at', '800'),
  ('whatsapp_phone_number_id', ''),
  ('whatsapp_cron_driver', 'pg_cron'),
  ('pastoreo_chronic_threshold', '3'),
  ('pastoreo_chronic_lookback_days', '90')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- Vault helper (service_role only) — mirrors docs/vault-setup.md get_decryption_key
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_whatsapp_secret(p_name TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name $$;

REVOKE ALL ON FUNCTION public.get_whatsapp_secret(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_whatsapp_secret(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_secret(TEXT) TO service_role;

-- =============================================================================
-- Audit — add notification_log to log_mutation coverage (existing SECURITY DEFINER)
-- =============================================================================
DROP TRIGGER IF EXISTS audit_notification_log ON public.notification_log;
CREATE TRIGGER audit_notification_log
  AFTER INSERT OR UPDATE OR DELETE ON public.notification_log
  FOR EACH ROW EXECUTE FUNCTION public.log_mutation();

NOTIFY pgrst, 'reload schema';
