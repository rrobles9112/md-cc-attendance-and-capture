-- Retreat RLS / RPC / payment-status integration tests
-- Run as postgres (table owner). Do NOT prepend SET ROLE authenticated.
-- authenticated cannot SET ROLE anon, so anon/RPC/status cases live here.
--
-- CI: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/retreat_rls.test.sql
-- Local: same command (session user postgres). Each block SET LOCAL ROLE
-- anon or authenticated and JWT claims, then RESET ROLE to verify as owner.
--
-- Relies on supabase/seed.sql (via db reset) for the three role users.
-- Variable names use v_ prefix to avoid PL/pgSQL / column ambiguity.
-- Match rls.test.sql style: RAISE NOTICE 'PASS: ...' / RAISE EXCEPTION 'FAIL: ...'

BEGIN;

DO $$
DECLARE
  v_super_admin_id UUID := 'a0000000-0000-4000-8000-000000000001';
  v_leader_id UUID := 'a0000000-0000-4000-8000-000000000002';
  v_server_id UUID := 'a0000000-0000-4000-8000-000000000003';
  v_rpc_id UUID;
  v_dup_email_id UUID;
  v_dup_phone_id UUID;
  v_sens_yes_id UUID;
  v_sens_no_id UUID;
  v_minor_id UUID;
  v_status_a UUID;
  v_status_b UUID;
  v_status_c UUID;
  v_other_event_id UUID;
  v_members_before INTEGER;
  v_members_after INTEGER;
  v_consent_before INTEGER;
  v_consent_after INTEGER;
  v_pay_count INTEGER;
  v_status TEXT;
  v_event_key TEXT;
  v_email TEXT;
  v_phone TEXT;
  v_denomination TEXT;
  v_community TEXT;
  v_legal_rep TEXT;
  v_policy TEXT;
  v_consent_at TIMESTAMPTZ;
  v_sensitive_at TIMESTAMPTZ;
  v_total_value TEXT;
  v_seen_pii BOOLEAN;
  v_is_minor BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_super_admin_id) THEN
    RAISE EXCEPTION 'Seed users missing — run supabase db reset (applies seed.sql) before retreat RLS tests';
  END IF;

  -- =========================================================================
  -- 1.1 Anon SELECT/DML denied on retreat tables; no PII readable
  -- =========================================================================
  SET LOCAL ROLE anon;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon')::text,
    true
  );

  BEGIN
    PERFORM 1 FROM public.retreat_registrations;
    SELECT EXISTS (
      SELECT 1 FROM public.retreat_registrations
      WHERE email IS NOT NULL AND btrim(email) <> ''
    ) INTO v_seen_pii;
    IF v_seen_pii THEN
      RAISE EXCEPTION 'FAIL: anon SELECT on retreat_registrations returned PII';
    END IF;
    RAISE NOTICE 'PASS: anon SELECT on retreat_registrations returns no PII';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: anon SELECT on retreat_registrations denied (privilege)';
    WHEN undefined_table THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      IF SQLSTATE = '42P01' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: anon SELECT on retreat_registrations denied (%)', SQLERRM;
  END;

  BEGIN
    PERFORM 1 FROM public.retreat_payments;
    SELECT EXISTS (SELECT 1 FROM public.retreat_payments) INTO v_seen_pii;
    IF v_seen_pii THEN
      RAISE EXCEPTION 'FAIL: anon SELECT on retreat_payments returned rows';
    END IF;
    RAISE NOTICE 'PASS: anon SELECT on retreat_payments returns no rows';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: anon SELECT on retreat_payments denied (privilege)';
    WHEN undefined_table THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: anon SELECT on retreat_payments denied (%)', SQLERRM;
  END;

  BEGIN
    INSERT INTO public.retreat_registrations (event_key, name, phone, email, status)
    VALUES ('retiro-juvenil-octubre-2026', 'Anon Inject', '3000000099', 'anon-inject@example.com', 'preinscrito');
    RAISE EXCEPTION 'FAIL: anon INSERT on retreat_registrations should be denied';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: anon INSERT on retreat_registrations denied';
    WHEN undefined_table THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: anon INSERT on retreat_registrations denied (%)', SQLERRM;
  END;

  BEGIN
    UPDATE public.retreat_registrations SET name = 'Hacked' WHERE true;
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: anon UPDATE on retreat_registrations should be denied';
    END IF;
    RAISE NOTICE 'PASS: anon UPDATE on retreat_registrations affected 0 rows';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: anon UPDATE on retreat_registrations denied';
    WHEN undefined_table THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: anon UPDATE on retreat_registrations denied (%)', SQLERRM;
  END;

  BEGIN
    DELETE FROM public.retreat_registrations WHERE true;
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: anon DELETE on retreat_registrations should be denied';
    END IF;
    RAISE NOTICE 'PASS: anon DELETE on retreat_registrations affected 0 rows';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: anon DELETE on retreat_registrations denied';
    WHEN undefined_table THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: anon DELETE on retreat_registrations denied (%)', SQLERRM;
  END;

  BEGIN
    INSERT INTO public.retreat_payments (registration_id, amount)
    VALUES ('00000000-0000-4000-8000-000000000099', 10);
    RAISE EXCEPTION 'FAIL: anon INSERT on retreat_payments should be denied';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: anon INSERT on retreat_payments denied';
    WHEN undefined_table THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: anon INSERT on retreat_payments denied (%)', SQLERRM;
  END;

  BEGIN
    UPDATE public.retreat_payments SET amount = 1 WHERE true;
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: anon UPDATE on retreat_payments should be denied';
    END IF;
    RAISE NOTICE 'PASS: anon UPDATE on retreat_payments affected 0 rows';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: anon UPDATE on retreat_payments denied';
    WHEN undefined_table THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: anon UPDATE on retreat_payments denied (%)', SQLERRM;
  END;

  BEGIN
    DELETE FROM public.retreat_payments WHERE true;
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: anon DELETE on retreat_payments should be denied';
    END IF;
    RAISE NOTICE 'PASS: anon DELETE on retreat_payments affected 0 rows';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: anon DELETE on retreat_payments denied';
    WHEN undefined_table THEN
      RAISE;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: anon DELETE on retreat_payments denied (%)', SQLERRM;
  END;

  RESET ROLE;

  -- =========================================================================
  -- 1.2 Anon RPC inserts preinscrito + consent; table INSERT still denied;
  --     no members / consent_records rows
  -- =========================================================================
  SELECT count(*) INTO v_members_before FROM public.members;
  SELECT count(*) INTO v_consent_before FROM public.consent_records;

  SET LOCAL ROLE anon;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon')::text,
    true
  );

  v_rpc_id := public.register_retreat_preinscription(
    p_name := 'Ana Retreat',
    p_phone := '3000000002',
    p_email := 'retreat-ok@example.com',
    p_birthday := DATE '2000-01-15',
    p_legal_rep_name := NULL,
    p_general_consent := true,
    p_sensitive_consent := false,
    p_denomination := 'Catolica',
    p_community_name := 'MD CC'
  );

  BEGIN
    INSERT INTO public.retreat_registrations (event_key, name, phone, email, status)
    VALUES ('retiro-juvenil-octubre-2026', 'Direct Insert', '3000000098', 'direct-insert@example.com', 'preinscrito');
    RAISE EXCEPTION 'FAIL: anon table INSERT must remain denied after RPC grant';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: anon table INSERT still denied';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: anon table INSERT still denied (%)', SQLERRM;
  END;

  RESET ROLE;

  IF v_rpc_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: RPC should return a registration uuid';
  END IF;

  SELECT r.status, r.event_key, r.email, r.phone,
         r.general_consent_accepted_at, r.general_consent_policy_version,
         r.denomination, r.community_name
    INTO v_status, v_event_key, v_email, v_phone, v_consent_at, v_policy,
         v_denomination, v_community
  FROM public.retreat_registrations r
  WHERE r.id = v_rpc_id;

  IF v_status IS DISTINCT FROM 'preinscrito' THEN
    RAISE EXCEPTION 'FAIL: RPC row status expected preinscrito, got %', v_status;
  END IF;
  IF v_event_key IS DISTINCT FROM 'retiro-juvenil-octubre-2026' THEN
    RAISE EXCEPTION 'FAIL: event_key must be retiro-juvenil-octubre-2026, got %', v_event_key;
  END IF;
  IF v_consent_at IS NULL OR v_policy IS NULL OR btrim(v_policy) = '' THEN
    RAISE EXCEPTION 'FAIL: general consent timestamp and policy version must be stored on the row';
  END IF;
  IF v_policy IS DISTINCT FROM 'pdtp-v1.0-2026-07-17' THEN
    RAISE EXCEPTION 'FAIL: expected policy version pdtp-v1.0-2026-07-17, got %', v_policy;
  END IF;
  IF v_email IS DISTINCT FROM 'retreat-ok@example.com' THEN
    RAISE EXCEPTION 'FAIL: expected normalized email retreat-ok@example.com, got %', v_email;
  END IF;
  IF v_phone IS DISTINCT FROM '3000000002' THEN
    RAISE EXCEPTION 'FAIL: expected normalized phone 3000000002, got %', v_phone;
  END IF;

  SELECT count(*) INTO v_members_after FROM public.members;
  SELECT count(*) INTO v_consent_after FROM public.consent_records;
  IF v_members_after <> v_members_before THEN
    RAISE EXCEPTION 'FAIL: RPC must not insert members (before %, after %)', v_members_before, v_members_after;
  END IF;
  IF v_consent_after <> v_consent_before THEN
    RAISE EXCEPTION 'FAIL: RPC must not insert consent_records (before %, after %)', v_consent_before, v_consent_after;
  END IF;

  RAISE NOTICE 'PASS: anon RPC inserts preinscrito with consent on the row; no members/consent_records';

  -- Anon still cannot read the PII just inserted
  SET LOCAL ROLE anon;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon')::text,
    true
  );
  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.retreat_registrations
      WHERE email = 'retreat-ok@example.com' OR id = v_rpc_id
    ) THEN
      RAISE EXCEPTION 'FAIL: anon SELECT leaked retreat-ok@example.com PII';
    END IF;
    RAISE NOTICE 'PASS: anon cannot read RPC-inserted PII';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: anon cannot read RPC-inserted PII (privilege)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: anon cannot read RPC-inserted PII (%)', SQLERRM;
  END;
  RESET ROLE;

  -- =========================================================================
  -- 1.3 Validation, uniqueness, sensitive-null-without-consent
  -- =========================================================================
  SET LOCAL ROLE anon;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon')::text,
    true
  );

  BEGIN
    PERFORM public.register_retreat_preinscription(
      p_name := '',
      p_phone := '3000000010',
      p_email := 'retreat-missing-name@example.com',
      p_birthday := DATE '2000-01-15',
      p_legal_rep_name := NULL,
      p_general_consent := true,
      p_sensitive_consent := false,
      p_denomination := NULL,
      p_community_name := NULL
    );
    RAISE EXCEPTION 'FAIL: missing name should be rejected';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: missing name rejected (%)', SQLERRM;
  END;

  BEGIN
    PERFORM public.register_retreat_preinscription(
      p_name := 'No Phone',
      p_phone := '',
      p_email := 'retreat-missing-phone@example.com',
      p_birthday := DATE '2000-01-15',
      p_legal_rep_name := NULL,
      p_general_consent := true,
      p_sensitive_consent := false,
      p_denomination := NULL,
      p_community_name := NULL
    );
    RAISE EXCEPTION 'FAIL: missing phone should be rejected';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: missing phone rejected (%)', SQLERRM;
  END;

  BEGIN
    PERFORM public.register_retreat_preinscription(
      p_name := 'No Email',
      p_phone := '3000000011',
      p_email := '  ',
      p_birthday := DATE '2000-01-15',
      p_legal_rep_name := NULL,
      p_general_consent := true,
      p_sensitive_consent := false,
      p_denomination := NULL,
      p_community_name := NULL
    );
    RAISE EXCEPTION 'FAIL: missing email should be rejected';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: missing email rejected (%)', SQLERRM;
  END;

  BEGIN
    PERFORM public.register_retreat_preinscription(
      p_name := 'No Consent',
      p_phone := '3000000012',
      p_email := 'retreat-no-consent@example.com',
      p_birthday := DATE '2000-01-15',
      p_legal_rep_name := NULL,
      p_general_consent := false,
      p_sensitive_consent := false,
      p_denomination := NULL,
      p_community_name := NULL
    );
    RAISE EXCEPTION 'FAIL: missing general consent should be rejected';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: missing general consent rejected (%)', SQLERRM;
  END;

  BEGIN
    PERFORM public.register_retreat_preinscription(
      p_name := 'Minor No Rep',
      p_phone := '3000000013',
      p_email := 'retreat-minor-norep@example.com',
      p_birthday := DATE '2012-06-15',
      p_legal_rep_name := NULL,
      p_general_consent := true,
      p_sensitive_consent := false,
      p_denomination := NULL,
      p_community_name := NULL
    );
    RAISE EXCEPTION 'FAIL: minor without legal representative should be rejected';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: minor without legal representative rejected (%)', SQLERRM;
  END;

  v_minor_id := public.register_retreat_preinscription(
    p_name := 'Minor With Rep',
    p_phone := '3000000014',
    p_email := 'retreat-minor@example.com',
    p_birthday := DATE '2012-06-15',
    p_legal_rep_name := 'Maria Representative',
    p_general_consent := true,
    p_sensitive_consent := false,
    p_denomination := NULL,
    p_community_name := NULL
  );

  v_dup_email_id := public.register_retreat_preinscription(
    p_name := 'Dup Email First',
    p_phone := '3000000020',
    p_email := 'Ana@Example.com',
    p_birthday := DATE '2000-01-15',
    p_legal_rep_name := NULL,
    p_general_consent := true,
    p_sensitive_consent := false,
    p_denomination := NULL,
    p_community_name := NULL
  );

  BEGIN
    PERFORM public.register_retreat_preinscription(
      p_name := 'Dup Email Second',
      p_phone := '3000000021',
      p_email := ' ana@example.com ',
      p_birthday := DATE '2000-01-15',
      p_legal_rep_name := NULL,
      p_general_consent := true,
      p_sensitive_consent := false,
      p_denomination := NULL,
      p_community_name := NULL
    );
    RAISE EXCEPTION 'FAIL: duplicate email for the same event should be rejected';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: duplicate email rejected (unique_violation)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: duplicate email rejected (%)', SQLERRM;
  END;

  v_dup_phone_id := public.register_retreat_preinscription(
    p_name := 'Dup Phone First',
    p_phone := '3001234567',
    p_email := 'retreat-dup-phone@example.com',
    p_birthday := DATE '2000-01-15',
    p_legal_rep_name := NULL,
    p_general_consent := true,
    p_sensitive_consent := false,
    p_denomination := NULL,
    p_community_name := NULL
  );

  BEGIN
    PERFORM public.register_retreat_preinscription(
      p_name := 'Dup Phone Second',
      p_phone := '300-123-4567',
      p_email := 'retreat-dup-phone-2@example.com',
      p_birthday := DATE '2000-01-15',
      p_legal_rep_name := NULL,
      p_general_consent := true,
      p_sensitive_consent := false,
      p_denomination := NULL,
      p_community_name := NULL
    );
    RAISE EXCEPTION 'FAIL: duplicate phone for the same event should be rejected';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: duplicate phone rejected (unique_violation)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: duplicate phone rejected (%)', SQLERRM;
  END;

  v_sens_yes_id := public.register_retreat_preinscription(
    p_name := 'Sensitive Yes',
    p_phone := '3000000030',
    p_email := 'retreat-sens-yes@example.com',
    p_birthday := DATE '2000-01-15',
    p_legal_rep_name := NULL,
    p_general_consent := true,
    p_sensitive_consent := true,
    p_denomination := 'Catolica',
    p_community_name := 'MD CC'
  );

  v_sens_no_id := public.register_retreat_preinscription(
    p_name := 'Sensitive No',
    p_phone := '3000000031',
    p_email := 'retreat-sens-no@example.com',
    p_birthday := DATE '2000-01-15',
    p_legal_rep_name := NULL,
    p_general_consent := true,
    p_sensitive_consent := false,
    p_denomination := 'Catolica',
    p_community_name := 'MD CC'
  );

  RESET ROLE;

  IF EXISTS (
    SELECT 1 FROM public.retreat_registrations
    WHERE email IN (
      'retreat-missing-name@example.com',
      'retreat-missing-phone@example.com',
      'retreat-no-consent@example.com',
      'retreat-minor-norep@example.com'
    )
  ) THEN
    RAISE EXCEPTION 'FAIL: rejected submits must not create retreat_registrations rows';
  END IF;

  SELECT r.legal_rep_name, r.is_minor
    INTO v_legal_rep, v_is_minor
  FROM public.retreat_registrations r
  WHERE r.id = v_minor_id;
  IF v_legal_rep IS DISTINCT FROM 'Maria Representative' OR v_is_minor IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: minor with legal representative should persist is_minor and legal_rep_name';
  END IF;
  RAISE NOTICE 'PASS: minor with legal representative persisted';

  SELECT r.email INTO v_email FROM public.retreat_registrations r WHERE r.id = v_dup_email_id;
  IF v_email IS DISTINCT FROM 'ana@example.com' THEN
    RAISE EXCEPTION 'FAIL: RPC should store lower(btrim(email)), got %', v_email;
  END IF;

  SELECT count(*) INTO v_pay_count
  FROM public.retreat_registrations
  WHERE email = 'ana@example.com';
  IF v_pay_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 1 row for ana@example.com, got %', v_pay_count;
  END IF;

  SELECT r.phone INTO v_phone FROM public.retreat_registrations r WHERE r.id = v_dup_phone_id;
  IF v_phone IS DISTINCT FROM '3001234567' THEN
    RAISE EXCEPTION 'FAIL: RPC should store digit-only phone, got %', v_phone;
  END IF;

  SELECT r.denomination, r.community_name, r.sensitive_consent_accepted_at
    INTO v_denomination, v_community, v_sensitive_at
  FROM public.retreat_registrations r
  WHERE r.id = v_sens_yes_id;
  IF v_denomination IS DISTINCT FROM 'Catolica' OR v_community IS DISTINCT FROM 'MD CC' THEN
    RAISE EXCEPTION 'FAIL: sensitive fields should persist when sensitive consent is accepted';
  END IF;
  IF v_sensitive_at IS NULL THEN
    RAISE EXCEPTION 'FAIL: sensitive consent timestamp should be stored when accepted';
  END IF;
  RAISE NOTICE 'PASS: sensitive fields stored with sensitive consent';

  SELECT r.denomination, r.community_name, r.sensitive_consent_accepted_at
    INTO v_denomination, v_community, v_sensitive_at
  FROM public.retreat_registrations r
  WHERE r.id = v_sens_no_id;
  IF v_denomination IS NOT NULL OR v_community IS NOT NULL OR v_sensitive_at IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: sensitive fields must be NULL without sensitive consent';
  END IF;
  RAISE NOTICE 'PASS: sensitive fields NULL without sensitive consent';

  -- Composite unique: same email allowed for a different event_key (owner insert)
  INSERT INTO public.retreat_registrations (
    event_key, name, phone, email, birthday, is_minor, status,
    general_consent_accepted_at, general_consent_policy_version
  ) VALUES (
    'other-event-key',
    'Other Event Ana',
    '3999999999',
    'ana@example.com',
    DATE '2000-01-15',
    false,
    'preinscrito',
    now(),
    'pdtp-v1.0-2026-07-17'
  ) RETURNING id INTO v_other_event_id;

  IF v_other_event_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: same email should be allowed for a different event_key';
  END IF;
  RAISE NOTICE 'PASS: unique (event_key, email) allows the same email on another event';

  -- =========================================================================
  -- 1.4 Refuse payment if total missing/empty/non-numeric/<=0 or amount <=0
  -- =========================================================================
  SELECT s.value INTO v_total_value
  FROM public.app_settings s
  WHERE s.key = 'retreat.youth.total_cost';
  IF v_total_value IS DISTINCT FROM '' THEN
    RAISE EXCEPTION 'FAIL: seed retreat.youth.total_cost must be empty string, got %', v_total_value;
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_leader_id::text,
      'app_metadata', json_build_object('role', 'leader')
    )::text,
    true
  );

  BEGIN
    INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
    VALUES (v_rpc_id, 10, v_leader_id);
    RAISE EXCEPTION 'FAIL: payment should be refused when total is empty';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: payment refused when total is empty (%)', SQLERRM;
  END;
  RESET ROLE;

  UPDATE public.app_settings SET value = '0' WHERE key = 'retreat.youth.total_cost';
  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_leader_id::text,
      'app_metadata', json_build_object('role', 'leader')
    )::text,
    true
  );
  BEGIN
    INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
    VALUES (v_rpc_id, 10, v_leader_id);
    RAISE EXCEPTION 'FAIL: payment should be refused when total is 0';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: payment refused when total is 0 (%)', SQLERRM;
  END;
  RESET ROLE;

  UPDATE public.app_settings SET value = '-5' WHERE key = 'retreat.youth.total_cost';
  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_leader_id::text,
      'app_metadata', json_build_object('role', 'leader')
    )::text,
    true
  );
  BEGIN
    INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
    VALUES (v_rpc_id, 10, v_leader_id);
    RAISE EXCEPTION 'FAIL: payment should be refused when total is negative';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: payment refused when total is negative (%)', SQLERRM;
  END;
  RESET ROLE;

  UPDATE public.app_settings SET value = 'not-a-number' WHERE key = 'retreat.youth.total_cost';
  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_leader_id::text,
      'app_metadata', json_build_object('role', 'leader')
    )::text,
    true
  );
  BEGIN
    INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
    VALUES (v_rpc_id, 10, v_leader_id);
    RAISE EXCEPTION 'FAIL: payment should be refused when total is non-numeric';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: payment refused when total is non-numeric (%)', SQLERRM;
  END;
  RESET ROLE;

  UPDATE public.app_settings SET value = '100' WHERE key = 'retreat.youth.total_cost';
  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_leader_id::text,
      'app_metadata', json_build_object('role', 'leader')
    )::text,
    true
  );
  BEGIN
    INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
    VALUES (v_rpc_id, 0, v_leader_id);
    RAISE EXCEPTION 'FAIL: payment amount 0 should be refused';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: payment amount 0 refused (%)', SQLERRM;
  END;

  BEGIN
    INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
    VALUES (v_rpc_id, -10, v_leader_id);
    RAISE EXCEPTION 'FAIL: negative payment amount should be refused';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: negative payment amount refused (%)', SQLERRM;
  END;
  RESET ROLE;

  SELECT r.status INTO v_status FROM public.retreat_registrations r WHERE r.id = v_rpc_id;
  IF v_status IS DISTINCT FROM 'preinscrito' THEN
    RAISE EXCEPTION 'FAIL: refused payments must leave status preinscrito, got %', v_status;
  END IF;
  SELECT count(*) INTO v_pay_count FROM public.retreat_payments WHERE registration_id = v_rpc_id;
  IF v_pay_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: refused payments must not create retreat_payments rows, got %', v_pay_count;
  END IF;
  RAISE NOTICE 'PASS: refused payments leave registration preinscrito with zero payment rows';

  -- Restore empty total to prove missing-key path, then delete and restore seed row
  DELETE FROM public.app_settings WHERE key = 'retreat.youth.total_cost';
  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_leader_id::text,
      'app_metadata', json_build_object('role', 'leader')
    )::text,
    true
  );
  BEGIN
    INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
    VALUES (v_rpc_id, 10, v_leader_id);
    RAISE EXCEPTION 'FAIL: payment should be refused when total key is missing';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: payment refused when total key is missing (%)', SQLERRM;
  END;
  RESET ROLE;

  INSERT INTO public.app_settings (key, value)
  VALUES ('retreat.youth.total_cost', '');

  -- =========================================================================
  -- 1.5 Status machine, overpay, no members, server INSERT denied
  -- =========================================================================
  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_super_admin_id::text,
      'app_metadata', json_build_object('role', 'super_admin')
    )::text,
    true
  );
  UPDATE public.app_settings
  SET value = '100', updated_by = v_super_admin_id
  WHERE key = 'retreat.youth.total_cost';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: super_admin should be able to set retreat.youth.total_cost';
  END IF;
  RESET ROLE;

  SELECT s.value INTO v_total_value FROM public.app_settings s WHERE s.key = 'retreat.youth.total_cost';
  IF v_total_value IS DISTINCT FROM '100' THEN
    RAISE EXCEPTION 'FAIL: expected total 100 after super_admin update, got %', v_total_value;
  END IF;
  RAISE NOTICE 'PASS: super_admin set retreat.youth.total_cost to 100';

  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_leader_id::text,
      'app_metadata', json_build_object('role', 'leader')
    )::text,
    true
  );
  BEGIN
    UPDATE public.app_settings SET value = '999' WHERE key = 'retreat.youth.total_cost';
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: leader should not update retreat.youth.total_cost';
    END IF;
    RAISE NOTICE 'PASS: leader cannot set retreat.youth.total_cost';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: leader cannot set retreat.youth.total_cost (privilege)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: leader cannot set retreat.youth.total_cost (%)', SQLERRM;
  END;
  RESET ROLE;

  SELECT s.value INTO v_total_value FROM public.app_settings s WHERE s.key = 'retreat.youth.total_cost';
  IF v_total_value IS DISTINCT FROM '100' THEN
    RAISE EXCEPTION 'FAIL: leader must not change stored total, got %', v_total_value;
  END IF;

  SET LOCAL ROLE anon;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon')::text,
    true
  );
  v_status_a := public.register_retreat_preinscription(
    p_name := 'Status A',
    p_phone := '3000000040',
    p_email := 'retreat-status-a@example.com',
    p_birthday := DATE '2000-01-15',
    p_legal_rep_name := NULL,
    p_general_consent := true,
    p_sensitive_consent := false,
    p_denomination := NULL,
    p_community_name := NULL
  );
  v_status_b := public.register_retreat_preinscription(
    p_name := 'Status B',
    p_phone := '3000000041',
    p_email := 'retreat-status-b@example.com',
    p_birthday := DATE '2000-01-15',
    p_legal_rep_name := NULL,
    p_general_consent := true,
    p_sensitive_consent := false,
    p_denomination := NULL,
    p_community_name := NULL
  );
  RESET ROLE;

  SELECT r.status INTO v_status FROM public.retreat_registrations r WHERE r.id = v_status_a;
  IF v_status IS DISTINCT FROM 'preinscrito' THEN
    RAISE EXCEPTION 'FAIL: zero-sum registration should be preinscrito, got %', v_status;
  END IF;
  RAISE NOTICE 'PASS: zero sum stays preinscrito';

  SELECT count(*) INTO v_members_before FROM public.members;

  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_leader_id::text,
      'app_metadata', json_build_object('role', 'leader')
    )::text,
    true
  );
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_status_a, 40, v_leader_id);
  RESET ROLE;

  SELECT r.status INTO v_status FROM public.retreat_registrations r WHERE r.id = v_status_a;
  IF v_status IS DISTINCT FROM 'pagos_parciales' THEN
    RAISE EXCEPTION 'FAIL: partial sum 40/100 should be pagos_parciales, got %', v_status;
  END IF;
  RAISE NOTICE 'PASS: partial sum becomes pagos_parciales';

  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_leader_id::text,
      'app_metadata', json_build_object('role', 'leader')
    )::text,
    true
  );
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_status_a, 60, v_leader_id);
  RESET ROLE;

  SELECT r.status INTO v_status FROM public.retreat_registrations r WHERE r.id = v_status_a;
  IF v_status IS DISTINCT FROM 'inscrito' THEN
    RAISE EXCEPTION 'FAIL: exact total 100/100 should be inscrito, got %', v_status;
  END IF;
  SELECT count(*) INTO v_members_after FROM public.members;
  IF v_members_after <> v_members_before THEN
    RAISE EXCEPTION 'FAIL: reaching inscrito must not insert members';
  END IF;
  RAISE NOTICE 'PASS: covered sum becomes inscrito without members insert';

  SET LOCAL ROLE anon;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon')::text,
    true
  );
  v_status_c := public.register_retreat_preinscription(
    p_name := 'Status C',
    p_phone := '3000000042',
    p_email := 'retreat-status-c@example.com',
    p_birthday := DATE '2000-01-15',
    p_legal_rep_name := NULL,
    p_general_consent := true,
    p_sensitive_consent := false,
    p_denomination := NULL,
    p_community_name := NULL
  );
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_leader_id::text,
      'app_metadata', json_build_object('role', 'leader')
    )::text,
    true
  );
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_status_c, 40, v_leader_id);
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_super_admin_id::text,
      'app_metadata', json_build_object('role', 'super_admin')
    )::text,
    true
  );
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_status_c, 20, v_super_admin_id);
  RESET ROLE;

  SELECT count(*) INTO v_pay_count
  FROM public.retreat_payments
  WHERE registration_id = v_status_c;
  IF v_pay_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: super_admin subsequent installment should persist, expected 2 payments got %', v_pay_count;
  END IF;
  SELECT r.status INTO v_status FROM public.retreat_registrations r WHERE r.id = v_status_c;
  IF v_status IS DISTINCT FROM 'pagos_parciales' THEN
    RAISE EXCEPTION 'FAIL: leader 40 + super_admin 20 should be pagos_parciales, got %', v_status;
  END IF;
  IF (
    SELECT COALESCE(SUM(p.amount), 0)
    FROM public.retreat_payments p
    WHERE p.registration_id = v_status_c
  ) <> 60 THEN
    RAISE EXCEPTION 'FAIL: payment sum should include both installments (60)';
  END IF;
  RAISE NOTICE 'PASS: super_admin subsequent installment persists with both payments';

  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_leader_id::text,
      'app_metadata', json_build_object('role', 'leader')
    )::text,
    true
  );
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_status_b, 80, v_leader_id);
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_status_b, 50, v_leader_id);
  RESET ROLE;

  SELECT r.status INTO v_status FROM public.retreat_registrations r WHERE r.id = v_status_b;
  IF v_status IS DISTINCT FROM 'inscrito' THEN
    RAISE EXCEPTION 'FAIL: overpay 130/100 should be inscrito, got %', v_status;
  END IF;
  SELECT count(*) INTO v_pay_count
  FROM public.retreat_payments
  WHERE registration_id = v_status_b;
  IF v_pay_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: overpay installment should persist, expected 2 payments got %', v_pay_count;
  END IF;
  RAISE NOTICE 'PASS: overpayment accepted and marked inscrito';

  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_server_id::text,
      'app_metadata', json_build_object('role', 'server')
    )::text,
    true
  );
  BEGIN
    INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
    VALUES (v_status_b, 5, v_server_id);
    RAISE EXCEPTION 'FAIL: server should not INSERT retreat_payments';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: server CANNOT INSERT retreat_payments';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: server CANNOT INSERT retreat_payments (%)', SQLERRM;
  END;
  RESET ROLE;

  SELECT count(*) INTO v_pay_count
  FROM public.retreat_payments
  WHERE registration_id = v_status_b AND recorded_by = v_server_id;
  IF v_pay_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: server payment row must not exist';
  END IF;

  RAISE NOTICE 'All retreat RLS/RPC/status tests passed';
