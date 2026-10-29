import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dataforcePaymentFlag,
  dataforceProductCode,
  dataforceTransactionBalance,
  dataforceEstimatedBalance,
  normaliseFieldworker,
  normalisePurchaseOrderLine,
  normalisePurchaseOrderItems,
  purchaseOrderPayableDate,
  isPurchaseOrderCompletedAppointment,
} from '../lib/dataforce-purchase-orders.js';
import handler from '../api/smoke-alarms/google-key.js';
import reportsHandler from '../api/smoke-alarms/reports/index.js';

function responseRecorder() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

test('pays products outside the rate card as invoiced', () => {
  const registered = normalisePurchaseOrderLine({ productId: 3999, lineQty: 2, productName: '[3999] High ceiling fee', lineRateIncTax: 55 }, true);
  assert.equal(registered.payable, false);
  assert.equal(registered.invoicePay, true);
  assert.equal(registered.issue, '');
  assert.equal(registered.name, '[3999] High ceiling fee');
  assert.equal(registered.invoiceTotalIncGst, 110);
  assert.equal(registered.payIncGst, 110);
  const unregistered = normalisePurchaseOrderLine({ productId: 3999, lineQty: 2, productName: '[3999] High ceiling fee', lineRateIncTax: 55 }, false);
  assert.equal(unregistered.payIncGst, 100);
  const unpriced = normalisePurchaseOrderLine({ productId: 3999, lineQty: 1, productName: '[3999] Mystery' }, true);
  assert.equal(unpriced.invoicePay, false);
  assert.notEqual(unpriced.issue, '');
});

test('pays inspection fees (3437) a fixed $60 ex GST, not the $131 invoiced', () => {
  const line = { productId: 3437, lineQty: 1, productName: '[3437] Inspection Fees', lineRateIncTax: 131 };
  const registered = normalisePurchaseOrderLine(line, true);
  assert.equal(registered.payable, false);
  assert.equal(registered.invoicePay, true);
  assert.equal(registered.fixedRate, true);
  assert.equal(registered.name, 'Inspection fee');
  assert.equal(registered.subtotalExGst, 60);
  assert.equal(registered.gst, 6);
  assert.equal(registered.payIncGst, 66);
  const unregistered = normalisePurchaseOrderLine(line, false);
  assert.equal(unregistered.payIncGst, 60);
  assert.equal(unregistered.gst, 0);
});

test('inspection fee discount removes inspection pay and preserves upgrade pay', () => {
  const inspection = { productId: 3437, lineQty: 1, lineRateIncTax: 131 };
  const alarm = { productId: 3430, lineQty: 2, lineRateIncTax: 98 };
  for (const gstRegistered of [true, false]) {
    for (const nameField of ['discountName', 'description', 'productName', 'lineDescription', 'name']) {
      const discountLines = [{ [nameField]: 'Inspection Fees Discount', lineQty: 1, lineRateIncTax: 131 }];
      assert.deepEqual(normalisePurchaseOrderItems({ productLines: [inspection], discountLines }, gstRegistered), []);
      const upgraded = normalisePurchaseOrderItems({ productLines: [inspection, alarm], discountLines }, gstRegistered);
      assert.deepEqual(upgraded.map(item => item.code), ['3430']);
      assert.equal(upgraded[0].subtotalExGst, 26);
    }
    for (const discountLines of [[], [{ discountName: 'Other discount', lineRateIncTax: 131 }],
      [{ discountName: 'Inspection Fees Discount', lineRateIncTax: 0 }]]) {
      assert.equal(normalisePurchaseOrderItems({ productLines: [inspection], discountLines }, gstRegistered)[0].payIncGst,
        gstRegistered ? 66 : 60);
    }
  }
  assert.deepEqual(normalisePurchaseOrderItems(null), []);
});

