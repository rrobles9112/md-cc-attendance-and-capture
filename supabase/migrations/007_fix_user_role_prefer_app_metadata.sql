-- 007_fix_user_role_prefer_app_metadata.sql
-- Fix: 42501 persisted on member writes even after migration 006 because production
-- `profiles.role` was 'server' (the handle_new_user() default) while the user's JWT
-- `app_metadata.role` was 'super_admin'. seed.sql — which sets the test users' profile
-- roles — is local-only and is never applied to the cloud project, so the two sources
-- desynced. Migration 006 only fell back to app_metadata.role when profiles was NULL,
-- which did not cover the "profiles exists but with the wrong role" case.
--
-- Two-part fix:
--   1. user_role() now prefers the JWT app_metadata.role (authoritative, admin-set,
--      tamper-proof — not user_metadata) and falls back to profiles.role. This
--      matches the client useRole() hook and removes the desync window.
--   2. One-time idempotent sync of profiles.role from auth.users.raw_app_meta_data
--      so the cached profile matches the authoritative claim for every user.
--
-- Note: app_metadata is server-controlled (set via the Supabase admin API / dashboard),
-- NOT user-settable, so preferring it is safe. The top-level JWT 'role' claim is the
-- PostgREST role ('authenticated') and is intentionally ignored.

-- =============================================================================
-- 1) user_role(): prefer app_metadata.role, fall back to profiles.role.
--    Type references are schema-qualified because the function runs with an empty
--    search_path (SECURITY DEFINER hardening).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.user_role() RETURNS public.app_role AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role')::public.app_role,
    (SELECT role FROM public.profiles WHERE id = auth.uid())
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

-- =============================================================================
-- 2) One-time sync: align profiles.role with the authoritative app_metadata.role.
--    Runs as the migration user (superuser) so it can read auth.users. Idempotent:
--    only touches rows where the two sources actually differ.
-- =============================================================================
DO $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE public.profiles p
  SET role = (u.raw_app_meta_data ->> 'role')::public.app_role,
      updated_at = now()
  FROM auth.users u
  WHERE p.id = u.id
    AND u.raw_app_meta_data ->> 'role' IS NOT NULL
    AND u.raw_app_meta_data ->> 'role' <> p.role::text
    AND (u.raw_app_meta_data ->> 'role')::public.app_role IS NOT NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Synced % profile row(s) to match app_metadata.role', v_updated;
END $$;
