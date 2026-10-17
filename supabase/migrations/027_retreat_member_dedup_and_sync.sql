-- 027_retreat_member_dedup_and_sync.sql
-- Deduplication & bidirectional data sync between retreat_registrations
-- (preinscritos) and members (Valientes assembly members):
--   1. Adds medical condition columns to public.members so health data captured
--      during a retreat persists on the member record for future retreats.
--   2. Adds public.normalize_colombian_phone_digits(text) so '+573001234567'
--      in members and '3001234567' in retreat_registrations compare equal
--      across all duplicate and pre-registration checks.
--   3. Updates register_retreat_preinscription and
--      register_retreat_preinscription_for_member to normalize phones, reuse
--      existing member fields via COALESCE, and backfill newly completed
--      fields (health, emergency contact, birthday, legal rep, WhatsApp) onto
--      public.members without creating duplicates.
--   4. Updates transfer_retreat_to_valientes with optional parameters
--      (p_allow_unpaid DEFAULT false, p_link_existing_member DEFAULT false),
--      full propagation of emergency_contact_* and medical_* fields to
--      public.members, and automatic linking/updating of existing members when
--      p_link_existing_member = true.

-- =============================================================================
-- 1) Columns — public.members medical conditions
-- =============================================================================

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS has_medical_conditions BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS medical_conditions TEXT,
  ADD COLUMN IF NOT EXISTS medical_medications TEXT,
  ADD COLUMN IF NOT EXISTS medical_dosage TEXT;

COMMENT ON COLUMN public.members.has_medical_conditions IS
  'Self-reported flag indicating whether the member has any medical conditions (synced with retreat preinscriptions).';
COMMENT ON COLUMN public.members.medical_conditions IS
  'Free-text description of medical conditions when has_medical_conditions is true.';
COMMENT ON COLUMN public.members.medical_medications IS
  'Free-text description of treatment medications when has_medical_conditions is true.';
COMMENT ON COLUMN public.members.medical_dosage IS
  'Free-text dosage and frequency details when has_medical_conditions is true.';

