import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());
}

test('customer upload and SMS scripts compile', async () => {
  for (const path of ['hotwater/upload-photos.html', 'hotwater/photo-tracker.html', 'sms/index.html']) {
    const html = await read(path);
    for (const source of inlineScripts(html)) assert.doesNotThrow(() => new Function(source), path);
  }
});

test('photo uploads reuse Zoho tokens and allow unlimited additional photos', async () => {
  const api = await read('api/zoho/create-photo-request.js');
  const upload = await read('hotwater/upload-photos.html');
  for (const marker of [
    "let cachedAccessToken = ''",
    'let accessTokenRefreshPromise = null',
    'data.expires_in_sec || data.expires_in',
    'return await accessTokenRefreshPromise',
  ]) assert.ok(api.includes(marker), `missing token reuse marker ${marker}`);
  assert.match(upload, /id="extraFile" accept="image\/\*" multiple/);
  assert.match(upload, /for \(const file of files\)/);
  assert.match(upload, /const MAX_UPLOAD_ATTEMPTS = 4/);
  assert.match(upload, /Your photos are safe on this page/);
});

test('VIC Aircon uses a separate WorkDrive parent and customer route', async () => {
  const api = await read('api/zoho/create-photo-request.js');
  const routes = JSON.parse(await read('vercel.json')).rewrites;
  assert.match(api, /ZOHO_WORKDRIVE_AIRCON_PARENT_FOLDER_ID/);
  assert.match(api, /uploadPath: '\/ac'/);
  assert.match(api, /function fullPhoneForFolder\(phone\)/);
  assert.match(api, /const folderName = fullPhone \? `\$\{name\.trim\(\)\} \(\$\{fullPhone\}\)`/);
  assert.match(api, /await renameFolder\(accessToken, existingId, folderName\)/);
  assert.doesNotMatch(api, /const folderName = last4 \?/);
  assert.deepEqual(
    routes.find(route => route.source === '/ac'),
    { source: '/ac', destination: '/hotwater/upload-photos.html?product=aircon' },
  );
});

test('aircon assessment collects the requested questions and photos', async () => {
  const upload = await read('hotwater/upload-photos.html');
  for (const marker of [
    'id="fullName"',
    'id="customerEmail"',
    'id="propertyAddress"',
    'initAirconAddressAutocomplete',
    "state !== 'VIC'",
    'Single storey',
    'Double storey',
    'How many aircon units do you need?',
    'How many rooms need air conditioning?',
    'Tile roof',
    'Tin roof',
    "key: 'switchboard'",
    'Room ${i + 1} for indoor head',
    "key: 'utility-bill'",
    "key: 'aircon-assessment-answers'",
    'commentLabelForSlot',
    "label: `Room ${i + 1} for indoor head`",
    'savePhotoComment',
    'Photo comments',
    'capture="environment"',
    '>Take photo</button>',
    '>Choose from gallery</button>',
    'camera-file-${s.key}',
    'gallery-file-${s.key}',
  ]) assert.ok(upload.includes(marker), `missing ${marker}`);

  for (const id of ['unitCount', 'roomCount']) {
    const select = upload.match(new RegExp(`<select id="${id}">([\\s\\S]*?)<\\/select>`))?.[1] || '';
    assert.ok(select, `missing ${id} dropdown`);
    for (let value = 1; value <= 7; value += 1) {
      assert.ok(select.includes(`<option value="${value}">${value}</option>`), `missing ${id} option ${value}`);
    }
    assert.doesNotMatch(select, /<option value="8">/);
  }
  assert.ok(
    upload.indexOf('How many rooms need air conditioning?') < upload.indexOf('How many aircon units do you need?'),
    'room count should appear before aircon unit count',
  );
  assert.match(upload, /Name this room, e\.g\. master bedroom, bedroom 2, living room or study/);
});

test('photo tracker displays every saved aircon answer in a modal', async () => {
  const tracker = await read('hotwater/photo-tracker.html');
  assert.match(tracker, /data-answers=/);
  assert.match(tracker, /id="answersOverlay"/);
  assert.match(tracker, /\['Full name', a\.fullName/);
  assert.match(tracker, /\['Email address', a\.email/);
  assert.match(tracker, /\['Property address', a\.address/);
  assert.match(tracker, /\['Property', a\.storeys/);
  assert.match(tracker, /\['Aircon units', a\.units/);
  assert.match(tracker, /\['Rooms', a\.rooms/);
  assert.match(tracker, /\['Roof', a\.roof/);
  assert.match(tracker, /Room \$\{room\} name and comments/);
  assert.match(tracker, /Rates notice or utility bill comments/);
});

test('photo button always offers Hot Water and VIC Aircon', async () => {
  const sms = await read('sms/index.html');
  assert.match(sms, /pickPhotoProduct\('aircon'\)/);
  assert.match(sms, /pickPhotoProduct\('hws'\)/);
  assert.match(sms, /body: JSON\.stringify\(\{ name, phone: activePhone, product \}\)/);
  assert.match(sms, /data\.reused && Number\(data\.photoCount\) > 0/);
  assert.match(sms, /&more=1/);
  assert.match(sms, /From 30 September 2026, VEU rules increase the minimum customer co-payment to \$3,000 for affected multi-split and ducted systems/);
  assert.doesNotMatch(sms, /Rebates are reducing substantially/);
  assert.match(sms, /upload your photos as soon as possible/);
  assert.match(sms, /upload the additional photos as soon as possible/);
});

test('aircon upload notification email includes customer details, every answer and the photo link', async () => {
  const api = await read('api/zoho/create-photo-request.js');
  for (const marker of [
    "['Full name', assessment?.fullName || who]",
    "['Email address', assessment?.email || 'Not provided']",
    "['Property address', assessment?.address || 'Not provided']",
    "['Property', assessment?.storeys || 'Not answered']",
    "['Aircon units', assessment?.units || 'Not answered']",
    "['Rooms', assessment?.rooms || 'Not answered']",
    "['Roof', assessment?.roof || 'Not answered']",
    '...photoCommentRows(assessment)',
    'Room ${room} name and comments',
    'Open photos in WorkDrive',
    'airconAssessmentError(assessment)',
    "['vignesh@goldsure.com.au', 'david@goldsure.com.au', 'amit@goldsure.com.au']",
  ]) assert.ok(api.includes(marker), `missing email detail ${marker}`);
});
