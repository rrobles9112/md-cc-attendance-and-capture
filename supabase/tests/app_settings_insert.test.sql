-- app_settings_insert.test.sql — fix-retiro-costo-total T-SQL-1..4 (owner-run psql)
-- Run: docker exec -i supabase_db_MD_CC_ATTENDANCE_AND_CAPTURE psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/app_settings_insert.test.sql
-- Pre-migration expectation: T-SQL-1 RED (super_admin INSERT ... ON CONFLICT => 42501, no FOR INSERT policy).
-- Post-migration expectation: T-SQL-1 GREEN (succeeds), T-SQL-2/3/4 still denied.
BEGIN;
DO $$
DECLARE
  v_super UUID := 'a0000000-0000-4000-8000-000000000001';
  v_leader UUID := 'a0000000-0000-4000-8000-000000000002';
  v_val TEXT;
BEGIN
  -- 0) guard: app_settings table exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_settings') THEN
    RAISE EXCEPTION 'FAIL: public.app_settings missing';
  END IF;

  -- cleanup any prior __t keys (idempotent)
  DELETE FROM public.app_settings WHERE key LIKE '__t\_%';

  -- T-SQL-1: super_admin INSERT ... ON CONFLICT succeeds (RED pre-migration: 42501)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_super::text,'app_metadata',json_build_object('role','super_admin'))::text, true);
  BEGIN
    INSERT INTO public.app_settings(key, value) VALUES ('__t1','480000')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      RAISE EXCEPTION 'FAIL: T-SQL-1 super_admin INSERT denied 42501 (missing FOR INSERT policy) %', SQLERRM;
    ELSE
      RAISE EXCEPTION 'FAIL: T-SQL-1 unexpected % %', SQLSTATE, SQLERRM;
    END IF;
  END;
  RESET ROLE;
  SELECT value INTO v_val FROM public.app_settings WHERE key = '__t1';
  IF v_val <> '480000' THEN
    RAISE EXCEPTION 'FAIL: T-SQL-1 value got %', v_val;
  END IF;
  RAISE NOTICE 'PASS: T-SQL-1 super_admin upsert succeeds';

  -- T-SQL-2: leader INSERT ... ON CONFLICT denied 42501, value unchanged
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text, true);
  BEGIN
    INSERT INTO public.app_settings(key, value) VALUES ('__t1','999999')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    RAISE EXCEPTION 'FAIL: T-SQL-2 leader should be denied 42501';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLSTATE <> '42501' THEN
      RAISE EXCEPTION 'FAIL: T-SQL-2 expected 42501 got % %', SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: T-SQL-2 leader denied 42501 %', SQLERRM;
  END;
  RESET ROLE;
  SELECT value INTO v_val FROM public.app_settings WHERE key = '__t1';
  IF v_val <> '480000' THEN
    RAISE EXCEPTION 'FAIL: T-SQL-2 value changed to %', v_val;
  END IF;

  -- T-SQL-3: anon denied, value unchanged
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  BEGIN
    INSERT INTO public.app_settings(key, value) VALUES ('__t1','999999')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    RAISE EXCEPTION 'FAIL: T-SQL-3 anon should be denied';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: T-SQL-3 anon denied % %', SQLSTATE, SQLERRM;
  END;
  RESET ROLE;
  SELECT value INTO v_val FROM public.app_settings WHERE key = '__t1';
  IF v_val <> '480000' THEN
    RAISE EXCEPTION 'FAIL: T-SQL-3 value changed to %', v_val;
  END IF;

  -- T-SQL-4: authenticated without app_metadata claim denied
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text)::text, true);
  BEGIN
    INSERT INTO public.app_settings(key, value) VALUES ('__t2','480000')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    RAISE EXCEPTION 'FAIL: T-SQL-4 no-claim should be denied';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLSTATE <> '42501' THEN
      RAISE EXCEPTION 'FAIL: T-SQL-4 expected 42501 got % %', SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: T-SQL-4 no-claim denied 42501 %', SQLERRM;
  END;
  RESET ROLE;

  -- cleanup __t keys
  DELETE FROM public.app_settings WHERE key LIKE '__t\_%';

  RAISE NOTICE 'All app_settings_insert cases PASSED';
END $$;
ROLLBACK;
