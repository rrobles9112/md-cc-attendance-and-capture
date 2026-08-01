-- 004_fix_user_role_profiles_lookup.sql
-- Fix: user_role() previously read auth.jwt()->>'role' and cast it to app_role.
-- In real PostgREST requests that claim is the PostgREST role ('anon'/'authenticated'),
-- never an app_role, so every RLS policy evaluation raised 22P02 (HTTP 400) and all
-- app writes failed. The pgTAP tests passed only because they simulated claims with
-- role = app_role, which no real Supabase JWT contains.
-- Correct pattern: resolve the app role from public.profiles keyed by auth.uid().
-- SECURITY DEFINER is required so the function bypasses profiles RLS and does not
-- recurse (profiles policies themselves call user_role()).

CREATE OR REPLACE FUNCTION public.user_role() RETURNS app_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;
