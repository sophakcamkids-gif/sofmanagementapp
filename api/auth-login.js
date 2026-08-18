// POST /api/auth-login  { role: 'admin'|'member', id, password }
// Verifies credentials SERVER-SIDE (service key reads the secret keys the browser
// can no longer see) and returns a signed session token used by /api/state.

import { sbGet, signToken, codeOf } from './_secure.js';

const norm = (s) => String(s || '').trim();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });
  const { role, id, password } = req.body || {};
  const pw = String(password ?? '');

  try {
    if (role === 'admin') {
      const cfg = (await sbGet('sof_live_admin_auth')) || {};
      const username = cfg.username || 'phornsophak@gmail.com';
      const adminPw = cfg.password || 'sof2026';
      if (norm(id).toLowerCase() === String(username).toLowerCase() && pw === adminPw) {
        return res.status(200).json({ ok: true, token: signToken({ role: 'admin', code: 'ADMIN' }), role: 'admin' });
      }
      return res.status(401).json({ ok: false, error: 'invalid' });
    }

    // Member: id is their code (C001…). Password = per-member override, else default.
    const code = norm(id).toUpperCase();
    if (!code) return res.status(400).json({ ok: false, error: 'id' });

    // Confirm the member exists in one of the rosters.
    let exists = false;
    for (const k of ['sof_live_member_list_data', 'sof_live_profile_data', 'sof_live_deposit_profile_data']) {
      const list = await sbGet(k);
      if (Array.isArray(list) && list.some((x) => codeOf(x) === code)) { exists = true; break; }
    }
    if (!exists) return res.status(401).json({ ok: false, error: 'nomember' });

    const creds = (await sbGet('sof_live_member_credentials')) || {};
    const defaultPw = (await sbGet('sof_live_member_default_password')) || 'sof2026';
    const expected = creds[code] || defaultPw;
    if (pw !== String(expected)) return res.status(401).json({ ok: false, error: 'invalid' });

    return res.status(200).json({ ok: true, token: signToken({ role: 'member', code }), role: 'member', code });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
}
