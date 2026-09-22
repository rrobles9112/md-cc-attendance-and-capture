-- DIAGNOSTIC — run in Supabase Dashboard → SQL Editor (production project ppiyddosohwswhfzqhk)
-- Paste the full output back. Read-only: no mutations.

\set superadmin_id '''a0000000-0000-4000-8000-000000000001'''

-- 1) Current user_role() function definition (is the 007 version active?)
SELECT pg_get_functiondef('public.user_role()'::regprocedure) AS user_role_def;

-- 2) What user_role() returns WITH the superadmin's JWT claims set
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"super_admin"},"email":"test-superadmin@test.com"}';
SELECT public.user_role() AS user_role_with_superadmin_jwt;
RESET role;

-- 3) What user_role() returns with NO app_metadata (the 006 path / RLS-test path)
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT public.user_role() AS user_role_no_app_metadata;
RESET role;

-- 4) profiles.role for the superadmin (the desync check)
SELECT id, role, full_name, created_at FROM public.profiles WHERE id = :superadmin_id;

-- 5) auth.users raw_app_meta_data for the superadmin (the JWT source)
SELECT id, email, raw_app_meta_data, raw_user_meta_data
FROM auth.users WHERE id = :superadmin_id;

-- 6) The members UPDATE policy (USING + WITH CHECK)
SELECT polname, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'members' AND cmd = 'UPDATE';

-- 7) All members policies (for completeness)
SELECT polname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'members' ORDER BY polname;

-- 8) Applied migrations (are 006, 007, 008 recorded?)
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
