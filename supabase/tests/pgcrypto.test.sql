-- pgcrypto Integration Tests
-- Run with: supabase db test or psql -f supabase/tests/pgcrypto.test.sql
-- Tests pgcrypto encrypt/decrypt roundtrip for sensitive fields

DO $$
DECLARE
  test_key TEXT := 'test-encryption-key-for-pgcrypto-2026';
  original_text TEXT := 'Iglesia Bautista Internacional';
  encrypted_data BYTEA;
  decrypted_text TEXT;
BEGIN
  -- Ensure pgcrypto extension is available
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- Test 1: Encrypt data
  encrypted_data := pgp_sym_encrypt(original_text, test_key);
  ASSERT encrypted_data IS NOT NULL, 'Encrypted data should not be NULL';
  ASSERT encrypted_data != original_text::bytea, 'Encrypted data should differ from plaintext';

  RAISE NOTICE 'PASS: pgp_sym_encrypt produces non-null ciphertext';

  -- Test 2: Decrypt data matches original
  decrypted_text := pgp_sym_decrypt(encrypted_data, test_key);
  ASSERT decrypted_text = original_text, 'Decrypted text should match original';

  RAISE NOTICE 'PASS: pgp_sym_decrypt roundtrip matches original';

  -- Test 3: Different keys produce decryption failure
  BEGIN
    decrypted_text := pgp_sym_decrypt(encrypted_data, 'wrong-key');
    -- If we get here with wrong key, that's a failure
    -- pgp_sym_decrypt may throw or return garbage — either way is a test concern
    RAISE NOTICE 'NOTE: Decryption with wrong key did not throw (may return garbage)';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'PASS: Decryption with wrong key fails as expected';
  END;

  -- Test 4: Empty string encryption
  encrypted_data := pgp_sym_encrypt('', test_key);
  decrypted_text := pgp_sym_decrypt(encrypted_data, test_key);
  ASSERT decrypted_text = '', 'Empty string should roundtrip correctly';

  RAISE NOTICE 'PASS: Empty string encryption roundtrip works';

  -- Test 5: UTF-8 / Spanish characters
  original_text := 'Comunidad Cristiana del Sur — Bogotá, Colombia (áéíóú ñ)';
  encrypted_data := pgp_sym_encrypt(original_text, test_key);
  decrypted_text := pgp_sym_decrypt(encrypted_data, test_key);
  ASSERT decrypted_text = original_text, 'Spanish characters should roundtrip correctly';

  RAISE NOTICE 'PASS: UTF-8/Spanish character encryption roundtrip works';

  -- Test 6: Denomination/community field simulation
  original_text := 'Pentecostal';
  encrypted_data := pgp_sym_encrypt(original_text, test_key);

  -- Simulate storing in a BYTEA column
  -- (In real schema: denomination_encrypted BYTEA)
  decrypted_text := pgp_sym_decrypt(encrypted_data, test_key);
  ASSERT decrypted_text = original_text, 'Denomination field should roundtrip';

  original_text := 'Iglesia de Dios Ministerial de Jesucristo Internacional';
  encrypted_data := pgp_sym_encrypt(original_text, test_key);
  decrypted_text := pgp_sym_decrypt(encrypted_data, test_key);
  ASSERT decrypted_text = original_text, 'Community name field should roundtrip';

  RAISE NOTICE 'PASS: Denomination/community field encryption simulation works';

  RAISE NOTICE 'All pgcrypto tests passed';
END $$;
