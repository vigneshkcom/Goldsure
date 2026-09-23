// lib/ghl-contact.js
// Find a GHL contact by phone (same last-9-digit approach as lib/ghl-note.js),
// creating one if no match exists. Used by flows that need a guaranteed
// contact to attach notes/opportunities to, rather than just skipping when
// nothing is found.

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

export async function findGhlContactIdByEmail(email, { apiKey, locationId }) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;
  const hdrs = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };
  const r = await fetch(
    `${GHL_BASE}/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(target)}&limit=20`,
    { headers: hdrs }
  );
  if (!r.ok) return null;
  const d = await r.json();
  return (d.contacts || []).find(c => String(c.email || '').trim().toLowerCase() === target)?.id || null;
}

// Finds a contact by phone first, then exact email, creating one only when
// neither identifier matches. Quote tools use this so a manual quote for a
// customer who is not yet in GHL still gets a contact, note and opportunity.
export async function findOrCreateGhlContact({ phone, email, firstName, lastName, address } = {}) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId || (!phone && !email)) return null;
  const hdrs = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };

  try {
    const existingId = (phone ? await findGhlContactIdByPhone(phone, { apiKey, locationId }) : null)
      || (email ? await findGhlContactIdByEmail(email, { apiKey, locationId }) : null);
    if (existingId) return { contactId: existingId, created: false };

    const r = await fetch(`${GHL_BASE}/contacts/`, {
      method: 'POST',
      headers: { ...hdrs, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId,
        ...(phone ? { phone } : {}),
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
        ...(email ? { email } : {}),
        ...(address ? { address1: address } : {}),
      }),
    });
    if (!r.ok) {
      console.error('[GHL contact] create failed', r.status, (await r.text().catch(() => '')).slice(0, 300));
      return null;
    }
    const data = await r.json().catch(() => ({}));
    const contactId = data?.contact?.id || data?.id;
    return contactId ? { contactId, created: true } : null;
  } catch (e) {
    console.error('[GHL contact]', e.message);
    return null;
  }
}

// Finds a contact by phone, creating one from the supplied details if none is
// found. Returns { contactId, created } or null if GHL isn't configured or
// the create call fails. Never throws — callers treat this as best-effort.
export async function findOrCreateGhlContactByPhone(phone, { firstName, lastName, email, address } = {}) {
  if (!phone) return null;
  return findOrCreateGhlContact({ phone, firstName, lastName, email, address });
}
