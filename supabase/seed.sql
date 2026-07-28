-- supabase/seed.sql
-- Local-only demo/test data (applied by `supabase db reset` via config.toml [db.seed]).
-- NOT applied by `supabase db push` to cloud.
-- Password for all demo users: test-password

-- =============================================================================
-- DEMO / TEST SEED DATA
-- =============================================================================
-- Idempotent: safe to re-run on already-seeded databases (ON CONFLICT / NOT EXISTS).
-- WARNING: Do not treat these accounts as production credentials.
--
-- Deterministic IDs for stable FK references across resets / tests
-- Profiles / auth users
--   a0000000-0000-4000-8000-000000000001  super_admin
--   a0000000-0000-4000-8000-000000000002  leader
--   a0000000-0000-4000-8000-000000000003  server
-- Members
--   b0000000-0000-4000-8000-000000000001..005
-- Sessions
--   c0000000-0000-4000-8000-000000000001..002

DO $$
DECLARE
  demo_password TEXT := 'test-password';
  demo_encrypt_key TEXT := 'demo-local-pgcrypto-key-not-for-prod';
  super_admin_id UUID := 'a0000000-0000-4000-8000-000000000001';
  leader_id UUID := 'a0000000-0000-4000-8000-000000000002';
  server_id UUID := 'a0000000-0000-4000-8000-000000000003';
  member_juan UUID := 'b0000000-0000-4000-8000-000000000001';
  member_maria UUID := 'b0000000-0000-4000-8000-000000000002';
  member_carlos UUID := 'b0000000-0000-4000-8000-000000000003';
  member_ana_deleted UUID := 'b0000000-0000-4000-8000-000000000004';
  member_sofia_minor UUID := 'b0000000-0000-4000-8000-000000000005';
  session_morning UUID := 'c0000000-0000-4000-8000-000000000001';
  session_evening UUID := 'c0000000-0000-4000-8000-000000000002';
