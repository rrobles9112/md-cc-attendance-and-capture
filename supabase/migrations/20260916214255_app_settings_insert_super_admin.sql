-- 20260916214255_app_settings_insert_super_admin.sql
-- Fix T1: allow client upsert (INSERT ... ON CONFLICT DO UPDATE) for super_admin.
-- PostgREST upsert evaluates the INSERT branch first, so it requires a FOR INSERT
-- policy even when the row already exists. Existing SELECT/UPDATE policies untouched.
-- Rollback: DROP POLICY IF EXISTS "app_settings_insert_super_admin" ON public.app_settings;
CREATE POLICY "app_settings_insert_super_admin"
ON public.app_settings
FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.user_role()) = 'super_admin');
