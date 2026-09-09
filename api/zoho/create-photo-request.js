// api/zoho/create-photo-request.js
// Per-customer WorkDrive photo collection. Avoids Zoho's external-share-link
// permission system entirely (its role_id enumeration isn't reliably
// discoverable) by instead uploading files server-side into a per-customer
// folder, via our own upload page.
//
//  POST /api/zoho/create-photo-request  { name: "Customer Name" }
//    → { folderId, folderName, uploadPageUrl }
//
//  GET  /api/zoho/create-photo-request?action=status&id=<folderId>
//    → { name, photoCount, files: [ { name, uploadedAt } ] }
//    (lets the upload page see what the customer has already sent, so the
//    same link can be re-sent to ask for more photos without demanding the
//    mandatory ones a second time)
//
//  PUT  /api/zoho/create-photo-request  { folderId, filename, dataBase64 }
//    → { success: true }
//    (dataBase64 is a data URL or raw base64 string of the photo, sent by
//    hotwater/upload-photos.html after client-side compression)

import { sendHostingerMail } from '../../lib/hostinger-mail.js';
import { postGhlNoteByPhone, findGhlContactIdByPhone } from '../../lib/ghl-note.js';
import { ensureOpportunityInStage } from '../../lib/ghl-opportunity.js';

// Pipeline this feature moves opportunities on. No literal pipeline ID is
// committed to code (see lib/ghl-opportunity.js) — HWS_PIPELINE_ID lets an
// exact match be configured in Vercel, with the name hint as a fallback.
const HWS_PIPELINE_ID_ENV = process.env.HWS_PIPELINE_ID || '';
const HWS_PIPELINE_NAME_HINTS = ['hws pipeline', 'hot water'];
const AIRCON_PIPELINE_ID_ENV = process.env.AIRCON_PIPELINE_ID || '';
const AIRCON_PIPELINE_NAME_HINTS = ['air con', 'aircon', 'air-con', 'air conditioning', 'hvac'];

const normaliseProduct = value => String(value || '').trim().toLowerCase() === 'aircon' ? 'aircon' : 'hws';

function productConfig(value) {
  const product = normaliseProduct(value);
  if (product === 'aircon') {
    return {
      product,
      parentId: process.env.ZOHO_WORKDRIVE_AIRCON_PARENT_FOLDER_ID,
      uploadPath: '/ac',
      label: 'VIC Aircon',
      opportunityName: who => `Aircon - ${who}`,
      pipelineIdEnv: AIRCON_PIPELINE_ID_ENV,
      pipelineNameHints: AIRCON_PIPELINE_NAME_HINTS,
    };
  }
  return {
    product,
    parentId: process.env.ZOHO_WORKDRIVE_PARENT_FOLDER_ID,
    uploadPath: '/u',
    label: 'Hot Water',
    opportunityName: who => `Hot Water — ${who}`,
    pipelineIdEnv: HWS_PIPELINE_ID_ENV,
    pipelineNameHints: HWS_PIPELINE_NAME_HINTS,
  };
}

const REGION = 'com.au';
const ACCOUNTS_BASE = `https://accounts.zoho.${REGION}`;
const API_BASE = `https://www.zohoapis.${REGION}/workdrive/api/v1`;
// File uploads go to the workdrive.zoho.<region> host directly (not the
// www.zohoapis.<region>/workdrive prefix used for metadata calls above) —
// confirmed against the same host the WorkDrive web client itself calls
// for its own upload flow (workdrive.zoho.com.au/api/v1/checkfilename).
const UPLOAD_BASE = `https://workdrive.zoho.${REGION}/api/v1`;

