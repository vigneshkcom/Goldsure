import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dataforceProductCode,
  dataforceTransactionBalance,
  normaliseFieldworker,
  normalisePurchaseOrderLine,
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
    companyName: 'Alex Electrical',
    email: 'alex@example.com',
    phone: '',
    taxId: '12345678901',
    gstRegistered: true,
  });
});

test('builds a protected purchase-order preview from completed Dataforce jobs', async () => {
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
  let searchPayload;
  global.fetch = async (url, init = {}) => {
    const value = String(url);
    if (value.endsWith('/authorization/token')) return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
    if (value.endsWith('/GOLDSURE_ASAP/fieldworkers')) return new Response(JSON.stringify({ records: [{ fieldworkerId: 1009, name: 'Alex Symonds', companyName: 'Alex Electrical', email: 'alex@example.com', taxId: '12345678901', gstRegistered: true }] }), { status: 200 });
    if (value.includes('/appointments/search')) {
      searchPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({ totalCount: 1, records: [{ appointmentId: 9001, jobId: 7001, fieldworkerId: 1009, completionStatusDescription: 'Completed', actualCompletedDate: '2026-09-20T15:30:00' }] }), { status: 200 });
    }
    if (value.includes('/appointments/9001/invoice')) return new Response(JSON.stringify({ transactionBalance: 300, productLines: [{ productId: 3429, productName: '[3429] Booking Fee', lineQty: 1 }, { productId: 3430, productName: '[3430] Hard Wired', lineQty: 4 }] }), { status: 200 });
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
    assert.equal(searchPayload.filterGroups[0].filters[0].propertyName, 'actualCompletedDate');
    assert.equal(response.body.workers[0].email, 'alex@example.com');
    assert.equal(response.body.rows[0].items[0].totalIncGst, 33);
    assert.equal(response.body.rows[0].items[1].rateExGst, 13);
    assert.equal(response.body.rows[0].transactionBalance, 300);
    assert.equal(response.body.rows[0].balanceSource, 'appointment invoice');
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('sends a confirmed purchase order to the electrician and CCs Vignesh', async () => {
  const originalFetch = global.fetch;
  const previousEnv = {
    PURCHASE_ORDER_PIN: process.env.PURCHASE_ORDER_PIN,
    HOSTINGER_MAILBOX_RESOURCE_ID: process.env.HOSTINGER_MAILBOX_RESOURCE_ID,
    HOSTINGER_MAIL_API_TOKEN: process.env.HOSTINGER_MAIL_API_TOKEN,
  };
  Object.assign(process.env, {
    PURCHASE_ORDER_PIN: '4321',
    HOSTINGER_MAILBOX_RESOURCE_ID: 'mailbox',
    HOSTINGER_MAIL_API_TOKEN: 'token',
  });
  let mailPayload;
  global.fetch = async (url, init = {}) => {
    assert.match(String(url), /mailboxes\/mailbox\/send$/);
    mailPayload = JSON.parse(init.body);
    return new Response('', { status: 202 });
  };
  try {
    const response = responseRecorder();
    await reportsHandler({
      method: 'POST',
      headers: { 'x-purchase-order-pin': '4321' },
      body: {
        to: 'alex@example.com',
        subject: 'Purchase Order GS-PO-20260920-1009',
        purchaseOrder: {
          poNumber: 'GS-PO-20260920-1009',
          issueDate: '24 Sep 2026',
          period: '14 Sep 2026 to 20 Sep 2026',
          electrician: { name: 'Alex Symonds', companyName: 'Alex Electrical', email: 'alex@example.com', taxId: '12345678901', gstRegistered: true },
          totals: { subtotalExGst: 30, gst: 3, totalIncGst: 33 },
          jobs: [{
            jobId: '7001',
            installedDate: '20 Sep 2026',
            pendingBalance: 300,
            cashCollected: true,
            cashOffset: 300,
            items: [{ key: 'booking', name: 'Changed in browser', quantity: 1, rateExGst: 999, subtotalExGst: 999 }],
          }],
        },
      },
    }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(mailPayload.to, ['alex@example.com']);
    assert.deepEqual(mailPayload.cc, ['vignesh@goldsure.com.au']);
    assert.match(mailPayload.html, /GS-PO-20260920-1009/);
    assert.match(mailPayload.html, />Booking</);
    assert.match(mailPayload.html, /Cash offset/);
    assert.match(mailPayload.html, /-\$300\.00/);
    assert.match(mailPayload.html, /-\$267\.00/);
    assert.doesNotMatch(mailPayload.html, /\$999\.00/);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
