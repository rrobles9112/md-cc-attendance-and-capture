-- 011_youth_retreat_preregistration.sql
-- Youth retreat pre-registration: dedicated tables, anon RPC insert, payment
-- status machine. Event key is forced to retiro-juvenil-octubre-2026.
--
-- Security model:
--   * ENABLE RLS; no anon policies.
--   * REVOKE table DML+SELECT from anon/PUBLIC (003 default-grants ALL).
--   * Authenticated: registrations SELECT; payments SELECT+INSERT.
--   * Payment INSERT RLS: leader + super_admin only.
--   * RPC register_retreat_preinscription is SECURITY DEFINER SET search_path=''
--     with EXECUTE granted to anon only (REVOKE FROM PUBLIC).
--   * Payment BEFORE/AFTER triggers run as owner (SECURITY DEFINER).
-- Do not add retreat_* to supabase_realtime.

-- =============================================================================
-- TABLES
-- =============================================================================

CREATE TABLE public.retreat_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  birthday DATE,
  is_minor BOOLEAN NOT NULL DEFAULT false,
  legal_rep_name TEXT,
  status TEXT NOT NULL DEFAULT 'preinscrito'
    CHECK (status IN ('preinscrito', 'pagos_parciales', 'inscrito')),
  general_consent_accepted_at TIMESTAMPTZ NOT NULL,
  general_consent_policy_version TEXT NOT NULL,
  sensitive_consent_accepted_at TIMESTAMPTZ,
  sensitive_consent_policy_version TEXT,
  denomination TEXT,
  community_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.retreat_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES public.retreat_registrations(id),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  recorded_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX retreat_registrations_event_email_uidx
  ON public.retreat_registrations (event_key, (lower(btrim(email))));

CREATE UNIQUE INDEX retreat_registrations_event_phone_uidx
  ON public.retreat_registrations (
    event_key,
    (regexp_replace(btrim(phone), '[^0-9]', '', 'g'))
  );

CREATE INDEX retreat_payments_registration_id_idx
  ON public.retreat_payments (registration_id);

-- =============================================================================
-- GRANTS (003 default-grants ALL to anon/authenticated/service_role)
-- =============================================================================

REVOKE ALL ON TABLE public.retreat_registrations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.retreat_registrations TO authenticated;

REVOKE ALL ON TABLE public.retreat_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.retreat_payments TO authenticated;

-- =============================================================================
-- RLS (no anon policies)
-- =============================================================================

ALTER TABLE public.retreat_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retreat_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY retreat_registrations_select ON public.retreat_registrations
  FOR SELECT
  TO authenticated
  USING ((SELECT public.user_role()) IN ('super_admin', 'leader'));

CREATE POLICY retreat_payments_select ON public.retreat_payments
  FOR SELECT
  TO authenticated
  USING ((SELECT public.user_role()) IN ('super_admin', 'leader'));

CREATE POLICY retreat_payments_insert ON public.retreat_payments
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.user_role()) IN ('super_admin', 'leader'));

-- =============================================================================
-- AUDIT + updated_at
-- =============================================================================

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.retreat_registrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER audit_retreat_registrations
  AFTER INSERT OR UPDATE OR DELETE ON public.retreat_registrations
  FOR EACH ROW EXECUTE FUNCTION public.log_mutation();

CREATE TRIGGER audit_retreat_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.retreat_payments
  FOR EACH ROW EXECUTE FUNCTION public.log_mutation();

