# SOF Member Telegram Bot — Setup

A personal Telegram bot for SOF members. Each member links their account, then can:

- **Ask questions** about their savings / loans / interest → answered by Gemini using
  their real figures (`/report` for a plain summary even without Gemini).
- **Receive personal notifications** — when the committee approves a member's payment or
  loan request, the app sends that member a private Telegram message.

The bot lives in `api/telegram-webhook.js` (a Vercel serverless function). It reads the
same Supabase cloud data the app writes, and stores the `chat_id ↔ member ID` links in
the `sof_live_member_chats` row of `app_state` (which the app reads to send notifications).

---

## 1. Create the bot

1. In Telegram, open **@BotFather** → `/newbot` → follow the prompts.
2. Copy the **bot token** (looks like `123456789:AAH...`).

## 2. Set Vercel environment variables

Vercel project → **Settings → Environment Variables**.

**In most cases you only need to add `TELEGRAM_BOT_TOKEN`** — the webhook reuses the
app's existing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (serverless functions can
read every env var, VITE-prefixed or not). Add the others only if they don't already exist.

| Name | Value |
|------|-------|
| `TELEGRAM_BOT_TOKEN` | the bot token from BotFather **(required, new)** |
| `GEMINI_API_KEY` | *(optional)* free key from https://aistudio.google.com/app/apikey — enables AI Q&A. Falls back to `VITE_GEMINI_API_KEY` if set. |
| `SUPABASE_URL` | *only if `VITE_SUPABASE_URL` is not already set* — `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | *only if `VITE_SUPABASE_ANON_KEY` is not already set* — the project **anon** key |
| `WEBHOOK_SECRET` | *(optional)* any random string, for extra security (see step 3) |

Then **redeploy** so the function picks up the variables.

## 3. Point Telegram at the webhook (once)

Replace `<TOKEN>` and `<APP>` and open this URL in a browser:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<APP>.vercel.app/api/telegram-webhook
```

If you set `WEBHOOK_SECRET`, add `&secret_token=<YOUR_SECRET>` to that URL.

You should see `{"ok":true,"result":true,...}`. Check status any time with
`https://api.telegram.org/bot<TOKEN>/getWebhookInfo`.

## 4. Members use it

1. Open the bot in Telegram (share its `t.me/<botusername>` link with members).
2. Send **`/start`**, then send your **member ID** (e.g. `C001`) to link.
3. Ask anything — “ខ្ញុំសន្សំបានប៉ុន្មាន?”, “កម្ចីនៅសល់ប៉ុន្មាន?”, “ការប្រាក់ខែក្រោយ?” — or send **`/report`** for a summary. **`/unlink`** to disconnect.

---

## Monthly reminders (automatic)

`api/cron-reminders.js` runs **once a month** (Vercel Cron in `vercel.json`, `0 2 1 * *`
= 1st of each month, 09:00 Cambodia time). It reminds every linked member to make their
monthly savings deposit, and members with an outstanding loan to also repay (with their
remaining balance + interest). It DMs members, posts to the SOF group, and adds an in-app
announcement.

- Toggle it and send a test on the **Settings** page → "ការរំលឹកប្រចាំខែ (ស្វ័យប្រវត្តិ)"
  ("ផ្ញើឥឡូវ (តេស្ត)" calls `/api/cron-reminders?force=1`).
- Uses the same env vars as the webhook. Optionally set `CRON_SECRET` in Vercel to lock the
  endpoint (Vercel Cron passes it automatically; the "send now" button uses `?force=1`).
- Vercel Cron requires a **production** deployment and runs only on the production domain.

## Notes

- **Notifications** are sent by the app (browser) when the committee approves a payment or
  loan request, to the member's linked chat. The admin's browser needs the latest links,
  so if a member just linked, the admin may need to reload (or Hard Refresh) once.
- The `GEMINI_API_KEY` here (for the Telegram bot) is separate from the in-app SOF Bot key
  set on the Settings page. You can use the same key for both.
- Security: the anon key can read/write `app_state` (same as the app). Keep `WEBHOOK_SECRET`
  set so only Telegram can call the webhook.
