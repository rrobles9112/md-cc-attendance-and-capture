-- 010_enable_realtime_publication.sql
-- Fix: GUI never received real-time updates (no postgres_changes events) when rows in
-- Supabase were inserted, updated, or deleted — even though the WebSocket channels
-- joined successfully with status SUBSCRIBED.
--
-- Root cause:
--   Supabase Realtime only broadcasts changes for tables that are members of the
--   `supabase_realtime` publication. No previous migration ever added the app tables,
--   so logical replication never delivered their changes to the Realtime server.
--   Reproduced and verified locally (supabase start):
--     * publication empty                     -> UPDATE/INSERT/DELETE applied, 0/3 events received
--     * tables added to supabase_realtime     -> 3/3 events received (UPDATE, INSERT, DELETE)
--
-- Replica identity is intentionally left at the default (PRIMARY KEY):
--   * INSERT/UPDATE payloads carry the full NEW row
--   * DELETE payloads carry the PK in OLD, which is all RealtimeManager.deleteLocal() needs
--     to evict the row from the Dexie cache.
--
-- Idempotent: skips tables already in the publication (safe to re-run).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['members', 'sessions', 'attendance', 'social_media', 'whatsapp_numbers']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
