-- Retreat preinscription DELETE tests (change: delete-retreat-preinscriptions)
-- Run as postgres (table owner). Do NOT prepend SET ROLE authenticated.
--
-- CI:    docker exec supabase_db_MD_CC_ATTENDANCE_AND_CAPTURE psql -U postgres \
--          -v ON_ERROR_STOP=1 -f supabase/tests/retreat_delete.test.sql
-- Local: same command. Each staff/anon block uses SET LOCAL ROLE + JWT claims,
--        then RESET ROLE to verify as owner.
--
-- Relies on supabase/seed.sql (via db reset) for the three role users:
--   a0000000-0000-4000-8000-000000000001  super_admin
--   a0000000-0000-4000-8000-000000000002  leader
--   a0000000-0000-4000-8000-000000000003  server
-- Pattern matches retreat_rls.test.sql: RAISE NOTICE 'PASS: ...' /
-- RAISE EXCEPTION 'FAIL: ...', single transaction with final ROLLBACK.
--
-- RED expectation (pre-migration 021): S3/S4/S5 PASS as denied, S1 FAILS
-- (staff DELETE affects 0 rows / privilege denied — no DELETE policy yet),
-- aborting the script. S2/S6/S8 fail by the same mechanism (no staff DELETE
-- capability at all). Post-021: all S1–S8 PASS.

BEGIN;

