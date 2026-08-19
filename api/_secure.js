// Shared server-side security helpers (imported by auth-login.js and state.js).
// Underscore prefix → Vercel does NOT treat this as a routable function.
//
// Uses the SUPABASE_SERVICE_ROLE_KEY (server-only, bypasses RLS) so the browser
// never needs a key that can read/write the whole database.

import crypto from 'crypto';

const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTH_SECRET = process.env.AUTH_SECRET || '';

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
