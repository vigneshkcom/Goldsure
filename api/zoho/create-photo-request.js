// api/zoho/create-photo-request.js
// Creates a per-customer WorkDrive folder and a no-login external upload
// link, so a customer can submit install-site photos (switchboard, existing
// units, compliance plate) via a link sent by SMS/email — no Zoho account
// needed on their end.
//
//  POST /api/zoho/create-photo-request  { name: "Customer Name" }
//    → { folderId, folderName, uploadLink }

const REGION = process.env.ZOHO_REGION || 'com.au';
const ACCOUNTS_BASE = `https://accounts.zoho.${REGION}`;
const API_BASE = `https://www.zohoapis.${REGION}/workdrive/api/v1`;

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

// Zoho's "Collect Files" no-login upload links are created the same way as a
// regular external share link, just with an uploader-only role_id instead of
// a viewer/editor one. The role_id enumeration is account-specific — this
// default is a placeholder. If link creation fails or the resulting link
// grants more than upload-only access, fetch the real id via
// GET /workdrive/api/v1/links/permissions (bearer = access token from
// getAccessToken()) and set ZOHO_UPLOAD_ROLE_ID in the environment instead.
const UPLOAD_ROLE_ID = process.env.ZOHO_UPLOAD_ROLE_ID || '34';

async function createUploadLink(accessToken, folderId) {
  const r = await fetch(`${API_BASE}/links`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        attributes: { resource_id: folderId, link_name: 'Photo upload', role_id: UPLOAD_ROLE_ID },
        type: 'links',
      },
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`link create failed: ${JSON.stringify(data)}`);
  return data.data.attributes.url || data.data.attributes.link;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

  const parentId = process.env.ZOHO_WORKDRIVE_PARENT_FOLDER_ID;
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET || !process.env.ZOHO_REFRESH_TOKEN || !parentId) {
    return res.status(500).json({ error: 'Zoho credentials not configured' });
  }

  try {
    const accessToken = await getAccessToken();
    const folderName = `${name.trim()} - ${new Date().toISOString().slice(0, 10)}`;
    const folderId = await createFolder(accessToken, folderName, parentId);
    const uploadLink = await createUploadLink(accessToken, folderId);
    return res.status(200).json({ folderId, folderName, uploadLink });
  } catch (err) {
    console.error('Zoho photo-request failed:', err.message);
    return res.status(502).json({ error: 'Zoho request failed', detail: err.message });
  }
}
