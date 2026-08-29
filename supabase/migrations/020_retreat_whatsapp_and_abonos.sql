-- 020_retreat_whatsapp_and_abonos.sql
-- Three product fixes, self-contained restatements (migrations <= 019 untouched):
--
-- 1) WhatsApp fields on retreat_registrations (has_whatsapp NOT NULL DEFAULT
--    false, whatsapp_number TEXT NULL) persisted by BOTH preinscription RPCs
--    via new trailing optional params p_has_whatsapp / p_whatsapp_number.
--
-- 2) transfer_retreat_to_valientes: the ONLY admission gate is
--    status = 'inscrito' (status is trigger-maintained from payments or
--    seeded directly; the UI gates on the same status, so RPC and UI must
--    agree). missing_total and SUM(payments) >= total preconditions are
--    removed. The duplicate-member check (email OR phone digits, only when
--    member_id IS NULL) moves BEFORE the status gate so data errors surface
--    first. WhatsApp data propagates to members + whatsapp_numbers in both
--    INSERT and UPDATE branches.
--
-- 3) retreat_payments_guard_total (BEFORE INSERT): no abonos once fully paid
--    and no abono larger than the remaining balance. The status machine
--    (retreat_payments_apply_status) is intentionally untouched.

-- =============================================================================
-- 1) Columns
-- =============================================================================

ALTER TABLE public.retreat_registrations
  ADD COLUMN IF NOT EXISTS has_whatsapp boolean NOT NULL DEFAULT false;
ALTER TABLE public.retreat_registrations
  ADD COLUMN IF NOT EXISTS whatsapp_number text;

COMMENT ON COLUMN public.retreat_registrations.has_whatsapp IS
  'Whether the preinscrito reports WhatsApp on the primary phone; propagated to members.has_whatsapp on Valientes transfer.';
COMMENT ON COLUMN public.retreat_registrations.whatsapp_number IS
  'Optional additional WhatsApp number captured at preinscription (trimmed); propagated to whatsapp_numbers on Valientes transfer.';

-- =============================================================================
-- 2) retreat_payments_guard_total — cap abonos until totalidad
--    Full restatement of 011 body + remaining-balance validations.
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
  v_sum numeric;
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

  SELECT COALESCE(SUM(p.amount), 0) INTO v_sum
  FROM public.retreat_payments p
  WHERE p.registration_id = NEW.registration_id;

  IF v_sum >= v_total THEN
    RAISE EXCEPTION 'retreat registration already fully paid: sum % >= total %', v_sum, v_total
      USING ERRCODE = '23514';
  END IF;

  IF v_sum + NEW.amount > v_total THEN
    RAISE EXCEPTION 'payment exceeds remaining balance: sum % + % > total %', v_sum, NEW.amount, v_total
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.retreat_payments_guard_total() FROM PUBLIC;

-- =============================================================================
-- 3) register_retreat_preinscription — new trailing optional WhatsApp params.
--    Full restatement of the 011 body. Old 9-arg overload dropped so PostgREST
--    resolves exactly one signature.
-- =============================================================================

DROP FUNCTION IF EXISTS public.register_retreat_preinscription(
  text, text, text, date, text, boolean, boolean, text, text
);

