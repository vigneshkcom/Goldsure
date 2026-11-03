import { createHmac, timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { getAccessToken, listChildren, createFolder, uploadFile } from '../api/zoho/create-photo-request.js';
import { hasHostingerMailConfig, sendHostingerMail } from './hostinger-mail.js';
import { reserveReport, updateReport } from './beachcomber-report-history.js';

const API = 'https://www.zohoapis.com.au/workdrive/api/v1';
const RECIPIENT = 'vignesh@goldsure.com.au';
const ROOT_NAME = 'Beachcomber Resort - Smoke Alarm Reports';
const buckets = new Map();
const pending = new Map();
export const choices = {
  sound: { loud: 'Loud repeating alarm', chirp: 'Short chirps at intervals', silent: 'No sound / indicator only', other: 'Other / unsure' },
  trigger: { cooking: 'Cooking fumes', steam: 'Shower / steam', dust: 'Dust / cleaning', none: 'No obvious trigger', unsure: 'Unsure' },
  outcome: { stopped: 'Stopped and returned to normal', ongoing: 'Still happening / returned again', fault: 'Possible fault warning', information: 'Information only' },
};
const clean = (value, max) => String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const secret = () => process.env.ZOHO_CLIENT_SECRET;
const sign = value => createHmac('sha256', secret()).update(value).digest('base64url');
export function newSession(now = Date.now()) {
  const payload = `${randomUUID()}.${now}`;
  return `${payload}.${sign(payload)}`;
}
export function readSession(token, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !/^[a-f0-9-]{36}$/.test(parts[0]) || !/^\d{13}$/.test(parts[1])) throw new Error('Please refresh the page and try again.');
  const expected = Buffer.from(sign(parts.slice(0,2).join('.')));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual) || now-Number(parts[1]) > 3600000 || now < Number(parts[1])-30000) throw new Error('Your session expired. Please refresh the page.');
  return { id: parts[0], startedAt: Number(parts[1]) };
}
export function validateReport(body) {
  if (body.website) throw new Error('Unable to submit this report.');
  if (body.safe !== true) throw new Error('This form is only for non-emergency reports. Follow the building emergency procedures if there is danger or uncertainty.');
  const rawUnit = clean(body.unit, 20).replace(/\s/g,'');
  if (!/^\d{1,4}(?:\/\d{1,4})?$/.test(rawUnit)) throw new Error('Enter a valid unit number, for example 1005 or 1005/1006.');
  const unit = rawUnit.split('/').map(v=>String(Number(v))).join('/');
  const name = clean(body.name, 100), phone = clean(body.phone, 30), email = clean(body.email, 160);
  if (!name || (!phone && !email)) throw new Error('Enter your name and a phone number or email address.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please check your email address.');
  if (phone && !/^[+()\d\s-]{6,30}$/.test(phone)) throw new Error('Please check your phone number.');
  for (const k of Object.keys(choices)) if (!choices[k][body[k]]) throw new Error('Please complete the guided check.');
  const files = body.files || [];
  if (!Array.isArray(files) || files.length > 3) throw new Error('Attach up to three photos, with a combined size under 2 MB.');
  let size = 0;
  const attachments = files.map((file, i) => {
    if (!['image/jpeg','image/png','image/webp'].includes(file?.type) || typeof file.data !== 'string' || file.data.length > 2800000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) throw new Error('Only JPG, PNG or WebP photos are accepted.');
    const buffer = Buffer.from(file.data, 'base64'); size += buffer.length;
    const valid = file.type === 'image/jpeg' ? buffer[0]===255 && buffer[1]===216 && buffer[2]===255 : file.type === 'image/png' ? buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP';
    if (!valid || buffer.length < 12) throw new Error('One of the photos could not be read. Please choose another image.');
    return { filename: `Photo-${i+1}.${file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]}`, buffer };
  });
  if (size > 2*1024*1024) throw new Error('Photos must be under 2 MB in total.');
  return { unit, name, phone, email, sound: body.sound, trigger: body.trigger, outcome: body.outcome, notes: clean(body.notes, 2500), attachments };
}
export function reportText(report, reference, date) {
  return [
    'BEACHCOMBER RESORT - SMOKE ALARM REPORT', `Reference: ${reference}`,
    `Submitted: ${new Intl.DateTimeFormat('en-AU', { timeZone:'Australia/Brisbane', dateStyle:'full', timeStyle:'long' }).format(date)}`,
    `Property: Unit ${report.unit}, 18 Hanlan Street, Surfers Paradise QLD 4217`,
    `Name: ${report.name}`, `Phone: ${report.phone || 'Not provided'}`, `Email: ${report.email || 'Not provided'}`,
    `Sound: ${choices.sound[report.sound]}`, `Possible trigger: ${choices.trigger[report.trigger]}`, `Outcome: ${choices.outcome[report.outcome]}`,
    `Additional details: ${report.notes || 'None'}`, `Photos: ${report.attachments.length}`,
    '', 'Resident confirmed no immediate danger before submitting. This is a resident report, not an equipment diagnosis.',
    'Guidance shown: interconnected alarms sound together; investigate danger first; hush only a clearly unwanted activation; never disable an alarm; persistent or unexplained alarms and fault chirps require assistance.',
  ].join('\n');
}
async function setState(token, folder, value) {
  const r = await fetch(`${API}/files/${encodeURIComponent(folder)}`, { method:'PATCH', headers:{Authorization:`Zoho-oauthtoken ${token}`,'Content-Type':'application/json'}, body:JSON.stringify({data:{type:'files',attributes:{description:value}}}) });
  if (!r.ok) throw new Error('Could not record report delivery.');
}
export async function deliverReport(report, session, deps = {}) {
  const digest = createHash('sha256').update(JSON.stringify({...report, attachments:report.attachments.map(x=>({filename:x.filename,sha:createHash('sha256').update(x.buffer).digest('hex')}))})).digest('hex');
  const reservation = await (deps.reserveReport || reserveReport)(session, report.unit, digest);
  const ref = reservation.reference;
  const update = deps.updateReport || updateReport;
  if (reservation.emailed_at) return {ok:true, reference:ref, duplicate:true};
  const token = await (deps.getAccessToken || getAccessToken)();
  const list = deps.listChildren || listChildren, create = deps.createFolder || createFolder, upload = deps.uploadFile || uploadFile, state = deps.setState || setState;
  const parent = process.env.ZOHO_WORKDRIVE_BEACHCOMBER_PARENT_FOLDER_ID || process.env.ZOHO_WORKDRIVE_QLD_PHOTOS_PARENT_FOLDER_ID;
  const rootItems = await list(token, parent);
  const root = rootItems.find(x => x.attributes?.name === ROOT_NAME && x.attributes?.is_folder !== false)?.id || await create(token, ROOT_NAME, parent);
  const folderName = `Unit ${report.unit} - ${ref}`;
  const children = await list(token, root, 100);
  const existing = children.find(x => String(x.attributes?.name || '').endsWith(` - ${ref}`) && x.attributes?.is_folder !== false);
  const prior = existing?.attributes?.description || '';
  if (prior.includes('payload:') && !prior.includes(`payload:${digest}`)) throw new Error('This report was already submitted. Start a new report for a different incident.');
  if (prior.includes('email:sent')) {
    await update(session,{workdrive_folder_id:existing.id,emailed_at:new Date().toISOString()});
    return {ok:true, reference:ref, duplicate:true};
  }
  const folder = reservation.workdrive_folder_id || existing?.id || await create(token, folderName, root);
  await update(session,{workdrive_folder_id:folder});
  const text = reportText(report, ref, new Date(session.startedAt));
  await state(token, folder, `payload:${digest}\nemail:pending`);
  await upload(token, folder, 'Report.txt', Buffer.from(text));
  await upload(token, folder, 'Report.json', Buffer.from(JSON.stringify({...report, attachments:report.attachments.map(x=>x.filename), reference:ref, submittedAt:new Date(session.startedAt).toISOString()},null,2)));
  for (const attachment of report.attachments) await upload(token, folder, attachment.filename, attachment.buffer);
  const link = `https://workdrive.zoho.com.au/folder/${encodeURIComponent(folder)}`;
  try {
    await (deps.send || sendHostingerMail)({to:[RECIPIENT],displayName:'Goldsure | Beachcomber',subject:`Beachcomber | Unit ${report.unit} | ${choices.outcome[report.outcome]} | ${ref}`,text:`${text}\n\nWorkDrive report and photos: ${link}`,html:`<div style="font-family:Arial,sans-serif;color:#173d36;max-width:680px"><h2>Beachcomber smoke alarm report</h2><p><strong>Unit ${esc(report.unit)}</strong> · ${esc(choices.outcome[report.outcome])}</p><pre style="white-space:pre-wrap;font-family:Arial,sans-serif;line-height:1.6">${esc(text)}</pre><p><a href="${link}">Open report and photos in WorkDrive</a></p></div>`});
  } catch {
    return { ok:false, saved:true, reference:ref, error:'Your report is saved, but the email notification could not be sent. Tap Retry notification. For urgent help, call Goldsure on (07) 2145 5155.' };
  }
  await state(token, folder, `payload:${digest}\nemail:sent`);
  await update(session,{emailed_at:new Date().toISOString()});
  return {ok:true,reference:ref};
}
export async function beachcomberReport(req, res, deps = {}) {
  res.setHeader('Cache-Control','no-store');
  const origin = req.headers?.origin;
  const allowed = ['https://portal.goldsure.com.au','https://www.goldsure.com.au','https://goldsure.com.au'];
  if (origin && !allowed.includes(origin) && !(process.env.VERCEL_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin))) return res.status(403).json({error:'Please use the Beachcomber help page.'});
  if (!secret() || !process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_REFRESH_TOKEN || !(process.env.ZOHO_WORKDRIVE_BEACHCOMBER_PARENT_FOLDER_ID || process.env.ZOHO_WORKDRIVE_QLD_PHOTOS_PARENT_FOLDER_ID) || !hasHostingerMailConfig()) return res.status(503).json({error:'Online reporting is temporarily unavailable. Please contact Goldsure on (07) 2145 5155.'});
  if (req.method === 'GET') return res.status(200).json({token:newSession()});
  if (req.method !== 'POST') {res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
  if (!String(req.headers?.['content-type'] || '').includes('application/json')) return res.status(415).json({error:'Use the online reporting form.'});
  if (Number(req.headers?.['content-length'] || 0)>3100000) return res.status(413).json({error:'Photos are too large.'});
  let session, report;
  try { session=readSession(req.body?.token); report=validateReport(req.body || {}); } catch(e) {return res.status(400).json({error:e.message});}
  const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0];
  const now=Date.now();
  for (const [k,v] of buckets) if(now-v.time>600000) buckets.delete(k);
  const bucket=buckets.get(ip) || {time:now,ids:new Set()};
  if(bucket.ids.size>=8 && !bucket.ids.has(session.id)) return res.status(429).json({error:'Too many reports. Please try again later or call Goldsure on (07) 2145 5155.'});
  bucket.ids.add(session.id); buckets.set(ip,bucket);
  try {
    if (!pending.has(session.id)) pending.set(session.id, deliverReport(report,session,deps));
    const result=await pending.get(session.id);
    return res.status(result.ok?200:502).json(result);
  } catch(e) {
    console.error('[Beachcomber report]',e.message.replace(/https?:\/\/\S+/g,'[service]'));
    return res.status(502).json({error:'We could not confirm delivery. Please retry with this page open, or contact Goldsure on (07) 2145 5155.'});
  } finally {pending.delete(session.id);}
}
