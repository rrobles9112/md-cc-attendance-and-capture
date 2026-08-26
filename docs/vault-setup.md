# Supabase Vault Setup

This guide explains how to set up Supabase Vault for managing the pgcrypto encryption key used to protect sensitive religious fields (denomination, community name).

## Overview

Supabase Vault provides Postgres-level secret storage encrypted at rest. The pgcrypto encryption key is stored in Vault and accessed server-side via `vault.decrypted_secrets` — the raw key never reaches the client or CI environment.

## Prerequisites

- Supabase project with `supabase_vault` extension enabled
- Database access (Supabase SQL editor or `psql`)

## Step 1: Enable the Vault Extension

```sql
CREATE EXTENSION IF NOT EXISTS supabase_vault;
```

## Step 2: Create the Encryption Key

Store the pgcrypto encryption key as a Vault secret:

```sql
SELECT vault.create_secret(
  'your-strong-encryption-key-here',  -- The actual key (use a strong random value)
  'pgcrypto_encryption_key',          -- Secret name
  'Encryption key for sensitive religious fields (denomination, community)'
);
```

> **Important**: Generate a strong key (32+ characters, mixed case, numbers, symbols). Example:
> ```bash
> openssl rand -base64 32
> ```

## Step 3: Access the Key in an Edge Function

Create an Edge Function that retrieves the key from Vault for decryption:

```typescript
// supabase/functions/decrypt-sensitive/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  // Retrieve the encryption key from Vault
  const { data: keyData, error: keyError } = await supabase
    .rpc('get_decryption_key')

  if (keyError || !keyData) {
    return new Response(JSON.stringify({ error: 'Failed to retrieve encryption key' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encryptionKey = keyData

  // Now use the key to decrypt sensitive fields
  // pgp_sym_decrypt(denomination_encrypted, encryptionKey)

  return new Response(JSON.stringify({ key: encryptionKey }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

## Step 4: Create the RPC Function

```sql
CREATE OR REPLACE FUNCTION get_decryption_key()
RETURNS TEXT AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'pgcrypto_encryption_key';
$$ LANGUAGE sql SECURITY DEFINER;
```

> **Security**: Restrict this function to `service_role` only. Do not grant access to `anon` or `authenticated` roles.

## Step 5: Using the Key for Encrypt/Decrypt

### Encrypt (during member capture)

```sql
-- Insert with encrypted sensitive fields
INSERT INTO members (
  name, name_normalized, phone, email,
  denomination_encrypted, community_name_encrypted,
  consent_recorded, sensitive_consent_recorded, created_by
) VALUES (
  'Juan Pérez', 'juan perez', '+573001234567', 'juan@test.com',
  pgp_sym_encrypt('Pentecostal', (SELECT get_decryption_key())),
  pgp_sym_encrypt('Iglesia de Dios', (SELECT get_decryption_key())),
  true, true, 'user-uuid-here'
);
```

### Decrypt (admin export or ARCO access)

```sql
-- Decrypt for authorized export
SELECT
  name,
  phone,
  email,
  pgp_sym_decrypt(denomination_encrypted, (SELECT get_decryption_key())) AS denomination,
  pgp_sym_decrypt(community_name_encrypted, (SELECT get_decryption_key())) AS community_name
FROM members
WHERE deleted_at IS NULL
  AND sensitive_consent_recorded = true;
