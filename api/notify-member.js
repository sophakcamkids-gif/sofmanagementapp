// POST /api/notify-member  { memberCode, text }
// Admin-only. Sends a private Telegram DM to a LINKED member, using the server's bot
// token (kept out of the browser) and the chat_id ↔ member-code map the webhook keeps
// in sof_live_member_chats. Used so an IN-APP approval notifies the member the same way
// the committee-group Telegram approval already does — reliably, without the admin's
// device needing the bot token.

import { bearer, verifyToken, sbGet, codeOf } from './_secure.js';

const TG = process.env.TELEGRAM_BOT_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });

  const auth = verifyToken(bearer(req));
  if (!auth || auth.role !== 'admin') return res.status(401).json({ ok: false, error: 'unauthorised' });

  const { memberCode, text } = req.body || {};
  const code = codeOf({ code: memberCode });
  if (!code || !text) return res.status(400).json({ ok: false, error: 'args' });
  if (!TG) return res.status(200).json({ ok: true, delivered: false, reason: 'no-bot' });

  try {
    // The map is stored chat_id -> member-code; find this member's chat_id.
    const chats = (await sbGet('sof_live_member_chats')) || {};
    const entry = Object.entries(chats).find(([, c]) => codeOf({ code: c }) === code);
    const chatId = entry ? entry[0] : '';
    if (!chatId) return res.status(200).json({ ok: true, delivered: false, reason: 'not-linked' });

    const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: String(text) }),
    });
    const j = await r.json().catch(() => ({ ok: false }));
    return res.status(200).json({ ok: true, delivered: !!j.ok });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
}
