// lib/ghl-note.js
// Post a note onto a GHL contact, found by phone number.
//
// The number stored in GHL rarely matches the format we hold it in, so the
// lookup tries the usual Australian variants and confirms a hit on the last 9
// digits — the same approach the SMS portal's note action uses.

const GHL_BASE = 'https://services.leadconnectorhq.com';
const last9 = s => String(s || '').replace(/\D/g, '').slice(-9);

export async function findGhlContactIdByPhone(phone, { apiKey, locationId }) {
  const target = last9(phone);
  if (!target) return null;
  const variants = [...new Set([phone, String(phone).replace(/^\+/, ''), '0' + target, target])];
  const hdrs = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };

  for (const q of variants) {
    const r = await fetch(
      `${GHL_BASE}/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(q)}&limit=20`,
      { headers: hdrs }
    );
    if (!r.ok) continue;
    const d = await r.json();
    const match = (d.contacts || []).find(c => last9(c.phone) === target);
    if (match) return match.id;
  }
  return null;
}

// Returns true if the note was posted. Never throws — callers treat notes as
// best-effort so a GHL outage can't fail the work that triggered them.
export async function postGhlNoteByPhone(phone, noteBody) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId || !phone || !noteBody) return false;

  try {
    const contactId = await findGhlContactIdByPhone(phone, { apiKey, locationId });
    if (!contactId) return false;
    const r = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: '2021-07-28',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: noteBody }),
    });
    return r.ok;
  } catch (e) {
    console.error('[GHL note]', e.message);
    return false;
  }
}
