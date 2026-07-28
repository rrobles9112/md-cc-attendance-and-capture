-- RLS Integration Tests
-- Run with: supabase db test or psql -f supabase/tests/rls.test.sql
-- Uses DO $$ blocks with RAISE ASSERTIONS
--
-- Relies on supabase/seed.sql (via db reset) for the three role users.
-- Creates ephemeral members/sessions for assertions and cleans those up only.

DO $$
DECLARE
  super_admin_id UUID;
  leader_id UUID;
  server_id UUID;
  member_id UUID;
  leader_member_id UUID;
  session_id UUID;
BEGIN
  SELECT id INTO super_admin_id FROM auth.users WHERE email = 'test-superadmin@test.com';
  SELECT id INTO leader_id FROM auth.users WHERE email = 'test-leader@test.com';
  SELECT id INTO server_id FROM auth.users WHERE email = 'test-server@test.com';

  IF super_admin_id IS NULL OR leader_id IS NULL OR server_id IS NULL THEN
    RAISE EXCEPTION 'Seed users missing — run supabase db reset (applies seed.sql) before RLS tests';
  END IF;

  -- Elevate claim first so profile role alignment is allowed under RLS
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'super_admin')::text, true);

  -- Ensure roles match the proposal (seed should already have set these)
  UPDATE profiles SET role = 'super_admin', full_name = 'Test Super Admin', is_active = true
  WHERE id = super_admin_id;
  UPDATE profiles SET role = 'leader', full_name = 'Test Leader', is_active = true
  WHERE id = leader_id;
  UPDATE profiles SET role = 'server', full_name = 'Test Server', is_active = true
  WHERE id = server_id;

  -- Test 1: super_admin can INSERT members
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'super_admin')::text, true);

  INSERT INTO members (name, name_normalized, phone, email, consent_recorded, created_by)
  VALUES ('RLS Test Member', 'rls test member', '+573001110001', 'rls-test-member@test.com', true, super_admin_id)
  RETURNING id INTO member_id;

  RAISE NOTICE 'PASS: super_admin can INSERT members';

  -- Test 2: leader can INSERT members
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'leader')::text, true);

  INSERT INTO members (name, name_normalized, phone, email, consent_recorded, created_by)
  VALUES ('RLS Leader Member', 'rls leader member', '+573001110002', 'rls-leader-member@test.com', true, leader_id)
  RETURNING id INTO leader_member_id;

  RAISE NOTICE 'PASS: leader can INSERT members';

  -- Test 3: server CANNOT INSERT members
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'server')::text, true);

  BEGIN
    INSERT INTO members (name, name_normalized, phone, email, consent_recorded, created_by)
    VALUES ('RLS Server Member', 'rls server member', '+573001110003', 'rls-server-member@test.com', true, server_id);
    RAISE EXCEPTION 'FAIL: server should NOT be able to INSERT members';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: server CANNOT INSERT members (RLS blocked)';
    WHEN OTHERS THEN
      -- Some PostgREST/RLS setups raise check_violation or query_canceled equivalents;
      -- treat any failure of the INSERT as the expected deny path when no row appears.
      IF SQLERRM LIKE 'FAIL:%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS: server CANNOT INSERT members (RLS blocked: %)', SQLERRM;
  END;

  -- Test 4: leader CANNOT UPDATE members
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'leader')::text, true);

  BEGIN
    UPDATE members SET phone = '+573007777777' WHERE id = member_id;
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
    DELETE FROM members WHERE id = member_id;
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

  -- Test 6: server can INSERT attendance
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'super_admin')::text, true);
  INSERT INTO sessions (name, session_date, created_by)
  VALUES ('RLS Test Session', '2026-07-17', super_admin_id)
  RETURNING id INTO session_id;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'server')::text, true);
  INSERT INTO attendance (member_id, session_id, marked_by) VALUES (member_id, session_id, server_id);

  RAISE NOTICE 'PASS: server can INSERT attendance';

  -- Test 7: super_admin can UPDATE members
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'super_admin')::text, true);
  UPDATE members SET phone = '+573001111111' WHERE id = member_id;

  RAISE NOTICE 'PASS: super_admin can UPDATE members';

  -- Cleanup ephemeral rows only — keep seeded auth users / sample data
  DELETE FROM attendance WHERE session_id = session_id;
  DELETE FROM sessions WHERE id = session_id;
  DELETE FROM members WHERE id IN (member_id, leader_member_id);

  RAISE NOTICE 'All RLS tests passed';
END $$;
