export const $ = id => document.getElementById(id);
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function status(id, text, error = false) { $(id).textContent = text; $(id).classList.toggle('error', error); }
export function date(value) { return value ? new Date(value).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' }) : 'Not yet'; }
export async function api(action, data = {}, password = '', binary = false) {
  const response = await fetch('/api/smoke-alarms/google-key', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(password ? { 'x-certificate-password': password } : {}) }, body: JSON.stringify({ action: `qld-certificate-${action}`, ...data }) });
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || `Request failed (${response.status}). Refresh the tracker before trying again.`); }
  return binary ? response.blob() : response.json();
}
export function saveBlob(blob, filename) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
