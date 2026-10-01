import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { customerNameFromFolder, inferLegacyHwsProduct, photoRequestFromFolder } from '../api/zoho/create-photo-request.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());
}

test('legacy hot-water links infer the state from the submitted property address', () => {
  assert.equal(inferLegacyHwsProduct('hws', '156 Moreton St, Lakemba NSW 2195, Australia'), 'hws-nsw');
  assert.equal(inferLegacyHwsProduct('', '12 Example Road, Richmond VIC 3121, Australia'), 'hws-vic');
  assert.equal(inferLegacyHwsProduct('hws-nsw', '12 Example Road, Richmond VIC 3121, Australia'), 'hws-nsw');
  assert.equal(inferLegacyHwsProduct('hws', 'Address unavailable'), 'hws');
});

test('photo notifications recover the full customer name from the WorkDrive folder', () => {
  assert.equal(customerNameFromFolder('Jash Patel (+61400111222)'), 'Jash Patel');
  assert.equal(customerNameFromFolder('Jane Smith (0412 345 678)'), 'Jane Smith');
  assert.equal(customerNameFromFolder('Customer Without Phone'), 'Customer Without Phone');
});

test('customer upload and SMS scripts compile', async () => {
  for (const path of [
    'hotwater/upload-photos.html',
    'hotwater/photo-tracker.html',
    'hotwater/quote-tracker.html',
    'hotwater-nsw/quote-tracker.html',
    'aircons/quote-tracker.html',
    'sms/index.html',
  ]) {
    const html = await read(path);
    for (const source of inlineScripts(html)) assert.doesNotThrow(() => new Function(source), path);
  }
});

test('photo requests report awaiting, viewed, partial and received statuses', () => {
  const config = { product: 'hws-vic', label: 'VIC Hot Water', uploadPath: '/vic-hws-photos' };
  const folder = (filesCount, description = 'phone:0412345678') => ({
    id: 'folder-1',
    attributes: {
      name: 'Jane Smith (0412345678)',
      description,
      storage_info: { files_count: filesCount },
      created_time_in_millisecond: 1,
      modified_time_in_millisecond: 2,
    },
  });
  assert.equal(photoRequestFromFolder(folder(0), config, 'https://portal.goldsure.com.au').status, 'awaiting');
  assert.equal(photoRequestFromFolder(folder(0, 'phone:0412345678\nlink_viewed_at:2026-10-01T00:00:00.000Z'), config, 'https://portal.goldsure.com.au').status, 'viewed');
  assert.equal(photoRequestFromFolder(folder(2), config, 'https://portal.goldsure.com.au').status, 'partial');
  assert.equal(photoRequestFromFolder(folder(4), config, 'https://portal.goldsure.com.au').status, 'received');
});

