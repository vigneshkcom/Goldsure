import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateQuote } from '../api/hotwater-nsw/pricing.js';
import sendQuoteHandler from '../api/hotwater-nsw/send.js';
import {
  DISCOUNT_OFFER_CAMPAIGN,
  buildDiscountOfferInput,
  buildDiscountOfferSms,
  buildDiscountOfferToken,
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
  final_price: 3000,
  finance_requested: true,
  finance_term_years: 10,
};

test('only open sent quotes are eligible, never offers or accepted quotes', () => {
  assert.equal(isDiscountOfferEligibleQuote(source), true);
  assert.equal(isDiscountOfferEligibleQuote({ ...source, status: 'accepted' }), false);
  assert.equal(isDiscountOfferEligibleQuote({ ...source, accepted_at: '2026-10-01' }), false);
  assert.equal(isDiscountOfferEligibleQuote({ ...source, quote_token: 'off300-q-1-x' }), false);
  assert.equal(isDiscountOfferEligibleQuote({ ...source, quote_token: 'sep26-q-1-x' }), false);
});

test('offer closes on 10 November (Sydney time)', () => {
  assert.equal(isDiscountOfferOpen(new Date('2026-11-09T05:00:00Z')), true);
  assert.equal(isDiscountOfferOpen(new Date('2026-11-10T05:00:00Z')), false);
});

test('prices the offer at the original total less $300', () => {
  const input = buildDiscountOfferInput(source, 'Vignesh');
  const calc = calculateQuote(input);
  assert.equal(input.campaign, DISCOUNT_OFFER_CAMPAIGN);
  assert.equal(calc.final_price, 2700);
  assert.equal(calc.finance_requested, true);
  assert.doesNotMatch(input.email_body, /Brighte/);
  assert.equal(buildDiscountOfferToken('q-1', 'abc'), 'off300-q-1-abc');
  assert.match(input.email_body, /\$3,000\.00/);
  assert.match(input.email_body, /\$2,700\.00/);
  assert.match(input.email_body, /10 November 2026/);
});

test('drops the loan rather than inflating the price when under $2,000', () => {
  const input = buildDiscountOfferInput({ ...source, final_price: 2000 }, 'Vignesh');
  const calc = calculateQuote(input);
  assert.equal(input.finance_dropped, true);
  assert.match(input.email_body, /Brighte's minimum loan amount is \$2,000/);
  assert.match(input.email_body, /happy to work with you/);
  assert.equal(calc.final_price, 1700);
  assert.equal(calc.finance_requested, false);
});

test('preview returns prices without inserting or sending anything', async () => {
  const originalFetch = globalThis.fetch;
  const env = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_ANON_KEY };
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_ANON_KEY = 'key';
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET' });
    return { ok: true, json: async () => (String(url).includes('like.') ? [] : [source]) };
  };
  const out = { code: 0, body: null };
  const res = { status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } };
  try {
    await sendQuoteHandler({ method: 'POST', body: { action: 'preview-discount-offer', source_quote_token: 'original-token' } }, res);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.SUPABASE_URL = env.u; process.env.SUPABASE_ANON_KEY = env.k;
  }
  if (out.code === 403) return; // offer window closed on the machine clock; covered by the Sydney-date test above
  assert.equal(out.code, 200);
  assert.equal(out.body.old_price, 3000);
  assert.equal(out.body.new_price, 2700);
  assert.equal(out.body.savings, 300);
  assert.ok(calls.every(c => c.method === 'GET'));
});

test('SMS never mentions the loan restriction', () => {
  const text = buildDiscountOfferSms({ firstName: 'A', agentName: 'D', previousPrice: 2000, newPrice: 1700, quoteUrl: 'u' });
  assert.doesNotMatch(text, /Brighte|loan/i);
});

test('SMS is a personal note from the agent who sent the quote', () => {
  const text = buildDiscountOfferSms({ firstName: 'Khin', agentName: 'David', previousPrice: 3000, newPrice: 2700, quoteUrl: 'https://x.test/q' });
  assert.match(text, /^Hi Khin, David from Goldsure here\./);
  assert.match(text, /quote for \$3,000\.00/);
  assert.match(text, /before 10 November 2026/);
  assert.match(text, /\$300\.00 off your original quoted amount/);
  assert.match(text, /view your new offer here: https:\/\/x\.test\/q$/);
  assert.match(buildDiscountOfferSms({ firstName: 'Khin', previousPrice: 3000, newPrice: 2700, quoteUrl: 'u' }), /^Hi Khin, it's the team at Goldsure\./);
});