-- =============================================================================
-- 2) Phone normalization helper — strips non-digits and leading Colombian '57'
--    prefix on 12-digit numbers so '+573001234567' and '3001234567' match.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.normalize_colombian_phone_digits(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN char_length(d) = 12 AND left(d, 2) = '57' THEN substring(d FROM 3)
    ELSE d
  END
  FROM (
    SELECT regexp_replace(btrim(COALESCE(p_raw, '')), '[^0-9]', '', 'g') AS d
  ) s;
$$;

REVOKE ALL ON FUNCTION public.normalize_colombian_phone_digits(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_colombian_phone_digits(text) TO anon, authenticated;

COMMENT ON FUNCTION public.normalize_colombian_phone_digits(text) IS
  'Normalizes Colombian phone strings to 10-digit canonical digits (strips non-digits and leading 57 on 12-digit strings).';

-- =============================================================================
-- 3) register_retreat_preinscription — canonical phone normalization +
--    bidirectional field sync with existing active members when matched.
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
  v_birthday date;
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
  v_existing_member public.members%ROWTYPE;
  v_has_existing_member boolean := false;
  v_id uuid;
BEGIN
  v_name := btrim(COALESCE(p_name, ''));
  v_email := lower(btrim(COALESCE(p_email, '')));
  v_phone := public.normalize_colombian_phone_digits(p_phone);
  v_birthday := p_birthday;
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

  SELECT m.*
    INTO v_existing_member
  FROM public.members m
  WHERE m.deleted_at IS NULL
    AND (
          lower(btrim(m.email)) = v_email
       OR public.normalize_colombian_phone_digits(m.phone) = v_phone
    )
  ORDER BY (m.pastoral_group = 'Valientes') DESC, m.created_at ASC
  LIMIT 1;

  v_has_existing_member := FOUND;

  IF v_has_existing_member THEN
    v_birthday := COALESCE(v_birthday, v_existing_member.birthday);
    v_legal_rep := COALESCE(v_legal_rep, NULLIF(btrim(COALESCE(v_existing_member.legal_rep_name, '')), ''));
    v_has_whatsapp := v_has_whatsapp OR COALESCE(v_existing_member.has_whatsapp, false);
  END IF;

  IF v_birthday IS NOT NULL
     AND EXTRACT(YEAR FROM age(CURRENT_DATE, v_birthday)) < 18 THEN
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
         OR public.normalize_colombian_phone_digits(r.phone) = v_phone
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
  ELSIF v_has_existing_member AND COALESCE(v_existing_member.has_medical_conditions, false) IS TRUE THEN
    v_has_medical := true;
    v_medical_conditions := NULLIF(btrim(COALESCE(v_existing_member.medical_conditions, '')), '');
    v_medical_medications := NULLIF(btrim(COALESCE(v_existing_member.medical_medications, '')), '');
    v_medical_dosage := NULLIF(btrim(COALESCE(v_existing_member.medical_dosage, '')), '');
  END IF;

  v_emergency_name := NULLIF(btrim(COALESCE(p_emergency_contact_name, '')), '');
  v_emergency_relationship := NULLIF(btrim(COALESCE(p_emergency_contact_relationship, '')), '');
  v_emergency_phone := NULLIF(btrim(COALESCE(p_emergency_contact_phone, '')), '');

  IF v_has_existing_member THEN
    v_emergency_name := COALESCE(v_emergency_name, NULLIF(btrim(COALESCE(v_existing_member.emergency_contact_name, '')), ''));
    v_emergency_relationship := COALESCE(v_emergency_relationship, NULLIF(btrim(COALESCE(v_existing_member.emergency_contact_relationship, '')), ''));
    v_emergency_phone := COALESCE(v_emergency_phone, NULLIF(btrim(COALESCE(v_existing_member.emergency_contact_phone, '')), ''));
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
    v_birthday,
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

  IF v_has_existing_member THEN
    UPDATE public.members
    SET birthday = COALESCE(birthday, v_birthday),
        is_minor = CASE WHEN v_birthday IS NOT NULL THEN v_is_minor ELSE is_minor END,
        legal_rep_name = COALESCE(legal_rep_name, CASE WHEN v_is_minor THEN v_legal_rep ELSE NULL END),
        has_whatsapp = has_whatsapp OR v_has_whatsapp,
        has_medical_conditions = has_medical_conditions OR v_has_medical,
        medical_conditions = COALESCE(v_medical_conditions, medical_conditions),
        medical_medications = COALESCE(v_medical_medications, medical_medications),
        medical_dosage = COALESCE(v_medical_dosage, medical_dosage),
        emergency_contact_name = COALESCE(v_emergency_name, emergency_contact_name),
        emergency_contact_relationship = COALESCE(v_emergency_relationship, emergency_contact_relationship),
        emergency_contact_phone = COALESCE(v_emergency_phone, emergency_contact_phone),
        updated_at = now()
    WHERE id = v_existing_member.id;
  END IF;

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

-- =============================================================================
-- 4) register_retreat_preinscription_for_member — inherits existing member
--    data (birthday, legal rep, WhatsApp, medical, emergency contact) when not
--    overridden, normalizes phone to 10-digit canonical format, and backfills
--    newly completed fields onto public.members.
-- =============================================================================

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
  v_m              public.members%ROWTYPE;
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

  SELECT *
    INTO v_m
  FROM public.members m
  WHERE m.id = p_member_id AND m.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found or deleted' USING ERRCODE = 'P0002';
  END IF;

  v_name := btrim(COALESCE(v_m.name, ''));
  v_phone := public.normalize_colombian_phone_digits(v_m.phone);
  v_email := lower(btrim(COALESCE(v_m.email, '')));
  v_birthday := COALESCE(p_birthday, v_m.birthday);

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
  v_legal_rep := COALESCE(
    NULLIF(btrim(COALESCE(p_legal_rep_name, '')), ''),
    NULLIF(btrim(COALESCE(v_m.legal_rep_name, '')), '')
  );

  IF v_is_minor AND v_legal_rep IS NULL THEN
    RAISE EXCEPTION 'legal representative is required for minors' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.retreat_registrations r
    WHERE r.event_key = c_event_key
      AND (
            r.member_id = p_member_id
         OR lower(btrim(r.email)) = v_email
         OR public.normalize_colombian_phone_digits(r.phone) = v_phone
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

  v_has_whatsapp := COALESCE(p_has_whatsapp, false) OR COALESCE(v_m.has_whatsapp, false);
  v_whatsapp := NULLIF(btrim(COALESCE(p_whatsapp_number, '')), '');
  IF v_whatsapp IS NULL THEN
    SELECT w.number INTO v_whatsapp
    FROM public.whatsapp_numbers w
    WHERE w.member_id = p_member_id AND w.deleted_at IS NULL
    ORDER BY w.created_at ASC
    LIMIT 1;
  END IF;

  v_has_medical := COALESCE(p_has_medical_conditions, false) OR COALESCE(v_m.has_medical_conditions, false);
  IF COALESCE(p_has_medical_conditions, false) IS TRUE THEN
    v_medical_conditions := COALESCE(
      NULLIF(btrim(COALESCE(p_medical_conditions, '')), ''),
      NULLIF(btrim(COALESCE(v_m.medical_conditions, '')), '')
    );
    v_medical_medications := COALESCE(
      NULLIF(btrim(COALESCE(p_medical_medications, '')), ''),
      NULLIF(btrim(COALESCE(v_m.medical_medications, '')), '')
    );
    v_medical_dosage := COALESCE(
      NULLIF(btrim(COALESCE(p_medical_dosage, '')), ''),
      NULLIF(btrim(COALESCE(v_m.medical_dosage, '')), '')
    );
  ELSIF COALESCE(v_m.has_medical_conditions, false) IS TRUE THEN
    v_medical_conditions := NULLIF(btrim(COALESCE(v_m.medical_conditions, '')), '');
    v_medical_medications := NULLIF(btrim(COALESCE(v_m.medical_medications, '')), '');
    v_medical_dosage := NULLIF(btrim(COALESCE(v_m.medical_dosage, '')), '');
  END IF;

  v_emergency_name := COALESCE(
    NULLIF(btrim(COALESCE(p_emergency_contact_name, '')), ''),
    NULLIF(btrim(COALESCE(v_m.emergency_contact_name, '')), '')
  );
  v_emergency_relationship := COALESCE(
    NULLIF(btrim(COALESCE(p_emergency_contact_relationship, '')), ''),
    NULLIF(btrim(COALESCE(v_m.emergency_contact_relationship, '')), '')
  );
  v_emergency_phone := COALESCE(
    NULLIF(btrim(COALESCE(p_emergency_contact_phone, '')), ''),
    NULLIF(btrim(COALESCE(v_m.emergency_contact_phone, '')), '')
  );

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

  -- Backfill any newly provided data onto the member record so future retreats
  -- and assembly records already have the completed fields.
  UPDATE public.members
  SET birthday = COALESCE(v_birthday, birthday),
      is_minor = v_is_minor,
      legal_rep_name = CASE WHEN v_is_minor THEN COALESCE(v_legal_rep, legal_rep_name) ELSE legal_rep_name END,
      has_whatsapp = has_whatsapp OR v_has_whatsapp,
      has_medical_conditions = v_has_medical,
      medical_conditions = COALESCE(v_medical_conditions, medical_conditions),
      medical_medications = COALESCE(v_medical_medications, medical_medications),
      medical_dosage = COALESCE(v_medical_dosage, medical_dosage),
      emergency_contact_name = COALESCE(v_emergency_name, emergency_contact_name),
      emergency_contact_relationship = COALESCE(v_emergency_relationship, emergency_contact_relationship),
      emergency_contact_phone = COALESCE(v_emergency_phone, emergency_contact_phone),
      updated_at = now()
  WHERE id = p_member_id;

  IF v_whatsapp IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.whatsapp_numbers w
    WHERE w.member_id = p_member_id AND w.number = v_whatsapp AND w.deleted_at IS NULL
  ) THEN
    INSERT INTO public.whatsapp_numbers (member_id, number, is_primary_phone)
    VALUES (p_member_id, v_whatsapp, false);
  END IF;

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