```

## Secret Rotation

To rotate the encryption key:

1. **Generate a new key**:
   ```bash
   openssl rand -base64 32
   ```

2. **Update the Vault secret**:
   ```sql
   -- Delete old secret
   DELETE FROM vault.secrets WHERE name = 'pgcrypto_encryption_key';

   -- Create new secret
   SELECT vault.create_secret(
     'new-strong-encryption-key',
     'pgcrypto_encryption_key',
     'Rotated encryption key for sensitive fields'
   );
   ```

3. **Re-encrypt all sensitive data** (requires a migration):
   ```sql
   -- This must be done in a transaction during a maintenance window
   BEGIN;

   -- Decrypt with old key, re-encrypt with new key
   UPDATE members
   SET
     denomination_encrypted = pgp_sym_encrypt(
       pgp_sym_decrypt(denomination_encrypted, 'OLD_KEY'),
       'NEW_KEY'
     ),
     community_name_encrypted = pgp_sym_encrypt(
       pgp_sym_decrypt(community_name_encrypted, 'OLD_KEY'),
       'NEW_KEY'
     )
   WHERE denomination_encrypted IS NOT NULL;

   COMMIT;
   ```

4. **Remove the old key from Vault** (after confirming re-encryption).

> **Note**: Key rotation requires a maintenance window. Schedule during low-usage hours. The old key must remain available until all data is re-encrypted.

## WhatsApp Pastoreo Secrets (D2, T-017)

Injection requires no migration — Vault + `supabase secrets set` + Edge redeploy only. Fail-closed when missing (`whatsapp_enabled=true` but no creds → Edge returns `failed` + Pastoreo banner "WhatsApp no configurado — D2 pending", no provider calls).

### Required Vault secrets

| Secret | Value placeholder | Used by |
| ------ | ----------------- | ------- |
| `WHATSAPP_TOKEN` | system-user access token from Meta Business | Edge `send-whatsapp` `Authorization: Bearer` to Graph API |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta `phone_number_id` (or Twilio sandbox / Meta test number in dev) | Edge `POST https://graph.facebook.com/v20.0/{phone_number_id}/messages` |
| `CRON_SECRET` | random 32+ chars (`openssl rand -hex 32`) | `pg_cron` `x-cron-secret` and Vercel `/api/cron/daily-digest` `Authorization: Bearer` |

### Create placeholder secrets (D2 pending)

```sql
-- Via SQL (service_role)
SELECT vault.create_secret('', 'WHATSAPP_TOKEN', 'Meta system-user token — D2 pending');
SELECT vault.create_secret('', 'WHATSAPP_PHONE_NUMBER_ID', 'Meta phone_number_id — D2 pending');
SELECT vault.create_secret(replace(gen_random_uuid()::text,'-',''), 'CRON_SECRET', 'Shared secret for pg_cron / Vercel Cron');
```

### Inject real values (no migration)

```bash
supabase secrets set WHATSAPP_TOKEN="<real-token>" WHATSAPP_PHONE_NUMBER_ID="<real-id>" CRON_SECRET="<random>"
# also mirror to app_settings fallback (readable flag for Pastoreo banner):
psql -c "UPDATE app_settings SET value='<real-id>' WHERE key='whatsapp_phone_number_id'"
supabase functions deploy send-whatsapp --no-verify-jwt
```

### Verify

```sql
SELECT name FROM vault.decrypted_secrets; -- service_role only, expect 3 names
SELECT key, left(value,8) FROM app_settings WHERE key LIKE 'whatsapp_%';
```

### Kill switch & cap

```sql
-- Pause all sends without redeploy
UPDATE app_settings SET value='false' WHERE key='whatsapp_enabled';
-- Tune cap without migration
UPDATE app_settings SET value='900' WHERE key='whatsapp_monthly_cap';
UPDATE app_settings SET value='800' WHERE key='whatsapp_monthly_alert_at';
-- Pastoreo chronic tuning
UPDATE app_settings SET value='3' WHERE key='pastoreo_chronic_threshold';
UPDATE app_settings SET value='90' WHERE key='pastoreo_chronic_lookback_days';
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `vault.decrypted_secrets` is empty | Ensure the secret was created with `vault.create_secret()` |
| Decryption returns garbled data | Key mismatch — verify the key name matches |
| Permission denied on `get_decryption_key()` | Check function is `SECURITY DEFINER` and granted to correct role |
| Extension not found | Run `CREATE EXTENSION IF NOT EXISTS supabase_vault;` |
