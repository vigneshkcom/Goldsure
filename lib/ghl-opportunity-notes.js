// Match the selected GHL opportunity to its customer, then use the same
// contact-note API as the existing SMS portal. These notes appear on the
// customer's opportunity screen but are not opportunity-only notes.
const GHL = 'https://services.leadconnectorhq.com';
const STAFF = new Set(['David', 'Vignesh', 'Amit', 'Shanira', 'Alda']);
const ID = /^[a-zA-Z0-9_-]{5,80}$/;

class NoteError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function headers(version = '2021-07-28') {
  if (!process.env.GHL_API_KEY || !process.env.GHL_LOCATION_ID) throw new NoteError(503, 'GHL is not configured for notes.');
  return { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: version, Accept: 'application/json' };
}

async function ghl(path, { method = 'GET', version = '2021-07-28', body } = {}) {
  const response = await fetch(`${GHL}${path}`, {
    method, headers: { ...headers(version), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new NoteError(response.status === 403 ? 503 : 502,
    response.status === 403 ? 'The GHL integration needs notes and user access enabled.' : `GHL notes request failed (${response.status}).`);
  return data;
}

const last9 = value => String(value || '').replace(/\D/g, '').slice(-9);

async function resolveOpportunity(opportunityId, expectedEmail, expectedPhone) {
  if (!ID.test(opportunityId)) throw new NoteError(400, 'Select a valid GHL opportunity.');
  const data = await ghl(`/opportunities/${encodeURIComponent(opportunityId)}`, { version: 'v3' });
  const opportunity = data.opportunity;
  if (!opportunity || opportunity.id !== opportunityId || !ID.test(String(opportunity.contactId || '')))
    throw new NoteError(404, 'The GHL opportunity could not be verified.');
  if (opportunity.locationId && opportunity.locationId !== process.env.GHL_LOCATION_ID)
    throw new NoteError(404, 'The GHL opportunity is not in this portal.');
  const contactData = await ghl(`/contacts/${encodeURIComponent(opportunity.contactId)}`);
  const contact = contactData.contact;
  if (!contact || contact.id !== opportunity.contactId) throw new NoteError(404, 'The opportunity contact could not be verified.');
  if (contact.locationId && contact.locationId !== process.env.GHL_LOCATION_ID)
    throw new NoteError(404, 'The opportunity contact is not in this portal.');
  if (expectedEmail && String(contact.email || '').trim().toLowerCase() !== expectedEmail.trim().toLowerCase())
    throw new NoteError(409, 'This quote no longer matches the GHL opportunity contact. No note was saved.');
  if (expectedPhone && (!last9(expectedPhone) || last9(contact.phone) !== last9(expectedPhone)))
    throw new NoteError(409, 'This conversation no longer matches the GHL opportunity contact. No note was saved.');
  return { opportunity, contact };
}

function simplify(note, source) {
  return { id: note.id || '', body: note.body || '', date: note.dateAdded || note.dateUpdated || '', source };
}

async function loadNotes(contactId) {
  const contactResult = await ghl(`/contacts/${encodeURIComponent(contactId)}/notes`);
  if (!Array.isArray(contactResult.notes)) throw new NoteError(502, 'GHL contact notes were incomplete.');
  return { notes: contactResult.notes.map(note => simplify(note, 'Contact')).sort((a, b) => b.date.localeCompare(a.date)) };
}

async function authorId(staffName) {
  if (!STAFF.has(staffName)) throw new NoteError(400, 'Select your staff name before saving a note.');
  let mapped = {};
  try { mapped = JSON.parse(process.env.GHL_NOTES_STAFF_IDS || '{}'); } catch {}
  if (ID.test(String(mapped[staffName] || ''))) return mapped[staffName];
  const result = await ghl(`/users/?locationId=${encodeURIComponent(process.env.GHL_LOCATION_ID)}`);
  if (!Array.isArray(result.users)) throw new NoteError(503, 'GHL staff users could not be verified.');
  const matches = result.users.filter(user => !user.deleted &&
    String(user.firstName || user.name?.split(/\s+/)[0] || '').toLowerCase() === staffName.toLowerCase());
  if (matches.length !== 1 || !ID.test(String(matches[0].id || '')))
    throw new NoteError(503, `GHL has no unique user match for ${staffName}. Ask an admin to configure the staff ID.`);
  return matches[0].id;
}

export async function opportunityNotes(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
  const input = req.method === 'GET' ? req.query || {} : req.body || {};
  try {
    const opportunityId = String(input.opportunityId || '');
    const expectedEmail = String(input.expectedEmail || '');
    const expectedPhone = String(input.expectedPhone || '');
    const { opportunity, contact } = await resolveOpportunity(opportunityId, expectedEmail, expectedPhone);
    if (req.method === 'GET') {
      const result = await loadNotes(contact.id);
      let author = {};
      if (input.staffName) {
        try { await authorId(String(input.staffName)); author = { authorReady: true }; }
        catch (error) { author = { authorReady: false, authorIssue: error.message }; }
      }
      return res.status(200).json({ opportunityId, opportunityName: opportunity.name || '', contactName: contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' '), noteScope: 'contact', ...result, ...author });
    }
    const body = String(input.body || '').trim();
    if (!body || body.length > 3000) throw new NoteError(400, 'Enter a note of up to 3,000 characters.');
    if (!expectedEmail && !expectedPhone) throw new NoteError(400, 'A matching customer email or phone is required before saving.');
    await loadNotes(contact.id);
    const staffName = String(input.staffName || '').trim();
    const userId = await authorId(staffName);
    const created = await ghl(`/contacts/${encodeURIComponent(contact.id)}/notes`, { method: 'POST', body: { body, userId } });
    if (!created.note?.id) throw new NoteError(502, 'GHL did not confirm that the note was saved. Please check GHL before retrying.');
    return res.status(201).json({ saved: true, noteScope: 'contact', note: simplify(created.note, 'Contact') });
  } catch (error) {
    return res.status(error.status || 502).json({ error: error instanceof NoteError ? error.message : 'Could not complete the GHL notes request.' });
  }
}
