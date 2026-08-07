-- 009_fix_select_policies_for_soft_delete.sql
-- Fix: soft-delete PATCH (UPDATE deleted_at) fails with 42501
-- "new row violates row-level security policy" even for super_admin.
--
-- Root cause (Postgres RLS + soft-delete interaction):
--   UPDATE with a WHERE clause also evaluates SELECT policies against BOTH
--   the existing row and the new row image (see Postgres CREATE POLICY docs,
--   "Policies Applied by Command Type"). Our SELECT policies required
--   `deleted_at IS NULL`, so the moment soft-delete sets deleted_at the new
--   row fails SELECT and Postgres raises 42501 — even though the UPDATE
--   policy itself only checks user_role() = 'super_admin'.
--
-- Evidence (production REST, test-superadmin JWT with app_metadata.role=super_admin):
--   PATCH members SET name=...           → 200
--   PATCH members SET deleted_at=now()   → 403 / 42501
--
-- Fix: keep active-row visibility for all app roles; allow super_admin to
-- also see soft-deleted rows so soft-delete UPDATEs and admin purge flows work.

DROP POLICY IF EXISTS members_select ON members;
CREATE POLICY members_select ON members FOR SELECT USING (
  public.user_role() IN ('super_admin', 'leader', 'server')
  AND (
    deleted_at IS NULL
    OR public.user_role() = 'super_admin'
  )
);

DROP POLICY IF EXISTS sessions_select ON sessions;
CREATE POLICY sessions_select ON sessions FOR SELECT USING (
  public.user_role() IN ('super_admin', 'leader', 'server')
  AND (
    deleted_at IS NULL
    OR public.user_role() = 'super_admin'
  )
);

DROP POLICY IF EXISTS social_media_select ON social_media;
CREATE POLICY social_media_select ON social_media FOR SELECT USING (
  public.user_role() IN ('super_admin', 'leader', 'server')
  AND (
    deleted_at IS NULL
    OR public.user_role() = 'super_admin'
  )
);

DROP POLICY IF EXISTS whatsapp_numbers_select ON whatsapp_numbers;
CREATE POLICY whatsapp_numbers_select ON whatsapp_numbers FOR SELECT USING (
  public.user_role() IN ('super_admin', 'leader', 'server')
  AND (
    deleted_at IS NULL
    OR public.user_role() = 'super_admin'
  )
);

DROP POLICY IF EXISTS attendance_select ON attendance;
CREATE POLICY attendance_select ON attendance FOR SELECT USING (
  public.user_role() IN ('super_admin', 'leader', 'server')
  AND (
    deleted_at IS NULL
    OR public.user_role() = 'super_admin'
  )
);

NOTIFY pgrst, 'reload schema';
