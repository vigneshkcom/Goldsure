const MAX_AGE_MS = 10 * 60 * 1000;
export async function cacheRequest(path, init = {}, {env = process.env, fetchImpl = fetch} = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Schedule storage is not configured.');
  const response = await fetchImpl(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, {
    ...init, headers: {apikey:env.SUPABASE_SERVICE_ROLE_KEY, Authorization:'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type':'application/json', ...init.headers}, cache:'no-store'
  });
  if (!response.ok) throw new Error('Schedule storage failed (' + response.status + ').');
  return response.status === 204 ? null : response.json();
}
export async function readScheduleCache(options) {
  const [row] = await cacheRequest('electrician_schedule_cache?id=eq.dataforce&select=*', {}, options);
  return row || {payload:{}};
}
export function savedSchedule(row, dates, now = Date.now()) {
  const workers = row.payload?.workers || {};
  const schedule = dates.flatMap(day => day.electricians.map(name => {
    const saved = workers[name];
    const stale = !saved?.updatedAt || now - Date.parse(saved.updatedAt) > MAX_AGE_MS;
    return {date:day.date,name,stale,updatedAt:saved?.updatedAt || null,
      appointments:saved ? saved.appointments.filter(a => a.date === day.date) : null};
  }));
  const stamps = Object.values(workers).map(worker => worker.updatedAt).filter(Boolean).sort();
  return {schedule, locations:new Map(Object.entries(row.payload?.locations || {}).map(([id,place]) => [Number(id),place])),
    updatedAt:stamps[0] || null, stale:schedule.some(row => row.stale), retryAt:row.next_attempt_at || null};
}
