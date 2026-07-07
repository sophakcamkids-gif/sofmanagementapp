// SOF member Telegram bot — Vercel serverless webhook.
//
// Members DM the bot, link their account with their member ID, then ask questions
// about their savings/loans (answered by Gemini, grounded in their real figures) or
// type /report for a summary. The bot reads the SAME cloud data the app writes to
// Supabase (`app_state` key/value table) and stores the chat_id ↔ member-code map in
// `sof_live_member_chats`, which the app reads to send personal notifications.
//
// Required Vercel env vars:
//   TELEGRAM_BOT_TOKEN   – from @BotFather
//   SUPABASE_URL         – e.g. https://xxxx.supabase.co
//   SUPABASE_ANON_KEY    – project anon key (same one the app uses)
//   GEMINI_API_KEY       – (optional) free Google AI Studio key → enables Q&A
//   WEBHOOK_SECRET       – (optional) if set, must match Telegram's secret_token
//
// After deploy, point Telegram at this URL once:
//   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<app>.vercel.app/api/telegram-webhook

const TG = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI = process.env.GEMINI_API_KEY;
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_ANON_KEY;
const SECRET = process.env.WEBHOOK_SECRET || '';

// ── Supabase app_state (key/value) via REST ──────────────────────────────────
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
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
}

