-- SOF — Phase 3: lock down app_state so the browser's anon key can no longer read
-- or write the database. Run in the Supabase SQL editor of the SOF project
-- (ref: nykdkdgwqlgzkkrajxef) — NOT the school (CCC) project.
--
-- ⚠️ Run this ONLY AFTER Phase 2 is deployed to production and verified (the live
-- app loads/saves through /api/state with a session token). If the client still
-- used the anon key directly, this would make the live app stop loading.
--
-- The server functions use SUPABASE_SERVICE_ROLE_KEY, which BYPASSES RLS, so they
-- keep full access. With RLS on and every policy removed, the anon key (and any
-- signed-in Supabase auth user) has no access at all.

-- 1) Make sure row-level security is enforced.
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

-- 2) Remove every existing policy on app_state, whatever it is named.
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'app_state' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON app_state', p.policyname);
  END LOOP;
END $$;

-- 3) Verify — this should return ZERO rows after the lockdown.
SELECT policyname FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'app_state';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (re-open anon full access) if the live app breaks and you must revert:
--   CREATE POLICY "Allow anon full access - app_state" ON app_state
--     FOR ALL TO anon USING (true) WITH CHECK (true);