async function getAccessToken() {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  });
  const r = await fetch(`${ACCOUNTS_BASE}/oauth/v2/token`, { method: 'POST', body: params });
  const data = await r.json();
  if (!data.access_token) throw new Error(`token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// List a folder's children, paging through until exhausted. The JSON:API page
// params must be percent-encoded — sending literal `page[limit]` brackets gets
// a 400 back from Zoho — and the per-page maximum is 50.
const PAGE_SIZE = 50;

async function listChildren(accessToken, parentId, maxPages = 10) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const qs = `page%5Blimit%5D=${PAGE_SIZE}&page%5Boffset%5D=${page * PAGE_SIZE}`;
    const r = await fetch(`${API_BASE}/files/${encodeURIComponent(parentId)}/files?${qs}`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: 'application/vnd.api+json' },
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`HTTP ${r.status} — ${text.slice(0, 200)}`);
    }
    const data = await r.json();
    const batch = data.data || [];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

// Look for an existing subfolder of the same name, so repeat requests for one
// customer keep landing in that customer's single folder instead of spawning a
// new one per click. Best-effort: if the lookup fails for any reason we fall
// through to creating a folder rather than blocking the request.
async function findFolderByName(accessToken, name, parentId) {
  try {
    const children = await listChildren(accessToken, parentId);
    const wanted = name.trim().toLowerCase();
    const match = children.find(f =>
      f?.attributes?.is_folder !== false &&
      String(f?.attributes?.name || '').trim().toLowerCase() === wanted
    );
    return match ? match.id : null;
  } catch {
    return null;
  }
}

// The customer's phone is parked in the folder's own description field, which
// saves keeping a separate table just to map folders back to people. The
// tracker reads it to look the customer up in GHL and to text them a reminder.
// Best-effort throughout: a folder without one simply shows no pipeline.
async function setFolderPhone(accessToken, folderId, phone) {
  try {
    await fetch(`${API_BASE}/files/${encodeURIComponent(folderId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { attributes: { description: `phone:${phone}` }, type: 'files' } }),
    });
  } catch (e) {
    console.error('[Zoho] could not store phone on folder:', e.message);
  }
}

