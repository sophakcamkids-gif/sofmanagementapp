import { getToken, apiLoadState, apiSet } from './secureApi';

/**
 * Cloud persistence layer for the app's key/value state.
 *
 * SECURITY (Phase 2): all cloud access now goes through the token-gated server
 * endpoints in /api (see secureApi.ts), never the browser's anon Supabase key.
 * After the Phase 3 RLS lockdown the anon key can no longer read or write the
 * database at all — only a signed-in admin/member, via the server.
 *
 * The app still keeps LocalStorage as a fast synchronous working copy; this
 * module mirrors reads/writes to the cloud through the API.
 */

// Pull every persisted key/value pair the signed-in caller may see. Returns {}
// when not signed in, so the app falls back to whatever is in LocalStorage.
export async function loadAllCloudState(): Promise<Record<string, any>> {
  return await apiLoadState();
}

// Broadcast whether the last admin cloud write reached Supabase, so the UI can warn
// the admin instead of silently losing data (a lost/expired session made writes fail
// quietly). The App listens for the 'sof-cloud' event.
function emitCloud(ok: boolean): void {
  try { window.dispatchEvent(new CustomEvent('sof-cloud', { detail: { ok } })); } catch { /* SSR/none */ }
}

// Mirror a single key/value pair to the cloud. Safe to call fire-and-forget.
//   • admin  → writes any key through the server (service key bypasses RLS); emits
//     success/failure so the UI can flag a broken session.
//   • member → skipped here; a member's few permitted writes (own password,
//     own pending submission) go through the dedicated secureApi helpers at
//     their call sites, which the server authorises per-item.
//   • signed out → skipped (LocalStorage still holds the working copy).
export async function saveCloudState(key: string, value: any): Promise<void> {
  let isAdmin = false;
  try { isAdmin = localStorage.getItem('userRole') === 'admin'; } catch { /* ignore */ }
  if (!isAdmin) return;
  if (!getToken()) { emitCloud(false); return; }
  const ok = await apiSet(key, value);
  emitCloud(ok);
}
