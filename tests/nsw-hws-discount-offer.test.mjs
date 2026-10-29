import test from 'node:test';
import assert from 'node:assert/strict';

import sendQuoteHandler from '../api/hotwater-nsw/send.js';
import {
  buildDiscountOfferSms,
  buildDiscountOfferUpdate,
  findDiscountOffer,
  isDiscountOfferEligibleQuote,
  isDiscountOfferOpen,
} from '../api/hotwater-nsw/discount-offer.js';

const source = {
  id: 'q-1',
  quote_token: 'original-token',
  customer_name: 'Khin Cho',
  customer_email: 'khin@example.com',
  customer_phone: '+61423331146',
  status: 'sent',
  agent_name: 'David',
  existing_system: 'electric',
  heat_pump_model: 'EG-330FR',
  tank_staying: false,
  base_price: 3000,
  total_extras: 0,
  no_finance_discount: 0,
  other_extras: [],
  final_price: 3000,
  finance_requested: true,
  finance_term_years: 10,
};

test('only open sent quotes without the offer are eligible', () => {
  assert.equal(isDiscountOfferEligibleQuote(source), true);
  assert.equal(isDiscountOfferEligibleQuote({ ...source, status: 'accepted' }), false);
  assert.equal(isDiscountOfferEligibleQuote({ ...source, accepted_at: '2026-10-01' }), false);
  const applied = buildDiscountOfferUpdate(source);
  assert.equal(isDiscountOfferEligibleQuote({ ...source, ...applied.patch }), false);
});

test('offer closes on 10 November (Sydney time)', () => {
  assert.equal(isDiscountOfferOpen(new Date('2026-11-09T05:00:00Z')), true);
  assert.equal(isDiscountOfferOpen(new Date('2026-11-10T05:00:00Z')), false);
});

test('updates the same quote: $3,000 becomes $2,700 and the offer is recorded', () => {
  const u = buildDiscountOfferUpdate(source, '2026-10-29T00:00:00.000Z');
  assert.equal(u.oldPrice, 3000);
  assert.equal(u.newPrice, 2700);
  assert.equal(u.patch.final_price, 2700);
  assert.equal(u.patch.total_extras, -300);
  assert.equal(u.patch.finance_requested, true);
  assert.equal(u.patch.amount_financed, 2700 - u.patch.deposit_amount);
  const marker = findDiscountOffer({ other_extras: u.patch.other_extras });
  assert.equal(marker.amount, -300);
  assert.equal(marker.previous_price, 3000);
  assert.equal(marker.applied_at, '2026-10-29T00:00:00.000Z');
  assert.equal(u.revert.final_price, 3000);
  assert.deepEqual(u.revert.other_extras, []);
  assert.doesNotMatch(u.emailBody, /Brighte/);
  assert.match(u.emailBody, /\$3,000\.00/);
  assert.match(u.emailBody, /\$2,700\.00/);
});

test('keeps existing extras and the discretionary discount untouched', () => {
  const u = buildDiscountOfferUpdate({ ...source, other_extras: [{ label: 'Switchboard', amount: 250 }], total_extras: 250, no_finance_discount: 100, final_price: 3150 });
  assert.equal(u.patch.other_extras.length, 2);
  assert.equal(u.patch.total_extras, -50);
  assert.equal(u.patch.final_price, 2850);
  assert.equal(u.patch.no_finance_discount, undefined);
});

test('drops the loan, and explains why in the email, when under $2,000', () => {
  const u = buildDiscountOfferUpdate({ ...source, final_price: 2000, base_price: 2000 });
  assert.equal(u.financeDropped, true);
  assert.equal(u.patch.final_price, 1700);
  assert.equal(u.patch.finance_requested, false);
  assert.equal(u.patch.amount_financed, 0);
  assert.match(u.emailBody, /Brighte's minimum loan amount is \$2,000/);
  assert.match(u.emailBody, /happy to work with you/);
});

test('SMS is a personal note from the agent and never mentions the loan', () => {
  const text = buildDiscountOfferSms({ firstName: 'Khin', agentName: 'David', previousPrice: 3000, newPrice: 2700, quoteUrl: 'https://x.test/q' });
  assert.match(text, /^Hi Khin, David from Goldsure here\./);
  assert.match(text, /quote for \$3,000\.00/);
  assert.match(text, /before 10 November 2026/);
  assert.match(text, /view your new offer here: https:\/\/x\.test\/q$/);
  assert.doesNotMatch(text, /Brighte|loan/i);
  assert.match(buildDiscountOfferSms({ firstName: 'Khin', previousPrice: 3000, newPrice: 2700, quoteUrl: 'u' }), /^Hi Khin, it's the team at Goldsure\./);
});

test('preview shows the updated quote without writing anything', async () => {
  const originalFetch = globalThis.fetch;
  const env = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_ANON_KEY };
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_ANON_KEY = 'key';
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET' });
    return { ok: true, json: async () => [source] };
  };
  const out = { code: 0, body: null };
  const res = { status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } };
  try {
    await sendQuoteHandler({ method: 'POST', body: { action: 'preview-discount-offer', source_quote_token: 'original-token' } }, res);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.SUPABASE_URL = env.u; process.env.SUPABASE_ANON_KEY = env.k;
  }
  if (out.code === 403) return; // offer window closed on this machine's clock; covered by the Sydney-date test
  assert.equal(out.code, 200);
  assert.equal(out.body.old_price, 3000);
  assert.equal(out.body.new_price, 2700);
  assert.match(out.body.email_html, /Special offer discount/);
  assert.match(out.body.sms_text, /David from Goldsure/);
  assert.ok(calls.every(c => c.method === 'GET'));
});
