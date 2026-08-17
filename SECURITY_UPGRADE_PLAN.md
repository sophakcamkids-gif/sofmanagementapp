# SOF — Security Upgrade (branch: `security-hardening`)

Goal: stop the **anon key** (embedded in the app bundle) from being able to read or
write the whole database. Today `app_state` has `FOR ALL TO anon USING(true)` — anyone
who extracts the key can dump/alter all data (finances + passwords + secrets).

**This branch is isolated. Nothing here reaches the live app until you review and merge.**
It also requires Supabase + Vercel changes that only you can apply.

---

## Target architecture

```
Browser  ──(no service key)──►  Vercel API (/api/*)  ──(service_role key)──►  Supabase
             carries a signed        verifies token,
             session token           enforces per-role rules
```

- The browser NEVER holds the service-role key and can NOT write `app_state` directly.
- Login is verified **server-side**; the server issues a short-lived **session token** (HMAC).
- Reads strip sensitive keys (credentials, admin auth, Telegram/Gemini secrets) — the client
  never receives them.
- Writes are authorised: a member may only write a small whitelist (their own submission,
  their own password, loan request, telegram link); an admin may write anything.

## New API functions (this branch)
- `api/_secure.js` — shared helpers: HMAC token sign/verify, Supabase admin read/write
  (service key), sensitive-key list, member/admin write whitelist.
- `api/auth-login.js` — POST `{ role, id, password }` → verifies against
  `sof_live_member_credentials` / `sof_live_admin_auth` (service key) → returns a token.
- `api/state.js` — `GET` (token) returns non-sensitive `app_state`; `POST` (token) writes one
  key after an authorisation check. Uses the service key.

## Client changes (Phase 2 — the risky flip, done AFTER the API is tested)
- `src/lib/cloudStore.ts` → call `/api/state` with the token instead of the anon client.
- Login flow → call `/api/auth-login`, keep the token; stop reading credentials on the client.

## Supabase / Vercel actions (only you can do)
1. Vercel env: `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API → service_role),
   `AUTH_SECRET` (any long random string).
2. After Phase 2 is merged, run the RLS lock-down SQL (in `security/rls-lockdown.sql`) to
   revoke anon access to `app_state`. **Do this LAST**, only once the API path works, or the
   live app will stop loading.

## Phases & safety
1. **Phase 1 (this commit)** — add the API + docs. No client change, no RLS change → live app
   keeps working exactly as now. Safe to merge/deploy; the new endpoints just sit unused.
2. **Phase 2** — switch the client to the API (still with anon fallback for reads) and test end
   to end on this branch / a preview deployment.
3. **Phase 3** — run the RLS lock-down. Point of no return; do it only after Phase 2 verified.

Rollback at any phase: revert the branch; the anon policy still allows the old path until
Phase 3 SQL is run.