-- =============================================================================
-- RPC: anonymous pre-registration insert
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_retreat_preinscription(
  p_name text,
  p_phone text,
  p_email text,
  p_birthday date DEFAULT NULL,
  p_legal_rep_name text DEFAULT NULL,
  p_general_consent boolean DEFAULT false,
  p_sensitive_consent boolean DEFAULT false,
  p_denomination text DEFAULT NULL,
  p_community_name text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_event_key constant text := 'retiro-juvenil-octubre-2026';
  c_policy_version constant text := 'pdtp-v1.0-2026-07-17';
  v_name text;
  v_phone text;
  v_email text;
  v_legal_rep text;
  v_is_minor boolean := false;
  v_denomination text := NULL;
  v_community text := NULL;
  v_sensitive_at timestamptz := NULL;
  v_sensitive_policy text := NULL;
  v_id uuid;
BEGIN
  v_name := btrim(COALESCE(p_name, ''));
  v_email := lower(btrim(COALESCE(p_email, '')));
  v_phone := regexp_replace(btrim(COALESCE(p_phone, '')), '[^0-9]', '', 'g');
  v_legal_rep := NULLIF(btrim(COALESCE(p_legal_rep_name, '')), '');

  IF v_name = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  IF v_phone = '' THEN
    RAISE EXCEPTION 'phone is required';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'email is required';
  END IF;
  IF p_general_consent IS NOT TRUE THEN
    RAISE EXCEPTION 'general consent is required';
  END IF;

  IF p_birthday IS NOT NULL
     AND EXTRACT(YEAR FROM age(CURRENT_DATE, p_birthday)) < 18 THEN
    v_is_minor := true;
  END IF;

  IF v_is_minor AND v_legal_rep IS NULL THEN
    RAISE EXCEPTION 'legal representative is required for minors';
  END IF;

  IF p_sensitive_consent IS TRUE THEN
    v_denomination := NULLIF(btrim(COALESCE(p_denomination, '')), '');
    v_community := NULLIF(btrim(COALESCE(p_community_name, '')), '');
    v_sensitive_at := now();
    v_sensitive_policy := c_policy_version;
  END IF;

  INSERT INTO public.retreat_registrations (
    event_key,
    name,
    phone,
    email,
    birthday,
    is_minor,
    legal_rep_name,
    status,
    general_consent_accepted_at,
    general_consent_policy_version,
    sensitive_consent_accepted_at,
    sensitive_consent_policy_version,
    denomination,
    community_name
  ) VALUES (
    c_event_key,
    v_name,
    v_phone,
    v_email,
    p_birthday,
    v_is_minor,
    CASE WHEN v_is_minor THEN v_legal_rep ELSE NULL END,
    'preinscrito',
    now(),
    c_policy_version,
    v_sensitive_at,
    v_sensitive_policy,
    v_denomination,
    v_community
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_retreat_preinscription(
  text, text, text, date, text, boolean, boolean, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_retreat_preinscription(
  text, text, text, date, text, boolean, boolean, text, text
) TO anon, authenticated;

-- =============================================================================
-- Payment guards + status machine
-- =============================================================================

CREATE OR REPLACE FUNCTION public.retreat_payments_guard_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_raw text;
  v_total numeric;
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'retreat payment amount must be greater than 0';
  END IF;

  SELECT s.value INTO v_raw
  FROM public.app_settings s
  WHERE s.key = 'retreat.youth.total_cost';

  IF v_raw IS NULL OR btrim(v_raw) = '' THEN
    RAISE EXCEPTION 'retreat.youth.total_cost is missing or empty';
  END IF;

  BEGIN
    v_total := btrim(v_raw)::numeric;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'retreat.youth.total_cost is not numeric';
  END;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'retreat.youth.total_cost must be positive';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.retreat_payments_apply_status()
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
  SELECT s.value INTO v_raw
  FROM public.app_settings s
  WHERE s.key = 'retreat.youth.total_cost';

  v_total := btrim(v_raw)::numeric;

  SELECT COALESCE(SUM(p.amount), 0) INTO v_sum
  FROM public.retreat_payments p
  WHERE p.registration_id = NEW.registration_id;

  IF v_sum = 0 THEN
    v_status := 'preinscrito';
  ELSIF v_sum < v_total THEN
    v_status := 'pagos_parciales';
  ELSE
    v_status := 'inscrito';
  END IF;

  UPDATE public.retreat_registrations
  SET status = v_status
  WHERE id = NEW.registration_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.retreat_payments_guard_total() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retreat_payments_apply_status() FROM PUBLIC;

CREATE TRIGGER retreat_payments_before_insert
  BEFORE INSERT ON public.retreat_payments
  FOR EACH ROW EXECUTE FUNCTION public.retreat_payments_guard_total();

CREATE TRIGGER retreat_payments_after_insert
  AFTER INSERT ON public.retreat_payments
  FOR EACH ROW EXECUTE FUNCTION public.retreat_payments_apply_status();

-- =============================================================================
-- Seed total (empty — not a numeric default). Owner insert: no INSERT policy.
-- =============================================================================

INSERT INTO public.app_settings (key, value)
VALUES ('retreat.youth.total_cost', '')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
