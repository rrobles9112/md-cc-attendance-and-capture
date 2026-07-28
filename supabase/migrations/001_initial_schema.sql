-- 001_initial_schema.sql
-- Attendance & Data Capture Platform — full DDL, RLS, audit triggers, pg_cron purge,
-- auth profile provisioning, and demo/test seed data for local development.
--
-- Demo credentials (password for all): test-password
--   test-superadmin@test.com  → super_admin
--   test-leader@test.com      → leader
--   test-server@test.com      → server

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

-- Audit trigger: logs every INSERT, UPDATE, DELETE to audit_log.
-- record_id is read via to_jsonb so tables without an `id` column (e.g. app_settings)
-- still audit successfully with a NULL record_id.
CREATE OR REPLACE FUNCTION log_mutation() RETURNS TRIGGER AS $$
DECLARE
  record_uuid UUID;
BEGIN
  record_uuid := COALESCE(
    NULLIF(to_jsonb(NEW)->>'id', '')::uuid,
    NULLIF(to_jsonb(OLD)->>'id', '')::uuid
  );

  INSERT INTO audit_log(user_id, action, table_name, record_id, old_value, new_value)
  VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    record_uuid,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-create a profiles row when a new auth.users row is inserted.
-- Default role is 'server'; super_admin must be assigned manually via Supabase dashboard or CLI.
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'server'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

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

-- =============================================================================
-- DEMO / TEST SEED DATA
-- =============================================================================
-- Idempotent: safe to re-run on already-seeded databases (ON CONFLICT / NOT EXISTS).
-- WARNING: Do not treat these accounts as production credentials.
--
-- Deterministic IDs for stable FK references across resets / tests
-- Profiles / auth users
--   a0000000-0000-4000-8000-000000000001  super_admin
--   a0000000-0000-4000-8000-000000000002  leader
--   a0000000-0000-4000-8000-000000000003  server
-- Members
--   b0000000-0000-4000-8000-000000000001..005
-- Sessions
--   c0000000-0000-4000-8000-000000000001..002

DO $$
DECLARE
  demo_password TEXT := 'test-password';
  demo_encrypt_key TEXT := 'demo-local-pgcrypto-key-not-for-prod';
  super_admin_id UUID := 'a0000000-0000-4000-8000-000000000001';
  leader_id UUID := 'a0000000-0000-4000-8000-000000000002';
  server_id UUID := 'a0000000-0000-4000-8000-000000000003';
  member_juan UUID := 'b0000000-0000-4000-8000-000000000001';
  member_maria UUID := 'b0000000-0000-4000-8000-000000000002';
  member_carlos UUID := 'b0000000-0000-4000-8000-000000000003';
  member_ana_deleted UUID := 'b0000000-0000-4000-8000-000000000004';
  member_sofia_minor UUID := 'b0000000-0000-4000-8000-000000000005';
  session_morning UUID := 'c0000000-0000-4000-8000-000000000001';
  session_evening UUID := 'c0000000-0000-4000-8000-000000000002';