test('includes completed jobs without a Field sub-status but excludes cancelled C records', () => {
  for (const status of ['Completed', 'Completed - Field', 'Completed - Office', 'Appointment Completed']) {
    assert.equal(isPurchaseOrderCompletedAppointment({ completionStatusDescription: status }), true);
  }
  assert.equal(isPurchaseOrderCompletedAppointment({ completionStatusCode: 'C' }), true);
  for (const status of ['Cancelled', 'Assigned', 'Waiting', 'Incomplete']) {
    assert.equal(isPurchaseOrderCompletedAppointment({ completionStatusCode: 'C', completionStatusDescription: status }), false);
  }
  assert.equal(isPurchaseOrderCompletedAppointment({}), false);
});

test('estimates a cash job balance from the invoice total when Dataforce returns none', () => {
  const invoice = {
    productLines: [
      { productId: 3429, lineQty: 1, lineRateIncTax: 33 },
      { productId: 3430, lineQty: 4, lineRateIncTax: 55 },
    ],
    discountLines: [{ lineQty: 1, lineRateIncTax: 20 }],
  };
  assert.equal(dataforceTransactionBalance(invoice), null);
  assert.equal(dataforceEstimatedBalance(invoice), 233);
  assert.equal(dataforceEstimatedBalance({ productLines: [] }), null);
  assert.equal(dataforceEstimatedBalance(null), null);
});

test('maps the agreed electrician product rates', () => {
  const hardwired = normalisePurchaseOrderLine({ productId: 3430, lineQty: 2, productName: '[3430] Hard Wired' }, true);
  assert.equal(dataforceProductCode({ productName: '[3429] Booking Fee' }), '3429');
  assert.deepEqual(hardwired, {
    code: '3430',
    key: 'hardwired',
    name: 'Hardwired smoke alarm',
    sourceName: '[3430] Hard Wired',
    quantity: 2,
    payable: true,
    issue: '',
    rateExGst: 13,
    subtotalExGst: 26,
    gst: 2.6,
    totalIncGst: 28.6,
  });
  const booking = normalisePurchaseOrderLine({ description: '[3429] Booking Fee', quantity: 1 }, true);
  assert.equal(booking.rateExGst, 30);
  assert.equal(booking.totalIncGst, 33);
  const batteryNoGst = normalisePurchaseOrderLine({ productCode: '3431', qty: 3 }, false);
  assert.equal(batteryNoGst.subtotalExGst, 30);
  assert.equal(batteryNoGst.gst, 0);
  const batteryWithGst = normalisePurchaseOrderLine({ productCode: '3431', qty: 1 }, true);
  assert.equal(batteryWithGst.rateExGst, 10);
  assert.equal(batteryWithGst.totalIncGst, 11);
  assert.equal(dataforceTransactionBalance({ transactionSummary: { amountOutstanding: '$300.00' } }), 300);
  assert.equal(dataforceTransactionBalance({ productLines: [] }), null);
  assert.deepEqual(dataforcePaymentFlag([{ tagName: 'Cash' }]), { type: 'cash', label: 'Cash' });
  assert.deepEqual(dataforcePaymentFlag([{ tagName: 'Bank Transfer' }]), { type: 'bank-transfer', label: 'Bank Transfer' });
  assert.equal(purchaseOrderPayableDate('2026-09-20'), '02/10/2026');
  assert.equal(purchaseOrderPayableDate('2026-09-28'), '16/10/2026');
  assert.equal(purchaseOrderPayableDate('2026-10-04'), '16/10/2026');
  assert.equal(purchaseOrderPayableDate('2026-12-28'), '15/01/2027');
});

test('normalises Dataforce fieldworker contact and GST details', () => {
  assert.deepEqual(normaliseFieldworker({
    fieldworkerId: 1009,
    firstname: 'Alex',
    surname: 'Symonds',
    companyName: 'Alex Electrical',
    emailAddress: ' ALEX@EXAMPLE.COM ',
    taxId: '12345678901',
    gstRegistered: true,
  }), {
    id: 1009,
    name: 'Alex Symonds',
    firstName: 'Alex',
    companyName: 'Alex Electrical',
    email: 'alex@example.com',
    phone: '',
    taxId: '12345678901',
    gstRegistered: true,
  });
});

