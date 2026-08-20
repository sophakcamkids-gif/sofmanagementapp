// /api/state — the secure data layer. Requires a session token from /api/auth-login.
//
//   GET   → returns app_state as { key: value }. For members, sensitive keys
//           (credentials, admin auth, Telegram/Gemini secrets) are stripped.
//   POST  → writes one key, authorised by role:
//           • admin           { key, value }         — writes any key.
//           • member          { key, appendItem }    — appends the item to a
//             whitelisted shared array (pending payments / loan requests) after
//             checking the item belongs to them; may NOT replace whole keys.
//           • member (self)   { key: 'password', value } — changes only their own
//             password (server merges into sof_live_member_credentials).

import { bearer, verifyToken, sbGet, sbSet, getAllowedState, SENSITIVE_KEYS, MEMBER_WRITABLE, codeOf } from './_secure.js';

export default async function handler(req, res) {
  const auth = verifyToken(bearer(req));
  if (!auth) return res.status(401).json({ ok: false, error: 'unauthorised' });

  try {
    if (req.method === 'GET') {
      // Single-key fetch (used to lazy-load heavy keys like the report signature).
      const one = req.query && req.query.key;
      if (one) {
        if (auth.role !== 'admin' && SENSITIVE_KEYS.has(String(one))) {
          return res.status(403).json({ ok: false, error: 'forbidden' });
        }
        const value = await sbGet(String(one));
        return res.status(200).json({ ok: true, key: one, value });
      }
      const state = await getAllowedState(auth.role);
      return res.status(200).json({ ok: true, state });
    }

    if (req.method === 'POST') {
      const { key, value, appendItem } = req.body || {};
      if (!key) return res.status(400).json({ ok: false, error: 'key' });

      // Admin: full write to any key.
      if (auth.role === 'admin') {
        await sbSet(key, value);
        return res.status(200).json({ ok: true });
      }

      // Member: change only their own password.
      if (key === 'password') {
        const creds = (await sbGet('sof_live_member_credentials')) || {};
        creds[auth.code] = String(value ?? '');
        await sbSet('sof_live_member_credentials', creds);
        return res.status(200).json({ ok: true });
      }

      // Member: append their own submission to a whitelisted shared array.
      if (MEMBER_WRITABLE.has(key) && appendItem && typeof appendItem === 'object') {
        if (codeOf({ code: appendItem.memberCode }) !== auth.code) {
          return res.status(403).json({ ok: false, error: 'not-your-item' });
        }
        const arr = (await sbGet(key)) || [];
        const next = Array.isArray(arr) ? [appendItem, ...arr] : [appendItem];
        await sbSet(key, next);
        return res.status(200).json({ ok: true });
      }

      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    return res.status(405).json({ ok: false, error: 'method' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
}