BEGIN
  -- ---------------------------------------------------------------------------
  -- Auth users (login-capable) + identities
  -- ---------------------------------------------------------------------------
  -- Minimal auth.users columns for GoTrue compatibility across CLI versions.
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    last_sign_in_at
  )
  VALUES
    (
      '00000000-0000-0000-0000-000000000000',
      super_admin_id,
      'authenticated',
      'authenticated',
      'test-superadmin@test.com',
      crypt(demo_password, gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'role', 'super_admin'
      ),
      jsonb_build_object('full_name', 'Test Super Admin'),
      now(),
      now(),
      now()
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      leader_id,
      'authenticated',
      'authenticated',
      'test-leader@test.com',
      crypt(demo_password, gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'role', 'leader'
      ),
      jsonb_build_object('full_name', 'Test Leader'),
      now(),
      now(),
      now()
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      server_id,
      'authenticated',
      'authenticated',
      'test-server@test.com',
      crypt(demo_password, gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'role', 'server'
      ),
      jsonb_build_object('full_name', 'Test Server'),
      now(),
      now(),
      now()
    )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = COALESCE(auth.users.email_confirmed_at, EXCLUDED.email_confirmed_at),
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = now();

  -- Email provider identities required for password sign-in
  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE provider = 'email' AND provider_id = super_admin_id::text
  ) THEN
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      super_admin_id,
      super_admin_id,
      jsonb_build_object(
        'sub', super_admin_id::text,
        'email', 'test-superadmin@test.com',
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      super_admin_id::text,
      now(),
      now(),
      now()
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE provider = 'email' AND provider_id = leader_id::text
  ) THEN
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      leader_id,
      leader_id,
      jsonb_build_object(
        'sub', leader_id::text,
        'email', 'test-leader@test.com',
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      leader_id::text,
      now(),
      now(),
      now()
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE provider = 'email' AND provider_id = server_id::text
  ) THEN
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      server_id,
      server_id,
      jsonb_build_object(
        'sub', server_id::text,
        'email', 'test-server@test.com',
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      server_id::text,
      now(),
      now(),
      now()
    );
  END IF;
  -- handle_new_user() trigger creates profiles as 'server'; align roles + names.
  UPDATE public.profiles
  SET
    full_name = CASE id
      WHEN super_admin_id THEN 'Test Super Admin'
      WHEN leader_id THEN 'Test Leader'
      WHEN server_id THEN 'Test Server'
      ELSE full_name
    END,
    role = CASE id
      WHEN super_admin_id THEN 'super_admin'::app_role
      WHEN leader_id THEN 'leader'::app_role
      WHEN server_id THEN 'server'::app_role
      ELSE role
    END,
    is_active = true,
    updated_at = now()
  WHERE id IN (super_admin_id, leader_id, server_id);

  -- If the trigger did not fire (e.g. conflict path), ensure profiles exist.
  INSERT INTO public.profiles (id, full_name, role, is_active)
  VALUES
    (super_admin_id, 'Test Super Admin', 'super_admin', true),
    (leader_id, 'Test Leader', 'leader', true),
    (server_id, 'Test Server', 'server', true)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    is_active = true,
    updated_at = now();

  -- ---------------------------------------------------------------------------
  -- App settings
  -- ---------------------------------------------------------------------------
  INSERT INTO public.app_settings (key, value, updated_by)
  VALUES ('dpo_contact_email', 'dpo@church-demo.test', super_admin_id)
  ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  -- ---------------------------------------------------------------------------
  -- Members (sample + edge cases: sensitive consent, minor, soft-deleted purge)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.members (
    id, name, name_normalized, phone, email, birthday, is_minor, legal_rep_name,
    has_whatsapp, consent_recorded, sensitive_consent_recorded,
    denomination_encrypted, community_name_encrypted,
    duplicate_flag, created_by, created_at, updated_at, deleted_at
  )
  VALUES
    (
      member_juan,
      'Juan Pérez',
      'juan perez',
      '+573001234567',
      'juan@test.com',
      DATE '1990-03-15',
      false,
      NULL,
      true,
      true,
      true,
      pgp_sym_encrypt('Pentecostal', demo_encrypt_key),
      pgp_sym_encrypt('Iglesia de Dios', demo_encrypt_key),
      false,
      leader_id,
      now() - interval '14 days',
      now() - interval '2 days',
      NULL
    ),
    (
      member_maria,
      'María Gómez',
      'maria gomez',
      '+573009876543',
      'maria@test.com',
      DATE '1985-07-22',
      false,
      NULL,
      true,
      true,
      true,
      pgp_sym_encrypt('Católica', demo_encrypt_key),
      pgp_sym_encrypt('Parroquia San José', demo_encrypt_key),
      false,
      super_admin_id,
      now() - interval '10 days',
      now() - interval '1 day',
      NULL
    ),
    (
      member_carlos,
      'Carlos Ruiz',
      'carlos ruiz',
      '+573008888888',
      'carlos@test.com',
      DATE '1995-11-02',
      false,
      NULL,
      false,
      true,
      false,
      NULL,
      NULL,
      false,
      leader_id,
      now() - interval '7 days',
      now() - interval '7 days',
      NULL
    ),
    (
      member_ana_deleted,
      'Ana López',
      'ana lopez',
      '+573007777777',
      'ana.deleted@test.com',
      DATE '1988-01-09',
      false,
      NULL,
      true,
      true,
      false,
      NULL,
      NULL,
      false,
      super_admin_id,
      now() - interval '120 days',
      now() - interval '95 days',
      now() - interval '95 days'  -- eligible for 90-day purge
    ),
    (
      member_sofia_minor,
      'Sofía Martínez',
      'sofia martinez',
      '+573006666666',
      'sofia.minor@test.com',
      CURRENT_DATE - interval '14 years',
      true,
      'Laura Martínez',
      true,
      true,
      false,
      NULL,
      NULL,
      false,
      leader_id,
      now() - interval '3 days',
      now() - interval '3 days',
      NULL
    )
  ON CONFLICT (id) DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- Contact channels
  -- ---------------------------------------------------------------------------
  INSERT INTO public.social_media (member_id, platform, handle)
  SELECT member_juan, 'instagram', '@juanperez.co'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.social_media
    WHERE member_id = member_juan AND platform = 'instagram' AND deleted_at IS NULL
  );

  INSERT INTO public.social_media (member_id, platform, handle)
  SELECT member_maria, 'tiktok', '@mariagomez'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.social_media
    WHERE member_id = member_maria AND platform = 'tiktok' AND deleted_at IS NULL
  );

  INSERT INTO public.whatsapp_numbers (member_id, number, is_primary_phone)
  SELECT member_juan, '+573001234567', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.whatsapp_numbers
    WHERE member_id = member_juan AND number = '+573001234567' AND deleted_at IS NULL
  );

  INSERT INTO public.whatsapp_numbers (member_id, number, is_primary_phone)
  SELECT member_maria, '+573009876543', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.whatsapp_numbers
    WHERE member_id = member_maria AND number = '+573009876543' AND deleted_at IS NULL
  );

  INSERT INTO public.whatsapp_numbers (member_id, number, is_primary_phone)
  SELECT member_sofia_minor, '+573006666666', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.whatsapp_numbers
    WHERE member_id = member_sofia_minor AND number = '+573006666666' AND deleted_at IS NULL
  );

  -- ---------------------------------------------------------------------------
  -- Consent evidence (Ley 1581)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.consent_records (member_id, consent_type, policy_version, accepted_at)
  SELECT member_juan, 'personal_data', 'v1.0', now() - interval '14 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE member_id = member_juan AND consent_type = 'personal_data'
  );

  INSERT INTO public.consent_records (member_id, consent_type, policy_version, accepted_at)
  SELECT member_juan, 'sensitive_religious', 'v1.0', now() - interval '14 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE member_id = member_juan AND consent_type = 'sensitive_religious'
  );

  INSERT INTO public.consent_records (member_id, consent_type, policy_version, accepted_at)
  SELECT member_maria, 'personal_data', 'v1.0', now() - interval '10 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE member_id = member_maria AND consent_type = 'personal_data'
  );

  INSERT INTO public.consent_records (member_id, consent_type, policy_version, accepted_at)
  SELECT member_maria, 'sensitive_religious', 'v1.0', now() - interval '10 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE member_id = member_maria AND consent_type = 'sensitive_religious'
  );

  INSERT INTO public.consent_records (member_id, consent_type, policy_version, accepted_at)
  SELECT member_carlos, 'personal_data', 'v1.0', now() - interval '7 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE member_id = member_carlos AND consent_type = 'personal_data'
  );

  INSERT INTO public.consent_records (member_id, consent_type, policy_version, accepted_at)
  SELECT member_sofia_minor, 'personal_data', 'v1.0', now() - interval '3 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE member_id = member_sofia_minor AND consent_type = 'personal_data'
  );

  -- ---------------------------------------------------------------------------
  -- Sessions + attendance (server can mark; leader created one session)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.sessions (id, name, session_date, created_by, created_at)
  VALUES
    (session_morning, 'Grupo de Oración — Mañana', CURRENT_DATE - 1, leader_id, now() - interval '1 day'),
    (session_evening, 'Grupo de Oración — Noche', CURRENT_DATE, super_admin_id, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.attendance (member_id, session_id, marked_by, marked_at)
  SELECT member_juan, session_morning, server_id, now() - interval '1 day'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE member_id = member_juan AND session_id = session_morning AND deleted_at IS NULL
  );

  INSERT INTO public.attendance (member_id, session_id, marked_by, marked_at)
  SELECT member_maria, session_morning, leader_id, now() - interval '1 day'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE member_id = member_maria AND session_id = session_morning AND deleted_at IS NULL
  );

  INSERT INTO public.attendance (member_id, session_id, marked_by, marked_at)
  SELECT member_carlos, session_evening, server_id, now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE member_id = member_carlos AND session_id = session_evening AND deleted_at IS NULL
  );

  INSERT INTO public.attendance (member_id, session_id, marked_by, marked_at)
  SELECT member_juan, session_evening, super_admin_id, now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE member_id = member_juan AND session_id = session_evening AND deleted_at IS NULL
  );

  -- ---------------------------------------------------------------------------
  -- ARCO requests (admin panel workflow samples)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.arco_requests (member_id, request_type, status, deadline, fulfilled_at, notes, created_at)
  SELECT
    member_maria,
    'access',
    'pending',
    CURRENT_DATE + 10,
    NULL,
    'Solicitud de acceso de prueba — pendiente de cumplimiento',
    now() - interval '2 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.arco_requests
    WHERE member_id = member_maria AND request_type = 'access' AND status = 'pending'
  );

  INSERT INTO public.arco_requests (member_id, request_type, status, deadline, fulfilled_at, notes, created_at)
  SELECT
    member_juan,
    'rectification',
    'fulfilled',
    CURRENT_DATE - 5,
    now() - interval '1 day',
    'Corrección de teléfono completada (dato de prueba)',
    now() - interval '12 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.arco_requests
    WHERE member_id = member_juan AND request_type = 'rectification' AND status = 'fulfilled'
  );

  RAISE NOTICE 'Seed complete: 3 role users (password=test-password) + sample members/sessions/attendance/ARCO';
END $$;