BEGIN
  -- ---------------------------------------------------------------------------
  -- Auth users (login-capable) + identities
  -- ---------------------------------------------------------------------------
  -- Minimal auth.users columns for GoTrue compatibility across CLI versions.
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    last_sign_in_at
  )
  VALUES
    (
      '00000000-0000-0000-0000-000000000000',
      super_admin_id,
      'authenticated',
      'authenticated',
      'test-superadmin@test.com',
      crypt(demo_password, gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'role', 'super_admin'
      ),
      jsonb_build_object('full_name', 'Test Super Admin'),
      now(),
      now(),
      now()
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      leader_id,
      'authenticated',
      'authenticated',
      'test-leader@test.com',
      crypt(demo_password, gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'role', 'leader'
      ),
      jsonb_build_object('full_name', 'Test Leader'),
      now(),
      now(),
      now()
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      server_id,
      'authenticated',
      'authenticated',
      'test-server@test.com',
      crypt(demo_password, gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'role', 'server'
      ),
      jsonb_build_object('full_name', 'Test Server'),
      now(),
      now(),
      now()
    )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = COALESCE(auth.users.email_confirmed_at, EXCLUDED.email_confirmed_at),
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = now();

  -- Email provider identities required for password sign-in
  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE provider = 'email' AND provider_id = super_admin_id::text
  ) THEN
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      super_admin_id,
      super_admin_id,
      jsonb_build_object(
        'sub', super_admin_id::text,
        'email', 'test-superadmin@test.com',
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      super_admin_id::text,
      now(),
      now(),
      now()
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE provider = 'email' AND provider_id = leader_id::text
  ) THEN
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      leader_id,
      leader_id,
      jsonb_build_object(
        'sub', leader_id::text,
        'email', 'test-leader@test.com',
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      leader_id::text,
      now(),
      now(),
      now()
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE provider = 'email' AND provider_id = server_id::text
  ) THEN
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      server_id,
      server_id,
      jsonb_build_object(
        'sub', server_id::text,
        'email', 'test-server@test.com',
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      server_id::text,
      now(),
      now(),
      now()
    );
  END IF;
  -- handle_new_user() trigger creates profiles as 'server'; align roles + names.
  UPDATE public.profiles
  SET
    full_name = CASE id
      WHEN super_admin_id THEN 'Test Super Admin'
      WHEN leader_id THEN 'Test Leader'
      WHEN server_id THEN 'Test Server'
      ELSE full_name
    END,
    role = CASE id
      WHEN super_admin_id THEN 'super_admin'::app_role
      WHEN leader_id THEN 'leader'::app_role
      WHEN server_id THEN 'server'::app_role
      ELSE role
    END,
    is_active = true,
    updated_at = now()
  WHERE id IN (super_admin_id, leader_id, server_id);

  -- If the trigger did not fire (e.g. conflict path), ensure profiles exist.
  INSERT INTO public.profiles (id, full_name, role, is_active)
  VALUES
    (super_admin_id, 'Test Super Admin', 'super_admin', true),
    (leader_id, 'Test Leader', 'leader', true),
    (server_id, 'Test Server', 'server', true)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    is_active = true,
    updated_at = now();

  -- ---------------------------------------------------------------------------
  -- App settings
  -- ---------------------------------------------------------------------------
  INSERT INTO public.app_settings (key, value, updated_by)
  VALUES ('dpo_contact_email', 'dpo@church-demo.test', super_admin_id)
  ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  -- ---------------------------------------------------------------------------
  -- Members (sample + edge cases: sensitive consent, minor, soft-deleted purge)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.members (
    id, name, name_normalized, phone, email, birthday, is_minor, legal_rep_name,
    has_whatsapp, consent_recorded, sensitive_consent_recorded,
    denomination_encrypted, community_name_encrypted,
    duplicate_flag, created_by, created_at, updated_at, deleted_at
  )
  VALUES
    (
      member_juan,
      'Juan Pérez',
      'juan perez',
      '+573001234567',
      'juan@test.com',
      DATE '1990-03-15',
      false,
      NULL,
      true,
      true,
      true,
      pgp_sym_encrypt('Pentecostal', demo_encrypt_key),
      pgp_sym_encrypt('Iglesia de Dios', demo_encrypt_key),
      false,
      leader_id,
      now() - interval '14 days',
      now() - interval '2 days',
      NULL
    ),
    (
      member_maria,
      'María Gómez',
      'maria gomez',
      '+573009876543',
      'maria@test.com',
      DATE '1985-07-22',
      false,
      NULL,
      true,
      true,
      true,
      pgp_sym_encrypt('Católica', demo_encrypt_key),
      pgp_sym_encrypt('Parroquia San José', demo_encrypt_key),
      false,
      super_admin_id,
      now() - interval '10 days',
      now() - interval '1 day',
      NULL
    ),
    (
      member_carlos,
      'Carlos Ruiz',
      'carlos ruiz',
      '+573008888888',
      'carlos@test.com',
      DATE '1995-11-02',
      false,
      NULL,
      false,
      true,
      false,
      NULL,
      NULL,
      false,
      leader_id,
      now() - interval '7 days',
      now() - interval '7 days',
      NULL
    ),
    (
      member_ana_deleted,
      'Ana López',
      'ana lopez',
      '+573007777777',
      'ana.deleted@test.com',
      DATE '1988-01-09',
      false,
      NULL,
      true,
      true,
      false,
      NULL,
      NULL,
      false,
      super_admin_id,
      now() - interval '120 days',
      now() - interval '95 days',
      now() - interval '95 days'  -- eligible for 90-day purge
    ),
    (
      member_sofia_minor,
      'Sofía Martínez',
      'sofia martinez',
      '+573006666666',
      'sofia.minor@test.com',
      CURRENT_DATE - interval '14 years',
      true,
      'Laura Martínez',
      true,
      true,
      false,
      NULL,
      NULL,
      false,
      leader_id,
      now() - interval '3 days',
      now() - interval '3 days',
      NULL
    )
  ON CONFLICT (id) DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- Contact channels
  -- ---------------------------------------------------------------------------
  INSERT INTO public.social_media (member_id, platform, handle)
  SELECT member_juan, 'instagram', '@juanperez.co'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.social_media
    WHERE member_id = member_juan AND platform = 'instagram' AND deleted_at IS NULL
  );

  INSERT INTO public.social_media (member_id, platform, handle)
  SELECT member_maria, 'tiktok', '@mariagomez'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.social_media
    WHERE member_id = member_maria AND platform = 'tiktok' AND deleted_at IS NULL
  );

  INSERT INTO public.whatsapp_numbers (member_id, number, is_primary_phone)
  SELECT member_juan, '+573001234567', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.whatsapp_numbers
    WHERE member_id = member_juan AND number = '+573001234567' AND deleted_at IS NULL
  );

  INSERT INTO public.whatsapp_numbers (member_id, number, is_primary_phone)
  SELECT member_maria, '+573009876543', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.whatsapp_numbers
    WHERE member_id = member_maria AND number = '+573009876543' AND deleted_at IS NULL
  );

  INSERT INTO public.whatsapp_numbers (member_id, number, is_primary_phone)
  SELECT member_sofia_minor, '+573006666666', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.whatsapp_numbers
    WHERE member_id = member_sofia_minor AND number = '+573006666666' AND deleted_at IS NULL
  );

  -- ---------------------------------------------------------------------------
  -- Consent evidence (Ley 1581)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.consent_records (member_id, consent_type, policy_version, accepted_at)
  SELECT member_juan, 'personal_data', 'v1.0', now() - interval '14 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE member_id = member_juan AND consent_type = 'personal_data'
  );

  INSERT INTO public.consent_records (member_id, consent_type, policy_version, accepted_at)
  SELECT member_juan, 'sensitive_religious', 'v1.0', now() - interval '14 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE member_id = member_juan AND consent_type = 'sensitive_religious'
  );

  INSERT INTO public.consent_records (member_id, consent_type, policy_version, accepted_at)
  SELECT member_maria, 'personal_data', 'v1.0', now() - interval '10 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE member_id = member_maria AND consent_type = 'personal_data'
  );

  INSERT INTO public.consent_records (member_id, consent_type, policy_version, accepted_at)
  SELECT member_maria, 'sensitive_religious', 'v1.0', now() - interval '10 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE member_id = member_maria AND consent_type = 'sensitive_religious'
  );

  INSERT INTO public.consent_records (member_id, consent_type, policy_version, accepted_at)
  SELECT member_carlos, 'personal_data', 'v1.0', now() - interval '7 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE member_id = member_carlos AND consent_type = 'personal_data'
  );

  INSERT INTO public.consent_records (member_id, consent_type, policy_version, accepted_at)
  SELECT member_sofia_minor, 'personal_data', 'v1.0', now() - interval '3 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE member_id = member_sofia_minor AND consent_type = 'personal_data'
  );

  -- ---------------------------------------------------------------------------
  -- Sessions + attendance (server can mark; leader created one session)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.sessions (id, name, session_date, created_by, created_at)
  VALUES
    (session_morning, 'Grupo de Oración — Mañana', CURRENT_DATE - 1, leader_id, now() - interval '1 day'),
    (session_evening, 'Grupo de Oración — Noche', CURRENT_DATE, super_admin_id, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.attendance (member_id, session_id, marked_by, marked_at)
  SELECT member_juan, session_morning, server_id, now() - interval '1 day'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE member_id = member_juan AND session_id = session_morning AND deleted_at IS NULL
  );

  INSERT INTO public.attendance (member_id, session_id, marked_by, marked_at)
  SELECT member_maria, session_morning, leader_id, now() - interval '1 day'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE member_id = member_maria AND session_id = session_morning AND deleted_at IS NULL
  );

  INSERT INTO public.attendance (member_id, session_id, marked_by, marked_at)
  SELECT member_carlos, session_evening, server_id, now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE member_id = member_carlos AND session_id = session_evening AND deleted_at IS NULL
  );

  INSERT INTO public.attendance (member_id, session_id, marked_by, marked_at)
  SELECT member_juan, session_evening, super_admin_id, now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE member_id = member_juan AND session_id = session_evening AND deleted_at IS NULL
  );

  -- ---------------------------------------------------------------------------
  -- ARCO requests (admin panel workflow samples)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.arco_requests (member_id, request_type, status, deadline, fulfilled_at, notes, created_at)
  SELECT
    member_maria,
    'access',
    'pending',
    CURRENT_DATE + 10,
    NULL,
    'Solicitud de acceso de prueba — pendiente de cumplimiento',
    now() - interval '2 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.arco_requests
    WHERE member_id = member_maria AND request_type = 'access' AND status = 'pending'
  );

  INSERT INTO public.arco_requests (member_id, request_type, status, deadline, fulfilled_at, notes, created_at)
  SELECT
    member_juan,
    'rectification',
    'fulfilled',
    CURRENT_DATE - 5,
    now() - interval '1 day',
    'Corrección de teléfono completada (dato de prueba)',
    now() - interval '12 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.arco_requests
    WHERE member_id = member_juan AND request_type = 'rectification' AND status = 'fulfilled'
  );

  RAISE NOTICE 'Seed complete: 3 role users (password=test-password) + sample members/sessions/attendance/ARCO';
END $$;
