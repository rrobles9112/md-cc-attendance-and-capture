-- Audit Trigger Integration Tests
-- Run with: supabase db test or psql -f supabase/tests/audit_trigger.test.sql

DO $$
DECLARE
  test_user_id UUID;
  test_member_id UUID;
  audit_count_before INTEGER;
  audit_count_after INTEGER;
  last_audit RECORD;
BEGIN
  -- Setup: create test user
  INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'audit-test@test.com')
  RETURNING id INTO test_user_id;

  INSERT INTO profiles (id, full_name, role) VALUES (test_user_id, 'Audit Test', 'super_admin');

  -- Set JWT context
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'super_admin')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- Test 1: INSERT triggers audit log
  SELECT count(*) INTO audit_count_before FROM audit_log;

  INSERT INTO members (name, name_normalized, phone, email, consent_recorded, created_by)
  VALUES ('Audit Test Member', 'audit test member', '+573001234567', 'audit@test.com', true, test_user_id);
  SELECT id INTO test_member_id FROM members WHERE name = 'Audit Test Member';

  SELECT count(*) INTO audit_count_after FROM audit_log;
  ASSERT audit_count_after > audit_count_before, 'INSERT should fire audit trigger';

  SELECT * INTO last_audit FROM audit_log ORDER BY id DESC LIMIT 1;
  ASSERT last_audit.action = 'INSERT', 'Audit action should be INSERT';
  ASSERT last_audit.table_name = 'members', 'Audit table should be members';
  ASSERT last_audit.record_id = test_member_id, 'Audit record_id should match';
  ASSERT last_audit.new_value IS NOT NULL, 'new_value should be set for INSERT';
  ASSERT last_audit.old_value IS NULL, 'old_value should be NULL for INSERT';

  RAISE NOTICE 'PASS: INSERT audit trigger fires correctly';

  -- Test 2: UPDATE triggers audit log with old/new values
  SELECT count(*) INTO audit_count_before FROM audit_log;

  UPDATE members SET phone = '+573009999999' WHERE id = test_member_id;

  SELECT count(*) INTO audit_count_after FROM audit_log;
  ASSERT audit_count_after > audit_count_before, 'UPDATE should fire audit trigger';

  SELECT * INTO last_audit FROM audit_log ORDER BY id DESC LIMIT 1;
  ASSERT last_audit.action = 'UPDATE', 'Audit action should be UPDATE';
  ASSERT last_audit.old_value->>'phone' = '+573001234567', 'old_value should contain old phone';
  ASSERT last_audit.new_value->>'phone' = '+573009999999', 'new_value should contain new phone';

  RAISE NOTICE 'PASS: UPDATE audit trigger fires with correct old/new values';

  -- Test 3: DELETE triggers audit log
  SELECT count(*) INTO audit_count_before FROM audit_log;

  DELETE FROM members WHERE id = test_member_id;

  SELECT count(*) INTO audit_count_after FROM audit_log;
  ASSERT audit_count_after > audit_count_before, 'DELETE should fire audit trigger';

  SELECT * INTO last_audit FROM audit_log ORDER BY id DESC LIMIT 1;
  ASSERT last_audit.action = 'DELETE', 'Audit action should be DELETE';
  ASSERT last_audit.old_value IS NOT NULL, 'old_value should be set for DELETE';

  RAISE NOTICE 'PASS: DELETE audit trigger fires correctly';

  -- Cleanup
  DELETE FROM audit_log WHERE record_id = test_member_id OR user_id = test_user_id;
  DELETE FROM profiles WHERE id = test_user_id;
  DELETE FROM auth.users WHERE id = test_user_id;

  RAISE NOTICE 'All audit trigger tests passed';
END $$;
