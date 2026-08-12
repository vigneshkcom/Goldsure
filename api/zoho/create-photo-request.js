// api/zoho/create-photo-request.js
// Per-customer WorkDrive photo collection. Avoids Zoho's external-share-link
// permission system entirely (its role_id enumeration isn't reliably
// discoverable) by instead uploading files server-side into a per-customer
// folder, via our own upload page.
//
//  POST /api/zoho/create-photo-request  { name: "Customer Name" }
//    → { folderId, folderName, uploadPageUrl }
//
//  PUT  /api/zoho/create-photo-request  { folderId, filename, dataBase64 }
//    → { success: true }
//    (dataBase64 is a data URL or raw base64 string of the photo, sent by
//    hotwater/upload-photos.html after client-side compression)

import { sendHostingerMail } from '../../lib/hostinger-mail.js';
import { postGhlNoteByPhone } from '../../lib/ghl-note.js';

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

// Look for an existing subfolder of the same name, so repeat requests for one
// customer keep landing in that customer's single folder instead of spawning a
// new one per click. Best-effort: if the lookup fails for any reason we fall
// through to creating a folder rather than blocking the request.
async function findFolderByName(accessToken, name, parentId) {
  try {
    const r = await fetch(`${API_BASE}/files/${encodeURIComponent(parentId)}/files?page[limit]=100`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: 'application/vnd.api+json' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const wanted = name.trim().toLowerCase();
    const match = (data.data || []).find(f =>
      f?.attributes?.is_folder !== false &&
      String(f?.attributes?.name || '').trim().toLowerCase() === wanted
    );
    return match ? match.id : null;
  } catch {
    return null;
  }
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
  const parentId = process.env.ZOHO_WORKDRIVE_PARENT_FOLDER_ID;
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET || !process.env.ZOHO_REFRESH_TOKEN || !parentId) {
    return res.status(500).json({ error: 'Zoho credentials not configured' });
  }

  // GET ?action=list → every customer folder with its photo count, for the
  // tracker page. Read straight from WorkDrive so it can't drift out of sync
  // with what's actually been uploaded (including photos added by hand).
  if (req.method === 'GET' && req.query.action === 'list') {
    try {
      const accessToken = await getAccessToken();
      const r = await fetch(`${API_BASE}/files/${encodeURIComponent(parentId)}/files?page[limit]=200`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: 'application/vnd.api+json' },
      });
      if (!r.ok) {
        const text = await r.text();
        return res.status(502).json({ error: 'Zoho list failed', status: r.status, detail: text.slice(0, 300) });
      }
      const data = await r.json();
      const folders = (data.data || [])
        .filter(f => f?.attributes?.is_folder !== false)
        .map(f => {
          const a = f.attributes || {};
          return {
            id: f.id,
            name: a.name || '',
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
      // One folder per customer, reused across requests — no date suffix, so
      // asking the same customer for photos twice doesn't split them up.
      const folderName = name.trim();
      const existingId = await findFolderByName(accessToken, folderName, parentId);
      const folderId = existingId || await createFolder(accessToken, folderName, parentId);
      const baseUrl = process.env.SITE_URL || 'https://portal.goldsure.com.au';
      // The phone rides along so the upload can be noted against the right GHL
      // contact when it comes back in.
      const phoneParam = phone ? `&phone=${encodeURIComponent(phone)}` : '';
      const uploadPageUrl = `${baseUrl}/hotwater/upload-photos.html?folder=${encodeURIComponent(folderId)}&name=${encodeURIComponent(folderName)}${phoneParam}`;
      return res.status(200).json({ folderId, folderName, uploadPageUrl, reused: Boolean(existingId) });
    } catch (err) {
      console.error('Zoho folder create failed:', err.message);
      return res.status(502).json({ error: 'Zoho request failed', detail: err.message });
    }
  }

  // PUT → receive a photo (base64) and push it into the given folder
  if (req.method === 'PUT') {
    const { folderId, filename, dataBase64, customerName, phone } = req.body || {};
    if (!folderId || !dataBase64) return res.status(400).json({ error: 'folderId and dataBase64 are required' });

    try {
      const accessToken = await getAccessToken();
      const buffer = base64ToBuffer(dataBase64);
      await uploadFile(accessToken, folderId, filename || `photo-${Date.now()}.jpg`, buffer);

      // Notify the team so uploads don't have to be checked for manually.
      // Best-effort: a mail failure must never fail the customer's upload.
      try {
        const who = (customerName || '').trim() || 'A customer';
        const folderUrl = await getFolderLink(accessToken, folderId);

        // Log it against the GHL contact too, so it shows up where the rest of
        // the customer's history lives. Also best-effort.
        if (phone) {
          const noteBody = folderUrl
            ? `[Photo Upload]\n${who} has uploaded a photo. View it here: ${folderUrl}`
            : `[Photo Upload]\n${who} has uploaded a photo to their WorkDrive folder (${folderId}).`;
          await postGhlNoteByPhone(phone, noteBody);
        }

        const linkHtml = folderUrl
          ? `<p><a href="${folderUrl}">Open their folder in WorkDrive</a></p>`
          : `<p style="color:#666;font-size:13px;">Folder ID: ${folderId} — open WorkDrive and search for “${who}”.</p>`;
        await sendHostingerMail({
          to: ['vignesh@goldsure.com.au', 'david@goldsure.com.au'],
          displayName: 'Goldsure Portal',
          subject: `New photo uploaded — ${who}`,
          html: `<p><strong>${who}</strong> has uploaded a photo.</p>
                 ${linkHtml}
                 <p style="color:#666;font-size:13px;">File: ${filename || 'photo.jpg'}</p>`,
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
