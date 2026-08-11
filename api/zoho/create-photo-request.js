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

const REGION = 'com.au';
const ACCOUNTS_BASE = `https://accounts.zoho.${REGION}`;
const API_BASE = `https://www.zohoapis.${REGION}/workdrive/api/v1`;
// Zoho routes file content (uploads/downloads) through a separate
// "content" subdomain from the main metadata API — unverified against a
// live account; if uploads fail with a 404/routing error, this is the
// first thing to check against Zoho's current API docs.
const UPLOAD_BASE = `https://content.zohoapis.${REGION}/workdrive/api/v1`;

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

  // POST → create a per-customer folder, return the upload page link
  if (req.method === 'POST') {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

    try {
      const accessToken = await getAccessToken();
      const folderName = `${name.trim()} - ${new Date().toISOString().slice(0, 10)}`;
      const folderId = await createFolder(accessToken, folderName, parentId);
      const baseUrl = process.env.SITE_URL || 'https://portal.goldsure.com.au';
      const uploadPageUrl = `${baseUrl}/hotwater/upload-photos.html?folder=${encodeURIComponent(folderId)}&name=${encodeURIComponent(name.trim())}`;
      return res.status(200).json({ folderId, folderName, uploadPageUrl });
    } catch (err) {
      console.error('Zoho folder create failed:', err.message);
      return res.status(502).json({ error: 'Zoho request failed', detail: err.message });
    }
  }

  // PUT → receive a photo (base64) and push it into the given folder
  if (req.method === 'PUT') {
    const { folderId, filename, dataBase64 } = req.body || {};
    if (!folderId || !dataBase64) return res.status(400).json({ error: 'folderId and dataBase64 are required' });

    try {
      const accessToken = await getAccessToken();
      const buffer = base64ToBuffer(dataBase64);
      await uploadFile(accessToken, folderId, filename || `photo-${Date.now()}.jpg`, buffer);
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Zoho photo upload failed:', err.message);
      return res.status(502).json({ error: 'Zoho upload failed', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
