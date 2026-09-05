-- 021_retreat_registration_deletes.sql
-- Youth retreat pre-registration deletes: staff-only DELETE via RLS plus
-- owner-side status recalculation on payment delete.
--
-- Security model (extends 011, same pattern):
--   * No anon policies; fail-closed (RLS denies by default → 0 rows).
--   * Authenticated: DELETE on both tables for leader + super_admin only,
--     via public.user_role(). server and any other role get 0 rows.
--   * No client UPDATE grant/policy (011 has none; this migration adds none).
--     Status recalculation after payment deletes runs as owner
--     (SECURITY DEFINER, like retreat_payments_apply_status).
--   * No SECURITY DEFINER RPC for deletion (proposal D6/N5).
--   * Existing audit_retreat_* triggers keep covering DELETE (no changes).
-- Depends solely on 011 objects. On rebase against HEAD keep after 020
-- and revalidate against 019.

-- =============================================================================
-- GRANTS
-- =============================================================================

GRANT DELETE ON TABLE public.retreat_registrations TO authenticated;
GRANT DELETE ON TABLE public.retreat_payments TO authenticated;

-- =============================================================================
-- RLS DELETE policies (literal role parity with canDeleteRetreatRegistration)
-- =============================================================================

CREATE POLICY retreat_registrations_delete ON public.retreat_registrations
  FOR DELETE
  TO authenticated
  USING ((SELECT public.user_role()) IN ('super_admin', 'leader'));

CREATE POLICY retreat_payments_delete ON public.retreat_payments
  FOR DELETE
  TO authenticated
  USING ((SELECT public.user_role()) IN ('super_admin', 'leader'));

-- =============================================================================
-- Status recalculation on payment delete (owner-side, covers option (b))
-- =============================================================================

CREATE OR REPLACE FUNCTION public.retreat_payments_apply_status_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_raw text;
  v_total numeric;
  v_sum numeric;
  v_status text;
BEGIN
  SELECT COALESCE(SUM(p.amount), 0) INTO v_sum
  FROM public.retreat_payments p
  WHERE p.registration_id = OLD.registration_id;

  IF v_sum = 0 THEN
    UPDATE public.retreat_registrations
    SET status = 'preinscrito'
    WHERE id = OLD.registration_id;
    RETURN OLD;
  END IF;

  SELECT s.value INTO v_raw
  FROM public.app_settings s
  WHERE s.key = 'retreat.youth.total_cost';

  -- Total missing/empty: leave the surviving row untouched (spec).
  IF v_raw IS NULL OR btrim(v_raw) = '' THEN
    RETURN OLD;
  END IF;

  BEGIN
    v_total := btrim(v_raw)::numeric;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN OLD;
  END;

  -- Total non-numeric or non-positive: leave the row untouched (spec).
  IF v_total IS NULL OR v_total <= 0 THEN
    RETURN OLD;
  END IF;

  -- Same threshold semantics as retreat_payments_apply_status (011).
  IF v_sum < v_total THEN
    v_status := 'pagos_parciales';
  ELSE
    v_status := 'inscrito';
  END IF;

  UPDATE public.retreat_registrations
  SET status = v_status
  WHERE id = OLD.registration_id;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.retreat_payments_apply_status_on_delete() FROM PUBLIC;

CREATE TRIGGER retreat_payments_after_delete
  AFTER DELETE ON public.retreat_payments
  FOR EACH ROW EXECUTE FUNCTION public.retreat_payments_apply_status_on_delete();

NOTIFY pgrst, 'reload schema';