test('purchase-order page exposes cash review, manual lines, payment date and both email actions', () => {
  const html = readFileSync(new URL('../smoke-alarms/purchase-orders.html', import.meta.url), 'utf8');
  assert.match(html, /Cash tagged/);
  assert.match(html, /Bank transfer, review/);
  assert.match(html, /class="jobs-table"/);
  assert.match(html, /Installation breakdown/);
  assert.match(html, /Job \/ scheduled/);
  assert.match(html, /Scheduled from/);
  assert.match(html, /Scheduled to/);
  assert.match(html, /Customer balance/);
  assert.match(html, /> Offset<\/label>/);
  assert.doesNotMatch(html, /Cash collected \/ offset|class="money-input cash-input"/);
  assert.match(html, /const cashOffset=row\._cashCollected\?pendingBalance:0/);
  assert.match(html, /\+ Add line/);
  assert.match(html, /Amount inc GST/);
  assert.match(html, /id="reviewTo"/);
  assert.match(html, /id="reviewCc"/);
  assert.match(html, /Email install summary/);
  assert.match(html, /Create Xero bill/);
  assert.match(html, /id="xeroModal"/);
  assert.match(html, /creates a draft supplier bill only/i);
  assert.match(html, /action:'preview'/);
  assert.match(html, /action:'create',confirm:true/);
  assert.match(html, /function pdfFilename\(response,po\)/);
  assert.match(html, /link\.download=fileName/);
  assert.match(html, /two weeks in arrears/);
  assert.match(html, /PO for \$\{worker\.name\} - Week ending/);
});

