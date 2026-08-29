-- 012b_whatsapp_pastoreo_indexes.sql (renamed 016; Amendment A1 2026-08-29)
-- WhatsApp Pastoreo Notifications — indexes (PR1, T-011). Amendment A1 dropped
-- concurrent index builds: the Supabase CLI applies each migration inside a
-- single transaction, where they are invalid (SQLSTATE 25001) — proven by the
-- whole-file rollback of 015's first statements during S3. Plain index builds
-- are equivalent here: db reset targets a fresh database and the hosted tables
-- are small (sub-second locks).
-- supabase-postgres-best-practices query-partial-indexes still honored. All
-- indexes IF NOT EXISTS + partial WHERE deleted_at IS NULL / specific status
-- predicates. Does not depend on RLS (017).
--
-- Apply with: supabase db reset (applies in order 015→016→017) or direct psql.
-- Verification: \di shows the indexes; EXPLAIN (FORMAT JSON) for birthday scan
-- shows Index Scan on idx_members_birthday_month_day (no Seq Scan at 1k rows).

-- Birthday daily scan — expression + partial
CREATE INDEX IF NOT EXISTS idx_members_birthday_month_day
  ON public.members ((EXTRACT(MONTH FROM birthday)), (EXTRACT(DAY FROM birthday)))
  WHERE deleted_at IS NULL AND birthday IS NOT NULL;

-- Attendance hot path
CREATE INDEX IF NOT EXISTS idx_attendance_member_session
  ON public.attendance (member_id, session_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_session
  ON public.attendance (session_id) WHERE deleted_at IS NULL;

-- Sessions by date
CREATE INDEX IF NOT EXISTS idx_sessions_session_date
  ON public.sessions (session_date) WHERE deleted_at IS NULL;

-- Sex filter
CREATE INDEX IF NOT EXISTS idx_members_sex
  ON public.members (sex) WHERE deleted_at IS NULL;

-- Notification dedup — idempotency (partial unique, exclude failed/skipped so retries allowed)
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_log_dedup
  ON public.notification_log (session_id, member_id, kind)
  WHERE status IN ('sent','queued');

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_log_birthday
  ON public.notification_log (member_id, kind, notification_date)
  WHERE kind = 'birthday' AND status IN ('sent','queued');

-- Per-recipient birthday dedup (digest is per staffer)
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_log_birthday_recipient
  ON public.notification_log (member_id, recipient_profile_id, kind, notification_date)
  WHERE kind = 'birthday' AND status IN ('sent','queued');

-- Ops: monthly cap check (helps count sent per month)
CREATE INDEX IF NOT EXISTS idx_notification_log_sent_at_status
  ON public.notification_log (sent_at, status) WHERE status = 'sent';
