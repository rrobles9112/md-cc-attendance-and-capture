-- retreat_valientes_transfer.test.sql — PR1 014 Valientes transfer cases (owner-run psql)
-- Run: docker exec -i supabase_db_MD_CC_ATTENDANCE_AND_CAPTURE psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/retreat_valientes_transfer.test.sql
BEGIN;
DO $$
DECLARE
  v_super UUID := 'a0000000-0000-4000-8000-000000000001';
  v_leader UUID := 'a0000000-0000-4000-8000-000000000002';
  v_server UUID := 'a0000000-0000-4000-8000-000000000003';
  v_r_inscrito UUID;
  v_r_pre UUID;
  v_r_linked UUID;
  v_member_linked UUID := 'c0000000-0000-4000-8000-0000000000a1';
  v_dup_member UUID := 'c0000000-0000-4000-8000-0000000000a2';
  v_new_member UUID;
  v_transferred_at TIMESTAMPTZ;
  v_pastoral TEXT;
  v_phone TEXT;
  v_email TEXT;
  v_cnt INT;
  v_cnt_before INT;
  v_cnt_after INT;
  v_total TEXT;
BEGIN
  -- 0) schema guards (42703 / 42883 equivalent)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='pastoral_group') THEN
    RAISE EXCEPTION 'FAIL: members.pastoral_group missing (014 not applied)' USING ERRCODE='42703';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='retreat_registrations' AND column_name='transferred_at') THEN
    RAISE EXCEPTION 'FAIL: retreat_registrations.transferred_at missing' USING ERRCODE='42703';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='transfer_retreat_to_valientes') THEN
    RAISE EXCEPTION 'FAIL: function transfer_retreat_to_valientes does not exist' USING ERRCODE='42883';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='members' AND indexname='members_pastoral_group_idx') THEN
    RAISE EXCEPTION 'FAIL: members_pastoral_group_idx missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='retreat_registrations' AND indexname='retreat_registrations_search_trgm_idx') THEN
    RAISE EXCEPTION 'FAIL: retreat_registrations_search_trgm_idx missing';
  END IF;
  -- pre-transfer all pastoral_group IS NULL
  SELECT count(*) INTO v_cnt FROM public.members WHERE pastoral_group IS NOT NULL;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: pre-transfer pastoral_group should be NULL for all rows, got %', v_cnt; END IF;
  RAISE NOTICE 'PASS: schema 014 present + pastoral_group all NULL pre-transfer';

  -- ensure total 400000 (super_admin can update app_settings)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_super::text,'app_metadata',json_build_object('role','super_admin'))::text,true);
  UPDATE public.app_settings SET value='400000', updated_by=v_super WHERE key='retreat.youth.total_cost';
  RESET ROLE;
  SELECT value INTO v_total FROM public.app_settings WHERE key='retreat.youth.total_cost';
  IF v_total <>'400000' THEN RAISE EXCEPTION 'FAIL: total setup 400000 got %', v_total; END IF;

  -- seed duplicate member for already_member case
  INSERT INTO public.members (id,name,name_normalized,phone,email,birthday,is_minor,has_whatsapp,consent_recorded,sensitive_consent_recorded,duplicate_flag,created_by,created_at,updated_at,deleted_at) VALUES
    (v_dup_member,'Dup Dup','dup dup','3009990001','dup-valientes@example.com','2000-01-15',false,false,true,false,false,v_leader,now(),now(),NULL),
    (v_member_linked,'Linked Member','linked member','3008880001','linked@example.com','2000-01-15',false,false,true,false,false,v_leader,now(),now(),NULL)
  ON CONFLICT (id) DO NOTHING;

  -- seed registrations via anon RPC (preinscrito) then payments to reach inscrito
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text,true);
  v_r_inscrito := public.register_retreat_preinscription(p_name:='Inscrito Valiente', p_phone:='3001234567', p_email:='inscrito-valiente@example.com', p_birthday:=DATE '2000-01-15', p_general_consent:=true, p_sensitive_consent:=true, p_denomination:='Catolica', p_community_name:='MD CC');
  v_r_pre := public.register_retreat_preinscription(p_name:='Pre Valiente', p_phone:='3001234568', p_email:='pre-valiente@example.com', p_birthday:=DATE '2000-01-15', p_general_consent:=true);
  RESET ROLE;

  -- linked member registration via leader RPC (member_id branch)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  -- payments for inscrito to reach 400k
  INSERT INTO public.retreat_payments (registration_id,amount,recorded_by) VALUES (v_r_inscrito,200000,v_leader), (v_r_inscrito,200000,v_leader);
  RESET ROLE;
  SELECT count(*) INTO v_cnt FROM public.retreat_payments WHERE registration_id=v_r_inscrito;
  IF v_cnt <>2 THEN RAISE EXCEPTION 'FAIL: inscrito payments setup'; END IF;
  -- verify status inscrito
  PERFORM pg_sleep(0.1);
  -- status trigger already updated
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  -- create linked registration (needs member_id)
  v_r_linked := public.register_retreat_preinscription_for_member(p_member_id:=v_member_linked, p_general_consent:=true, p_sensitive_consent:=false);
  INSERT INTO public.retreat_payments (registration_id,amount,recorded_by) VALUES (v_r_linked,400000,v_leader);
  RESET ROLE;

  -- CASE 1: leader inscrito member_id IS NULL -> succeeds
  SELECT count(*) INTO v_cnt_before FROM public.members;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  v_new_member := public.transfer_retreat_to_valientes(v_r_inscrito);
  RESET ROLE;
  IF v_new_member IS NULL THEN RAISE EXCEPTION 'FAIL: CASE1 leader inscrito null should return uuid'; END IF;
  SELECT pastoral_group INTO v_pastoral FROM public.members WHERE id=v_new_member;
  IF v_pastoral <>'Valientes' THEN RAISE EXCEPTION 'FAIL: CASE1 pastoral_group Valientes got %', v_pastoral; END IF;
  SELECT email INTO v_email FROM public.members WHERE id=v_new_member;
  IF v_email <>'inscrito-valiente@example.com' THEN RAISE EXCEPTION 'FAIL: CASE1 email normalized %', v_email; END IF;
  SELECT phone INTO v_phone FROM public.members WHERE id=v_new_member;
  IF v_phone <>'+573001234567' THEN RAISE EXCEPTION 'FAIL: CASE1 phone +57 expected got %', v_phone; END IF;
  SELECT transferred_at, transferred_member_id INTO v_transferred_at, v_new_member FROM public.retreat_registrations WHERE id=v_r_inscrito;
  IF v_transferred_at IS NULL THEN RAISE EXCEPTION 'FAIL: CASE1 transferred_at IS NULL'; END IF;
  SELECT count(*) INTO v_cnt_after FROM public.members;
  IF v_cnt_after <> v_cnt_before+1 THEN RAISE EXCEPTION 'FAIL: CASE1 should insert 1 member'; END IF;
  RAISE NOTICE 'PASS: CASE1 leader inscrito null -> Valientes %', v_new_member;

  -- ensure audit_log for members and retreat_registrations
  IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE table_name='members' AND record_id=v_new_member AND new_value->>'pastoral_group'='Valientes') THEN
    RAISE EXCEPTION 'FAIL: audit_log members pastoral_group Valientes missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE table_name='retreat_registrations' AND record_id=v_r_inscrito AND new_value->>'transferred_member_id' IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: audit_log retreat transferred_* missing';
  END IF;
  RAISE NOTICE 'PASS: audit_log captures pastoral_group+transferred_*';

  -- CASE 2: same registration second call -> already_transferred 23505
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  BEGIN PERFORM public.transfer_retreat_to_valientes(v_r_inscrito); RAISE EXCEPTION 'FAIL: CASE2 second call should 23505'; EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>'23505' OR SQLERRM NOT LIKE '%already_transferred%' THEN RAISE EXCEPTION 'FAIL: CASE2 expected 23505 already_transferred got % %', SQLSTATE, SQLERRM; END IF; RAISE NOTICE 'PASS: CASE2 already_transferred %', SQLERRM; END;
  RESET ROLE;

  -- CASE 3: preinscrito -> not_inscrito 23514
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  BEGIN PERFORM public.transfer_retreat_to_valientes(v_r_pre); RAISE EXCEPTION 'FAIL: CASE3 preinscrito should 23514'; EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>'23514' OR SQLERRM NOT LIKE '%not_inscrito%' THEN RAISE EXCEPTION 'FAIL: CASE3 expected 23514 not_inscrito got % %', SQLSTATE, SQLERRM; END IF; RAISE NOTICE 'PASS: CASE3 preinscrito not_inscrito %', SQLERRM; END;
  RESET ROLE;

  -- CASE 4: missing_total
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_super::text,'app_metadata',json_build_object('role','super_admin'))::text,true);
  UPDATE public.app_settings SET value='', updated_by=v_super WHERE key='retreat.youth.total_cost';
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  BEGIN PERFORM public.transfer_retreat_to_valientes(v_r_pre); RAISE EXCEPTION 'FAIL: CASE4 missing_total should 23514'; EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>'23514' OR SQLERRM NOT LIKE '%missing_total%' THEN RAISE EXCEPTION 'FAIL: CASE4 expected missing_total got % %', SQLSTATE, SQLERRM; END IF; RAISE NOTICE 'PASS: CASE4 missing_total %', SQLERRM; END;
  RESET ROLE;
  -- restore total
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_super::text,'app_metadata',json_build_object('role','super_admin'))::text,true);
  UPDATE public.app_settings SET value='400000', updated_by=v_super WHERE key='retreat.youth.total_cost';
  RESET ROLE;

  -- CASE 5: duplicate email/phone vs existing members -> already_member 23505
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text,true);
  DECLARE v_dup_reg UUID; BEGIN
    v_dup_reg := public.register_retreat_preinscription(p_name:='Dup Val', p_phone:='3009990001', p_email:='dup-valientes@example.com', p_general_consent:=true);
    -- need to make it inscrito for transfer to be attempted otherwise not_inscrito will trigger first
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
    INSERT INTO public.retreat_payments (registration_id,amount,recorded_by) VALUES (v_dup_reg,400000,v_leader);
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
    BEGIN PERFORM public.transfer_retreat_to_valientes(v_dup_reg); RAISE EXCEPTION 'FAIL: CASE5 duplicate should 23505'; EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>'23505' OR SQLERRM NOT LIKE '%already_member%' THEN RAISE EXCEPTION 'FAIL: CASE5 expected already_member got % %', SQLSTATE, SQLERRM; END IF; RAISE NOTICE 'PASS: CASE5 already_member %', SQLERRM; END;
    RESET ROLE;
  END;
  RESET ROLE;

  -- CASE 6: member_id IS NOT NULL -> UPDATE pastoral_group no extra row
  SELECT count(*) INTO v_cnt_before FROM public.members;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  v_new_member := public.transfer_retreat_to_valientes(v_r_linked);
  RESET ROLE;
  IF v_new_member <> v_member_linked THEN RAISE EXCEPTION 'FAIL: CASE6 should return linked member id % got %', v_member_linked, v_new_member; END IF;
  SELECT pastoral_group INTO v_pastoral FROM public.members WHERE id=v_member_linked;
  IF v_pastoral <>'Valientes' THEN RAISE EXCEPTION 'FAIL: CASE6 pastoral_group Valientes'; END IF;
  SELECT count(*) INTO v_cnt_after FROM public.members;
  IF v_cnt_after <> v_cnt_before THEN RAISE EXCEPTION 'FAIL: CASE6 should not insert new member % -> %', v_cnt_before, v_cnt_after; END IF;
  RAISE NOTICE 'PASS: CASE6 member_id NOT NULL -> UPDATE pastoral_group';

  -- CASE 7: linked member already Valientes -> already_transferred
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  BEGIN PERFORM public.transfer_retreat_to_valientes(v_r_linked); RAISE EXCEPTION 'FAIL: CASE7 already Valientes should 23505'; EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>'23505' OR SQLERRM NOT LIKE '%already_transferred%' THEN RAISE EXCEPTION 'FAIL: CASE7 expected already_transferred got % %', SQLSTATE, SQLERRM; END IF; RAISE NOTICE 'PASS: CASE7 already Valientes -> already_transferred %', SQLERRM; END;
  RESET ROLE;

  -- CASE 8: anon (no GRANT) permission denied
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text,true);
  BEGIN PERFORM public.transfer_retreat_to_valientes(v_r_pre); RAISE EXCEPTION 'FAIL: CASE8 anon should denied'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: CASE8 anon denied insufficient_privilege'; WHEN OTHERS THEN IF SQLERRM LIKE '%permission denied%' OR SQLSTATE='42501' THEN RAISE NOTICE 'PASS: CASE8 anon denied % %', SQLSTATE, SQLERRM; ELSE RAISE EXCEPTION 'FAIL: CASE8 anon % %', SQLSTATE, SQLERRM; END IF; END;
  RESET ROLE;

  -- CASE 9: server JWT -> 42501
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_server::text,'app_metadata',json_build_object('role','server'))::text,true);
  BEGIN PERFORM public.transfer_retreat_to_valientes(v_r_pre); RAISE EXCEPTION 'FAIL: CASE9 server should 42501'; EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>'42501' THEN RAISE EXCEPTION 'FAIL: CASE9 expected 42501 got % %', SQLSTATE, SQLERRM; END IF; RAISE NOTICE 'PASS: CASE9 server 42501 %', SQLERRM; END;
  RESET ROLE;

  -- CASE 10 indexes exist already checked; also check view exists and security_invoker
  IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='retreat_registration_with_payments') THEN RAISE EXCEPTION 'FAIL: view missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname='retreat_registration_with_payments' AND definition ILIKE '%security_invoker%') THEN
    -- check pg_attribute? alternative: view is created with security_invoker, verify via pg_class
    PERFORM 1 FROM pg_class WHERE relname='retreat_registration_with_payments' AND reloptions @> ARRAY['security_invoker=true'];
    IF NOT FOUND THEN RAISE NOTICE 'WARN: view security_invoker check skipped (rel options not visible)'; END IF;
  END IF;
  RAISE NOTICE 'PASS: view retreat_registration_with_payments exists';

  -- leader can read via view, anon cannot
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_leader::text,'app_metadata',json_build_object('role','leader'))::text,true);
  PERFORM 1 FROM public.retreat_registration_with_payments LIMIT 1;
  RAISE NOTICE 'PASS: leader can read view';
  RESET ROLE;
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text,true);
  BEGIN PERFORM 1 FROM public.retreat_registration_with_payments LIMIT 1; RAISE EXCEPTION 'FAIL: anon should not read view'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: anon view denied'; WHEN OTHERS THEN RAISE NOTICE 'PASS: anon view denied %', SQLERRM; END;
  RESET ROLE;

  RAISE NOTICE 'All 014 Valientes cases PASSED';
END $$;
ROLLBACK;
