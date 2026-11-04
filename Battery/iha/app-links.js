export function scheduleDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function assessorAppLink({ origin = 'https://portal.goldsure.com.au', assessorId, assessorName, day } = {}) {
  const url = new URL('/Battery/iha/', origin);
  url.searchParams.set('app', 'assessor');
  if (assessorId) url.searchParams.set('assessor', assessorId);
  if (assessorName) url.searchParams.set('who', assessorName);
  if (scheduleDay(day)) url.searchParams.set('day', day);
  return url.href;
}

export function linkedAssessor(params, assessors) {
  const id = params.get('assessor');
  if (id) return assessors.find(a => a.id === id) || null;
  const name = params.get('who')?.trim().toLowerCase();
  if (!name) return null;
  const exact = assessors.filter(a => a.full_name.toLowerCase() === name);
  if (exact.length === 1) return exact[0];
  // Keep previously shared first-name links working, without choosing between two people.
  const matches = assessors.filter(a => a.full_name.toLowerCase().split(/\s+/)[0] === name);
  return matches.length === 1 ? matches[0] : null;
}
