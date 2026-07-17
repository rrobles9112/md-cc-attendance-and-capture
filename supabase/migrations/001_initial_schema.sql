-- 001_initial_schema.sql
-- Attendance & Data Capture Platform — full DDL, RLS, audit triggers, pg_cron purge

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- pg_cron: must be enabled via Supabase Dashboard > Database > Extensions first.
-- The schedule calls below use IF EXISTS guards so the migration won't fail if not yet enabled.

-- Role enum
CREATE TYPE app_role AS ENUM ('super_admin', 'leader', 'server');

-- =============================================================================
-- TABLES
-- =============================================================================

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role app_role NOT NULL DEFAULT 'server',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  birthday DATE,
  is_minor BOOLEAN NOT NULL DEFAULT false,
  legal_rep_name TEXT,
  has_whatsapp BOOLEAN DEFAULT false,
  consent_recorded BOOLEAN NOT NULL DEFAULT false,
  sensitive_consent_recorded BOOLEAN NOT NULL DEFAULT false,
  denomination_encrypted BYTEA,
  community_name_encrypted BYTEA,
  duplicate_flag BOOLEAN DEFAULT false,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE social_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE whatsapp_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  is_primary_phone BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  session_date DATE NOT NULL,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id),
  session_id UUID NOT NULL REFERENCES sessions(id),
  marked_by UUID NOT NULL REFERENCES profiles(id),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(member_id, session_id)
);

CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id),
  consent_type TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address INET
);

CREATE TABLE arco_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES members(id),
  request_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  deadline DATE NOT NULL,
  fulfilled_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed DPO contact email (configurable by super_admin at runtime)
INSERT INTO app_settings (key, value) VALUES ('dpo_contact_email', '');

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Extract role from JWT custom claim (in public schema — auth schema is read-only on Cloud)
CREATE OR REPLACE FUNCTION public.user_role() RETURNS app_role AS $$
  SELECT (auth.jwt()->>'role')::app_role;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Audit trigger: logs every INSERT, UPDATE, DELETE to audit_log
CREATE OR REPLACE FUNCTION log_mutation() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log(user_id, action, table_name, record_id, old_value, new_value)
  VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- AUDIT TRIGGERS (all mutable tables)
-- =============================================================================

CREATE TRIGGER audit_profiles AFTER INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION log_mutation();

CREATE TRIGGER audit_members AFTER INSERT OR UPDATE OR DELETE ON members
  FOR EACH ROW EXECUTE FUNCTION log_mutation();

CREATE TRIGGER audit_social_media AFTER INSERT OR UPDATE OR DELETE ON social_media
  FOR EACH ROW EXECUTE FUNCTION log_mutation();

CREATE TRIGGER audit_whatsapp_numbers AFTER INSERT OR UPDATE OR DELETE ON whatsapp_numbers
  FOR EACH ROW EXECUTE FUNCTION log_mutation();

CREATE TRIGGER audit_sessions AFTER INSERT OR UPDATE OR DELETE ON sessions
  FOR EACH ROW EXECUTE FUNCTION log_mutation();

CREATE TRIGGER audit_attendance AFTER INSERT OR UPDATE OR DELETE ON attendance
  FOR EACH ROW EXECUTE FUNCTION log_mutation();

CREATE TRIGGER audit_consent_records AFTER INSERT OR UPDATE OR DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION log_mutation();

CREATE TRIGGER audit_arco_requests AFTER INSERT OR UPDATE OR DELETE ON arco_requests
  FOR EACH ROW EXECUTE FUNCTION log_mutation();

CREATE TRIGGER audit_app_settings AFTER INSERT OR UPDATE OR DELETE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION log_mutation();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- profiles: users see own; super_admin sees all
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON profiles FOR SELECT USING (
  id = auth.uid() OR public.user_role() = 'super_admin'
);

CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (
  public.user_role() = 'super_admin'
);

CREATE POLICY profiles_update ON profiles FOR UPDATE USING (
  public.user_role() = 'super_admin'
);

CREATE POLICY profiles_delete ON profiles FOR DELETE USING (
  public.user_role() = 'super_admin'
);

-- members: super_admin full; leader read+insert; server read
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

CREATE POLICY members_select ON members FOR SELECT USING (
  public.user_role() IN ('super_admin','leader','server') AND deleted_at IS NULL
);

CREATE POLICY members_insert ON members FOR INSERT WITH CHECK (
  public.user_role() IN ('super_admin','leader')
);

CREATE POLICY members_update ON members FOR UPDATE USING (
  public.user_role() = 'super_admin'
);

CREATE POLICY members_delete ON members FOR DELETE USING (
  public.user_role() = 'super_admin'
);

-- social_media: super_admin full; leader read+insert; server read
ALTER TABLE social_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY social_media_select ON social_media FOR SELECT USING (
  public.user_role() IN ('super_admin','leader','server') AND deleted_at IS NULL
);

