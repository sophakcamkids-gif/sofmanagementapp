-- SOF — Phase 3: lock down app_state so the browser's anon key can no longer read
-- or write the database. Run in the Supabase SQL editor.
--
-- ⚠️ Run this ONLY AFTER Phase 2 is deployed and verified (the app loads/saves through
-- /api/state with a session token). If you run it while the client still uses the anon
-- key directly, the live app will stop loading.
--
-- The server functions use SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS, so they keep
-- full access. Removing the anon policy leaves anon with no access.

DROP POLICY IF EXISTS "Allow anon full access - app_state" ON app_state;
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

-- Rollback (re-open to anon) if anything goes wrong:
-- CREATE POLICY "Allow anon full access - app_state" ON app_state
--   FOR ALL TO anon USING (true) WITH CHECK (true);