test('assigns completed jobs to their scheduled day, not their later completion day', async () => {
  const originalFetch = global.fetch;
  const previousEnv = {
    PURCHASE_ORDER_PIN: process.env.PURCHASE_ORDER_PIN,
    DATAFORCE_CLIENT_ID: process.env.DATAFORCE_CLIENT_ID,
    DATAFORCE_CLIENT_SECRET: process.env.DATAFORCE_CLIENT_SECRET,
  };
  Object.assign(process.env, {
    PURCHASE_ORDER_PIN: '4321',
    DATAFORCE_CLIENT_ID: 'client',
    DATAFORCE_CLIENT_SECRET: 'secret',
  });
  const searchProperties = [];
  global.fetch = async (url, init = {}) => {
    const value = String(url);
    if (value.endsWith('/authorization/token')) return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
    if (value.endsWith('/GOLDSURE_ASAP/fieldworkers')) return new Response(JSON.stringify({ records: [{ fieldworkerId: 1009, name: 'Alex Symonds', companyName: 'Alex Electrical', email: 'alex@example.com', taxId: '12345678901', gstRegistered: true }] }), { status: 200 });
    if (value.includes('/appointments/search')) {
      const searchPayload = JSON.parse(init.body);
      const propertyName = searchPayload.filterGroups[0].filters[0].propertyName;
      if (searchPayload.after) return new Response(JSON.stringify({ totalCount: 0, records: [] }), { status: 200 });
      searchProperties.push(propertyName);
      const records = propertyName === 'scheduledDate'
        ? [
          { appointmentId: 9001, jobId: 36708, fieldworkerId: 1009, completionStatusCode: 'C', completionStatusDescription: 'Completed', completionSubStatusDescription: 'Field', scheduledDate: '2026-10-05T09:00:00', actualCompletedDate: '2026-10-06T08:00:00' },
          { appointmentId: 9002, jobId: 36937, fieldworkerId: 1009, completionStatusCode: 'C', completionStatusDescription: 'Completed', scheduledDate: '2026-10-05T10:00:00' },
          { appointmentId: 9003, jobId: 36938, fieldworkerId: 1009, completionStatusCode: 'C', completionStatusDescription: 'Completed', scheduledDate: '2026-10-05T11:00:00' },
          { appointmentId: 9004, jobId: 36939, fieldworkerId: 1009, completionStatusCode: 'C', completionStatusDescription: 'Cancelled', scheduledDate: '2026-10-05T12:00:00' },
        ]
        : [];
      return new Response(JSON.stringify({ totalCount: records.length, records }), { status: 200 });
    }
    if (/\/appointments\/900[123]\/invoice/.test(value)) return new Response(JSON.stringify({ transactionBalance: 300, productLines: [{ productId: 3429, productName: '[3429] Booking Fee', lineQty: 1 }, { productId: 3430, productName: '[3430] Hard Wired', lineQty: 4 }] }), { status: 200 });
    if (/\/appointments\/900[123]\/tags/.test(value)) return new Response(JSON.stringify({ records: [{ tagId: 7, tagName: 'Cash', scope: 'Job' }] }), { status: 200 });
    throw new Error(`Unexpected request: ${value}`);
  };
  try {
    const response = responseRecorder();
    await handler({
      method: 'POST',
      headers: { 'x-purchase-order-pin': '4321' },
      body: { action: 'purchase-order-preview', startDate: '2026-10-05', endDate: '2026-10-05' },
    }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(searchProperties, ['scheduledDate']);
    assert.deepEqual(response.body.rows.map(row => row.jobId), ['36708', '36937', '36938']);
    assert.equal(response.body.rows[0].jobId, '36708');
    assert.equal(response.body.rows[0].installedDate, '2026-10-05');
    assert.equal(response.body.workers[0].email, 'alex@example.com');
    assert.equal(response.body.rows[0].items[0].totalIncGst, 33);
    assert.equal(response.body.rows[0].items[1].rateExGst, 13);
    assert.equal(response.body.rows[0].transactionBalance, 300);
    assert.equal(response.body.rows[0].balanceSource, 'appointment invoice');
    assert.deepEqual(response.body.rows[0].paymentFlag, { type: 'cash', label: 'Cash' });
    const nextDay = responseRecorder();
    await handler({
      method: 'POST',
      headers: { 'x-purchase-order-pin': '4321' },
      body: { action: 'purchase-order-preview', startDate: '2026-10-06', endDate: '2026-10-06' },
    }, nextDay);
    assert.equal(nextDay.statusCode, 200);
    assert.deepEqual(nextDay.body.rows, []);
    assert.deepEqual(searchProperties, ['scheduledDate', 'scheduledDate']);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('loads job 37112 beyond the first page when totalCount is only the current page count', async () => {
  const originalFetch = global.fetch;
  const keys = ['PURCHASE_ORDER_PIN', 'DATAFORCE_CLIENT_ID', 'DATAFORCE_CLIENT_SECRET'];
  const previousEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { PURCHASE_ORDER_PIN: '4321', DATAFORCE_CLIENT_ID: 'client', DATAFORCE_CLIENT_SECRET: 'secret' });
  const offsets = [];
  const completed = { appointmentId: 38883, jobId: 37112, fieldworkerId: 1009,
    completionStatusCode: 'D', completionStatusDescription: 'Completed', completionSubStatusDescription: 'Field',
    scheduledDate: '2026-10-28T12:00:00+11:00' };
  global.fetch = async (url, init = {}) => {
    const value = String(url);
    let payload;
    if (value.endsWith('/authorization/token')) payload = { access_token: 'token' };
    else if (value.endsWith('/fieldworkers')) payload = { records: [{ fieldworkerId: 1009, name: 'Alex Symonds', gstRegistered: true }] };
    else if (value.endsWith('/appointments/search')) {
      const { after } = JSON.parse(init.body);
      offsets.push(after);
      // The live API reports 100, then 14, then 0, rather than the overall total.
      const records = after === 0 ? Array.from({ length: 100 }, (_, i) => ({
        appointmentId: 38000 + i, jobId: 36000 + i, completionStatusDescription: 'Assigned', scheduledDate: completed.scheduledDate,
      })) : after === 100 ? [completed] : [];
      payload = { totalCount: records.length, records };
    } else if (value.endsWith('/appointments/38883/invoice')) payload = { productLines: [{ productId: 3431, lineQty: 2 }] };
    else if (value.endsWith('/appointments/38883/tags')) payload = { records: [] };
    else throw new Error(`Unexpected request: ${value}`);
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  try {
    const response = responseRecorder();
    await handler({ method: 'POST', headers: { 'x-purchase-order-pin': '4321' },
      body: { action: 'purchase-order-preview', startDate: '2026-10-26', endDate: '2026-11-01' } }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(offsets, [0, 100, 101]);
    assert.deepEqual(response.body.rows.map(row => row.jobId), ['37112']);
    assert.equal(response.body.rows[0].worker.name, 'Alex Symonds');
    assert.equal(response.body.rows[0].installedDate, '2026-10-28');
    assert.equal(response.body.rows[0].items[0].totalIncGst, 22);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('fills the customer balance for a cash-tagged job when Dataforce returns no balance', async () => {
  const originalFetch = global.fetch;
  const previousEnv = {
    PURCHASE_ORDER_PIN: process.env.PURCHASE_ORDER_PIN,
    DATAFORCE_CLIENT_ID: process.env.DATAFORCE_CLIENT_ID,
    DATAFORCE_CLIENT_SECRET: process.env.DATAFORCE_CLIENT_SECRET,
  };
  Object.assign(process.env, { PURCHASE_ORDER_PIN: '4321', DATAFORCE_CLIENT_ID: 'client', DATAFORCE_CLIENT_SECRET: 'secret' });
  const invoice = { productLines: [{ productId: 3430, productName: '[3430] Hard Wired', lineQty: 2, lineRateIncTax: 110 }] };
  const tagsByAppointment = { 9001: 'Cash', 9002: 'Bank Transfer' };
  global.fetch = async (url, init = {}) => {
    const value = String(url);
    if (value.endsWith('/authorization/token')) return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
    if (value.endsWith('/GOLDSURE_ASAP/fieldworkers')) return new Response(JSON.stringify({ records: [{ fieldworkerId: 1009, name: 'Alex Symonds', gstRegistered: true }] }), { status: 200 });
    if (value.includes('/appointments/search')) {
      if (JSON.parse(init.body).after) return new Response(JSON.stringify({ totalCount: 0, records: [] }), { status: 200 });
      return new Response(JSON.stringify({ totalCount: 2, records: [9001, 9002].map(id => ({ appointmentId: id, jobId: id + 6000, fieldworkerId: 1009, completionStatusDescription: 'Completed - Field', scheduledDate: '2026-09-20T09:00:00', actualCompletedDate: '2026-09-20T15:30:00' })) }), { status: 200 });
    }
    const id = (value.match(/appointments\/(\d+)\//) || [])[1];
    if (id && value.endsWith('/invoice')) return new Response(JSON.stringify(invoice), { status: 200 });
    if (id && value.endsWith('/tags')) return new Response(JSON.stringify({ records: [{ tagId: 7, tagName: tagsByAppointment[id], scope: 'Job' }] }), { status: 200 });
    throw new Error(`Unexpected request: ${value}`);
  };
  try {
    const response = responseRecorder();
    await handler({
      method: 'POST',
      headers: { 'x-purchase-order-pin': '4321' },
      body: { action: 'purchase-order-preview', startDate: '2026-09-14', endDate: '2026-09-20' },
    }, response);
    assert.equal(response.statusCode, 200);
    const cash = response.body.rows.find(row => row.appointmentId === 9001);
    const bank = response.body.rows.find(row => row.appointmentId === 9002);
    assert.equal(cash.transactionBalance, 220);
    assert.equal(cash.balanceEstimated, true);
    assert.equal(bank.transactionBalance, null);
    assert.equal(bank.balanceEstimated, false);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('sends reviewed purchase-order and install-summary emails with editable recipients', async () => {
  const originalFetch = global.fetch;
  const previousEnv = {
    PURCHASE_ORDER_PIN: process.env.PURCHASE_ORDER_PIN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };
  Object.assign(process.env, {
    PURCHASE_ORDER_PIN: '4321',
    RESEND_API_KEY: 're_test',
  });
  let mailPayload;
  global.fetch = async (url, init = {}) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    assert.equal(init.headers.Authorization, 'Bearer re_test');
    mailPayload = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: 'email_123' }), { status: 200 });
  };
  try {
    const purchaseOrder = {
      poNumber: 'PO for Alex Symonds - Week ending 20 Sep 2026',
      issueDate: '24 Sep 2026',
      period: '14 Sep 2026 to 20 Sep 2026',
      weekEnding: '2026-09-20',
      electrician: { name: 'Alex Symonds', companyName: 'Alex Electrical', email: 'alex@example.com', taxId: '12345678901', gstRegistered: true },
      additionalLines: [{ description: 'Warranty job 36341', amountIncGst: 110 }],
      jobs: [{
        jobId: '7001',
        installedDate: '20 Sep 2026',
        pendingBalance: 300,
        cashCollected: true,
        cashOffset: 300,
        paymentFlag: { type: 'cash', label: 'Cash' },
        items: [{ key: 'booking', name: 'Changed in browser', quantity: 1, rateExGst: 999, subtotalExGst: 999 }],
      }],
    };
    const response = responseRecorder();
    await reportsHandler({
      method: 'POST',
      headers: { 'x-purchase-order-pin': '4321' },
      body: {
        to: 'accounts@example.com, alex@example.com',
        cc: 'vignesh@goldsure.com.au; manager@example.com',
        subject: 'Purchase order - Alex Symonds - Week ending 20 Sep 2026',
        purchaseOrder,
      },
    }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(mailPayload.to, ['accounts@example.com', 'alex@example.com']);
    assert.deepEqual(mailPayload.cc, ['vignesh@goldsure.com.au', 'manager@example.com']);
    assert.equal(mailPayload.from, 'Goldsure Pty Ltd <vignesh@goldsure.com.au>');
    assert.equal(mailPayload.reply_to, 'vignesh@goldsure.com.au');
    assert.equal(mailPayload.attachments.length, 1);
    assert.match(mailPayload.attachments[0].filename, /\.pdf$/);
    assert.match(mailPayload.html, /PO for Alex Symonds - Week ending 20 Sep 2026/);
    assert.match(mailPayload.html, />Booking</);
    assert.match(mailPayload.html, /Cash offset/);
    assert.match(mailPayload.html, /Warranty job 36341/);
    assert.match(mailPayload.html, /02\/10\/2026/);
    assert.match(mailPayload.html, /-\$300\.00/);
    assert.match(mailPayload.html, /-\$157\.00/);
    assert.doesNotMatch(mailPayload.html, /\$999\.00/);
    assert.doesNotMatch(mailPayload.html, /Payment review|Cash tagged|Bank transfer, review|&mdash;/);

    const summaryResponse = responseRecorder();
    await reportsHandler({
      method: 'POST',
      headers: { 'x-purchase-order-pin': '4321' },
      body: {
        to: 'alex@example.com',
        cc: 'vignesh@goldsure.com.au',
        subject: 'Installation summary - Alex Symonds - 14 Sep 2026 to 20 Sep 2026',
        emailMode: 'summary',
        purchaseOrder,
      },
    }, summaryResponse);
    assert.equal(summaryResponse.statusCode, 200);
    assert.match(mailPayload.html, /INSTALLATION SUMMARY/);
    assert.match(mailPayload.html, /GROSS EARNINGS/);
    assert.match(mailPayload.html, /02\/10\/2026/);
    assert.doesNotMatch(mailPayload.html, /Payment review|Cash tagged|Bank transfer, review|&mdash;/);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
