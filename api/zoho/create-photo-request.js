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

const phoneFromDescription = d => {
  const m = /phone:(\+?[\d\s()-]{6,})/i.exec(String(d || ''));
  return m ? m[1].trim() : '';
};

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
      const children = await listChildren(accessToken, parentId);
      const folders = children
        .filter(f => f?.attributes?.is_folder !== false)
        .map(f => {
          const a = f.attributes || {};
          return {
            id: f.id,
            name: a.name || '',
            phone: phoneFromDescription(a.description),
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

      return res.status(200).json({ name, photoCount: files.length, files });
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
      const uploadPageUrl = `${baseUrl}/u?f=${encodeURIComponent(folderId)}${nameParam}${phoneParam}`;
      return res.status(200).json({ folderId, folderName, uploadPageUrl, reused: Boolean(existingId), photoCount });
    } catch (err) {
      console.error('Zoho folder create failed:', err.message);
      return res.status(502).json({ error: 'Zoho request failed', detail: err.message });
    }
  }

  // PUT → receive a photo (base64) and push it into the given folder
  if (req.method === 'PUT') {
    const { folderId, filename, dataBase64, customerName, phone, notify = true, followUp = false, uploadCount = 0 } = req.body || {};
    if (!folderId || !dataBase64) return res.status(400).json({ error: 'folderId and dataBase64 are required' });

    try {
      const accessToken = await getAccessToken();
      const buffer = base64ToBuffer(dataBase64);
      await uploadFile(accessToken, folderId, filename || `photo-${Date.now()}.jpg`, buffer);

      // Notify the team so uploads don't have to be checked for manually.
      // The upload page sends a set of photos one at a time and flags only the
      // last one, so a four-photo submission produces one email, not four.
      // Best-effort: a mail failure must never fail the customer's upload.
      if (!notify) return res.status(200).json({ success: true });

      try {
        const who = (customerName || '').trim() || 'A customer';
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
          const noteBody = folderUrl
            ? `[Photo Upload]\n${who} ${what}. View them here: ${folderUrl}`
            : `[Photo Upload]\n${who} ${what} to their WorkDrive folder (${folderId}).`;
          await postGhlNoteByPhone(phone, noteBody);
        }

        const linkHtml = folderUrl
          ? `<p><a href="${folderUrl}">Open their folder in WorkDrive</a></p>`
          : `<p style="color:#666;font-size:13px;">Folder ID: ${folderId} — open WorkDrive and search for “${who}”.</p>`;
        await sendHostingerMail({
          to: ['vignesh@goldsure.com.au', 'david@goldsure.com.au'],
          displayName: 'Goldsure Portal',
          subject: followUp ? `Additional photos uploaded — ${who}` : `New photos uploaded — ${who}`,
          html: `<p><strong>${who}</strong> ${what}.</p>
                 ${linkHtml}`,
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
