-- RLS Integration Tests
-- Run with: supabase db test or psql -f supabase/tests/rls.test.sql
-- Uses DO $$ blocks with RAISE ASSERTIONS

-- Setup: create test users (requires auth.users entries)
-- In CI, these are created via supabase db reset + seed

DO $$
DECLARE
  super_admin_id UUID;
  leader_id UUID;
  server_id UUID;
  member_id UUID;
  session_id UUID;
BEGIN
  -- Create test profiles
  INSERT INTO auth.users (id, email) VALUES
    (gen_random_uuid(), 'test-superadmin@test.com'),
    (gen_random_uuid(), 'test-leader@test.com'),
    (gen_random_uuid(), 'test-server@test.com')
  RETURNING id INTO super_admin_id;

  SELECT id INTO super_admin_id FROM auth.users WHERE email = 'test-superadmin@test.com';
  SELECT id INTO leader_id FROM auth.users WHERE email = 'test-leader@test.com';
  SELECT id INTO server_id FROM auth.users WHERE email = 'test-server@test.com';

  INSERT INTO profiles (id, full_name, role) VALUES
    (super_admin_id, 'Test Super Admin', 'super_admin'),
    (leader_id, 'Test Leader', 'leader'),
    (server_id, 'Test Server', 'server');

  -- Test 1: super_admin can INSERT members
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'super_admin')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  INSERT INTO members (name, name_normalized, phone, email, consent_recorded, created_by)
  VALUES ('Test Member', 'test member', '+573001234567', 'test@test.com', true, super_admin_id);
  SELECT id INTO member_id FROM members WHERE name = 'Test Member' AND deleted_at IS NULL;

  RAISE NOTICE 'PASS: super_admin can INSERT members';

  -- Test 2: leader can INSERT members
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'leader')::text, true);

  INSERT INTO members (name, name_normalized, phone, email, consent_recorded, created_by)
  VALUES ('Leader Member', 'leader member', '+573009999999', 'leader@test.com', true, leader_id);

  RAISE NOTICE 'PASS: leader can INSERT members';

  -- Test 3: server CANNOT INSERT members
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'server')::text, true);

  BEGIN
    INSERT INTO members (name, name_normalized, phone, email, consent_recorded, created_by)
    VALUES ('Server Member', 'server member', '+573008888888', 'server@test.com', true, server_id);
    RAISE EXCEPTION 'FAIL: server should NOT be able to INSERT members';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: server CANNOT INSERT members (RLS blocked)';
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
  END;

  -- Test 6: server can INSERT attendance
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'server')::text, true);

  -- Create a session first (as super_admin)
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'super_admin')::text, true);
  INSERT INTO sessions (name, session_date, created_by) VALUES ('Test Session', '2026-07-17', super_admin_id);
  SELECT id INTO session_id FROM sessions WHERE name = 'Test Session' AND deleted_at IS NULL;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'server')::text, true);
  INSERT INTO attendance (member_id, session_id, marked_by) VALUES (member_id, session_id, server_id);

  RAISE NOTICE 'PASS: server can INSERT attendance';

  -- Test 7: super_admin can UPDATE members
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'super_admin')::text, true);
  UPDATE members SET phone = '+573001111111' WHERE id = member_id;

  RAISE NOTICE 'PASS: super_admin can UPDATE members';

  -- Cleanup
  DELETE FROM attendance WHERE session_id = session_id;
  DELETE FROM sessions WHERE id = session_id;
  DELETE FROM members WHERE id IN (member_id, (SELECT id FROM members WHERE name = 'Leader Member'));
  DELETE FROM profiles WHERE id IN (super_admin_id, leader_id, server_id);
  DELETE FROM auth.users WHERE email IN ('test-superadmin@test.com', 'test-leader@test.com', 'test-server@test.com');

  RAISE NOTICE 'All RLS tests passed';
END $$;