test('the customer upload page records customer views but not staff previews', async () => {
  const api = await read('api/zoho/create-photo-request.js');
  const upload = await read('hotwater/upload-photos.html');
  const tracker = await read('hotwater/photo-tracker.html');
  assert.match(tracker, /source["']?,?["']?tracker|searchParams\.set\('source',\s*'tracker'\)/);
  assert.match(upload, /const isStaffPreview = params\.get\('source'\) === 'tracker'/);
  assert.match(upload, /if \(!folderId \|\| isStaffPreview\) return/);
  assert.match(api, /req\.method === 'PATCH' && req\.body\?\.action === 'record-view'/);
  assert.match(api, /link_viewed_at:/);
});

test('SMS and quote trackers show the matching photo request status and a staff photo viewer', async () => {
  const sms = await read('sms/index.html');
  assert.match(sms, /Quotes &amp; photos/);
  assert.match(sms, /View photos/);
  assert.doesNotMatch(sms, />Photo link/);
  assert.match(sms, /<button type="button" class="q-view" data-photo-url="\$\{esc\(request\.link\)\}"/);
  assert.match(sms, /trackerSearch\(request\.phone \|\| phone\)/);
  assert.match(sms, /\['aircon', 'hws-vic', 'hws-nsw'\]/);
  for (const [path, product] of [
    ['hotwater/quote-tracker.html', 'hws-vic'],
    ['hotwater-nsw/quote-tracker.html', 'hws-nsw'],
    ['aircons/quote-tracker.html', 'aircon'],
  ]) {
    const tracker = await read(path);
    assert.match(tracker, new RegExp(`loadPhotoRequests\\('${product}'\\)`));
    assert.match(tracker, /renderPhotoRequest\(q\)/);
    assert.match(tracker, /<th>Photos<\/th>/);
    assert.match(tracker, /class="photo-button view"/);
    assert.match(tracker, />View photos<\/button>/);
    assert.match(tracker, /class="photo-button awaiting" onclick="openPhotoReminder\(/);
    assert.match(tracker, />Awaiting photos<\/button>/);
    assert.match(tracker, /id="photoReminderModal"/);
    assert.match(tracker, /action:'send',phone:photoSmsTarget\.phone,message/);
    assert.match(tracker, /data-photo-url="\$\{esc\(request\.link\)\}"/);
    assert.match(tracker, /<td>\$\{renderPhotoRequest\(q\)\}<\/td>/);
    assert.doesNotMatch(tracker, />Photos\$\{esc\(count\)\}<\/button>/);
  }
});

test('photo tracker reads the customer filter from its URL and searches by phone', async () => {
  const tracker = await read('hotwater/photo-tracker.html');
  assert.match(tracker, /const requestedSearch = new URLSearchParams\(location\.search\)\.get\('search'\) \|\| ''/);
  assert.match(tracker, /\$\('search'\)\.value = requestedSearch/);
  assert.match(tracker, /phone\.endsWith\(digits\.slice\(-9\)\)/);
  assert.match(tracker, /class="btn-mini view-photos"/);
  assert.match(tracker, /data-view-photos="\$\{esc\(f\.link\)\}"/);
  assert.doesNotMatch(tracker, />Photo link/);
});

test('SMS quote cards wrap their details instead of clipping text', async () => {
  const sms = await read('sms/index.html');
  assert.match(sms, /\.quote-card \.q-meta \{[^}]*flex-wrap: wrap/);
  assert.match(sms, /\.quote-card \.q-actions \{[^}]*flex-wrap: wrap/);
  assert.match(sms, /\.quote-card \.q-info \{[^}]*grid-template-columns: max-content minmax\(0,1fr\)/);
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

test('Hot Water photo links collect and surface the property address', async () => {
  const api = await read('api/zoho/create-photo-request.js');
  const upload = await read('hotwater/upload-photos.html');
  for (const marker of [
    'id="hwsQuestions"',
    'id="hwsPropertyAddress"',
    "const addressInputId = isAircon ? 'propertyAddress' : 'hwsPropertyAddress'",
    "document.getElementById('hwsQuestions').style.display = 'block'",
    "address: document.getElementById('hwsPropertyAddress').value.trim()",
    'assessment,',
  ]) assert.ok(upload.includes(marker), `missing HWS address marker ${marker}`);
  for (const marker of [
    'setFolderHwsAddress(accessToken, folderId, phone, assessment)',
    "['Property address', assessment?.address || 'Not provided']",
    'isHwsProduct(config.product)',
    "const isHwsProduct = product => ['hws', 'hws-vic', 'hws-nsw'].includes(product)",
    'hwsAssessmentError(assessment)',
    "['Customer name', who]",
    "['Phone number', phone || 'Not provided']",
    "['Service', config.label]",
    "['Submission type', followUp ? 'Additional photos' : 'First photo upload']",
    "['Photos submitted', labels.length ? labels.join(', ') : 'Not provided']",
    "answers.push(['Received', receivedAt || receivedAtSydney()])",
    'const storedCustomerName = customerNameFromFolder(folderDetails.name)',
  ]) assert.ok(api.includes(marker), `missing HWS address API marker ${marker}`);
  assert.match(upload, /const folderCustomer = customerNameFromFolder\(d\.name\)/);
  assert.match(upload, /photoLabels: uploadedPhotoLabels/);
});

test('NSW and VIC Hot Water uploads use separate WorkDrive destinations', async () => {
  const api = await read('api/zoho/create-photo-request.js');
  const upload = await read('hotwater/upload-photos.html');
  const tracker = await read('hotwater/photo-tracker.html');
  const sms = await read('sms/index.html');
  const sidebar = await read('assets/internal-systems-sidebar.js');
  const routes = JSON.parse(await read('vercel.json')).rewrites;

  for (const marker of [
    "return 'hws-vic'",
    "return 'hws-nsw'",
    'ZOHO_WORKDRIVE_VIC_HWS_PARENT_FOLDER_ID',
    "uploadPath: '/vic-hws-photos'",
    "uploadPath: '/nsw-hws-photos'",
    "label: 'VIC Hot Water'",
    "label: 'NSW Hot Water'",
  ]) assert.ok(api.includes(marker), `missing state split marker ${marker}`);

  assert.match(upload, /location\.pathname === '\/nsw-hws-photos'[\s\S]*?'hws-nsw'/);
  assert.match(upload, /location\.pathname === '\/vic-hws-photos'[\s\S]*?'hws-vic'/);
  assert.match(upload, /\['hws-vic', 'hws-nsw'\]\.includes\(requestedProduct\)/);
  assert.match(tracker, /PRODUCT === 'hws-nsw' \? 'NSW Hot Water' : 'VIC Hot Water'/);
  assert.match(sidebar, /hotwater-nsw\/photo-tracker\.html/);
  const nswTracker = await read('hotwater-nsw/quote-tracker.html');
  assert.match(nswTracker, /href="\/hotwater-nsw\/photo-tracker\.html"/);
  assert.doesNotMatch(nswTracker, /href="\/hotwater\/photo-tracker\.html"/);
  assert.match(sms, /pickPhotoProduct\('hws-vic'\)/);
  assert.match(sms, /pickPhotoProduct\('hws-nsw'\)/);
  assert.deepEqual(
    routes.find(route => route.source === '/vic-hws-photos'),
    { source: '/vic-hws-photos', destination: '/hotwater/upload-photos.html?product=hws-vic' },
  );
  assert.deepEqual(
    routes.find(route => route.source === '/nsw-hws-photos'),
    { source: '/nsw-hws-photos', destination: '/hotwater/upload-photos.html?product=hws-nsw' },
  );
  assert.deepEqual(
    routes.find(route => route.source === '/hotwater-nsw/photo-tracker.html'),
    { source: '/hotwater-nsw/photo-tracker.html', destination: '/hotwater/photo-tracker.html?product=hws-nsw' },
  );
});

test('QLD smoke alarm promo uses its own WorkDrive destination and safe browser upload contract', async () => {
  const api = await read('api/zoho/create-photo-request.js');
  for (const marker of [
    "return 'smoke-promo'",
    'ZOHO_WORKDRIVE_QLD_PHOTOS_PARENT_FOLDER_ID',
    "label: 'QLD Smoke Alarm Promo'",
    "const PROMO_ORIGIN = 'https://smokealarmpromo.goldsure.com.au'",
    "if (req.method === 'OPTIONS') return res.status(204).end()",
    "req.query.action === 'health'",
    'folderUrl, uploadPageUrl',
    "config.product === 'smoke-promo'",
    'buffer.length > 4 * 1024 * 1024',
    "'[Smoke Alarm Promo Quote]'",
    'config.uploadedStageNames.length',
    'postGhlNoteWithRetry(knownPhone, noteBody)',
    'success: true, noteAdded',
    "'shanira@goldsure.com.au'",
    "'alda@goldsure.com.au'",
  ]) assert.ok(api.includes(marker), `missing smoke promo upload marker ${marker}`);
});

test('successful photo submissions use the correct product pipeline stage', async () => {
  const api = await read('api/zoho/create-photo-request.js');
  assert.match(api, /product,[\s\S]*?uploadPath: '\/ac',[\s\S]*?uploadedStageNames: \['Photos Uploaded'\]/);
  assert.match(api, /uploadPath: '\/u',[\s\S]*?uploadedStageNames: \['Photos Received'\]/);
  assert.match(api, /if \(!notify\) return res\.status\(200\)\.json\(\{ success: true \}\)/);
  assert.match(api, /await uploadFile\([\s\S]*?stageNames: config\.uploadedStageNames/);
  assert.match(api, /inferLegacyHwsProduct\(requestedProduct, req\.body\?\.assessment\?\.address\)/);
  assert.match(api, /createIfMissing: false/);
  assert.match(api, /pipelineCandidates: config\.product === 'hws'/);
  assert.doesNotMatch(api, /stageNames: \['Photos Received'\]/);
});

test('aircon assessment collects the requested questions and photos', async () => {
  const upload = await read('hotwater/upload-photos.html');
  for (const marker of [
    'id="fullName"',
    'id="customerEmail"',
    'id="propertyAddress"',
    'initCustomerAddressAutocomplete',
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

test('photo button always offers NSW Hot Water, VIC Hot Water and VIC Aircon', async () => {
  const sms = await read('sms/index.html');
  assert.match(sms, /pickPhotoProduct\('aircon'\)/);
  assert.match(sms, /pickPhotoProduct\('hws-vic'\)/);
  assert.match(sms, /pickPhotoProduct\('hws-nsw'\)/);
  assert.match(sms, /body: JSON\.stringify\(\{ name, phone: activePhone, product \}\)/);
  assert.match(sms, /data\.reused && Number\(data\.photoCount\) > 0/);
  assert.match(sms, /&more=1/);
  assert.doesNotMatch(sms, /30 September 2026/);
  assert.doesNotMatch(sms, /minimum customer co-payment/);
  assert.doesNotMatch(sms, /Rebates are reducing substantially/);
  assert.doesNotMatch(sms, /as soon as possible/);
  assert.match(sms, /To provide your quote, please complete the short assessment and upload photos of your property here/);
  assert.match(sms, /Thanks for your earlier aircon photos\. We need a few more to finish your quote/);
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

test('Hot Water photo notifications use the exact state-specific recipient lists', async () => {
  const api = await read('api/zoho/create-photo-request.js');
  const vicStart = api.indexOf("if (product === 'hws-vic')");
  const vicBlock = api.slice(vicStart, api.indexOf('\n  }', vicStart));
  assert.match(vicBlock, /notifyRecipients: \['info@goldsure\.com\.au'\]/);

  const nswStart = api.indexOf("if (product === 'hws-nsw')");
  const nswBlock = api.slice(nswStart, api.indexOf('\n  }', nswStart));
  assert.match(nswBlock, /notifyRecipients: \['vignesh@goldsure\.com\.au', 'shanira@goldsure\.com\.au', 'david@goldsure\.com\.au'\]/);
  assert.doesNotMatch(nswBlock, /info@goldsure\.com\.au/);

  const genericHwsBlock = api.slice(api.indexOf("uploadPath: '/u'"), api.indexOf('\n  };', api.indexOf("uploadPath: '/u'")));
  assert.match(genericHwsBlock, /notifyRecipients: \['info@goldsure\.com\.au'\]/);
  assert.doesNotMatch(genericHwsBlock, /vignesh@goldsure\.com\.au|david@goldsure\.com\.au/);
});
