-- 006_fix_rls_write_policies_and_user_role.sql
-- Fix: 42501 "new row violates row-level security policy" on members (and other tables)
-- during offline-queue flush when the app comes back online.
--
-- Root causes addressed:
--   1. user_role() returned NULL when no profiles row matched auth.uid() (e.g. the auth user
--      existed but handle_new_user() had not yet created the profile, or the profile was
--      deleted). A NULL role made every USING/WITH CHECK expression evaluate to NULL
--      (not TRUE), so all writes were denied even for the actual super_admin.
--   2. UPDATE policies were declared with only a USING clause and no explicit WITH CHECK.
--      PostgreSQL silently reuses USING as WITH CHECK, which is correct but fragile and
--      made the soft-delete update path (members/page.tsx -> enqueue 'update') hard to
--      reason about. Make the intent explicit so the new row is validated on every UPDATE.
--   3. audit_log had no INSERT policy, so the client-side consent logger
--      (logConsentEvent) silently failed when it tried to insert into audit_log. The
--      audit_members/audit_consent_records triggers already capture mutations via the
--      SECURITY DEFINER log_mutation() function, so client writes to audit_log are
--      redundant. We still add a defensive INSERT policy so explicit consent audit
--      entries written by authenticated users are accepted (not denied) when present.

-- =============================================================================
-- Robust user_role(): profiles lookup first, then JWT app_metadata.role fallback.
-- app_metadata.role is the authoritative app role set at signup / by an admin; the
-- PostgREST 'role' JWT claim (anon/authenticated) is NOT an app_role and is ignored.
-- Type references are schema-qualified because the function runs with an empty
-- search_path (SECURITY DEFINER hardening), so unqualified type names won't resolve.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.user_role() RETURNS public.app_role AS $$
  SELECT COALESCE(
    (SELECT role FROM public.profiles WHERE id = auth.uid()),
    (auth.jwt() -> 'app_metadata' ->> 'role')::public.app_role
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

-- =============================================================================
-- members: explicit WITH CHECK on UPDATE (soft-delete sets deleted_at + updated_at)
-- =============================================================================
DROP POLICY IF EXISTS members_update ON members;
CREATE POLICY members_update ON members FOR UPDATE
  USING (public.user_role() = 'super_admin')
  WITH CHECK (public.user_role() = 'super_admin');

-- =============================================================================
-- sessions
-- =============================================================================
DROP POLICY IF EXISTS sessions_update ON sessions;
CREATE POLICY sessions_update ON sessions FOR UPDATE
  USING (public.user_role() = 'super_admin')
  WITH CHECK (public.user_role() = 'super_admin');

-- =============================================================================
-- social_media
-- =============================================================================
DROP POLICY IF EXISTS social_media_update ON social_media;
CREATE POLICY social_media_update ON social_media FOR UPDATE
  USING (public.user_role() = 'super_admin')
  WITH CHECK (public.user_role() = 'super_admin');

-- =============================================================================
-- whatsapp_numbers
-- =============================================================================
DROP POLICY IF EXISTS whatsapp_numbers_update ON whatsapp_numbers;
CREATE POLICY whatsapp_numbers_update ON whatsapp_numbers FOR UPDATE
  USING (public.user_role() = 'super_admin')
  WITH CHECK (public.user_role() = 'super_admin');

-- =============================================================================
-- attendance
-- =============================================================================
DROP POLICY IF EXISTS attendance_update ON attendance;
CREATE POLICY attendance_update ON attendance FOR UPDATE
  USING (public.user_role() = 'super_admin')
  WITH CHECK (public.user_role() = 'super_admin');

-- =============================================================================
-- consent_records
-- =============================================================================
DROP POLICY IF EXISTS consent_records_update ON consent_records;
CREATE POLICY consent_records_update ON consent_records FOR UPDATE
  USING (public.user_role() = 'super_admin')
  WITH CHECK (public.user_role() = 'super_admin');

-- =============================================================================
-- arco_requests
-- =============================================================================
DROP POLICY IF EXISTS arco_requests_update ON arco_requests;
CREATE POLICY arco_requests_update ON arco_requests FOR UPDATE
  USING (public.user_role() = 'super_admin')
  WITH CHECK (public.user_role() = 'super_admin');

-- =============================================================================
-- profiles
-- =============================================================================
DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (public.user_role() = 'super_admin')
  WITH CHECK (public.user_role() = 'super_admin');

-- =============================================================================
-- app_settings
-- =============================================================================
DROP POLICY IF EXISTS app_settings_update ON app_settings;
CREATE POLICY app_settings_update ON app_settings FOR UPDATE
  USING (public.user_role() = 'super_admin')
  WITH CHECK (public.user_role() = 'super_admin');

-- =============================================================================
-- audit_log: allow authenticated users to append consent audit entries directly.
-- Reads remain super_admin only. The mutation triggers (log_mutation) already write
-- via SECURITY DEFINER, so this policy only governs direct client inserts.
-- =============================================================================
CREATE POLICY audit_log_insert ON audit_log FOR INSERT
  TO authenticated WITH CHECK (true);
