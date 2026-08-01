-- 005_fix_security_definer_search_path.sql
-- Fix: log_mutation() referenced audit_log unqualified inside a SECURITY DEFINER
-- function without SET search_path, so it used the CALLER's search_path. GoTrue
-- connects as supabase_auth_admin with search_path=auth, so auth.users inserts
-- (signup / admin create user) failed with 'relation "audit_log" does not exist'
-- via handle_new_user -> profiles insert -> audit_profiles trigger.
-- Pin search_path='' and fully qualify all table references on every SECURITY
-- DEFINER function (also the Supabase-recommended hardening against
-- search_path shadowing attacks).

CREATE OR REPLACE FUNCTION public.user_role() RETURNS app_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.log_mutation() RETURNS TRIGGER AS $$
DECLARE
  record_uuid UUID;
BEGIN
  record_uuid := COALESCE(
    NULLIF(to_jsonb(NEW)->>'id', '')::uuid,
    NULLIF(to_jsonb(OLD)->>'id', '')::uuid
  );

  INSERT INTO public.audit_log(user_id, action, table_name, record_id, old_value, new_value)
  VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    record_uuid,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'server'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
