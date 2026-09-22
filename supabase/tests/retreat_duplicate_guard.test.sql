-- Retreat duplicate-guard tests (025)
-- Verifies register_retreat_preinscription maps duplicates to the handled
-- `already_preinscribed` 23505 instead of leaking the raw PG error on
-- retreat_registrations_event_email_uidx / _phone_uidx.
--
-- Run as postgres (table owner). anon RPC cases SET LOCAL ROLE anon.
--
-- CI: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/retreat_duplicate_guard.test.sql
-- Local: same command (session user postgres).
--
-- Relies on supabase/seed.sql (via db reset) for the role users.
-- Match retreat_rls.test.sql style: RAISE NOTICE 'PASS: ...' / RAISE EXCEPTION 'FAIL: ...'

BEGIN;

DO $$
DECLARE
  v_first_id UUID;
BEGIN
  -- First registration (with religious data, as in the reported bug) succeeds.
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  v_first_id := public.register_retreat_preinscription(
    p_name := 'Dup Guard First',
    p_phone := '3000240001',
    p_email := 'dup-guard-024@example.com',
    p_birthday := DATE '2000-01-15',
    p_general_consent := true,
    p_sensitive_consent := true,
    p_denomination := 'Catolica',
    p_community_name := 'MD CC'
  );
  IF v_first_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: first registration should succeed';
  END IF;
  RAISE NOTICE 'PASS: first registration with religious data succeeds';
  RESET ROLE;

  -- Same email (different case/whitespace) -> handled already_preinscribed 23505.
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  BEGIN
    PERFORM public.register_retreat_preinscription(
      p_name := 'Dup Guard Second',
      p_phone := '3000240002',
      p_email := ' Dup-Guard-024@Example.com ',
      p_birthday := DATE '2000-01-15',
      p_general_consent := true,
      p_sensitive_consent := true,
      p_denomination := 'Cristiana',
      p_community_name := 'Otra Comunidad'
    );
    RAISE EXCEPTION 'FAIL: duplicate email for the same event should be rejected';
  EXCEPTION
    WHEN unique_violation THEN
      IF SQLSTATE <> '23505' THEN
        RAISE EXCEPTION 'FAIL: expected SQLSTATE 23505, got % (%)', SQLSTATE, SQLERRM;
      END IF;
      IF SQLERRM NOT LIKE '%already_preinscribed%' THEN
        RAISE EXCEPTION 'FAIL: raw 23505 leaked without already_preinscribed mapping: %', SQLERRM;
      END IF;
      RAISE NOTICE 'PASS: duplicate email mapped to already_preinscribed (%)', SQLERRM;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION 'FAIL: duplicate email expected 23505 already_preinscribed, got % %', SQLSTATE, SQLERRM;
  END;
  RESET ROLE;

  -- Same phone (different formatting) -> handled already_preinscribed 23505.
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  BEGIN
    PERFORM public.register_retreat_preinscription(
      p_name := 'Dup Guard Phone',
      p_phone := '300-024-0001',
      p_email := 'dup-guard-024-phone@example.com',
      p_birthday := DATE '2000-01-15',
      p_general_consent := true
    );
    RAISE EXCEPTION 'FAIL: duplicate phone for the same event should be rejected';
  EXCEPTION
    WHEN unique_violation THEN
      IF SQLERRM NOT LIKE '%already_preinscribed%' THEN
        RAISE EXCEPTION 'FAIL: raw 23505 leaked without already_preinscribed mapping: %', SQLERRM;
      END IF;
      RAISE NOTICE 'PASS: duplicate phone mapped to already_preinscribed (%)', SQLERRM;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION 'FAIL: duplicate phone expected 23505 already_preinscribed, got % %', SQLSTATE, SQLERRM;
  END;
  RESET ROLE;

  -- Negative control: fresh email + fresh phone still succeeds.
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM public.register_retreat_preinscription(
    p_name := 'Dup Guard Fresh',
    p_phone := '3000240003',
    p_email := 'dup-guard-024-fresh@example.com',
    p_birthday := DATE '2000-01-15',
    p_general_consent := true
  );
  RAISE NOTICE 'PASS: fresh email+phone still registers';
  RESET ROLE;

  RAISE NOTICE 'All duplicate-guard RPC tests passed';
END $$;

ROLLBACK;
