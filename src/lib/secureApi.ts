// Client shim for the server-side secure data layer (/api/*).
//
// After the Phase 3 RLS lockdown the browser can no longer touch Supabase
// directly with the anon key. Every read/write instead goes through these
// token-gated endpoints:
//   POST /api/auth-login  → verifies credentials server-side, returns a token
//   GET  /api/state       → returns all app_state the caller may see
//   POST /api/state       → writes (admin: any key; member: own password / own
//                           pending submission only)
//
// The session token is kept in localStorage so it survives a page refresh within
// its 8h life; the existing 20-minute inactivity auto-logout still clears the
// session for a lost/shared device.

const TOKEN_KEY = 'sof_api_token';
const ROLE_KEY = 'sof_api_role';
const CODE_KEY = 'sof_api_code';

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function getApiRole(): string {
  try { return localStorage.getItem(ROLE_KEY) || ''; } catch { return ''; }
}
export function getApiCode(): string {
  try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; }
}
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(CODE_KEY);
  } catch { /* ignore */ }
}

type LoginResult = { ok: boolean; token?: string; role?: string; code?: string; error?: string; state?: Record<string, any> };

// Verify credentials server-side and, on success, store the session token.
export async function apiLogin(role: 'admin' | 'member', id: string, password: string): Promise<LoginResult> {
  let j: LoginResult;
  try {
    const r = await fetch('/api/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, id, password }),
    });
    j = await r.json();
  } catch {
    return { ok: false, error: 'network' };
  }
  if (j && j.ok && j.token) {
    try {
      localStorage.setItem(TOKEN_KEY, j.token);
      localStorage.setItem(ROLE_KEY, j.role || role);
      if (j.code) localStorage.setItem(CODE_KEY, j.code);
    } catch { /* ignore */ }
  }
  return j || { ok: false, error: 'empty' };
}

// Pull every key/value the caller is allowed to see. Returns {} when not signed
// in or on any error, so callers can safely fall back to the local cache.
export async function apiLoadState(): Promise<Record<string, any>> {
  const token = getToken();
  if (!token) return {};
  try {
    const r = await fetch('/api/state', { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401) { clearToken(); return {}; }
    const j = await r.json();
    return j && j.ok ? (j.state || {}) : {};
  } catch {
    return {};
  }
}

// Admin: write any key. Returns false if not signed in / on error.
export async function apiSet(key: string, value: any): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  try {
    const r = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ key, value }),
    });
    if (r.status === 401) { clearToken(); return false; }
    const j = await r.json();
    return !!(j && j.ok);
  } catch {
    return false;
  }
}

// Member: append one of their own submissions to a whitelisted shared array
// (pending payments / loan requests). `item.memberCode` must match the token.
export async function apiMemberAppend(key: string, item: any): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  try {
    const r = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ key, appendItem: item }),
    });
    if (r.status === 401) { clearToken(); return false; }
    const j = await r.json();
    return !!(j && j.ok);
  } catch {
    return false;
  }
}

// Member: change only their own password (server merges into member_credentials).
export async function apiMemberPassword(value: string): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  try {
    const r = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ key: 'password', value }),
    });
    if (r.status === 401) { clearToken(); return false; }
    const j = await r.json();
    return !!(j && j.ok);
  } catch {
    return false;
  }
}
