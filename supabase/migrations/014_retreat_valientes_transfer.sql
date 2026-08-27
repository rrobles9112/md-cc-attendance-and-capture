-- 014_retreat_valientes_transfer.sql
-- G1 pastoral_group + transferred_* audit + search indexes + view + RPC transfer_retreat_to_valientes
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, CREATE EXTENSION IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION/VIEW, REVOKE/GRANT, COMMENT, NOTIFY pgrst.
-- Strict TDD PR1: members.pastoral_group TEXT CHECK open + partial idx + retreat_registrations.transferred_*
-- + pg_trgm GIN + btree indexes + security_invoker view + SECURITY DEFINER RPC.

-- 0) extension for ILIKE %substr% search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) members.pastoral_group G1
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS pastoral_group TEXT
  CHECK (pastoral_group IS NULL OR char_length(btrim(pastoral_group))>0);
COMMENT ON COLUMN public.members.pastoral_group IS 'Pastoral attendance group; Valientes for retreat graduates. NULL until transfer. G1; G2 junction deferred.';
CREATE INDEX IF NOT EXISTS members_pastoral_group_idx ON public.members(pastoral_group) WHERE pastoral_group IS NOT NULL;

-- 2) retreat_registrations.transferred_* (audit + idempotency)
ALTER TABLE public.retreat_registrations ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;
ALTER TABLE public.retreat_registrations ADD COLUMN IF NOT EXISTS transferred_member_id UUID REFERENCES public.members(id) ON DELETE SET NULL;
ALTER TABLE public.retreat_registrations ADD COLUMN IF NOT EXISTS transferred_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='retreat_registrations_transferred_member_id_fkey') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.retreat_registrations'::regclass AND contype='f' AND array_position(conkey,(SELECT attnum FROM pg_attribute WHERE attrelid='public.retreat_registrations'::regclass AND attname='transferred_member_id')) IS NOT NULL) THEN
      ALTER TABLE public.retreat_registrations ADD CONSTRAINT retreat_registrations_transferred_member_id_fkey FOREIGN KEY (transferred_member_id) REFERENCES public.members(id) ON DELETE SET NULL;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='retreat_registrations_transferred_by_fkey') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.retreat_registrations'::regclass AND contype='f' AND array_position(conkey,(SELECT attnum FROM pg_attribute WHERE attrelid='public.retreat_registrations'::regclass AND attname='transferred_by')) IS NOT NULL) THEN
      ALTER TABLE public.retreat_registrations ADD CONSTRAINT retreat_registrations_transferred_by_fkey FOREIGN KEY (transferred_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS retreat_registrations_transferred_member_id_idx ON public.retreat_registrations(transferred_member_id) WHERE transferred_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS retreat_registrations_transferred_at_idx ON public.retreat_registrations(transferred_at) WHERE transferred_at IS NOT NULL;
COMMENT ON COLUMN public.retreat_registrations.transferred_at IS 'When retreat row transferred to members pastoral_group Valientes; idempotency guard; NULL until transfer.';
COMMENT ON COLUMN public.retreat_registrations.transferred_member_id IS 'Destination members.id (INSERT) or origin members.id (UPDATE); ON DELETE SET NULL preserves audit.';
COMMENT ON COLUMN public.retreat_registrations.transferred_by IS 'Actor profiles.id that performed transfer; Ley 1581 audit.';

-- 3) search / pagination indexes (no CONCURRENTLY inside transaction)
CREATE INDEX IF NOT EXISTS retreat_registrations_status_idx ON public.retreat_registrations(status);
CREATE INDEX IF NOT EXISTS retreat_registrations_event_status_idx ON public.retreat_registrations(event_key, status);
CREATE INDEX IF NOT EXISTS retreat_registrations_created_at_idx ON public.retreat_registrations(created_at);
CREATE INDEX IF NOT EXISTS retreat_registrations_search_trgm_idx ON public.retreat_registrations USING gin ((lower(name) || ' ' || lower(email) || ' ' || phone) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS retreat_payments_registration_id_created_at_idx ON public.retreat_payments(registration_id, created_at DESC);

-- 4) optional view with security_invoker (read-only abonos aggregate)
CREATE OR REPLACE VIEW public.retreat_registration_with_payments WITH (security_invoker=true) AS
SELECT rr.id, rr.event_key, rr.name, rr.phone, rr.email, rr.birthday, rr.is_minor, rr.legal_rep_name, rr.status, rr.created_at, rr.transferred_at, rr.transferred_member_id, rr.transferred_by, rr.member_id, rr.general_consent_accepted_at, rr.general_consent_policy_version, rr.sensitive_consent_accepted_at, rr.sensitive_consent_policy_version, rr.denomination, rr.community_name, COALESCE(SUM(p.amount),0) AS total_paid, COUNT(p.id) AS payment_count, MAX(p.created_at) AS last_payment_at FROM public.retreat_registrations rr LEFT JOIN public.retreat_payments p ON p.registration_id=rr.id GROUP BY rr.id;
COMMENT ON VIEW public.retreat_registration_with_payments IS 'Abonos aggregate per retreat registration; security_invoker=true so RLS on retreat_* applies.';

