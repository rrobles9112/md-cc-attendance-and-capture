-- 002_remove_demo_seed_accounts.sql
-- Strip deterministic demo Auth users and sample domain rows that may have been
-- introduced by an earlier revision of 001_initial_schema.sql which embedded seed.
-- Local `db reset` re-applies demo data afterward via supabase/seed.sql.
-- Production `db push` applies this cleanup and does NOT run seed.sql.

DO $$
DECLARE
  super_admin_id UUID := 'a0000000-0000-4000-8000-000000000001';
  leader_id UUID := 'a0000000-0000-4000-8000-000000000002';
  server_id UUID := 'a0000000-0000-4000-8000-000000000003';
  member_ids UUID[] := ARRAY[
    'b0000000-0000-4000-8000-000000000001'::uuid,
    'b0000000-0000-4000-8000-000000000002'::uuid,
    'b0000000-0000-4000-8000-000000000003'::uuid,
    'b0000000-0000-4000-8000-000000000004'::uuid,
    'b0000000-0000-4000-8000-000000000005'::uuid
  ];
  session_ids UUID[] := ARRAY[
    'c0000000-0000-4000-8000-000000000001'::uuid,
    'c0000000-0000-4000-8000-000000000002'::uuid
  ];
BEGIN
  DELETE FROM public.attendance
  WHERE session_id = ANY (session_ids)
     OR member_id = ANY (member_ids)
     OR marked_by IN (super_admin_id, leader_id, server_id);

  DELETE FROM public.arco_requests WHERE member_id = ANY (member_ids);
  DELETE FROM public.consent_records WHERE member_id = ANY (member_ids);
  DELETE FROM public.social_media WHERE member_id = ANY (member_ids);
  DELETE FROM public.whatsapp_numbers WHERE member_id = ANY (member_ids);
  DELETE FROM public.sessions WHERE id = ANY (session_ids);
  DELETE FROM public.members WHERE id = ANY (member_ids);

  -- Reset DPO setting if it was only set by demo seed
  UPDATE public.app_settings
  SET value = '', updated_by = NULL, updated_at = now()
  WHERE key = 'dpo_contact_email'
    AND value = 'dpo@church-demo.test';

  DELETE FROM public.profiles
  WHERE id IN (super_admin_id, leader_id, server_id);

  DELETE FROM auth.identities
  WHERE user_id IN (super_admin_id, leader_id, server_id);

  DELETE FROM auth.users
  WHERE id IN (super_admin_id, leader_id, server_id)
     OR email IN (
       'test-superadmin@test.com',
       'test-leader@test.com',
       'test-server@test.com'
     );

  RAISE NOTICE 'Demo seed accounts and sample domain rows removed (if present)';
END $$;
