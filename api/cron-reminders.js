// SOF monthly reminders — runs ONCE a month via Vercel Cron (see vercel.json:
// "0 2 1 * *" = 1st of each month, 09:00 Cambodia time).
//
// One message per member:
//  • Everyone is reminded to make their monthly savings deposit (1st–15th window).
//  • Members with an outstanding loan are ALSO reminded to repay (principal +
//    interest), with their remaining balance and interest due.
//
// Sends personal Telegram DMs (to members who linked the bot), posts to the SOF
// group, and adds an in-app announcement (shown on the header bell).
//
// Reuses the webhook's env vars (TELEGRAM_BOT_TOKEN + VITE_SUPABASE_*). Set
// `sof_live_reminder_config.enabled = false` from Settings to pause. `?force=1`
// triggers a send immediately (the "send now" button).

const TG = process.env.TELEGRAM_BOT_TOKEN;
const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const CRON_SECRET = process.env.CRON_SECRET || '';

async function sbGet(key) {
  const r = await fetch(`${SB_URL}/rest/v1/app_state?key=eq.${encodeURIComponent(key)}&select=value`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const j = await r.json().catch(() => []);
  return Array.isArray(j) && j[0] ? j[0].value : null;
}
async function sbSet(key, value) {
  await fetch(`${SB_URL}/rest/v1/app_state`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
}
async function tgSend(chatId, text) {
  if (!TG || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const j = await r.json().catch(() => ({ ok: false }));
    return !!j.ok;
  } catch { return false; }
}

const codeOf = (r) => { const s = String((r && (r.id ?? r.code)) || ''); return (s.includes(' ') ? s.split(' ').pop() : s || '').toUpperCase(); };
const num = (v) => { if (typeof v === 'number') return v; if (v == null || v === '' || v === '-') return 0; const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
const money = (n) => (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KHM = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
const sortKey = (s) => { const p = String(s).trim().split(' '); const mi = KHM.indexOf(p[0]); return (Number(p[p.length - 1]) || 0) * 100 + (mi >= 0 ? mi + 1 : 0); };
const latestRows = (store) => {
  const months = Object.keys(store || {}).filter((m) => Array.isArray(store[m]));
  if (!months.length) return { month: '', rows: [] };
  const m = months.sort((a, b) => sortKey(a) - sortKey(b)).pop();
  return { month: m, rows: store[m] };
};

export default async function handler(req, res) {
  const force = req.query && (req.query.force === '1' || req.query.force === 'true');
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
  if (CRON_SECRET && !force && req.headers['authorization'] !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ ok: false });
  }

  const cfg = (await sbGet('sof_live_reminder_config')) || {};
  if (cfg.enabled === false && !force) return res.status(200).json({ ok: true, skipped: 'disabled' });

  const ict = new Date(Date.now() + 7 * 3600 * 1000); // Cambodia time
  const monthName = KHM[ict.getUTCMonth()];
  const monthLabel = `${monthName} ${ict.getUTCFullYear()}`;
  const today = ict.toISOString().split('T')[0];

  const sav = latestRows(await sbGet('sof_live_savings_by_month'));
  const ln = latestRows(await sbGet('sof_live_loans_by_month'));
  const chats = (await sbGet('sof_live_member_chats')) || {};
  const tgcfg = (await sbGet('sof_live_telegram_config')) || {};

  const byCode = {};
  for (const r of sav.rows) { const c = codeOf(r); byCode[c] = { ...(byCode[c] || {}), name: r.name, savTotal: num(r.total) }; }
  for (const r of ln.rows) {
    const c = codeOf(r);
    const rate = num(r.rate) || (num(r.loanValue) && num(r.interest) ? num(r.interest) / num(r.loanValue) * 100 : 1.5);
    const rem = num(r.remaining);
    byCode[c] = { ...(byCode[c] || {}), name: (byCode[c] && byCode[c].name) || r.name, remaining: rem, interest: rem * rate / 100 };
  }

  // One monthly message per member: savings for everyone, plus loan repayment for
  // loan holders. Loans have no stored receipt date, so they're reminded in the same
  // monthly (1st–15th) window as savings — exactly like a savings reminder.
  let sent = 0;
  for (const [chatId, code] of Object.entries(chats)) {
    const info = byCode[String(code).toUpperCase()] || {};
    const hasLoan = num(info.remaining) > 0;
    let msg = `ជម្រាបសួរ ${info.name || code}!\n\n`;
    if (hasLoan) {
      // Two items → keep the dash bullets.
      msg += `- សូមចូលរួមដាក់សន្សំ ប្រចាំខែ${monthName} ចាប់ពីថ្ងៃនេះតទៅ។\n`;
      msg += `- សូមបង់រំលស់កម្ចី និងការប្រាក់ក្នុងខែនេះ។ កម្ចីនៅសល់ $${money(info.remaining)} ការប្រាក់ត្រូវបង់ $${money(info.interest)}។ អ្នកអាចបង់តាម App របស់ក្រុមបាន។\n`;
    } else {
      // Savings-only member → single line, no dash.
      msg += `សូមចូលរួមដាក់សន្សំ ប្រចាំខែ${monthName} ចាប់ពីថ្ងៃនេះតទៅ។\n`;
    }
    msg += `\nសូមអរគុណ!\nគណៈកម្មាការ`;
    if (await tgSend(chatId, msg)) sent++;
  }

  // Group post + in-app announcement (once per run).
  if (tgcfg.chatId) {
    await tgSend(tgcfg.chatId, `🔔 ខែ${monthLabel}៖ ដល់ពេលដាក់សន្សំប្រចាំខែ (ថ្ងៃទី១–១៥) និងបង់រំលស់កម្ចីតាមកាលកំណត់ហើយ! សូមសមាជិកទាំងអស់អនុវត្តទាន់ពេលវេលា។ 🙏`);
  }
  const anns = (await sbGet('sof_live_announcements')) || [];
  await sbSet('sof_live_announcements', [
    { id: Date.now(), title: `ការរំលឹកប្រចាំខែ${monthLabel}`, body: 'សូមសមាជិកទាំងអស់ដាក់សន្សំប្រចាំខែ (ថ្ងៃទី១–១៥) និងបង់រំលស់កម្ចី (រួមទាំងការប្រាក់) តាមកាលកំណត់។ អាចបង់តាមកម្មវិធីបាន។ អរគុណ!', date: today },
    ...anns,
  ].slice(0, 50));

  return res.status(200).json({ ok: true, monthLabel, sent });
}