// Aircon assessment answers are stored on the folder as well as in a small
// text file. The description lets a re-opened upload link restore the answers;
// the text file keeps the details immediately visible to staff in WorkDrive.
async function setFolderAssessment(accessToken, folderId, phone, assessment = {}) {
  const oneLine = value => String(value || '').replace(/[\r\n]+/g, ' ').trim();
  const fullName = oneLine(assessment.fullName).slice(0, 160);
  const email = oneLine(assessment.email).slice(0, 254);
  const address = oneLine(assessment.address).slice(0, 500);
  const storeys = oneLine(assessment.storeys).slice(0, 80);
  const boundedCount = value => {
    const count = Number.parseInt(String(value || ''), 10);
    return Number.isInteger(count) && count >= 1 && count <= 7 ? String(count) : '';
  };
  const units = boundedCount(assessment.units);
  const rooms = boundedCount(assessment.rooms);
  const roof = oneLine(assessment.roof).slice(0, 80);
  const commentLines = Object.entries(assessment.comments || {})
    .filter(([key, value]) => /^(switchboard|room-[1-7]|utility-bill|extra-\d+)$/.test(key) && oneLine(value))
    .map(([key, value]) => `comment_${key.replace(/-/g, '_')}:${oneLine(value).slice(0, 300)}`);
  const lines = [
    phone ? `phone:${phone}` : '',
    'product:aircon',
    fullName ? `full_name:${fullName}` : '',
    email ? `email:${email}` : '',
    address ? `address:${address}` : '',
    storeys ? `storeys:${storeys}` : '',
    units ? `units:${units}` : '',
    rooms ? `rooms:${rooms}` : '',
    roof ? `roof:${roof}` : '',
    ...commentLines,
  ].filter(Boolean);
  try {
    await fetch(`${API_BASE}/files/${encodeURIComponent(folderId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { attributes: { description: lines.join('\n') }, type: 'files' } }),
    });
  } catch (e) {
    console.error('[Zoho] could not store aircon assessment on folder:', e.message);
  }
}

const phoneFromDescription = d => {
  const m = /phone:(\+?[\d\s()-]{6,})/i.exec(String(d || ''));
  return m ? m[1].trim() : '';
};

const assessmentFromDescription = d => {
  const text = String(d || '');
  const pick = key => (new RegExp(`(?:^|\\n)${key}:([^\\n]+)`, 'i').exec(text) || [])[1]?.trim() || '';
  const units = Number(pick('units')) || null;
  const rooms = Number(pick('rooms')) || null;
  const comments = {};
  for (const match of text.matchAll(/(?:^|\n)comment_([a-z0-9_]+):([^\n]+)/gi)) {
    comments[match[1].toLowerCase().replace(/_/g, '-')] = match[2].trim();
  }
  return {
    fullName: pick('full_name'),
    email: pick('email'),
    address: pick('address'),
    storeys: pick('storeys'),
    units,
    rooms,
    roof: pick('roof'),
    comments,
  };
};

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function photoCommentRows(assessment) {
  const comments = assessment?.comments && typeof assessment.comments === 'object' ? assessment.comments : {};
  const roomCount = Math.max(0, Math.min(7, Number(assessment?.rooms) || 0));
  const rows = [];
  if (comments.switchboard) rows.push(['Switchboard comments', comments.switchboard]);
  for (let room = 1; room <= roomCount; room += 1) {
    const comment = comments[`room-${room}`];
    if (comment) rows.push([`Room ${room} name and comments`, comment]);
  }
  if (comments['utility-bill']) rows.push(['Rates notice or utility bill comments', comments['utility-bill']]);
  Object.keys(comments)
    .filter(key => /^extra-\d+$/.test(key) && comments[key])
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))
    .forEach(key => rows.push([`Additional photo ${Number(key.slice(6))} comments`, comments[key]]));
  return rows;
}

function photoUploadEmailHtml({ config, who, what, folderUrl, folderId, assessment, uploadCount }) {
  const isAircon = config.product === 'aircon';
  const answers = isAircon ? [
    ['Full name', assessment?.fullName || who],
    ['Email address', assessment?.email || 'Not provided'],
    ['Property address', assessment?.address || 'Not provided'],
    ['Property', assessment?.storeys || 'Not answered'],
    ['Aircon units', assessment?.units || 'Not answered'],
    ['Rooms', assessment?.rooms || 'Not answered'],
    ['Roof', assessment?.roof || 'Not answered'],
    ...photoCommentRows(assessment),
    ['New photos uploaded', Number(uploadCount) || 0],
  ] : [
    ['Customer', who],
    ['New photos uploaded', Number(uploadCount) || 0],
  ];
  const rows = answers.map(([label, value], index) => `
    <tr>
      <td style="padding:11px 14px;border-top:${index ? '1px solid #e8edf3' : '0'};color:#64748b;font-size:13px;width:42%;">${escapeHtml(label)}</td>
      <td style="padding:11px 14px;border-top:${index ? '1px solid #e8edf3' : '0'};color:#172033;font-size:13px;font-weight:700;">${escapeHtml(value)}</td>
    </tr>`).join('');
  const action = folderUrl
    ? `<a href="${escapeHtml(folderUrl)}" style="display:inline-block;background:#1769aa;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:7px;font-size:14px;font-weight:700;">Open photos in WorkDrive</a>`
    : `<div style="font-size:12px;color:#64748b;">WorkDrive folder ID: ${escapeHtml(folderId)}</div>`;
  const address = isAircon && assessment?.address ? escapeHtml(assessment.address) : '';

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f7fa" style="background:#f4f7fa;font-family:Arial,Helvetica,sans-serif;">
  <tr><td style="padding:30px 14px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" align="center" bgcolor="#ffffff" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dfe6ee;border-radius:12px;overflow:hidden;">
      <tr><td bgcolor="#1769aa" style="height:6px;background:#1769aa;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:26px 28px 12px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#1769aa;">${escapeHtml(config.label)} photo assessment</div>
        <div style="margin-top:8px;font-size:23px;line-height:1.25;font-weight:700;color:#172033;">Photos received from ${escapeHtml(who)}</div>
        ${address ? `<div style="margin-top:7px;font-size:14px;line-height:1.5;color:#64748b;">${address}</div>` : ''}
      </td></tr>
      <tr><td style="padding:6px 28px 18px;font-size:14px;line-height:1.6;color:#3f4b5f;">${escapeHtml(who)} ${escapeHtml(what)}. Their submitted details are below.</td></tr>
      <tr><td style="padding:0 28px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;border:1px solid #e1e7ee;border-radius:8px;overflow:hidden;">${rows}</table>
      </td></tr>
      <tr><td style="padding:0 28px 28px;">${action}</td></tr>
      <tr><td bgcolor="#f8fafc" style="padding:13px 28px;border-top:1px solid #e8edf3;background:#f8fafc;font-size:11px;color:#94a3b8;">Goldsure Portal photo notification</td></tr>
    </table>
  </td></tr>
</table>`;
}

function photoUploadEmailText({ config, who, what, folderUrl, folderId, assessment, uploadCount }) {
  const lines = [`${config.label} photo assessment`, '', `${who} ${what}.`];
  if (config.product === 'aircon') {
    lines.push(
      '',
      `Full name: ${assessment?.fullName || who}`,
      `Email address: ${assessment?.email || 'Not provided'}`,
      `Property address: ${assessment?.address || 'Not provided'}`,
      `Property: ${assessment?.storeys || 'Not answered'}`,
      `Aircon units: ${assessment?.units || 'Not answered'}`,
      `Rooms: ${assessment?.rooms || 'Not answered'}`,
      `Roof: ${assessment?.roof || 'Not answered'}`,
    );
    for (const [label, value] of photoCommentRows(assessment)) lines.push(`${label}: ${value}`);
  }
  lines.push(`New photos uploaded: ${Number(uploadCount) || 0}`, '', folderUrl || `WorkDrive folder ID: ${folderId}`);
  return lines.join('\n');
}

function airconAssessmentError(assessment) {
  const fullName = String(assessment?.fullName || '').trim();
  const email = String(assessment?.email || '').trim();
  const address = String(assessment?.address || '').trim();
  const units = Number(assessment?.units);
  const rooms = Number(assessment?.rooms);
  if (!/^\S+(?:\s+\S+)+$/.test(fullName)) return 'full name is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'a valid email address is required';
  if (address.length < 6) return 'property address is required';
  if (!['Single storey', 'Double storey'].includes(assessment?.storeys)) return 'property storeys are required';
  if (!Number.isInteger(units) || units < 1 || units > 7) return 'aircon units must be between 1 and 7';
  if (!Number.isInteger(rooms) || rooms < 1 || rooms > 7) return 'rooms must be between 1 and 7';
  if (!['Tile roof', 'Tin roof'].includes(assessment?.roof)) return 'roof type is required';
  return '';
}

// Ask Zoho for the folder's own canonical link rather than constructing one —
// a hand-built /folder/<id> URL lands in a login redirect loop. Falls back to
// null so callers can degrade to whatever they can build themselves.
async function getFolderLink(accessToken, folderId) {
  try {
    const r = await fetch(`${API_BASE}/files/${encodeURIComponent(folderId)}`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: 'application/vnd.api+json' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const a = data?.data?.attributes || {};
    return a.permalink || a.perma_link || a.resource_url || data?.data?.links?.self || null;
  } catch {
    return null;
  }
}

async function createFolder(accessToken, name, parentId) {
  const r = await fetch(`${API_BASE}/files`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { attributes: { name, parent_id: parentId }, type: 'files' } }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`folder create failed: ${JSON.stringify(data)}`);
  return data.data.id;
}

async function uploadFile(accessToken, folderId, filename, buffer) {
  const form = new FormData();
  form.append('content', new Blob([buffer]), filename);
  form.append('filename', filename);
  form.append('parent_id', folderId);
  form.append('override-name-exist', 'true');

  const r = await fetch(`${UPLOAD_BASE}/upload`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    body: form,
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!r.ok || !data) {
    throw new Error(`file upload failed: HTTP ${r.status} — ${text.slice(0, 300)}`);
  }
  return data;
}

function base64ToBuffer(dataBase64) {
  const commaIdx = dataBase64.indexOf(',');
  const raw = dataBase64.startsWith('data:') && commaIdx !== -1 ? dataBase64.slice(commaIdx + 1) : dataBase64;
  return Buffer.from(raw, 'base64');
}

export default async function handler(req, res) {
  const requestedProduct = req.method === 'GET' ? req.query.product : req.body?.product;
  const config = productConfig(requestedProduct);
  const { parentId } = config;
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET || !process.env.ZOHO_REFRESH_TOKEN || !parentId) {
    return res.status(500).json({ error: `${config.label} WorkDrive storage is not configured` });
  }

  // GET ?action=list → every customer folder with its photo count, for the
  // tracker page. Read straight from WorkDrive so it can't drift out of sync
  // with what's actually been uploaded (including photos added by hand).
  if (req.method === 'GET' && req.query.action === 'list') {
    try {
      const accessToken = await getAccessToken();
      const children = await listChildren(accessToken, parentId);
      const folders = children
        .filter(f => f?.attributes?.is_folder !== false)
        .map(f => {
          const a = f.attributes || {};
          return {
            id: f.id,
            name: a.name || '',
            phone: phoneFromDescription(a.description),
            assessment: assessmentFromDescription(a.description),
            photoCount: a.storage_info?.files_count ?? null,
            createdAt: a.created_time_in_millisecond || null,
            modifiedAt: a.modified_time_in_millisecond || null,
            link: a.permalink || null,
          };
        })
        .sort((x, y) => (y.modifiedAt || 0) - (x.modifiedAt || 0));
      return res.status(200).json({ folders });
    } catch (err) {
      console.error('Zoho list failed:', err.message);
      return res.status(502).json({ error: 'Zoho list failed', detail: err.message });
    }
  }

  // GET ?action=folder&id=<folderId> → that folder's name. Lets the upload
  // page greet the customer by name without carrying it in the link, keeping
  // the SMS short.
  if (req.method === 'GET' && req.query.action === 'folder') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    try {
      const accessToken = await getAccessToken();
      const r = await fetch(`${API_BASE}/files/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: 'application/vnd.api+json' },
      });
      if (!r.ok) {
        const text = await r.text();
        return res.status(404).json({ error: 'not found', status: r.status, detail: text.slice(0, 300) });
      }
      const data = await r.json();
      return res.status(200).json({ name: data?.data?.attributes?.name || '' });
    } catch (err) {
      return res.status(502).json({ error: 'lookup failed', detail: err.message });
    }
  }

  // GET ?action=status&id=<folderId> → what that customer has already sent.
  // The upload page uses this to tick off the photos it already holds, which
  // is what lets the very same link be re-sent when we need more: the customer
  // sees what's in already and only has to add what's new.
  if (req.method === 'GET' && req.query.action === 'status') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    try {
      const accessToken = await getAccessToken();
      const r = await fetch(`${API_BASE}/files/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: 'application/vnd.api+json' },
      });
      if (!r.ok) {
        const text = await r.text();
        return res.status(404).json({ error: 'not found', status: r.status, detail: text.slice(0, 300) });
      }
      const meta = await r.json();
      const name = meta?.data?.attributes?.name || '';

      // File listing is best-effort: if it fails the page still works, it just
      // falls back to asking for everything.
      let files = [];
      try {
        files = (await listChildren(accessToken, id))
          .filter(f => f?.attributes?.is_folder === false)
          .map(f => ({
            name: f.attributes?.name || '',
            uploadedAt: f.attributes?.created_time_in_millisecond || null,
          }));
      } catch (listErr) {
        console.error('[Zoho] status file list failed:', listErr.message);
      }

      return res.status(200).json({
        name,
        photoCount: files.filter(f => /\.(jpe?g|png|webp|heic)$/i.test(f.name)).length,
        files,
        assessment: assessmentFromDescription(meta?.data?.attributes?.description),
      });
    } catch (err) {
      return res.status(502).json({ error: 'lookup failed', detail: err.message });
    }
  }

  // GET ?debug=<folderId> → raw Zoho metadata for that folder, so the correct
  // link field can be identified without guessing. Diagnostic only.
  if (req.method === 'GET' && req.query.debug) {
    try {
      const accessToken = await getAccessToken();
      const r = await fetch(`${API_BASE}/files/${encodeURIComponent(req.query.debug)}`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: 'application/vnd.api+json' },
      });
      const text = await r.text();
      return res.status(200).json({ status: r.status, body: text.slice(0, 4000) });
    } catch (err) {
      return res.status(502).json({ error: 'lookup failed', detail: err.message });
    }
  }

  // POST → create a per-customer folder, return the upload page link
  if (req.method === 'POST') {
    const { name, phone } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

    try {
      const accessToken = await getAccessToken();
      // One folder per customer, reused across requests, so asking the same
      // customer for photos twice doesn't split them up. The full name alone
      // isn't unique — two different "John Smith" customers would otherwise
      // share a folder and have their photos mixed together — so the last 4
      // digits of the mobile are appended when we have one.
      const last4 = String(phone || '').replace(/\D/g, '').slice(-4);
      const folderName = last4 ? `${name.trim()} (${last4})` : name.trim();
      const existingId = await findFolderByName(accessToken, folderName, parentId);
      const folderId = existingId || await createFolder(accessToken, folderName, parentId);
      // On reuse, say how many photos are already in there. The office then
      // knows the same link is going out as a top-up request rather than a
      // first ask — the upload page works that out for itself as well.
      let photoCount = 0;
      if (existingId) {
        try {
          photoCount = (await listChildren(accessToken, existingId))
            .filter(f => f?.attributes?.is_folder === false).length;
        } catch { photoCount = 0; }
      }
      // Written on reuse too, so folders made before this existed pick the
      // number up the next time a link is generated for that customer.
      if (phone) await setFolderPhone(accessToken, folderId, phone);
      const baseUrl = process.env.SITE_URL || 'https://portal.goldsure.com.au';
      // Kept compact — this goes out by SMS. /u rewrites to the upload page,
      // `p` carries the phone (needed to match the upload back to a GHL
      // contact) and `n` the first name for the greeting.
      const phoneParam = phone ? `&p=${encodeURIComponent(phone)}` : '';
      // From the customer's name, not the folder name, so the phone-number
      // suffix never leaks into the greeting.
      const firstName = name.trim().split(/\s+/)[0];
      const nameParam = firstName ? `&n=${encodeURIComponent(firstName)}` : '';
      const uploadPageUrl = `${baseUrl}${config.uploadPath}?f=${encodeURIComponent(folderId)}${nameParam}${phoneParam}`;
      return res.status(200).json({ folderId, folderName, uploadPageUrl, product: config.product, reused: Boolean(existingId), photoCount });
    } catch (err) {
      console.error('Zoho folder create failed:', err.message);
      return res.status(502).json({ error: 'Zoho request failed', detail: err.message });
    }
  }

  // PUT → receive a photo (base64) and push it into the given folder
  if (req.method === 'PUT') {
    const { folderId, filename, dataBase64, customerName, phone, notify = true, followUp = false, uploadCount = 0, assessment } = req.body || {};
    if (!folderId || !dataBase64) return res.status(400).json({ error: 'folderId and dataBase64 are required' });
    if (config.product === 'aircon') {
      const assessmentError = airconAssessmentError(assessment);
      if (assessmentError) return res.status(400).json({ error: assessmentError });
    }

    try {
      const accessToken = await getAccessToken();
      const buffer = base64ToBuffer(dataBase64);
      await uploadFile(accessToken, folderId, filename || `photo-${Date.now()}.jpg`, buffer);
      if (config.product === 'aircon' && assessment) {
        await setFolderAssessment(accessToken, folderId, phone, assessment);
      }

      // Notify the team so uploads don't have to be checked for manually.
      // The upload page sends a set of photos one at a time and flags only the
      // last one, so a four-photo submission produces one email, not four.
      // Best-effort: a mail failure must never fail the customer's upload.
      if (!notify) return res.status(200).json({ success: true });

      try {
        const who = String(customerName || '').replace(/[\r\n]+/g, ' ').trim() || 'A customer';
        const folderUrl = await getFolderLink(accessToken, folderId);
        // A top-up sent through the same link reads differently to a first
        // submission — the team needs to know these are extras added to a
        // folder they may have already looked at.
        const n = Number(uploadCount) || 0;
        const many = n === 1 ? '1 photo' : `${n} photos`;
        const what = followUp
          ? `has sent through ${n ? many + ' more' : 'more photos'}`
          : 'has uploaded their site photos';

        // Log it against the GHL contact too, so it shows up where the rest of
        // the customer's history lives. Also best-effort.
        if (phone) {
          const notePrefix = config.product === 'aircon' ? '[Aircon Photo Upload]' : '[Photo Upload]';
          const addressLine = config.product === 'aircon' && assessment?.address
            ? `\nProperty: ${String(assessment.address).replace(/[\r\n]+/g, ' ').trim()}`
            : '';
          const noteBody = folderUrl
            ? `${notePrefix}\n${who} ${what}.${addressLine}\nView them here: ${folderUrl}`
            : `${notePrefix}\n${who} ${what} to their WorkDrive folder (${folderId}).${addressLine}`;
          await postGhlNoteByPhone(phone, noteBody);

          // Move the deal to "Photos Received" on the HWS pipeline too, not
          // just a note — that's what actually shows up on the pipeline board.
          try {
            const apiKey = process.env.GHL_API_KEY;
            const locationId = process.env.GHL_LOCATION_ID;
            if (apiKey && locationId) {
              const contactId = await findGhlContactIdByPhone(phone, { apiKey, locationId });
              if (contactId) {
                await ensureOpportunityInStage({
                  contactId,
                  opportunityName: config.opportunityName(who),
                  pipelineIdEnv: config.pipelineIdEnv,
                  nameHints: config.pipelineNameHints,
                  stageNames: ['Photos Received'],
                });
              }
            }
          } catch (stageErr) {
            console.error('[Zoho upload] GHL stage update failed:', stageErr.message);
          }
        }

        const emailData = { config, who, what, folderUrl, folderId, assessment, uploadCount: n };
        await sendHostingerMail({
          to: ['vignesh@goldsure.com.au', 'david@goldsure.com.au'],
          displayName: 'Goldsure Portal',
          subject: followUp
            ? `Additional ${config.label} photos uploaded - ${who}`
            : `New ${config.label} photos uploaded - ${who}`,
          text: photoUploadEmailText(emailData),
          html: photoUploadEmailHtml(emailData),
        });
      } catch (mailErr) {
        console.error('[Zoho upload] notification email failed:', mailErr.message);
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Zoho photo upload failed:', err.message);
      return res.status(502).json({ error: 'Zoho upload failed', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
