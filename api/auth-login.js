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
      const okResponse = () => res.status(200).json({
        ok: true, role: 'admin',
        token: signToken({ role: 'admin', code: 'ADMIN' }),
        state: allowedFrom(all, 'admin'),
      });

      // 1) Preferred: Supabase Auth (email + hashed password).
      const signed = await supabaseSignIn(norm(id), pw);
      if (signed) return okResponse();

      // 2) Legacy fallback: the plaintext credentials in sof_live_admin_auth — so the
      //    admin is never locked out before the Supabase Auth user exists. Remove this
      //    block once Supabase Auth login is confirmed working.
      const cfg = all['sof_live_admin_auth'] || {};
      const username = cfg.username || 'phornsophak@gmail.com';
      const adminPw = cfg.password || 'sof2026';
      if (norm(id).toLowerCase() === String(username).toLowerCase() && pw === adminPw) {
        return okResponse();
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
      token: signToken({ role: 'member', code }),
      state: allowedFrom(all, 'member'),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
}