// ── Telegram ─────────────────────────────────────────────────────────────────
async function tgSend(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// ── Helpers (mirror the app's num / codeOf / money) ──────────────────────────
const codeOf = (r) => { const s = String((r && (r.id ?? r.code)) || ''); return (s.includes(' ') ? s.split(' ').pop() : s || '').toUpperCase(); };
const num = (v) => { if (typeof v === 'number') return v; if (v == null || v === '' || v === '-') return 0; const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
const money = (n) => (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KHM = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
const sortKey = (s) => { const p = String(s).trim().split(' '); const mi = KHM.indexOf(p[0]); return (Number(p[p.length - 1]) || 0) * 100 + (mi >= 0 ? mi + 1 : 0); };

async function findMember(code) {
  for (const k of ['sof_live_member_list_data', 'sof_live_profile_data', 'sof_live_deposit_profile_data']) {
    const l = await sbGet(k);
    const m = Array.isArray(l) ? l.find((x) => codeOf(x) === code) : null;
    if (m) return m;
  }
  return null;
}

async function buildDigest(code) {
  const sav = (await sbGet('sof_live_savings_by_month')) || {};
  const savLines = []; let latestSav = 0;
  Object.keys(sav).sort((a, b) => sortKey(a) - sortKey(b)).forEach((m) => {
    const rows = sav[m]; if (!Array.isArray(rows)) return;
    const r = rows.find((x) => codeOf(x) === code); if (!r) return;
    latestSav = num(r.total);
    savLines.push(`  ${m}: បន្ថែម $${money(num(r.addSaving))}, សរុប $${money(num(r.total))}`);
  });
  const ln = (await sbGet('sof_live_loans_by_month')) || {};
  const loanLines = []; let rem = 0; let rate = 0;
  Object.keys(ln).sort((a, b) => sortKey(a) - sortKey(b)).forEach((m) => {
    const rows = ln[m]; if (!Array.isArray(rows)) return;
    const r = rows.find((x) => codeOf(x) === code); if (!r) return;
    rem = num(r.remaining);
    if (num(r.rate)) rate = num(r.rate);
    else if (num(r.loanValue) && num(r.interest)) rate = num(r.interest) / num(r.loanValue) * 100;
    loanLines.push(`  ${m}: នៅសល់ $${money(num(r.remaining))}, ការប្រាក់ $${money(num(r.interest))}, បង់រំលស់ $${money(num(r.repayment))}`);
  });
  const nextInt = rem * (rate || 1.5) / 100;
  const member = await findMember(code);
  const name = (member && member.name) || code;
  return [
    `ឈ្មោះ៖ ${name} (ID៖ ${code})`,
    `ទុនសន្សំសរុបចុងក្រោយ៖ $${money(latestSav)}`,
    savLines.length ? `សន្សំតាមខែ៖\n${savLines.join('\n')}` : 'គ្មានទិន្នន័យសន្សំ',
    `កម្ចីនៅសល់ចុងក្រោយ៖ $${money(rem)} (អត្រា ${(rate || 1.5).toFixed(2)}%/ខែ)`,
    `ការប្រាក់ត្រូវបង់ខែបន្ទាប់ (ប៉ាន់ស្មាន)៖ $${money(nextInt)}`,
    loanLines.length ? `កម្ចីតាមខែ៖\n${loanLines.join('\n')}` : 'គ្មានទិន្នន័យកម្ចី',
  ].join('\n');
}

const RATES = { loan: 0.015, deposit: 0.005, fixedTerm: 0.01, reserve: 0.10, social: 0.005 };

async function buildGroupDigest() {
  const latest = (store) => {
    const months = Object.keys(store || {}).filter((m) => Array.isArray(store[m]));
    if (!months.length) return { month: '', rows: [] };
    const m = months.sort((a, b) => sortKey(a) - sortKey(b)).pop();
    return { month: m, rows: store[m] };
  };
  const sav = latest((await sbGet('sof_live_savings_by_month')) || {});
  const ln = latest((await sbGet('sof_live_loans_by_month')) || {});
  const totalSavings = sav.rows.reduce((s, r) => s + num(r.total), 0);
  const totalLoans = ln.rows.reduce((s, r) => s + num(r.remaining), 0);
  const borrowers = ln.rows.filter((r) => num(r.remaining) > 0).length;
  const monthInterest = ln.rows.reduce((s, r) => s + num(r.interest), 0);
  const roster = (await sbGet('sof_live_member_list_data')) || (await sbGet('sof_live_profile_data')) || [];
  const memberCount = Array.isArray(roster) && roster.length
    ? new Set(roster.map(codeOf).filter(Boolean)).size
    : new Set(sav.rows.map(codeOf).filter(Boolean)).size;
  const info = String((await sbGet('sof_live_group_info')) || '').trim();
  const lines = [
    `ព័ត៌មានក្រុម SOF — គិតត្រឹមខែ ${sav.month || ln.month || '-'}:`,
    `- ចំនួនសមាជិក៖ ${memberCount} នាក់`,
    `- ទុនសន្សំសរុបរបស់ក្រុម៖ $${money(totalSavings)}`,
    `- កម្ចីសរុប (នៅសល់)៖ $${money(totalLoans)}`,
    `- ចំនួនអ្នកខ្ចី៖ ${borrowers} នាក់`,
    `- ការប្រាក់កម្ចីសរុប (ខែនេះ)៖ $${money(monthInterest)}`,
    `- អត្រាការប្រាក់៖ កម្ចី ${(RATES.loan * 100).toFixed(2)}%/ខែ · សន្សំ ${(RATES.deposit * 100).toFixed(2)}%/ខែ · មានកាលកំណត់ ${(RATES.fixedTerm * 100).toFixed(2)}%/ខែ`,
    `- ការបែងចែក៖ មូលនិធិបំរុង ${(RATES.reserve * 100).toFixed(0)}% · មូលនិធិសង្គម ${(RATES.social * 100).toFixed(2)}% នៃចំណូល`,
  ];
  if (info) lines.push(`ព័ត៌មាន/ច្បាប់បន្ថែម៖\n${info}`);
  return lines.join('\n');
}

async function askGemini(prompt) {
  if (!GEMINI) return null;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const j = await r.json().catch(() => ({}));
  return (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text || '').trim();
}

const HELP_UNLINKED = 'សួស្តី! ខ្ញុំជា SOF Bot 🤖\nសូមផ្ញើលេខ ID សមាជិករបស់អ្នក (ឧ. C001) ដើម្បីភ្ជាប់គណនី។';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('SOF member bot webhook');
  if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET) return res.status(401).send('unauthorized');

  const update = req.body || {};
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return res.status(200).json({ ok: true });
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  try {
    const chats = (await sbGet('sof_live_member_chats')) || {};
    const linked = chats[String(chatId)];

    if (text === '/start' || text === '/help') {
      await tgSend(chatId, linked
        ? `សួស្តី! អ្នកបានភ្ជាប់ជាមួយ ID ${linked} រួចហើយ។\nសួរខ្ញុំអំពីទុនសន្សំ/កម្ចីរបស់អ្នក ឬព័ត៌មានក្រុមបានគ្រប់ពេល។\n/report = សង្ខេបផ្ទាល់ខ្លួន · /group = ព័ត៌មានក្រុម · /unlink = ផ្ដាច់`
        : HELP_UNLINKED);
    } else if (!linked) {
      const code = text.toUpperCase().replace(/\s+/g, '');
      const member = code ? await findMember(code) : null;
      if (member) {
        chats[String(chatId)] = code;
        await sbSet('sof_live_member_chats', chats);
        await tgSend(chatId, `✅ បានភ្ជាប់ជោគជ័យ ជាមួយ ${member.name || code} (${code})!\nឥឡូវអ្នកអាចសួរអំពីទុនសន្សំ/កម្ចី ឬវាយ /report។`);
      } else {
        await tgSend(chatId, `រកមិនឃើញលេខ ID «${text}» ទេ។ សូមផ្ញើលេខ ID សមាជិកឱ្យត្រឹមត្រូវ (ឧ. C001)។`);
      }
    } else if (text === '/report' || text === '/me') {
      await tgSend(chatId, await buildDigest(linked));
    } else if (text === '/group') {
      await tgSend(chatId, await buildGroupDigest());
    } else if (text === '/unlink') {
      delete chats[String(chatId)];
      await sbSet('sof_live_member_chats', chats);
      await tgSend(chatId, 'បានផ្ដាច់ការភ្ជាប់។ ផ្ញើលេខ ID ម្ដងទៀតដើម្បីភ្ជាប់វិញ។');
    } else {
      const digest = await buildDigest(linked);
      const group = await buildGroupDigest();
      const ans = await askGemini(
        `អ្នកគឺជា «SOF Bot» ជាជំនួយការក្រុមសន្សំប្រាក់អនាគតយើង (SOF)។ ` +
        `ឆ្លើយជាភាសាខ្មែរ ខ្លី ច្បាស់ និងសុភាព។ ប្រើតែទិន្នន័យខាងក្រោមដើម្បីឆ្លើយ (ទាំងផ្ទាល់ខ្លួន និងទូទាំងក្រុម) — កុំបង្កើតលេខថ្មី។ ` +
        `បើសំណួរនៅក្រៅវិសាលភាព សូមណែនាំឱ្យទាក់ទងគណៈកម្មការ SOF។\n\nទិន្នន័យសមាជិក៖\n${digest}\n\n${group}\n\nសំណួរ៖ ${text}`,
      );
      await tgSend(chatId, ans || `ទិន្នន័យរបស់អ្នក៖\n${digest}\n\n(សម្រាប់សំណួរលម្អិត សូមកំណត់ GEMINI_API_KEY)`);
    }
  } catch (e) {
    try { await tgSend(chatId, 'សុំទោស មានបញ្ហាបច្ចេកទេស។ សូមព្យាយាមម្ដងទៀត។'); } catch (_) { /* ignore */ }
  }
  return res.status(200).json({ ok: true });
}
