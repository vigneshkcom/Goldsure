import { json, validSession, db } from './_shared.js';
import { readLive } from './_dataforce.js';

let cache = null; // short server-side cache so several open pages share one Dataforce read
const TTL_MS = 20 * 1000;

export default async function handler(req, res) {
  if (!validSession(req)) return json(res, 401, { error: 'Choose your staff name first' });
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (cache && Date.now() - cache.at < TTL_MS && !req.query?.fresh) return json(res, 200, cache.data);
  try {
    const rows = await db('goldsure_rebooking_jobs?select=job_id&limit=100');
    const data = await readLive({ jobIds: (rows || []).map(r => r.job_id) });
    cache = { at: Date.now(), data };
    return json(res, 200, data);
  } catch (e) {
    return json(res, e.status === 503 ? 503 : 502, { error: e.status === 503 ? 'Dataforce is not connected' : 'Could not read Dataforce right now' });
  }
}
