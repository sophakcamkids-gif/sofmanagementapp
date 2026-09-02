// Shared server-side security helpers (imported by auth-login.js and state.js).
// Underscore prefix → Vercel does NOT treat this as a routable function.
//
// Uses the SUPABASE_SERVICE_ROLE_KEY (server-only, bypasses RLS) so the browser
// never needs a key that can read/write the whole database.

import crypto from 'crypto';

const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const AUTH_SECRET = process.env.AUTH_SECRET || '';

// Verify an email + password against Supabase Auth (GoTrue). Returns the token
// response on success, null on bad credentials / any error. Used for the admin
// login so the admin password is stored HASHED by Supabase, not in app_state.
export async function supabaseSignIn(email, password) {
  if (!SB_URL || !SB_ANON) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_ANON },
      body: JSON.stringify({ email: String(email || '').trim(), password: String(password || '') }),
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    return d && d.access_token ? d : null;
  } catch {
    return null;
  }
}

// ── Session tokens (minimal HMAC-signed, no dependency) ──────────────────────
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hmac = (data) => b64url(crypto.createHmac('sha256', AUTH_SECRET).update(data).digest());

export function signToken(payload, ttlSec = 8 * 60 * 60) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const data = b64url(JSON.stringify(body));
  return `${data}.${hmac(data)}`;
}
export function verifyToken(token) {
  if (!token || !AUTH_SECRET) return null;
  const [data, sig] = String(token).split('.');
  if (!data || !sig) return null;
  const expect = hmac(data);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  let body;
  try { body = JSON.parse(Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); } catch { return null; }
  if (!body || (body.exp && body.exp < Math.floor(Date.now() / 1000))) return null;
  return body; // { role, code, exp }
}
export function bearer(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

// ── Supabase admin (service key → bypasses RLS) ──────────────────────────────
const H = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
export async function sbGet(key) {
  const r = await fetch(`${SB_URL}/rest/v1/app_state?key=eq.${encodeURIComponent(key)}&select=value`, { headers: H });
  const j = await r.json().catch(() => []);
  return Array.isArray(j) && j[0] ? j[0].value : null;
}
export async function sbGetAll() {
  const r = await fetch(`${SB_URL}/rest/v1/app_state?select=key,value`, { headers: H });
  const j = await r.json().catch(() => []);
  const out = {};
  for (const row of Array.isArray(j) ? j : []) out[row.key] = row.value;
  return out;
}
export async function sbSet(key, value) {
  await fetch(`${SB_URL}/rest/v1/app_state`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
}

// Atomically prepend `item` to the JSONB array at `key` via the append_to_state
// SQL function. The DB serialises concurrent calls with a row lock, so two members
// submitting at the same instant never clobber each other (the read-modify-write in
// sbSet did). Falls back to a non-atomic read-modify-write if the function is not
// installed yet, so it keeps working before the migration is run.
export async function sbAppend(key, item) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/append_to_state`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: key, p_item: item }),
    });
    if (r.ok) return true;
  } catch { /* fall through to the fallback */ }
  const arr = (await sbGet(key)) || [];
  const next = Array.isArray(arr) ? [item, ...arr] : [item];
  await sbSet(key, next);
  return true;
}

// ── Access rules ─────────────────────────────────────────────────────────────
// Keys a logged-in MEMBER must never receive. The crown jewels: everyone's
// passwords, the admin login, and the private chat-id ↔ member map. NOTE: the
// Telegram/Gemini configs are intentionally NOT here — members read the Telegram
// bot token to send their own payment proofs, and may use the AI bot. After the
// RLS lockdown these are unreachable by anon (strangers) anyway; only an
// authenticated member can see them, which is acceptable.
export const SENSITIVE_KEYS = new Set([
  'sof_live_member_credentials',
  'sof_live_admin_auth',
  'sof_live_member_chats',
]);
// Keys a logged-in MEMBER may write (everything else is admin-only). NOTE: these are
// shared arrays, so the write endpoint appends the member's own item rather than
// letting them replace the whole list — see api/state.js.
export const MEMBER_WRITABLE = new Set([
  'sof_live_pending_payments',
  'sof_live_pending_loan_requests',
]);

export const codeOf = (r) => { const s = String((r && (r.id ?? r.code)) || ''); return (s.includes(' ') ? s.split(' ').pop() : s || '').toUpperCase(); };

// Heavy keys that are NOT needed to render the app on load (large base64 blobs used
// only when printing reports). Excluded from the initial snapshot for both roles and
// fetched on demand via GET /api/state?key=... — keeps login fast.
export const LAZY_KEYS = new Set([
  'sof_live_report_signature',
]);

// The subset of a full state snapshot the given role may receive on load: heavy
// lazy keys are dropped for everyone; members also lose the sensitive keys. Takes an
// already-fetched object so callers can reuse one sbGetAll.
export function allowedFrom(all, role) {
  const out = { ...(all || {}) };
  for (const k of LAZY_KEYS) delete out[k];
  if (role !== 'admin') { for (const k of SENSITIVE_KEYS) delete out[k]; }
  return out;
}
// Convenience: fetch everything and return only what the role may see.
export async function getAllowedState(role) {
  return allowedFrom(await sbGetAll(), role);
}
