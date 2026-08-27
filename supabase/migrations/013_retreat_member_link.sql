-- 013_retreat_member_link.sql
-- Link retreat_registrations to members without touching members RLS/Dexie.
-- Event key is fixed to retiro-juvenil-octubre-2026; constant lives in RPC c_event_key
-- and client src/lib/retreat/constants.ts RETREAT_EVENT_KEY.

-- 1) Column — idempotent via ADD COLUMN IF NOT EXISTS + constraint existence guard
ALTER TABLE public.retreat_registrations
  ADD COLUMN IF NOT EXISTS member_id UUID NULL
  REFERENCES public.members(id) ON DELETE SET NULL;

-- Ensure FK name is stable for future DROP (if column pre-existed without this FK, add it):
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'retreat_registrations_member_id_fkey'
      AND conrelid = 'public.retreat_registrations'::regclass
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='retreat_registrations' AND column_name='member_id'
  ) THEN
    -- Check if FK already exists under different name — avoid duplicate
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.retreat_registrations'::regclass
        AND contype = 'f'
        AND array_position(conkey, (SELECT attnum FROM pg_attribute WHERE attrelid='public.retreat_registrations'::regclass AND attname='member_id')) IS NOT NULL
    ) THEN
      ALTER TABLE public.retreat_registrations
        ADD CONSTRAINT retreat_registrations_member_id_fkey
        FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- 2) Partial index — plain (not CONCURRENTLY) inside transaction; IF NOT EXISTS idempotent
CREATE INDEX IF NOT EXISTS retreat_registrations_member_id_idx
  ON public.retreat_registrations(member_id)
  WHERE member_id IS NOT NULL;

-- 3) Comment
COMMENT ON COLUMN public.retreat_registrations.member_id IS
  'Nullable FK to members.id; set for member-originated pre-registrations, NULL for public /retiro rows. ON DELETE SET NULL preserves audit.';

-- 4) RPC — CREATE OR REPLACE idempotent; SECURITY DEFINER SET search_path=''
CREATE OR REPLACE FUNCTION public.register_retreat_preinscription_for_member(
  p_member_id uuid,
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
  v_id             uuid;
BEGIN
  -- 1) Role gate — uses existing SECURITY DEFINER helper public.user_role()
  IF (SELECT public.user_role()) NOT IN ('leader','super_admin') THEN
    RAISE EXCEPTION 'not_authorized: leader/super_admin required' USING ERRCODE = '42501';
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

  -- 6) Sensitive gating
  IF p_sensitive_consent IS TRUE THEN
    v_denomination := NULLIF(btrim(COALESCE(p_denomination, '')), '');
    v_community    := NULLIF(btrim(COALESCE(p_community_name, '')), '');
    v_sensitive_at := now();
    v_sensitive_policy := c_policy_version;
  END IF;

  -- 7) Insert — member_id set, consent stamps on row, status preinscrito
  INSERT INTO public.retreat_registrations (
    event_key, name, phone, email, birthday, is_minor, legal_rep_name, status,
    general_consent_accepted_at, general_consent_policy_version,
    sensitive_consent_accepted_at, sensitive_consent_policy_version,
    denomination, community_name, member_id
  ) VALUES (
    c_event_key, v_name, v_phone, v_email, v_birthday, v_is_minor,
    CASE WHEN v_is_minor THEN v_legal_rep ELSE NULL END,
    'preinscrito', now(), c_policy_version,
    v_sensitive_at, v_sensitive_policy,
    v_denomination, v_community, p_member_id
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

REVOKE ALL ON FUNCTION public.register_retreat_preinscription_for_member(uuid, date, text, boolean, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_retreat_preinscription_for_member(uuid, date, text, boolean, boolean, text, text) TO authenticated;

COMMENT ON FUNCTION public.register_retreat_preinscription_for_member(uuid, date, text, boolean, boolean, text, text)
  IS 'Authenticated member->retreat preinscription; SECURITY DEFINER SET search_path=''''; role gate leader/super_admin; re-derives PII from members.id; fresh Ley 1581 consent on row; duplicate-safe (pre-check + unique_violation->23505).';

-- 5) PostgREST reload
NOTIFY pgrst, 'reload schema';
