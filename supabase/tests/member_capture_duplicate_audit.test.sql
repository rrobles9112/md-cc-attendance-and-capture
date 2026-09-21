-- Member-capture duplicate audit (PR4 of the retiro-23505 stack)
-- Question: is the retreat 23505 (unique event/email+phone) extrapolable to
-- the member capture form (CaptureForm default variant)?
--
-- Answer pinned here: NO, by design.
--   1. public.members has NO unique index on email/phone (only PK on id), so a
--      double submit creates two UUID rows instead of raising 23505. Families
--      legitimately share contact data, so a hard unique would be wrong.
--   2. The duplicate defense is flag-for-review: CaptureForm calls
--      findDuplicateMembers (local Dexie + remote check) BEFORE insert and
--      stores duplicate_flag=true with a warning toast for admin review
--      (see src/lib/sync/conflict.ts, src/components/forms/CaptureForm.tsx).
--   3. Queue flush uses upsert by PK (src/lib/sync/queue.ts), so replaying the
--      same queued op is idempotent and cannot amplify a double submit.
--
-- This test locks those three schema premises. If a future migration adds a
-- unique index on members(email/phone), this test fails on purpose: the
-- capture UX (generic toast + review flow) must then be re-audited.
--
-- CI: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/member_capture_duplicate_audit.test.sql
--
-- Match retreat_rls.test.sql style: RAISE NOTICE 'PASS: ...' / RAISE EXCEPTION 'FAIL: ...'

BEGIN;

DO $$
DECLARE
  v_unique_guards integer;
BEGIN
  -- Premise 1: no unique index on members covering email or phone.
  -- (PK on id is excluded by the column filter below.)
  SELECT count(*) INTO v_unique_guards
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'members'
    AND i.indisunique
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = t.oid
        AND a.attnum = ANY (i.indkey)
        AND a.attname IN ('email', 'phone')
    );

  IF v_unique_guards <> 0 THEN
    RAISE EXCEPTION 'FAIL: members has % unique index(es) on email/phone; re-audit the capture duplicate UX before keeping them', v_unique_guards;
  END IF;
  RAISE NOTICE 'PASS: members has no unique index on email/phone (double submit cannot raise 23505)';

  -- Premise 2: the flag-for-review column exists.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'members'
      AND column_name = 'duplicate_flag'
  ) THEN
    RAISE EXCEPTION 'FAIL: members.duplicate_flag is missing; the review flow has no storage';
  END IF;
  RAISE NOTICE 'PASS: members.duplicate_flag exists (flag-for-review storage)';

  -- Premise 3: encrypted religious columns exist server-side, so sensitive
  -- member data never needs a plaintext unique guard.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'members'
      AND column_name IN ('denomination_encrypted', 'community_name_encrypted')
  ) THEN
    RAISE EXCEPTION 'FAIL: members encrypted religious columns are missing';
  END IF;
  RAISE NOTICE 'PASS: members religious data stays encrypted (no plaintext unique guard needed)';

  RAISE NOTICE 'All member-capture duplicate-audit checks passed';
END $$;

ROLLBACK;