DO $$
DECLARE
  v_super_admin_id UUID := 'a0000000-0000-4000-8000-000000000001';
  v_leader_id UUID := 'a0000000-0000-4000-8000-000000000002';
  v_server_id UUID := 'a0000000-0000-4000-8000-000000000003';
  v_s1 UUID;
  v_s2 UUID;
  v_s3 UUID;
  v_s4 UUID;
  v_s5 UUID;
  v_s6 UUID;
  v_s7 UUID;
  v_s8 UUID;
  v_pay1 UUID;
  v_pay2 UUID;
  v_n INTEGER;
  v_status TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_super_admin_id) THEN
    RAISE EXCEPTION 'Seed users missing — run supabase db reset (applies seed.sql) before retreat DELETE tests';
  END IF;

  -- Owner setup: valid total so payment seeding passes the BEFORE INSERT guard.
  UPDATE public.app_settings SET value = '100' WHERE key = 'retreat.youth.total_cost';

  -- =========================================================================
  -- S3 — server denied (0 rows, fail-closed)
  -- =========================================================================
  INSERT INTO public.retreat_registrations (
    event_key, name, phone, email, status,
    general_consent_accepted_at, general_consent_policy_version
  ) VALUES (
    'retiro-juvenil-octubre-2026', 'S3 Server Denied', '3000000051',
    'retreat-del-s3@example.com', 'preinscrito', now(), 'pdtp-v1.0-2026-07-17'
  ) RETURNING id INTO v_s3;
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_s3, 40, v_leader_id), (v_s3, 20, v_leader_id);

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
    DELETE FROM public.retreat_payments WHERE registration_id = v_s3;
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: S3 server DELETE on retreat_payments should affect 0 rows';
    END IF;
    DELETE FROM public.retreat_registrations WHERE id = v_s3;
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: S3 server DELETE on retreat_registrations should affect 0 rows';
    END IF;
    RAISE NOTICE 'PASS: S3 server DELETE denied on both tables (0 rows)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: S3 server DELETE denied (privilege)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: S3 server DELETE denied (%)', SQLERRM;
  END;
  RESET ROLE;

  -- =========================================================================
  -- S4 — anon denied (0 rows, fail-closed)
  -- =========================================================================
  SET LOCAL ROLE anon;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon')::text,
    true
  );
  BEGIN
    DELETE FROM public.retreat_payments WHERE registration_id = v_s3;
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: S4 anon DELETE on retreat_payments should affect 0 rows';
    END IF;
    DELETE FROM public.retreat_registrations WHERE id = v_s3;
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: S4 anon DELETE on retreat_registrations should affect 0 rows';
    END IF;
    RAISE NOTICE 'PASS: S4 anon DELETE denied on both tables (0 rows)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: S4 anon DELETE denied (privilege)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: S4 anon DELETE denied (%)', SQLERRM;
  END;
  RESET ROLE;

  -- =========================================================================
  -- S5 — inverted order violates FK (post-021) / denied with 0 rows (pre-021)
  -- =========================================================================
  INSERT INTO public.retreat_registrations (
    event_key, name, phone, email, status,
    general_consent_accepted_at, general_consent_policy_version
  ) VALUES (
    'retiro-juvenil-octubre-2026', 'S5 Inverted Order', '3000000052',
    'retreat-del-s5@example.com', 'preinscrito', now(), 'pdtp-v1.0-2026-07-17'
  ) RETURNING id INTO v_s5;
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_s5, 50, v_leader_id);

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
    DELETE FROM public.retreat_registrations WHERE id = v_s5;
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: S5 inverted-order DELETE should never remove a registration with payments';
    END IF;
    RAISE NOTICE 'PASS: S5 inverted-order DELETE denied (0 rows — pre-021, no policy yet)';
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE NOTICE 'PASS: S5 inverted-order DELETE rejected by FK (payments must go first)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: S5 inverted-order DELETE denied (%)', SQLERRM;
  END;
  RESET ROLE;

  -- =========================================================================
  -- S1 — leader deletes in payments → registration order
  -- =========================================================================
  INSERT INTO public.retreat_registrations (
    event_key, name, phone, email, status,
    general_consent_accepted_at, general_consent_policy_version
  ) VALUES (
    'retiro-juvenil-octubre-2026', 'S1 Leader Order', '3000000053',
    'retreat-del-s1@example.com', 'preinscrito', now(), 'pdtp-v1.0-2026-07-17'
  ) RETURNING id INTO v_s1;
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_s1, 40, v_leader_id), (v_s1, 20, v_leader_id);

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
    DELETE FROM public.retreat_payments WHERE registration_id = v_s1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 2 THEN
      RAISE EXCEPTION 'FAIL: S1 leader should delete 2 payments, deleted %', v_n;
    END IF;
    DELETE FROM public.retreat_registrations WHERE id = v_s1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'FAIL: S1 leader should delete 1 registration, deleted %', v_n;
    END IF;
    RAISE NOTICE 'PASS: S1 leader deletes payments then registration';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'FAIL: S1 leader DELETE denied (no GRANT/policy — pre-021 gap)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE;
  END;
  RESET ROLE;

  IF EXISTS (SELECT 1 FROM public.retreat_payments WHERE registration_id = v_s1) THEN
    RAISE EXCEPTION 'FAIL: S1 payments should be gone';
  END IF;
  IF EXISTS (SELECT 1 FROM public.retreat_registrations WHERE id = v_s1) THEN
    RAISE EXCEPTION 'FAIL: S1 registration should be gone';
  END IF;

  -- =========================================================================
  -- S2 — super_admin deletes in payments → registration order
  -- =========================================================================
  INSERT INTO public.retreat_registrations (
    event_key, name, phone, email, status,
    general_consent_accepted_at, general_consent_policy_version
  ) VALUES (
    'retiro-juvenil-octubre-2026', 'S2 Super Admin Order', '3000000054',
    'retreat-del-s2@example.com', 'preinscrito', now(), 'pdtp-v1.0-2026-07-17'
  ) RETURNING id INTO v_s2;
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_s2, 60, v_super_admin_id), (v_s2, 40, v_super_admin_id);

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
  BEGIN
    DELETE FROM public.retreat_payments WHERE registration_id = v_s2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 2 THEN
      RAISE EXCEPTION 'FAIL: S2 super_admin should delete 2 payments, deleted %', v_n;
    END IF;
    DELETE FROM public.retreat_registrations WHERE id = v_s2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'FAIL: S2 super_admin should delete 1 registration, deleted %', v_n;
    END IF;
    RAISE NOTICE 'PASS: S2 super_admin deletes payments then registration';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'FAIL: S2 super_admin DELETE denied (no GRANT/policy — pre-021 gap)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE;
  END;
  RESET ROLE;

  IF EXISTS (SELECT 1 FROM public.retreat_payments WHERE registration_id = v_s2) THEN
    RAISE EXCEPTION 'FAIL: S2 payments should be gone';
  END IF;
  IF EXISTS (SELECT 1 FROM public.retreat_registrations WHERE id = v_s2) THEN
    RAISE EXCEPTION 'FAIL: S2 registration should be gone';
  END IF;

  -- =========================================================================
  -- S6 — option (b): DELETE only payments resets status to preinscrito
  -- =========================================================================
  INSERT INTO public.retreat_registrations (
    event_key, name, phone, email, status,
    general_consent_accepted_at, general_consent_policy_version
  ) VALUES (
    'retiro-juvenil-octubre-2026', 'S6 Keep Registration', '3000000055',
    'retreat-del-s6@example.com', 'preinscrito', now(), 'pdtp-v1.0-2026-07-17'
  ) RETURNING id INTO v_s6;
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_s6, 60, v_leader_id), (v_s6, 40, v_leader_id);

  SELECT r.status INTO v_status FROM public.retreat_registrations r WHERE r.id = v_s6;
  IF v_status IS DISTINCT FROM 'inscrito' THEN
    RAISE EXCEPTION 'FAIL: S6 setup should reach inscrito (100/100), got %', v_status;
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
    DELETE FROM public.retreat_payments WHERE registration_id = v_s6;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 2 THEN
      RAISE EXCEPTION 'FAIL: S6 leader should delete 2 payments, deleted %', v_n;
    END IF;
    RAISE NOTICE 'PASS: S6 leader deleted only payments (option b)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'FAIL: S6 leader DELETE denied (no GRANT/policy — pre-021 gap)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE;
  END;
  RESET ROLE;

  SELECT r.status INTO v_status FROM public.retreat_registrations r WHERE r.id = v_s6;
  IF v_status IS DISTINCT FROM 'preinscrito' THEN
    RAISE EXCEPTION 'FAIL: S6 registration should reset to preinscrito after option (b), got %', v_status;
  END IF;
  RAISE NOTICE 'PASS: S6 option (b) keeps registration with status preinscrito';

  -- =========================================================================
  -- S7 — invalid total + remainder: partial delete leaves status untouched
  -- =========================================================================
  INSERT INTO public.retreat_registrations (
    event_key, name, phone, email, status,
    general_consent_accepted_at, general_consent_policy_version
  ) VALUES (
    'retiro-juvenil-octubre-2026', 'S7 Invalid Total', '3000000056',
    'retreat-del-s7@example.com', 'preinscrito', now(), 'pdtp-v1.0-2026-07-17'
  ) RETURNING id INTO v_s7;
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_s7, 60, v_leader_id) RETURNING id INTO v_pay1;
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_s7, 40, v_leader_id) RETURNING id INTO v_pay2;

  SELECT r.status INTO v_status FROM public.retreat_registrations r WHERE r.id = v_s7;
  IF v_status IS DISTINCT FROM 'inscrito' THEN
    RAISE EXCEPTION 'FAIL: S7 setup should reach inscrito (100/100), got %', v_status;
  END IF;

  -- Invalidate the configured total (empty string): trigger must leave survivor intact.
  UPDATE public.app_settings SET value = '' WHERE key = 'retreat.youth.total_cost';

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
    DELETE FROM public.retreat_payments WHERE id = v_pay1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'FAIL: S7 partial delete should remove exactly 1 payment, removed %', v_n;
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'FAIL: S7 leader DELETE denied (no GRANT/policy — pre-021 gap)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE;
  END;
  RESET ROLE;

  SELECT count(*) INTO v_n FROM public.retreat_payments WHERE registration_id = v_s7;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL: S7 exactly 1 payment should remain, found %', v_n;
  END IF;
  SELECT r.status INTO v_status FROM public.retreat_registrations r WHERE r.id = v_s7;
  IF v_status IS DISTINCT FROM 'inscrito' THEN
    RAISE EXCEPTION 'FAIL: S7 status should stay inscrito with invalid total + remainder, got %', v_status;
  END IF;
  RAISE NOTICE 'PASS: S7 invalid total + remainder leaves status intact';

  UPDATE public.app_settings SET value = '100' WHERE key = 'retreat.youth.total_cost';

  -- =========================================================================
  -- S8 — audit_log rows after authorized DELETEs
  -- =========================================================================
  INSERT INTO public.retreat_registrations (
    event_key, name, phone, email, status,
    general_consent_accepted_at, general_consent_policy_version
  ) VALUES (
    'retiro-juvenil-octubre-2026', 'S8 Audit Trail', '3000000057',
    'retreat-del-s8@example.com', 'preinscrito', now(), 'pdtp-v1.0-2026-07-17'
  ) RETURNING id INTO v_s8;
  INSERT INTO public.retreat_payments (registration_id, amount, recorded_by)
  VALUES (v_s8, 30, v_leader_id) RETURNING id INTO v_pay1;

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
    DELETE FROM public.retreat_payments WHERE registration_id = v_s8;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'FAIL: S8 leader should delete 1 payment, deleted %', v_n;
    END IF;
    DELETE FROM public.retreat_registrations WHERE id = v_s8;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'FAIL: S8 leader should delete 1 registration, deleted %', v_n;
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'FAIL: S8 leader DELETE denied (no GRANT/policy — pre-021 gap)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE;
  END;
  RESET ROLE;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log a
    WHERE a.table_name = 'retreat_payments' AND a.record_id = v_pay1
      AND a.action = 'DELETE'
  ) THEN
    RAISE EXCEPTION 'FAIL: S8 audit_log should contain the payment DELETE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log a
    WHERE a.table_name = 'retreat_registrations' AND a.record_id = v_s8
      AND a.action = 'DELETE'
  ) THEN
    RAISE EXCEPTION 'FAIL: S8 audit_log should contain the registration DELETE';
  END IF;
  RAISE NOTICE 'PASS: S8 audit_log captures both DELETEs';

  -- S4 used v_s3 seed: v_s3 rows must still exist (denied deletes changed nothing).
  IF NOT EXISTS (SELECT 1 FROM public.retreat_registrations WHERE id = v_s3) THEN
    RAISE EXCEPTION 'FAIL: S3/S4 seed registration must survive denied deletes';
  END IF;
  SELECT count(*) INTO v_n FROM public.retreat_payments WHERE registration_id = v_s3;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FAIL: S3/S4 seed payments must survive denied deletes, found %', v_n;
  END IF;

  RAISE NOTICE 'All retreat DELETE tests passed (S1–S8)';
END $$;

ROLLBACK;