CREATE POLICY social_media_insert ON social_media FOR INSERT WITH CHECK (
  public.user_role() IN ('super_admin','leader')
);

CREATE POLICY social_media_update ON social_media FOR UPDATE USING (
  public.user_role() = 'super_admin'
);

CREATE POLICY social_media_delete ON social_media FOR DELETE USING (
  public.user_role() = 'super_admin'
);

-- whatsapp_numbers: super_admin full; leader read+insert; server read
ALTER TABLE whatsapp_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_numbers_select ON whatsapp_numbers FOR SELECT USING (
  public.user_role() IN ('super_admin','leader','server') AND deleted_at IS NULL
);

CREATE POLICY whatsapp_numbers_insert ON whatsapp_numbers FOR INSERT WITH CHECK (
  public.user_role() IN ('super_admin','leader')
);

CREATE POLICY whatsapp_numbers_update ON whatsapp_numbers FOR UPDATE USING (
  public.user_role() = 'super_admin'
);

CREATE POLICY whatsapp_numbers_delete ON whatsapp_numbers FOR DELETE USING (
  public.user_role() = 'super_admin'
);

-- sessions: super_admin full; leader read+insert; server read
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sessions_select ON sessions FOR SELECT USING (
  public.user_role() IN ('super_admin','leader','server') AND deleted_at IS NULL
);

CREATE POLICY sessions_insert ON sessions FOR INSERT WITH CHECK (
  public.user_role() IN ('super_admin','leader')
);

CREATE POLICY sessions_update ON sessions FOR UPDATE USING (
  public.user_role() = 'super_admin'
);

CREATE POLICY sessions_delete ON sessions FOR DELETE USING (
  public.user_role() = 'super_admin'
);

-- attendance: all roles read+insert; super_admin can delete
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_select ON attendance FOR SELECT USING (
  public.user_role() IN ('super_admin','leader','server') AND deleted_at IS NULL
);

CREATE POLICY attendance_insert ON attendance FOR INSERT WITH CHECK (
  public.user_role() IN ('super_admin','leader','server')
);

CREATE POLICY attendance_update ON attendance FOR UPDATE USING (
  public.user_role() = 'super_admin'
);

CREATE POLICY attendance_delete ON attendance FOR DELETE USING (
  public.user_role() = 'super_admin'
);

-- consent_records: super_admin full; leader read+insert; server read
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY consent_records_select ON consent_records FOR SELECT USING (
  public.user_role() IN ('super_admin','leader','server')
);

CREATE POLICY consent_records_insert ON consent_records FOR INSERT WITH CHECK (
  public.user_role() IN ('super_admin','leader')
);

CREATE POLICY consent_records_update ON consent_records FOR UPDATE USING (
  public.user_role() = 'super_admin'
);

CREATE POLICY consent_records_delete ON consent_records FOR DELETE USING (
  public.user_role() = 'super_admin'
);

-- arco_requests: super_admin full; leader read+insert; server no access
ALTER TABLE arco_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY arco_requests_select ON arco_requests FOR SELECT USING (
  public.user_role() IN ('super_admin','leader')
);

CREATE POLICY arco_requests_insert ON arco_requests FOR INSERT WITH CHECK (
  public.user_role() IN ('super_admin','leader')
);

CREATE POLICY arco_requests_update ON arco_requests FOR UPDATE USING (
  public.user_role() = 'super_admin'
);

CREATE POLICY arco_requests_delete ON arco_requests FOR DELETE USING (
  public.user_role() = 'super_admin'
);

-- audit_log: super_admin read only; no direct writes (trigger-populated)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select ON audit_log FOR SELECT USING (
  public.user_role() = 'super_admin'
);

-- app_settings: super_admin full; others read
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_settings_select ON app_settings FOR SELECT USING (
  public.user_role() IN ('super_admin','leader','server')
);

CREATE POLICY app_settings_update ON app_settings FOR UPDATE USING (
  public.user_role() = 'super_admin'
);

-- =============================================================================
-- PG_CRON: 90-day purge of soft-deleted records
-- =============================================================================
-- IMPORTANT: Enable the "cron" extension in Supabase Dashboard >
-- Database > Extensions before these schedules will run.
-- The DO block only schedules if pg_cron is available.

DO $_$
BEGIN
  IF (SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'cron')) THEN
    PERFORM cron.schedule('purge-old-deletes', '0 3 * * *',
      $$DELETE FROM members WHERE deleted_at < now() - interval '90 days'$$
    );
    PERFORM cron.schedule('purge-old-deletes-sessions', '0 3 * * *',
      $$DELETE FROM sessions WHERE deleted_at < now() - interval '90 days'$$
    );
    PERFORM cron.schedule('purge-old-deletes-attendance', '0 3 * * *',
      $$DELETE FROM attendance WHERE deleted_at < now() - interval '90 days'$$
    );
  END IF;
END
$_$;
