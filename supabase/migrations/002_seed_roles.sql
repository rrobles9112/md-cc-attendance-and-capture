-- 002_seed_roles.sql
-- Auto-create a profiles row when a new auth.users row is inserted.
-- Default role is 'server'; super_admin must be assigned manually via Supabase dashboard or CLI.

CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'server'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- To promote a user to super_admin after they sign up:
-- UPDATE profiles SET role = 'super_admin' WHERE id = '<user-uuid>';
-- The JWT role claim is set via a Supabase Auth hook or custom access token hook.
-- See: https://supabase.com/docs/guides/auth/auth-hooks
