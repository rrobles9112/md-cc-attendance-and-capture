-- 008_reload_postgrest_schema.sql
-- Force PostgREST to reload its schema/function cache so the updated user_role()
-- (migration 007: prefer app_metadata.role) takes effect for REST queries.
--
-- Background: `supabase db push` applies `CREATE OR REPLACE FUNCTION` to pg_catalog
-- but does NOT notify PostgREST to invalidate its prepared-statement / function
-- cache. Until PostgREST reloads, REST queries keep using the previously
-- cached function body, so the old user_role() (profiles-first, returning
-- 'server' for the test users) kept being evaluated and member UPDATEs kept
-- failing with 42501 even though the new function was already in pg_catalog.
--
-- `NOTIFY pgrst, 'reload schema'` is the documented Supabase/PostgREST signal
-- to reload the cache. It is idempotent and safe to run repeatedly.

NOTIFY pgrst, 'reload schema';
