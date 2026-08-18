-- Deduplicate the existing "richard robles" member rows.
-- Run this in the Supabase Dashboard SQL Editor against the production project
-- (ppiyddosohwswhfzqhk) ONCE, after deploying PR #47.
--
-- Strategy: keep the EARLIEST created row, soft-delete the rest, and re-point any
-- child rows (social_media / whatsapp_numbers / attendance / consent_records) from
-- the duplicate rows onto the kept row so no data is orphaned or lost.
--
-- IMPORTANT: review the SELECT first (commented) before running the writes.
-- All writes are audited by the audit_* triggers automatically.

-- 0) Preview the duplicates (run this alone first to confirm which rows match):
-- SELECT id, name, phone, email, created_at, deleted_at
-- FROM members
-- WHERE name_normalized = 'richard robles'
--   AND deleted_at IS NULL
-- ORDER BY created_at;

DO $$
DECLARE
  v_keep_id UUID;
  v_dup_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  -- Pick the earliest non-deleted "richard robles" row as the canonical one.
  SELECT id INTO v_keep_id
  FROM members
  WHERE name_normalized = 'richard robles'
    AND deleted_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  IF v_keep_id IS NULL THEN
    RAISE NOTICE 'No active "richard robles" rows found — nothing to deduplicate.';
    RETURN;
  END IF;

  -- Collect the duplicate ids (everything except the kept row).
  SELECT array_agg(id) INTO v_dup_ids
  FROM members
  WHERE name_normalized = 'richard robles'
    AND deleted_at IS NULL
    AND id <> v_keep_id;

  IF array_length(v_dup_ids, 1) IS NULL THEN
    RAISE NOTICE 'Only one active "richard robles" row exists (id=%); no duplicates to remove.', v_keep_id;
    RETURN;
  END IF;

  RAISE NOTICE 'Keeping %; re-parenting children from % onto the kept row, then soft-deleting duplicates.', v_keep_id, v_dup_ids;

  -- Re-parent child rows from duplicates onto the kept row.
  UPDATE social_media     SET member_id = v_keep_id WHERE member_id = ANY(v_dup_ids);
  UPDATE whatsapp_numbers SET member_id = v_keep_id WHERE member_id = ANY(v_dup_ids);
  UPDATE attendance       SET member_id = v_keep_id WHERE member_id = ANY(v_dup_ids);
  UPDATE consent_records  SET member_id = v_keep_id WHERE member_id = ANY(v_dup_ids);

  -- Soft-delete the duplicate member rows (matches the app's soft-delete contract).
  UPDATE members
  SET deleted_at = now(),
      updated_at = now(),
      duplicate_flag = false
  WHERE id = ANY(v_dup_ids);

  -- Mark the kept row as a reviewed duplicate (optional — remove if you do not want the flag).
  UPDATE members SET duplicate_flag = false WHERE id = v_keep_id;

  RAISE NOTICE 'Deduplicate complete. Kept=%, soft-deleted=%', v_keep_id, v_dup_ids;
END $$;