CREATE OR REPLACE FUNCTION public.register_retreat_preinscription(
  p_name text,
  p_phone text,
  p_email text,
  p_birthday date DEFAULT NULL,
  p_legal_rep_name text DEFAULT NULL,
  p_general_consent boolean DEFAULT false,
  p_sensitive_consent boolean DEFAULT false,
  p_denomination text DEFAULT NULL,
  p_community_name text DEFAULT NULL,
  p_has_whatsapp boolean DEFAULT false,
  p_whatsapp_number text DEFAULT NULL
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
  v_has_whatsapp boolean := false;
  v_whatsapp text := NULL;
  v_id uuid;
BEGIN
  v_name := btrim(COALESCE(p_name, ''));
  v_email := lower(btrim(COALESCE(p_email, '')));
  v_phone := regexp_replace(btrim(COALESCE(p_phone, '')), '[^0-9]', '', 'g');
  v_legal_rep := NULLIF(btrim(COALESCE(p_legal_rep_name, '')), '');
  v_has_whatsapp := COALESCE(p_has_whatsapp, false);
  v_whatsapp := NULLIF(btrim(COALESCE(p_whatsapp_number, '')), '');

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
    community_name,
    has_whatsapp,
    whatsapp_number
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
    v_community,
    v_has_whatsapp,
    v_whatsapp
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_retreat_preinscription(
  text, text, text, date, text, boolean, boolean, text, text, boolean, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_retreat_preinscription(
  text, text, text, date, text, boolean, boolean, text, text, boolean, text
) TO anon, authenticated;

COMMENT ON FUNCTION public.register_retreat_preinscription(
  text, text, text, date, text, boolean, boolean, text, text, boolean, text
) IS 'Anon retreat preinscription insert; SECURITY DEFINER SET search_path=''''; fixed event key + Ley 1581 consent stamps on row; persists has_whatsapp / trimmed whatsapp_number (020).';

-- =============================================================================
-- 4) register_retreat_preinscription_for_member — new trailing optional
--    WhatsApp params. Full restatement of the 019 body (server included in the
--    role gate). Old 7-arg overload dropped.
-- =============================================================================

DROP FUNCTION IF EXISTS public.register_retreat_preinscription_for_member(
  uuid, date, text, boolean, boolean, text, text
);

CREATE OR REPLACE FUNCTION public.register_retreat_preinscription_for_member(
  p_member_id uuid,
  p_birthday date DEFAULT NULL,
  p_legal_rep_name text DEFAULT NULL,
  p_general_consent boolean DEFAULT false,
  p_sensitive_consent boolean DEFAULT false,
  p_denomination text DEFAULT NULL,
  p_community_name text DEFAULT NULL,
  p_has_whatsapp boolean DEFAULT false,
  p_whatsapp_number text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_event_key      constant text := 'retiro-juvenil-octubre-2026';
  c_policy_version constant text := 'pdtp-v1.0-2026-07-17';
  v_name           text;
  v_phone          text;
  v_email          text;
  v_birthday       date;
  v_legal_rep      text;
  v_is_minor       boolean := false;
  v_denomination   text := NULL;
  v_community      text := NULL;
  v_sensitive_at   timestamptz := NULL;
  v_sensitive_policy text := NULL;
  v_has_whatsapp   boolean := false;
  v_whatsapp       text := NULL;
  v_id             uuid;
BEGIN
  -- 1) Role gate — uses existing SECURITY DEFINER helper public.user_role()
  IF (SELECT public.user_role()) NOT IN ('leader','super_admin','server') THEN
    RAISE EXCEPTION 'not_authorized: leader/super_admin/server required' USING ERRCODE = '42501';
  END IF;

  -- 2) Load canonical identity from members (never trust client-supplied name/phone/email for this RPC)
  SELECT btrim(m.name),
         regexp_replace(btrim(m.phone), '[^0-9]', '', 'g'),
         lower(btrim(m.email)),
         COALESCE(p_birthday, m.birthday)
    INTO v_name, v_phone, v_email, v_birthday
  FROM public.members m
  WHERE m.id = p_member_id AND m.deleted_at IS NULL;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'member not found or deleted' USING ERRCODE = 'P0002';
  END IF;
  IF v_name = '' OR v_phone = '' OR v_email = '' THEN
    RAISE EXCEPTION 'member is missing required identity fields (name/phone/email)' USING ERRCODE = '23502';
  END IF;

  -- 3) Fresh consent (Ley 1581)
  IF p_general_consent IS NOT TRUE THEN
    RAISE EXCEPTION 'missing_consent: general consent is required' USING ERRCODE = '23514';
  END IF;

  -- 4) Minor / legal rep derivation
  IF v_birthday IS NOT NULL
     AND EXTRACT(YEAR FROM age(CURRENT_DATE, v_birthday)) < 18 THEN
    v_is_minor := true;
  END IF;
  v_legal_rep := NULLIF(btrim(COALESCE(p_legal_rep_name, '')), '');

  IF v_is_minor AND v_legal_rep IS NULL THEN
    RAISE EXCEPTION 'legal representative is required for minors' USING ERRCODE = '23514';
  END IF;

  -- 5) Friendly duplicate pre-check: member_id OR normalized email OR digit-only phone for same event
  IF EXISTS (
    SELECT 1 FROM public.retreat_registrations r
    WHERE r.event_key = c_event_key
      AND (
            r.member_id = p_member_id
         OR lower(btrim(r.email)) = v_email
         OR regexp_replace(btrim(r.phone), '[^0-9]', '', 'g') = v_phone
      )
  ) THEN
    RAISE EXCEPTION 'already_preinscribed: a pre-registration with this member/email/phone already exists for this event'
      USING ERRCODE = '23505';
  END IF;

  -- 6) Sensitive gating + WhatsApp normalization
  IF p_sensitive_consent IS TRUE THEN
    v_denomination := NULLIF(btrim(COALESCE(p_denomination, '')), '');
    v_community    := NULLIF(btrim(COALESCE(p_community_name, '')), '');
    v_sensitive_at := now();
    v_sensitive_policy := c_policy_version;
  END IF;
  v_has_whatsapp := COALESCE(p_has_whatsapp, false);
  v_whatsapp := NULLIF(btrim(COALESCE(p_whatsapp_number, '')), '');

  -- 7) Insert — member_id set, consent stamps on row, status preinscrito
  INSERT INTO public.retreat_registrations (
    event_key, name, phone, email, birthday, is_minor, legal_rep_name, status,
    general_consent_accepted_at, general_consent_policy_version,
    sensitive_consent_accepted_at, sensitive_consent_policy_version,
    denomination, community_name, member_id, has_whatsapp, whatsapp_number
  ) VALUES (
    c_event_key, v_name, v_phone, v_email, v_birthday, v_is_minor,
    CASE WHEN v_is_minor THEN v_legal_rep ELSE NULL END,
    'preinscrito', now(), c_policy_version,
    v_sensitive_at, v_sensitive_policy,
    v_denomination, v_community, p_member_id, v_has_whatsapp, v_whatsapp
  )
  RETURNING id INTO v_id;

  RETURN v_id;

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'already_preinscribed: duplicate email/phone for this event: %', SQLERRM
      USING ERRCODE = '23505';
  WHEN OTHERS THEN
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.register_retreat_preinscription_for_member(
  uuid, date, text, boolean, boolean, text, text, boolean, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_retreat_preinscription_for_member(
  uuid, date, text, boolean, boolean, text, text, boolean, text
) TO authenticated;

COMMENT ON FUNCTION public.register_retreat_preinscription_for_member(
  uuid, date, text, boolean, boolean, text, text, boolean, text
) IS 'Authenticated member->retreat preinscription; SECURITY DEFINER SET search_path=''''; role gate leader/super_admin/server; re-derives PII from members.id; fresh Ley 1581 consent on row; duplicate-safe (pre-check + unique_violation->23505); persists has_whatsapp / trimmed whatsapp_number (020).';

-- =============================================================================
-- 5) transfer_retreat_to_valientes — status-only admission gate, duplicate
--    check first, WhatsApp propagation in both branches. Full restatement of
--    the 014 body with 020 product changes.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.transfer_retreat_to_valientes(p_registration_id uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rr public.retreat_registrations%ROWTYPE;
  v_email text;
  v_phone_digits text;
  v_member_id uuid;
  v_key text;
BEGIN
  IF (SELECT public.user_role()) NOT IN ('leader','super_admin') THEN
    RAISE EXCEPTION 'not_authorized: leader/super_admin required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_rr FROM public.retreat_registrations WHERE id=p_registration_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retreat registration not found: %', p_registration_id USING ERRCODE='P0002';
  END IF;
  IF v_rr.transferred_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_transferred: % already transferred at % to %', p_registration_id, v_rr.transferred_at, v_rr.transferred_member_id USING ERRCODE='23505';
  END IF;
  IF v_rr.member_id IS NOT NULL THEN
    PERFORM 1 FROM public.members WHERE id=v_rr.member_id AND pastoral_group='Valientes';
    IF FOUND THEN
      RAISE EXCEPTION 'already_transferred: linked member % already Valientes', v_rr.member_id USING ERRCODE='23505';
    END IF;
  END IF;
  -- Duplicate data check BEFORE the status gate so data errors surface first.
  v_email:=lower(btrim(v_rr.email));
  v_phone_digits:=regexp_replace(btrim(v_rr.phone),'[^0-9]','g');
  IF v_rr.member_id IS NULL AND EXISTS (SELECT 1 FROM public.members WHERE deleted_at IS NULL AND (lower(btrim(email))=v_email OR regexp_replace(phone,'[^0-9]','g')=v_phone_digits)) THEN
    RAISE EXCEPTION 'already_member: a member with this email/phone already exists' USING ERRCODE='23505';
  END IF;
  -- Single admission gate: status is trigger-maintained from payments (or
  -- seeded directly), and the UI button gates on the same status.
  IF v_rr.status IS DISTINCT FROM 'inscrito' THEN
    RAISE EXCEPTION 'not_inscrito: status % is not inscrito', v_rr.status USING ERRCODE='23514';
  END IF;
  BEGIN SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name='members_encryption_key' LIMIT 1; EXCEPTION WHEN undefined_table THEN v_key:=NULL; WHEN OTHERS THEN v_key:=NULL; END;
  IF v_key IS NULL THEN v_key:='demo-local-pgcrypto-key-not-for-prod'; END IF;
  IF v_rr.member_id IS NOT NULL THEN
    UPDATE public.members SET pastoral_group='Valientes', has_whatsapp = has_whatsapp OR COALESCE(v_rr.has_whatsapp,false) WHERE id=v_rr.member_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'member not found: %', v_rr.member_id USING ERRCODE='P0002'; END IF;
    v_member_id:=v_rr.member_id;
  ELSE
    INSERT INTO public.members(name, name_normalized, phone, email, birthday, is_minor, legal_rep_name, has_whatsapp, consent_recorded, sensitive_consent_recorded, denomination_encrypted, community_name_encrypted, pastoral_group, created_by, duplicate_flag) VALUES (
      btrim(v_rr.name), lower(btrim(v_rr.name)),
      CASE WHEN v_rr.phone ~ '^\+' THEN v_rr.phone WHEN char_length(v_phone_digits)=10 THEN '+57'||v_phone_digits WHEN char_length(v_phone_digits)=12 AND left(v_phone_digits,2)='57' THEN '+'||v_phone_digits ELSE v_rr.phone END,
      v_email, v_rr.birthday, v_rr.is_minor, v_rr.legal_rep_name, COALESCE(v_rr.has_whatsapp,false), true, (v_rr.sensitive_consent_accepted_at IS NOT NULL),
      CASE WHEN v_rr.sensitive_consent_accepted_at IS NOT NULL AND v_rr.denomination IS NOT NULL THEN extensions.pgp_sym_encrypt(btrim(v_rr.denomination), v_key) ELSE NULL END,
      CASE WHEN v_rr.sensitive_consent_accepted_at IS NOT NULL AND v_rr.community_name IS NOT NULL THEN extensions.pgp_sym_encrypt(btrim(v_rr.community_name), v_key) ELSE NULL END,
      'Valientes', auth.uid(), false) RETURNING id INTO v_member_id;
  END IF;
  -- Propagate the optional additional WhatsApp number (both branches, idempotent).
  IF v_rr.whatsapp_number IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.whatsapp_numbers w WHERE w.member_id=v_member_id AND w.number=v_rr.whatsapp_number AND w.deleted_at IS NULL
  ) THEN
    INSERT INTO public.whatsapp_numbers (member_id, number, is_primary_phone) VALUES (v_member_id, v_rr.whatsapp_number, false);
  END IF;
  UPDATE public.retreat_registrations SET transferred_at=now(), transferred_member_id=v_member_id, transferred_by=auth.uid() WHERE id=p_registration_id;
  RETURN v_member_id;
EXCEPTION
  WHEN unique_violation THEN
    IF SQLERRM LIKE '%already_transferred%' OR SQLERRM LIKE '%already_member%' THEN RAISE;
    ELSE RAISE EXCEPTION 'already_member: duplicate email/phone races to unique index: %', SQLERRM USING ERRCODE='23505'; END IF;
  WHEN OTHERS THEN RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_retreat_to_valientes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_retreat_to_valientes(uuid) TO authenticated;
COMMENT ON FUNCTION public.transfer_retreat_to_valientes(uuid) IS 'Retreat→Valientes transfer; SECURITY DEFINER SET search_path=''''; leader/super_admin gate; FOR UPDATE idempotency; status-only admission gate (missing_total/SUM preconditions removed in 020); duplicate check before status gate; WhatsApp propagation to members + whatsapp_numbers; pgp_sym_encrypt vault.';

NOTIFY pgrst, 'reload schema';
