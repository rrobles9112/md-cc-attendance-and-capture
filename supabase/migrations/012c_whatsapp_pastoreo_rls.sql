-- 012c_whatsapp_pastoreo_rls.sql
-- WhatsApp Pastoreo Notifications — RLS (PR1, T-012)
-- Must follow supabase-postgres-best-practices security-* and supabase skill
-- security checklist: TO authenticated USING ((SELECT public.user_role())...),
-- no bare TO authenticated, no SECURITY DEFINER without auth.uid() guard.
-- notification_log is append-only via service_role (Edge Function); no
-- INSERT/UPDATE/DELETE policies for authenticated.

-- =============================================================================
-- notification_log — ENABLE RLS + policies
-- =============================================================================
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

-- Explicit grants — per skill rule 4 (new tables not auto-exposed)
REVOKE ALL ON TABLE public.notification_log FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.notification_log TO authenticated;
-- No INSERT/UPDATE/DELETE grants to authenticated — writes are service_role only

-- SELECT: super_admin + leader only; server/anon get 0 rows
DROP POLICY IF EXISTS notification_log_select ON public.notification_log;
CREATE POLICY notification_log_select ON public.notification_log
  FOR SELECT
  TO authenticated
  USING ((SELECT public.user_role()) IN ('super_admin','leader'));

-- No INSERT/UPDATE/DELETE policies for authenticated — service_role bypasses RLS.

-- =============================================================================
-- app_settings — whatsapp_* UPDATE remains super_admin only (001/006 already
-- restricts app_settings_update to super_admin; no extra policy needed).
-- Document the invariant: whatsapp_* keys are managed by super_admin only.
-- =============================================================================
-- Existing policy: app_settings_update USING (public.user_role() = 'super_admin')
-- already covers whatsapp_enabled, whatsapp_monthly_cap, etc.

-- =============================================================================
-- Pastoreo view (if introduced later) MUST be WITH (security_invoker = true).
-- No view created in PR1 — placeholder comment for PR3.
-- =============================================================================
-- Example (deferred to PR3):
-- CREATE OR REPLACE VIEW public.v_pastoreo_stats
-- WITH (security_invoker = true) AS ...

NOTIFY pgrst, 'reload schema';
