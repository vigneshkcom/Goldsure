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
});

test('photo tracker displays every saved aircon answer in a modal', async () => {
  const tracker = await read('hotwater/photo-tracker.html');
  assert.match(tracker, /data-answers=/);
  assert.match(tracker, /id="answersOverlay"/);
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
});
