import { dispatchAcceptanceEmails } from '../../lib/smoke-acceptance-notifications.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await dispatchAcceptanceEmails();
    return res.status(result.failed ? 502 : 200).json(result);
  } catch (error) {
    console.error('[Smoke acceptance notifications]', error.message);
    return res.status(502).json({ error: 'Could not process acceptance notifications' });
  }
}
