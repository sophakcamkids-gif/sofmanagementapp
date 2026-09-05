// POST /api/auth-login  { role: 'admin'|'member', id, password }
// Verifies credentials SERVER-SIDE (service key reads the secret keys the browser
// can no longer see) and returns a signed session token used by /api/state.
//
// SPEED: this one call also returns the caller's initial `state`, so the client
// does not need a second /api/state round-trip right after logging in.

import { sbGetAll, signToken, codeOf, allowedFrom, supabaseSignIn } from './_secure.js';

const norm = (s) => String(s || '').trim();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });
  const { role, id, password } = req.body || {};
  const pw = String(password ?? '');

  try {
    // One database round-trip for both the credential check and the returned state.
    const all = await sbGetAll();

    if (role === 'admin') {
      // Admin authenticates against Supabase Auth (email + hashed password). The old
      // plaintext sof_live_admin_auth fallback has been removed now that this works.
      const signed = await supabaseSignIn(norm(id), pw);
      if (signed) {
        return res.status(200).json({
          ok: true, role: 'admin',
          token: signToken({ role: 'admin', code: 'ADMIN' }),
          state: allowedFrom(all, 'admin'),
        });
      }
      return res.status(401).json({ ok: false, error: 'invalid' });
    }

    // Member: id is their code (C001…). Password = per-member override, else default.
    const code = norm(id).toUpperCase();
    if (!code) return res.status(400).json({ ok: false, error: 'id' });

    // Confirm the member exists in one of the rosters.
    let exists = false;
    for (const k of ['sof_live_member_list_data', 'sof_live_profile_data', 'sof_live_deposit_profile_data']) {
      const list = all[k];
      if (Array.isArray(list) && list.some((x) => codeOf(x) === code)) { exists = true; break; }
    }
    if (!exists) return res.status(401).json({ ok: false, error: 'nomember' });

    const creds = all['sof_live_member_credentials'] || {};
    const defaultPw = all['sof_live_member_default_password'] || 'sof2026';
    const expected = creds[code] || defaultPw;
    if (pw !== String(expected)) return res.status(401).json({ ok: false, error: 'invalid' });

    return res.status(200).json({
      ok: true, role: 'member', code,
      // Members get a long-lived session (30 days) so deposits/loan submits don't fail
      // from an expired token — members use their own phones (lower risk than admin).
      token: signToken({ role: 'member', code }, 30 * 24 * 60 * 60),
      state: allowedFrom(all, 'member'),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
}
