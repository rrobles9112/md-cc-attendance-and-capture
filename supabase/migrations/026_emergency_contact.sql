-- 026_emergency_contact.sql
-- Emergency contact (full name, relationship, mobile phone) for retreat
-- pre-registrations and member captures. Purely additive: legal_rep_name
-- (required for minors, Ley 1581) and has_whatsapp / whatsapp_number are
-- untouched.
--
-- Pattern mirrors 023: columns + both retreat RPCs restated with trailing
-- optional params (DEFAULT NULL preserves old call sites). The bodies below
-- are the current definitions from 025 (anon RPC, duplicate-safe) and 023
-- (member RPC, super_admin gate from 022) with only the emergency-contact
-- additions.
--
-- Members table gets the same three columns; the client syncs them through
-- the Dexie offline path (whole-row upsert in flushQueue) and they inherit
-- the existing table-level grants/RLS.

-- =============================================================================
-- 1) Columns — retreat_registrations
-- =============================================================================

ALTER TABLE public.retreat_registrations
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

COMMENT ON COLUMN public.retreat_registrations.emergency_contact_name IS
  'Emergency contact full name captured at preinscription (optional; trimmed).';
COMMENT ON COLUMN public.retreat_registrations.emergency_contact_relationship IS
  'Emergency contact relationship to the registrant, e.g. madre / padre / familiar cercano (optional; trimmed).';
COMMENT ON COLUMN public.retreat_registrations.emergency_contact_phone IS
  'Emergency contact mobile phone captured at preinscription (optional; trimmed).';

-- =============================================================================
-- 2) Columns — members
-- =============================================================================

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

COMMENT ON COLUMN public.members.emergency_contact_name IS
  'Emergency contact full name captured at member registration (optional; trimmed).';
COMMENT ON COLUMN public.members.emergency_contact_relationship IS
  'Emergency contact relationship to the member, e.g. madre / padre / familiar cercano (optional; trimmed).';
COMMENT ON COLUMN public.members.emergency_contact_phone IS
  'Emergency contact mobile phone captured at member registration (optional; trimmed).';

-- =============================================================================
-- 3) register_retreat_preinscription — restate of the 025 body with trailing
--    optional emergency-contact params. Old 15-arg overload dropped so
--    PostgREST resolves exactly one signature.
-- =============================================================================