-- =============================================================================
-- 5) transfer_retreat_to_valientes — supports:
--    - p_allow_unpaid (DEFAULT false): when true, permits transferring a
--      preinscrito or pagos_parciales registration to Valientes after explicit
--      checkpoint confirmation.
--    - p_link_existing_member (DEFAULT false): when true and an active member
--      already exists with the same normalized email or phone, links and
--      updates that member instead of raising 23505 or creating a duplicate.
--    - Copies emergency_contact_* and medical_* fields to public.members.
-- =============================================================================

DROP FUNCTION IF EXISTS public.transfer_retreat_to_valientes(uuid);

CREATE OR REPLACE FUNCTION public.transfer_retreat_to_valientes(
  p_registration_id uuid,
  p_allow_unpaid boolean DEFAULT false,
  p_link_existing_member boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rr public.retreat_registrations%ROWTYPE;
  v_email text;
  v_phone_digits text;
  v_existing_member_id uuid := NULL;
  v_member_id uuid;
  v_key text;
BEGIN
  IF (SELECT public.user_role()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'not_authorized: super_admin required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rr
  FROM public.retreat_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'retreat registration not found: %', p_registration_id USING ERRCODE = 'P0002';
  END IF;

  IF v_rr.transferred_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_transferred: % already transferred at % to %',
      p_registration_id, v_rr.transferred_at, v_rr.transferred_member_id
      USING ERRCODE = '23505';
  END IF;

  v_email := lower(btrim(v_rr.email));
  v_phone_digits := public.normalize_colombian_phone_digits(v_rr.phone);

  IF v_rr.member_id IS NOT NULL THEN
    IF COALESCE(p_link_existing_member, false) IS NOT TRUE THEN
      PERFORM 1 FROM public.members WHERE id = v_rr.member_id AND pastoral_group = 'Valientes';
      IF FOUND THEN
        RAISE EXCEPTION 'already_transferred: linked member % already Valientes', v_rr.member_id
          USING ERRCODE = '23505';
      END IF;
    END IF;
    v_existing_member_id := v_rr.member_id;
  ELSE
    SELECT m.id
      INTO v_existing_member_id
    FROM public.members m
    WHERE m.deleted_at IS NULL
      AND (
            lower(btrim(m.email)) = v_email
         OR public.normalize_colombian_phone_digits(m.phone) = v_phone_digits
      )
    ORDER BY (m.pastoral_group = 'Valientes') DESC, m.created_at ASC
    LIMIT 1;

    IF v_existing_member_id IS NOT NULL AND COALESCE(p_link_existing_member, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'already_member: a member with this email/phone already exists'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF COALESCE(p_allow_unpaid, false) IS NOT TRUE AND v_rr.status IS DISTINCT FROM 'inscrito' THEN
    RAISE EXCEPTION 'not_inscrito: status % is not inscrito', v_rr.status
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'members_encryption_key'
    LIMIT 1;
  EXCEPTION
    WHEN undefined_table THEN v_key := NULL;
    WHEN OTHERS THEN v_key := NULL;
  END;
  IF v_key IS NULL THEN
    v_key := 'demo-local-pgcrypto-key-not-for-prod';
  END IF;

  IF v_existing_member_id IS NOT NULL THEN
    UPDATE public.members
    SET pastoral_group = 'Valientes',
        birthday = COALESCE(v_rr.birthday, birthday),
        is_minor = COALESCE(v_rr.is_minor, is_minor),
        legal_rep_name = COALESCE(NULLIF(btrim(COALESCE(v_rr.legal_rep_name, '')), ''), legal_rep_name),
        has_whatsapp = has_whatsapp OR COALESCE(v_rr.has_whatsapp, false),
        emergency_contact_name = COALESCE(NULLIF(btrim(COALESCE(v_rr.emergency_contact_name, '')), ''), emergency_contact_name),
        emergency_contact_relationship = COALESCE(NULLIF(btrim(COALESCE(v_rr.emergency_contact_relationship, '')), ''), emergency_contact_relationship),
        emergency_contact_phone = COALESCE(NULLIF(btrim(COALESCE(v_rr.emergency_contact_phone, '')), ''), emergency_contact_phone),
        has_medical_conditions = has_medical_conditions OR COALESCE(v_rr.has_medical_conditions, false),
        medical_conditions = COALESCE(NULLIF(btrim(COALESCE(v_rr.medical_conditions, '')), ''), medical_conditions),
        medical_medications = COALESCE(NULLIF(btrim(COALESCE(v_rr.medical_medications, '')), ''), medical_medications),
        medical_dosage = COALESCE(NULLIF(btrim(COALESCE(v_rr.medical_dosage, '')), ''), medical_dosage),
        sensitive_consent_recorded = sensitive_consent_recorded OR (v_rr.sensitive_consent_accepted_at IS NOT NULL),
        denomination_encrypted = CASE
          WHEN v_rr.sensitive_consent_accepted_at IS NOT NULL AND v_rr.denomination IS NOT NULL
            THEN extensions.pgp_sym_encrypt(btrim(v_rr.denomination), v_key)
          ELSE denomination_encrypted
        END,
        community_name_encrypted = CASE
          WHEN v_rr.sensitive_consent_accepted_at IS NOT NULL AND v_rr.community_name IS NOT NULL
            THEN extensions.pgp_sym_encrypt(btrim(v_rr.community_name), v_key)
          ELSE community_name_encrypted
        END,
        updated_at = now()
    WHERE id = v_existing_member_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'member not found: %', v_existing_member_id USING ERRCODE = 'P0002';
    END IF;
    v_member_id := v_existing_member_id;
  ELSE
    INSERT INTO public.members (
      name,
      name_normalized,
      phone,
      email,
      birthday,
      is_minor,
      legal_rep_name,
      has_whatsapp,
      emergency_contact_name,
      emergency_contact_relationship,
      emergency_contact_phone,
      has_medical_conditions,
      medical_conditions,
      medical_medications,
      medical_dosage,
      consent_recorded,
      sensitive_consent_recorded,
      denomination_encrypted,
      community_name_encrypted,
      pastoral_group,
      created_by,
      duplicate_flag
    ) VALUES (
      btrim(v_rr.name),
      lower(btrim(v_rr.name)),
      CASE
        WHEN v_rr.phone ~ '^\+' THEN v_rr.phone
        WHEN char_length(v_phone_digits) = 10 THEN '+57' || v_phone_digits
        WHEN char_length(v_phone_digits) = 12 AND left(v_phone_digits, 2) = '57' THEN '+' || v_phone_digits
        ELSE v_rr.phone
      END,
      v_email,
      v_rr.birthday,
      v_rr.is_minor,
      v_rr.legal_rep_name,
      COALESCE(v_rr.has_whatsapp, false),
      NULLIF(btrim(COALESCE(v_rr.emergency_contact_name, '')), ''),
      NULLIF(btrim(COALESCE(v_rr.emergency_contact_relationship, '')), ''),
      NULLIF(btrim(COALESCE(v_rr.emergency_contact_phone, '')), ''),
      COALESCE(v_rr.has_medical_conditions, false),
      NULLIF(btrim(COALESCE(v_rr.medical_conditions, '')), ''),
      NULLIF(btrim(COALESCE(v_rr.medical_medications, '')), ''),
      NULLIF(btrim(COALESCE(v_rr.medical_dosage, '')), ''),
      true,
      (v_rr.sensitive_consent_accepted_at IS NOT NULL),
      CASE
        WHEN v_rr.sensitive_consent_accepted_at IS NOT NULL AND v_rr.denomination IS NOT NULL
          THEN extensions.pgp_sym_encrypt(btrim(v_rr.denomination), v_key)
        ELSE NULL
      END,
      CASE
        WHEN v_rr.sensitive_consent_accepted_at IS NOT NULL AND v_rr.community_name IS NOT NULL
          THEN extensions.pgp_sym_encrypt(btrim(v_rr.community_name), v_key)
        ELSE NULL
      END,
      'Valientes',
      auth.uid(),
      false
    )
    RETURNING id INTO v_member_id;
  END IF;

  IF v_rr.whatsapp_number IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.whatsapp_numbers w
    WHERE w.member_id = v_member_id AND w.number = v_rr.whatsapp_number AND w.deleted_at IS NULL
  ) THEN
    INSERT INTO public.whatsapp_numbers (member_id, number, is_primary_phone)
    VALUES (v_member_id, v_rr.whatsapp_number, false);
  END IF;

  UPDATE public.retreat_registrations
  SET member_id = COALESCE(member_id, v_member_id),
      transferred_at = now(),
      transferred_member_id = v_member_id,
      transferred_by = auth.uid()
  WHERE id = p_registration_id;

  RETURN v_member_id;
EXCEPTION
  WHEN unique_violation THEN
    IF SQLERRM LIKE '%already_transferred%' OR SQLERRM LIKE '%already_member%' THEN
      RAISE;
    ELSE
      RAISE EXCEPTION 'already_member: duplicate email/phone races to unique index: %', SQLERRM
        USING ERRCODE = '23505';
    END IF;
  WHEN OTHERS THEN
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_retreat_to_valientes(uuid, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_retreat_to_valientes(uuid, boolean, boolean) TO authenticated;

COMMENT ON FUNCTION public.transfer_retreat_to_valientes(uuid, boolean, boolean) IS
  'Retreat->Valientes transfer; SECURITY DEFINER SET search_path=''''; super_admin gate; supports unpaid checkpoint (p_allow_unpaid) and deduplicated linking of existing members (p_link_existing_member); propagates WhatsApp, emergency_contact_*, and medical_* to members.';

NOTIFY pgrst, 'reload schema';
