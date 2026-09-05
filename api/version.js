// Returns the currently DEPLOYED build id (Vercel's commit sha). The app compares
// this to its own baked-in __APP_VERSION__ and auto-reloads when they differ, so
// users (especially members who never hard-refresh) always end up on the latest
// code + config without doing anything.

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ version: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' });
}