END $$;

-- 2. Member-linked RPC (013) — compact, RED fails if column/function missing
DO $$
DECLARE
  v_leader UUID := 'a0000000-0000-4000-8000-000000000002';
  v_super UUID := 'a0000000-0000-4000-8000-000000000001';
  v_server UUID := 'a0000000-0000-4000-8000-000000000003';
  v_a UUID := 'b0000000-0000-4000-8000-0000000000a1'; v_b UUID := 'b0000000-0000-4000-8000-0000000000b2';
  v_minor UUID := 'b0000000-0000-4000-8000-0000000000c3'; v_dup_e UUID := 'b0000000-0000-4000-8000-0000000000d4';
  v_dup_p UUID := 'b0000000-0000-4000-8000-0000000000e5'; v_del UUID := 'b0000000-0000-4000-8000-0000000000f6';
  v_sens UUID := 'b0000000-0000-4000-8000-000000000101';
  v_reg UUID; v_first UUID; v_status TEXT; v_cnt INT; v_denom TEXT; v_comm TEXT; v_sens_at TIMESTAMPTZ; v_is_minor BOOLEAN; v_legal TEXT;
  v_event_key TEXT; v_policy TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='retreat_registrations' AND column_name='member_id') THEN RAISE EXCEPTION 'FAIL: member_id missing 013' USING ERRCODE='42703'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relname='retreat_registrations_member_id_idx' AND n.nspname='public') THEN RAISE EXCEPTION 'FAIL: idx missing'; END IF;
  INSERT INTO public.members (id,name,name_normalized,phone,email,birthday,is_minor,has_whatsapp,consent_recorded,sensitive_consent_recorded,duplicate_flag,created_by,created_at,updated_at,deleted_at) VALUES (v_a,'Ana A','ana a','3009000001','ana-a@example.com','2000-01-15',false,false,true,false,false,v_leader,now(),now(),NULL),(v_b,'Bob B','bob b','3009000002','bob-b@example.com','2000-01-15',false,false,true,false,false,v_leader,now(),now(),NULL),(v_minor,'Minor','minor','3009000003','minor@example.com','2014-06-15',true,false,true,false,false,v_leader,now(),now(),NULL),(v_dup_e,'Dup E','dup e','3009000004','ana-a@example.com','2000-01-15',false,false,true,false,false,v_leader,now(),now(),NULL),(v_dup_p,'Dup P','dup p','300-900-0001','dup-p@example.com','2000-01-15',false,false,true,false,false,v_leader,now(),now(),NULL),(v_del,'Del','del','3009000006','del@example.com','2000-01-15',false,false,true,false,false,v_leader,now(),now(),now()),(v_sens,'Sens','sens','3009000007','sens@example.com','2000-01-15',false,false,true,false,false,v_leader,now(),now(),NULL) ON CONFLICT (id) DO NOTHING;
  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  v_reg:=public.register_retreat_preinscription_for_member(p_member_id:=v_a,p_general_consent:=true);
  SELECT status,event_key,member_id,general_consent_accepted_at,general_consent_policy_version INTO v_status,v_event_key,v_first,v_sens_at,v_policy FROM public.retreat_registrations WHERE id=v_reg;
  IF v_status<>'preinscrito' OR v_event_key<>'retiro-juvenil-octubre-2026' OR v_first<>v_a OR v_sens_at IS NULL OR v_policy<>'pdtp-v1.0-2026-07-17' THEN RAISE EXCEPTION 'FAIL: leader mismatch'; END IF; v_first:=v_reg; RAISE NOTICE 'PASS: leader member-linked'; RESET ROLE;
  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  BEGIN PERFORM public.register_retreat_preinscription_for_member(p_member_id:=v_b,p_general_consent:=false); RAISE EXCEPTION 'FAIL: consent not rejected'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; IF SQLSTATE!='23514' THEN RAISE EXCEPTION 'FAIL: consent 23514 % %',SQLSTATE,SQLERRM; END IF; RAISE NOTICE 'PASS: missing consent %',SQLERRM; END; RESET ROLE;
  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  BEGIN PERFORM public.register_retreat_preinscription_for_member(p_member_id:=v_minor,p_general_consent:=true,p_legal_rep_name:=NULL); RAISE EXCEPTION 'FAIL: minor no rep'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; IF SQLERRM NOT LIKE '%legal representative%' THEN RAISE EXCEPTION 'FAIL: legal rep % %',SQLSTATE,SQLERRM; END IF; RAISE NOTICE 'PASS: minor no rep %',SQLERRM; END;
  BEGIN v_reg:=public.register_retreat_preinscription_for_member(p_member_id:=v_minor,p_general_consent:=true,p_legal_rep_name:='Tutor'); SELECT is_minor,legal_rep_name INTO v_is_minor,v_legal FROM public.retreat_registrations WHERE id=v_reg; IF NOT v_is_minor OR v_legal<>'Tutor' THEN RAISE EXCEPTION 'FAIL: minor rep'; END IF; RAISE NOTICE 'PASS: minor with rep'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE EXCEPTION 'FAIL: minor rep % %',SQLSTATE,SQLERRM; END; RESET ROLE;
  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  BEGIN PERFORM public.register_retreat_preinscription_for_member(p_member_id:=v_a,p_general_consent:=true); RAISE EXCEPTION 'FAIL: dup member'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; IF SQLSTATE!='23505' THEN RAISE EXCEPTION 'FAIL: dup member 23505 % %',SQLSTATE,SQLERRM; END IF; SELECT count(*) INTO v_cnt FROM public.retreat_registrations WHERE member_id=v_a; IF v_cnt<>1 THEN RAISE EXCEPTION 'FAIL: dup count %',v_cnt; END IF; RAISE NOTICE 'PASS: dup member %',SQLERRM; END; RESET ROLE;
  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  BEGIN PERFORM public.register_retreat_preinscription_for_member(p_member_id:=v_dup_e,p_general_consent:=true); RAISE EXCEPTION 'FAIL: dup email'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; IF SQLSTATE!='23505' THEN RAISE EXCEPTION 'FAIL: dup email % %',SQLSTATE,SQLERRM; END IF; RAISE NOTICE 'PASS: dup email %',SQLERRM; END; RESET ROLE;
  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  BEGIN PERFORM public.register_retreat_preinscription_for_member(p_member_id:=v_dup_p,p_general_consent:=true); RAISE EXCEPTION 'FAIL: dup phone'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; IF SQLSTATE!='23505' THEN RAISE EXCEPTION 'FAIL: dup phone % %',SQLSTATE,SQLERRM; END IF; RAISE NOTICE 'PASS: dup phone %',SQLERRM; END; RESET ROLE;
  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  BEGIN PERFORM public.register_retreat_preinscription_for_member(p_member_id:=v_del,p_general_consent:=true); RAISE EXCEPTION 'FAIL: deleted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; IF SQLERRM NOT LIKE '%member not found%' THEN RAISE EXCEPTION 'FAIL: deleted % %',SQLSTATE,SQLERRM; END IF; RAISE NOTICE 'PASS: deleted %',SQLERRM; END; RESET ROLE;
  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  BEGIN v_reg:=public.register_retreat_preinscription_for_member(p_member_id:=v_sens,p_general_consent:=true,p_sensitive_consent:=false,p_denomination:='Catolica',p_community_name:='MD CC'); SELECT denomination,community_name,sensitive_consent_accepted_at INTO v_denom,v_comm,v_sens_at FROM public.retreat_registrations WHERE id=v_reg; IF v_denom IS NOT NULL OR v_comm IS NOT NULL OR v_sens_at IS NOT NULL THEN RAISE EXCEPTION 'FAIL: sens false'; END IF; RAISE NOTICE 'PASS: sens false'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE EXCEPTION 'FAIL: sens false % %',SQLSTATE,SQLERRM; END; RESET ROLE;
  INSERT INTO public.members (id,name,name_normalized,phone,email,birthday,is_minor,has_whatsapp,consent_recorded,sensitive_consent_recorded,duplicate_flag,created_by,created_at,updated_at,deleted_at) VALUES ('b0000000-0000-4000-8000-000000000103','SensT','senst','3009000009','sens-true@example.com','2000-01-15',false,false,true,false,false,v_leader,now(),now(),NULL) ON CONFLICT (id) DO NOTHING;
  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  BEGIN v_reg:=public.register_retreat_preinscription_for_member(p_member_id:='b0000000-0000-4000-8000-000000000103',p_general_consent:=true,p_sensitive_consent:=true,p_denomination:='Catolica',p_community_name:='MD CC'); SELECT denomination,community_name,sensitive_consent_accepted_at INTO v_denom,v_comm,v_sens_at FROM public.retreat_registrations WHERE id=v_reg; IF v_denom<>'Catolica' OR v_comm<>'MD CC' OR v_sens_at IS NULL THEN RAISE EXCEPTION 'FAIL: sens true'; END IF; RAISE NOTICE 'PASS: sens true'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; RAISE EXCEPTION 'FAIL: sens true % %',SQLSTATE,SQLERRM; END; RESET ROLE;
  SET LOCAL ROLE anon; PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text,true);
  BEGIN PERFORM public.register_retreat_preinscription_for_member(p_member_id:=v_b,p_general_consent:=true); RAISE EXCEPTION 'FAIL: anon'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: anon deny'; WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; IF SQLSTATE='42501' OR SQLERRM LIKE '%permission denied%' THEN RAISE NOTICE 'PASS: anon deny %',SQLERRM; ELSE RAISE EXCEPTION 'FAIL: anon % %',SQLSTATE,SQLERRM; END IF; END; RESET ROLE;
  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_server::text,'app_metadata',json_build_object('role','server'))::text,true);
  BEGIN PERFORM public.register_retreat_preinscription_for_member(p_member_id:=v_b,p_general_consent:=true); RAISE EXCEPTION 'FAIL: server'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; IF SQLSTATE!='42501' THEN RAISE EXCEPTION 'FAIL: server 42501 % %',SQLSTATE,SQLERRM; END IF; RAISE NOTICE 'PASS: server deny %',SQLERRM; END; RESET ROLE;
  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_super::text,'app_metadata',json_build_object('role','super_admin'))::text,true); UPDATE public.app_settings SET value='100',updated_by=v_super WHERE key='retreat.youth.total_cost'; RESET ROLE;
  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true); INSERT INTO public.retreat_payments (registration_id,amount,recorded_by) VALUES (v_first,40,v_leader); RESET ROLE; SELECT status INTO v_status FROM public.retreat_registrations WHERE id=v_first; IF v_status<>'pagos_parciales' THEN RAISE EXCEPTION 'FAIL: pagos_parciales %',v_status; END IF; RAISE NOTICE 'PASS: pagos_parciales';
  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true); INSERT INTO public.retreat_payments (registration_id,amount,recorded_by) VALUES (v_first,60,v_leader); RESET ROLE; SELECT status INTO v_status FROM public.retreat_registrations WHERE id=v_first; IF v_status<>'inscrito' THEN RAISE EXCEPTION 'FAIL: inscrito %',v_status; END IF; RAISE NOTICE 'PASS: inscrito';
  RAISE NOTICE 'All member-linked RPC tests passed';
END $$;

ROLLBACK;
