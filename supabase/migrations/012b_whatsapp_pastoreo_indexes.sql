-- 012b_whatsapp_pastoreo_indexes.sql
-- WhatsApp Pastoreo Notifications — indexes CONCURRENTLY (PR1, T-011)
-- MUST be a dedicated file/migration: CONCURRENTLY cannot run inside a
-- transaction block. supabase-postgres-best-practices lock-concurrently +
-- query-partial-indexes. All indexes IF NOT EXISTS + partial WHERE deleted_at
-- IS NULL / specific status predicates. Does not depend on RLS (012c).
--
-- Apply with: supabase db reset (applies in order 012a→012b→012c) or
-- direct psql with large statement_timeout for CONCURRENTLY.
-- Verification: \di shows 8 indexes; EXPLAIN (FORMAT JSON) for birthday scan
-- shows Index Scan on idx_members_birthday_month_day (no Seq Scan at 1k rows).

-- Birthday daily scan — expression + partial
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_members_birthday_month_day
  ON public.members ((EXTRACT(MONTH FROM birthday)), (EXTRACT(DAY FROM birthday)))
  WHERE deleted_at IS NULL AND birthday IS NOT NULL;

-- Attendance hot path
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_member_session
  ON public.attendance (member_id, session_id) WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_session
  ON public.attendance (session_id) WHERE deleted_at IS NULL;

-- Sessions by date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_session_date
  ON public.sessions (session_date) WHERE deleted_at IS NULL;

-- Sex filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_members_sex
  ON public.members (sex) WHERE deleted_at IS NULL;

-- Notification dedup — idempotency (partial unique, exclude failed/skipped so retries allowed)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_notification_log_dedup
  ON public.notification_log (session_id, member_id, kind)
  WHERE status IN ('sent','queued');

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_notification_log_birthday
  ON public.notification_log (member_id, kind, notification_date)
  WHERE kind = 'birthday' AND status IN ('sent','queued');

-- Per-recipient birthday dedup (digest is per staffer)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_notification_log_birthday_recipient
  ON public.notification_log (member_id, recipient_profile_id, kind, notification_date)
  WHERE kind = 'birthday' AND status IN ('sent','queued');

-- Ops: monthly cap check (helps count sent per month)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_log_sent_at_status
  ON public.notification_log (sent_at, status) WHERE status = 'sent';
