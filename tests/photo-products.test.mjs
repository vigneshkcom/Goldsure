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

test('VIC Aircon uses a separate WorkDrive parent and customer route', async () => {
  const api = await read('api/zoho/create-photo-request.js');
  const routes = JSON.parse(await read('vercel.json')).rewrites;
  assert.match(api, /ZOHO_WORKDRIVE_AIRCON_PARENT_FOLDER_ID/);
  assert.match(api, /uploadPath: '\/ac'/);
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
  ]) assert.ok(upload.includes(marker), `missing ${marker}`);

  for (const id of ['unitCount', 'roomCount']) {
    const select = upload.match(new RegExp(`<select id="${id}">([\\s\\S]*?)<\\/select>`))?.[1] || '';
    assert.ok(select, `missing ${id} dropdown`);
    for (let value = 1; value <= 7; value += 1) {
      assert.ok(select.includes(`<option value="${value}">${value}</option>`), `missing ${id} option ${value}`);
    }
    assert.doesNotMatch(select, /<option value="8">/);
  }
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
});

test('photo button always offers Hot Water and VIC Aircon', async () => {
  const sms = await read('sms/index.html');
  assert.match(sms, /pickPhotoProduct\('aircon'\)/);
  assert.match(sms, /pickPhotoProduct\('hws'\)/);
  assert.match(sms, /body: JSON\.stringify\(\{ name, phone: activePhone, product \}\)/);
  assert.match(sms, /data\.reused && Number\(data\.photoCount\) > 0/);
  assert.match(sms, /&more=1/);
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
    'Open photos in WorkDrive',
    'airconAssessmentError(assessment)',
  ]) assert.ok(api.includes(marker), `missing email detail ${marker}`);
});
