-- RLS Integration Tests
-- Run with: supabase db test or psql -f supabase/tests/rls.test.sql
-- Uses DO $$ blocks with RAISE ASSERTIONS
--
-- Relies on supabase/seed.sql (via db reset) for the three role users.
-- Creates ephemeral members/sessions for assertions and cleans those up only.
-- Variable names use v_ prefix to avoid PL/pgSQL / column ambiguity.
--
-- The block runs as the `authenticated` role inside a transaction: psql connects as
-- the postgres owner, which BYPASSES RLS — without SET ROLE no policy is ever
-- enforced and deny-path assertions cannot pass. Claims mimic a real Supabase JWT:
-- 'role' is the PostgREST role; the app role resolves from profiles via 'sub'.

BEGIN;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_super_admin_id UUID;
  v_leader_id UUID;
  v_server_id UUID;
  v_member_id UUID;
  v_leader_member_id UUID;
  v_server_member_id UUID;
  v_session_id UUID;
  v_retreat_registration_id UUID;
BEGIN
  -- Deterministic IDs from supabase/seed.sql
  v_super_admin_id := 'a0000000-0000-4000-8000-000000000001';
  v_leader_id := 'a0000000-0000-4000-8000-000000000002';
  v_server_id := 'a0000000-0000-4000-8000-000000000003';

  -- Need super_admin identity before reading/updating other profiles under RLS.
  -- Realistic JWT: 'role' is the PostgREST role; app role resolves via profiles + sub.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_super_admin_id::text)::text, true);

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_super_admin_id) THEN
    RAISE EXCEPTION 'Seed users missing — run supabase db reset (applies seed.sql) before RLS tests';
  END IF;

  -- Ensure roles match the proposal (seed should already have set these)
  UPDATE profiles SET role = 'super_admin', full_name = 'Test Super Admin', is_active = true
  WHERE id = v_super_admin_id;
  UPDATE profiles SET role = 'leader', full_name = 'Test Leader', is_active = true
  WHERE id = v_leader_id;
  UPDATE profiles SET role = 'server', full_name = 'Test Server', is_active = true
  WHERE id = v_server_id;

  -- Test 1: super_admin can INSERT members
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_super_admin_id::text)::text, true);

  INSERT INTO members (name, name_normalized, phone, email, consent_recorded, created_by)
  VALUES ('RLS Test Member', 'rls test member', '+573001110001', 'rls-test-member@test.com', true, v_super_admin_id)
  RETURNING id INTO v_member_id;

  RAISE NOTICE 'PASS: super_admin can INSERT members';

  -- Test 2: leader can INSERT members
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_leader_id::text)::text, true);

  INSERT INTO members (name, name_normalized, phone, email, consent_recorded, created_by)
  VALUES ('RLS Leader Member', 'rls leader member', '+573001110002', 'rls-leader-member@test.com', true, v_leader_id)
  RETURNING id INTO v_leader_member_id;

  RAISE NOTICE 'PASS: leader can INSERT members';

  -- Test 3: server can INSERT members (capture open to all roles)
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_server_id::text)::text, true);

  INSERT INTO members (name, name_normalized, phone, email, consent_recorded, created_by)
  VALUES ('RLS Server Member', 'rls server member', '+573001110003', 'rls-server-member@test.com', true, v_server_id)
  RETURNING id INTO v_server_member_id;

  RAISE NOTICE 'PASS: server can INSERT members (capture open to all roles)';

  -- Test 4: leader CANNOT UPDATE members
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_leader_id::text)::text, true);

  BEGIN
    UPDATE members SET phone = '+573007777777' WHERE id = v_member_id;
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: leader should NOT be able to UPDATE members';
    END IF;
    RAISE NOTICE 'PASS: leader CANNOT UPDATE members (RLS blocked)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: leader CANNOT UPDATE members (RLS blocked)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: leader CANNOT UPDATE members (RLS blocked: %)', SQLERRM;
  END;

  -- Test 5: leader CANNOT DELETE members
  BEGIN
    DELETE FROM members WHERE id = v_member_id;
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: leader should NOT be able to DELETE members';
    END IF;
    RAISE NOTICE 'PASS: leader CANNOT DELETE members (RLS blocked)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: leader CANNOT DELETE members (RLS blocked)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: leader CANNOT DELETE members (RLS blocked: %)', SQLERRM;
  END;

  -- Test 5b: leader CANNOT INSERT sessions (super_admin only, 018)
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_leader_id::text)::text, true);

  BEGIN
    INSERT INTO sessions (name, session_date, created_by)
    VALUES ('RLS Leader Session', '2026-07-18', v_leader_id);
    RAISE EXCEPTION 'FAIL: leader should NOT be able to INSERT sessions';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: leader CANNOT INSERT sessions (super_admin only)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      IF SQLSTATE = '42501' OR SQLERRM LIKE '%row-level security%' THEN
        RAISE NOTICE 'PASS: leader CANNOT INSERT sessions (super_admin only)';
      ELSE
        RAISE;
      END IF;
  END;

  -- Test 6: server can INSERT attendance
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_super_admin_id::text)::text, true);
  INSERT INTO sessions (name, session_date, created_by)
  VALUES ('RLS Test Session', '2026-07-17', v_super_admin_id)
  RETURNING id INTO v_session_id;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_server_id::text)::text, true);
  INSERT INTO attendance (member_id, session_id, marked_by)
  VALUES (v_member_id, v_session_id, v_server_id);

  RAISE NOTICE 'PASS: server can INSERT attendance';

  -- Test 6b: server can DELETE attendance (un-mark, 018)
  DELETE FROM attendance
  WHERE member_id = v_member_id AND session_id = v_session_id AND marked_by = v_server_id;
  IF EXISTS (
    SELECT 1 FROM attendance
    WHERE member_id = v_member_id AND session_id = v_session_id AND marked_by = v_server_id
  ) THEN
    RAISE EXCEPTION 'FAIL: server should be able to DELETE its attendance row';
  END IF;
  RAISE NOTICE 'PASS: server can DELETE attendance (un-mark)';

  -- Re-insert so later assertions and the cleanup block stay valid.
  INSERT INTO attendance (member_id, session_id, marked_by)
  VALUES (v_member_id, v_session_id, v_server_id);

  -- Test 7: super_admin can UPDATE members
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_super_admin_id::text)::text, true);
  UPDATE members SET phone = '+573001111111' WHERE id = v_member_id;

  RAISE NOTICE 'PASS: super_admin can UPDATE members';

  -- Test 8: super_admin can soft-delete members (UPDATE deleted_at).
  -- Regression: SELECT policies that require deleted_at IS NULL cause 42501 on
  -- the new row image when UPDATE has a WHERE clause (Postgres applies SELECT
  -- policies to both old and new rows for UPDATE).
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'authenticated',
      'sub', v_super_admin_id::text,
      'app_metadata', json_build_object('role', 'super_admin')
    )::text,
    true
  );
  UPDATE members SET deleted_at = now(), updated_at = now() WHERE id = v_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: super_admin soft-delete UPDATE affected 0 rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = v_member_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: soft-deleted member not visible to super_admin SELECT';
  END IF;
  RAISE NOTICE 'PASS: super_admin can soft-delete members';

  -- Test 9: server can register retreat preinscription for a member via RPC (018)
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_server_id::text)::text, true);
  v_retreat_registration_id := public.register_retreat_preinscription_for_member(v_server_member_id, NULL, NULL, true, false, NULL, NULL);
  IF v_retreat_registration_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: server preinscription RPC returned NULL';
  END IF;
  RAISE NOTICE 'PASS: server can register retreat preinscription for member';

  -- Cleanup ephemeral rows only — keep seeded auth users / sample data.
  -- The ephemeral retreat_registrations row (v_retreat_registration_id) is
  -- left in place intentionally: the table has no DELETE policy for
  -- authenticated, and tests run after `db reset`, which rebuilds from seed.
  DELETE FROM attendance WHERE session_id = v_session_id;
  DELETE FROM sessions WHERE id = v_session_id;
  DELETE FROM members WHERE id IN (v_member_id, v_leader_member_id, v_server_member_id);

  RAISE NOTICE 'All RLS tests passed';
END $$;

ROLLBACK;