DROP FUNCTION IF EXISTS public.register_retreat_preinscription(
  text, text, text, date, text, boolean, boolean, text, text, boolean, text,
  boolean, text, text, text
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
  p_whatsapp_number text DEFAULT NULL,
  p_has_medical_conditions boolean DEFAULT false,
  p_medical_conditions text DEFAULT NULL,
  p_medical_medications text DEFAULT NULL,
  p_medical_dosage text DEFAULT NULL,
  p_emergency_contact_name text DEFAULT NULL,
  p_emergency_contact_relationship text DEFAULT NULL,
  p_emergency_contact_phone text DEFAULT NULL
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
  v_has_medical boolean := false;
  v_medical_conditions text := NULL;
  v_medical_medications text := NULL;
  v_medical_dosage text := NULL;
  v_emergency_name text := NULL;
  v_emergency_relationship text := NULL;
  v_emergency_phone text := NULL;
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

  IF EXISTS (
    SELECT 1 FROM public.retreat_registrations r
    WHERE r.event_key = c_event_key
      AND (
            lower(btrim(r.email)) = v_email
         OR regexp_replace(btrim(r.phone), '[^0-9]', '', 'g') = v_phone
      )
  ) THEN
    RAISE EXCEPTION 'already_preinscribed: a pre-registration with this email/phone already exists for this event'
      USING ERRCODE = '23505';
  END IF;

  IF p_sensitive_consent IS TRUE THEN
    v_denomination := NULLIF(btrim(COALESCE(p_denomination, '')), '');
    v_community := NULLIF(btrim(COALESCE(p_community_name, '')), '');
    v_sensitive_at := now();
    v_sensitive_policy := c_policy_version;
  END IF;

  v_has_medical := COALESCE(p_has_medical_conditions, false);
  IF v_has_medical IS TRUE THEN
    v_medical_conditions := NULLIF(btrim(COALESCE(p_medical_conditions, '')), '');
    v_medical_medications := NULLIF(btrim(COALESCE(p_medical_medications, '')), '');
    v_medical_dosage := NULLIF(btrim(COALESCE(p_medical_dosage, '')), '');
  END IF;

  v_emergency_name := NULLIF(btrim(COALESCE(p_emergency_contact_name, '')), '');
  v_emergency_relationship := NULLIF(btrim(COALESCE(p_emergency_contact_relationship, '')), '');
  v_emergency_phone := NULLIF(btrim(COALESCE(p_emergency_contact_phone, '')), '');

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
    whatsapp_number,
    has_medical_conditions,
    medical_conditions,
    medical_medications,
    medical_dosage,
    emergency_contact_name,
    emergency_contact_relationship,
    emergency_contact_phone
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
    v_whatsapp,
    v_has_medical,
    v_medical_conditions,
    v_medical_medications,
    v_medical_dosage,
    v_emergency_name,
    v_emergency_relationship,
    v_emergency_phone
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

REVOKE ALL ON FUNCTION public.register_retreat_preinscription(
  text, text, text, date, text, boolean, boolean, text, text, boolean, text,
  boolean, text, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_retreat_preinscription(
  text, text, text, date, text, boolean, boolean, text, text, boolean, text,
  boolean, text, text, text, text, text, text
) TO anon, authenticated;

COMMENT ON FUNCTION public.register_retreat_preinscription(
  text, text, text, date, text, boolean, boolean, text, text, boolean, text,
  boolean, text, text, text, text, text, text
) IS 'Anon retreat preinscription insert; SECURITY DEFINER SET search_path=''''; fixed event key + Ley 1581 consent stamps on row; persists has_whatsapp / trimmed whatsapp_number (020), opt-in medical details (023), duplicate guard (025) and trimmed emergency contact (026).';

-- =============================================================================
-- 4) register_retreat_preinscription_for_member — restate of the 023 body
--    (super_admin gate from 022) with trailing optional emergency-contact
--    params. Old 13-arg overload dropped.
-- =============================================================================

DROP FUNCTION IF EXISTS public.register_retreat_preinscription_for_member(
  uuid, date, text, boolean, boolean, text, text, boolean, text,
  boolean, text, text, text
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
  p_whatsapp_number text DEFAULT NULL,
  p_has_medical_conditions boolean DEFAULT false,
  p_medical_conditions text DEFAULT NULL,
  p_medical_medications text DEFAULT NULL,
  p_medical_dosage text DEFAULT NULL,
  p_emergency_contact_name text DEFAULT NULL,
  p_emergency_contact_relationship text DEFAULT NULL,
  p_emergency_contact_phone text DEFAULT NULL
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
  v_has_medical    boolean := false;
  v_medical_conditions text := NULL;
  v_medical_medications text := NULL;
  v_medical_dosage text := NULL;
  v_emergency_name text := NULL;
  v_emergency_relationship text := NULL;
  v_emergency_phone text := NULL;
  v_id             uuid;
BEGIN
  IF (SELECT public.user_role()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'not_authorized: super_admin required' USING ERRCODE = '42501';
  END IF;

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

  IF p_general_consent IS NOT TRUE THEN
    RAISE EXCEPTION 'missing_consent: general consent is required' USING ERRCODE = '23514';
  END IF;

  IF v_birthday IS NOT NULL
     AND EXTRACT(YEAR FROM age(CURRENT_DATE, v_birthday)) < 18 THEN
    v_is_minor := true;
  END IF;
  v_legal_rep := NULLIF(btrim(COALESCE(p_legal_rep_name, '')), '');

  IF v_is_minor AND v_legal_rep IS NULL THEN
    RAISE EXCEPTION 'legal representative is required for minors' USING ERRCODE = '23514';
  END IF;

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

  IF p_sensitive_consent IS TRUE THEN
    v_denomination := NULLIF(btrim(COALESCE(p_denomination, '')), '');
    v_community    := NULLIF(btrim(COALESCE(p_community_name, '')), '');
    v_sensitive_at := now();
    v_sensitive_policy := c_policy_version;
  END IF;
  v_has_whatsapp := COALESCE(p_has_whatsapp, false);
  v_whatsapp := NULLIF(btrim(COALESCE(p_whatsapp_number, '')), '');

  v_has_medical := COALESCE(p_has_medical_conditions, false);
  IF v_has_medical IS TRUE THEN
    v_medical_conditions := NULLIF(btrim(COALESCE(p_medical_conditions, '')), '');
    v_medical_medications := NULLIF(btrim(COALESCE(p_medical_medications, '')), '');
    v_medical_dosage := NULLIF(btrim(COALESCE(p_medical_dosage, '')), '');
  END IF;

  v_emergency_name := NULLIF(btrim(COALESCE(p_emergency_contact_name, '')), '');
  v_emergency_relationship := NULLIF(btrim(COALESCE(p_emergency_contact_relationship, '')), '');
  v_emergency_phone := NULLIF(btrim(COALESCE(p_emergency_contact_phone, '')), '');

  INSERT INTO public.retreat_registrations (
    event_key, name, phone, email, birthday, is_minor, legal_rep_name, status,
    general_consent_accepted_at, general_consent_policy_version,
    sensitive_consent_accepted_at, sensitive_consent_policy_version,
    denomination, community_name, member_id, has_whatsapp, whatsapp_number,
    has_medical_conditions, medical_conditions, medical_medications, medical_dosage,
    emergency_contact_name, emergency_contact_relationship, emergency_contact_phone
  ) VALUES (
    c_event_key, v_name, v_phone, v_email, v_birthday, v_is_minor,
    CASE WHEN v_is_minor THEN v_legal_rep ELSE NULL END,
    'preinscrito', now(), c_policy_version,
    v_sensitive_at, v_sensitive_policy,
    v_denomination, v_community, p_member_id, v_has_whatsapp, v_whatsapp,
    v_has_medical, v_medical_conditions, v_medical_medications, v_medical_dosage,
    v_emergency_name, v_emergency_relationship, v_emergency_phone
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
  uuid, date, text, boolean, boolean, text, text, boolean, text,
  boolean, text, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_retreat_preinscription_for_member(
  uuid, date, text, boolean, boolean, text, text, boolean, text,
  boolean, text, text, text, text, text, text
) TO authenticated;

COMMENT ON FUNCTION public.register_retreat_preinscription_for_member(
  uuid, date, text, boolean, boolean, text, text, boolean, text,
  boolean, text, text, text, text, text, text
) IS 'Authenticated member->retreat preinscription; SECURITY DEFINER SET search_path=''''; role gate super_admin; re-derives PII from members.id; fresh Ley 1581 consent on row; duplicate-safe (pre-check + unique_violation->23505); persists has_whatsapp / trimmed whatsapp_number, opt-in medical details (023) and trimmed emergency contact (026).';

NOTIFY pgrst, 'reload schema';