-- 5) RPC transfer_retreat_to_valientes
CREATE OR REPLACE FUNCTION public.transfer_retreat_to_valientes(p_registration_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c_event_key constant text := 'retiro-juvenil-octubre-2026';
  v_rr public.retreat_registrations%ROWTYPE;
  v_total_raw text;
  v_total numeric;
  v_sum numeric;
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
  SELECT value INTO v_total_raw FROM public.app_settings WHERE key='retreat.youth.total_cost';
  IF v_total_raw IS NULL OR btrim(v_total_raw)='' THEN
    RAISE EXCEPTION 'missing_total: retreat.youth.total_cost is missing or empty' USING ERRCODE='23514';
  END IF;
  BEGIN v_total:=btrim(v_total_raw)::numeric; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'missing_total: retreat.youth.total_cost is not numeric: %', v_total_raw USING ERRCODE='23514'; END;
  IF v_total <=0 THEN RAISE EXCEPTION 'missing_total: retreat.youth.total_cost must be positive: %', v_total USING ERRCODE='23514'; END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_sum FROM public.retreat_payments WHERE registration_id=p_registration_id;
  IF v_sum < v_total OR v_rr.status IS DISTINCT FROM 'inscrito' THEN
    RAISE EXCEPTION 'not_inscrito: sum % < total % or status % is not inscrito', v_sum, v_total, v_rr.status USING ERRCODE='23514';
  END IF;
  v_email:=lower(btrim(v_rr.email));
  v_phone_digits:=regexp_replace(btrim(v_rr.phone),'[^0-9]','g');
  BEGIN SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name='members_encryption_key' LIMIT 1; EXCEPTION WHEN undefined_table THEN v_key:=NULL; WHEN OTHERS THEN v_key:=NULL; END;
  IF v_key IS NULL THEN v_key:='demo-local-pgcrypto-key-not-for-prod'; END IF;
  IF v_rr.member_id IS NULL AND EXISTS (SELECT 1 FROM public.members WHERE deleted_at IS NULL AND (lower(btrim(email))=v_email OR regexp_replace(phone,'[^0-9]','g')=v_phone_digits)) THEN
    RAISE EXCEPTION 'already_member: a member with this email/phone already exists' USING ERRCODE='23505';
  END IF;
  IF v_rr.member_id IS NOT NULL THEN
    UPDATE public.members SET pastoral_group='Valientes' WHERE id=v_rr.member_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'member not found: %', v_rr.member_id USING ERRCODE='P0002'; END IF;
    v_member_id:=v_rr.member_id;
  ELSE
    INSERT INTO public.members(name, name_normalized, phone, email, birthday, is_minor, legal_rep_name, has_whatsapp, consent_recorded, sensitive_consent_recorded, denomination_encrypted, community_name_encrypted, pastoral_group, created_by, duplicate_flag) VALUES (
      btrim(v_rr.name), lower(btrim(v_rr.name)),
      CASE WHEN v_rr.phone ~ '^\+' THEN v_rr.phone WHEN char_length(v_phone_digits)=10 THEN '+57'||v_phone_digits WHEN char_length(v_phone_digits)=12 AND left(v_phone_digits,2)='57' THEN '+'||v_phone_digits ELSE v_rr.phone END,
      v_email, v_rr.birthday, v_rr.is_minor, v_rr.legal_rep_name, false, true, (v_rr.sensitive_consent_accepted_at IS NOT NULL),
      CASE WHEN v_rr.sensitive_consent_accepted_at IS NOT NULL AND v_rr.denomination IS NOT NULL THEN extensions.pgp_sym_encrypt(btrim(v_rr.denomination), v_key) ELSE NULL END,
      CASE WHEN v_rr.sensitive_consent_accepted_at IS NOT NULL AND v_rr.community_name IS NOT NULL THEN extensions.pgp_sym_encrypt(btrim(v_rr.community_name), v_key) ELSE NULL END,
      'Valientes', auth.uid(), false) RETURNING id INTO v_member_id;
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
COMMENT ON FUNCTION public.transfer_retreat_to_valientes(uuid) IS 'Retreat→Valientes transfer; SECURITY DEFINER SET search_path=''''; leader/super_admin gate; FOR UPDATE idempotency; SUM>=total gate; duplicate-safe branches INSERT/UPDATE; pgp_sym_encrypt vault.';
NOTIFY pgrst, 'reload schema';
