import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { calculateQuote } from '../api/hotwater-nsw/pricing.js';
import sendQuoteHandler from '../api/hotwater-nsw/send.js';
import {
  SEPTEMBER_OFFER_CAMPAIGN,
  SEPTEMBER_OFFER_CUTOFF,
  SEPTEMBER_OFFER_EMAIL_BODY,
  SEPTEMBER_OFFER_SUBJECT,
  buildSeptemberOfferInput,
  buildSeptemberOfferToken,
  isSeptemberOfferEligibleQuote,
} from '../api/hotwater-nsw/september-offer.js';

const hongQuote = {
  id: 'bd2096a3-fb67-4200-a6b4-c45d66ccdfcc',
  quote_token: 'original-token',
  customer_name: 'Hong Tan Nguyen',
  customer_email: 'customer@example.com',
  status: 'sent',
  sent_at: SEPTEMBER_OFFER_CUTOFF,
  agent_name: 'David',
  existing_system: 'electric',
  heat_pump_model: 'ECON-300RVW',
  tank_staying: true,
  final_price: 2499,
};

test('limits the September offer to sent quotes from Hong Tan and below', () => {
  assert.equal(isSeptemberOfferEligibleQuote(hongQuote), true);
  assert.equal(isSeptemberOfferEligibleQuote({ ...hongQuote, sent_at: '2026-09-15T02:07:17.000Z' }), false);
  assert.equal(isSeptemberOfferEligibleQuote({ ...hongQuote, status: 'accepted' }), false);
  assert.equal(isSeptemberOfferEligibleQuote({ ...hongQuote, quote_token: 'sep26-existing' }), false);
});

test('builds a fresh September offer with current pricing and zero upfront', () => {
  const input = buildSeptemberOfferInput(hongQuote, 'Vignesh');
  const calculated = calculateQuote(input);

  assert.equal(input.campaign, SEPTEMBER_OFFER_CAMPAIGN);
  assert.equal(input.agent_name, 'Vignesh');
  assert.equal(input.finance_requested, true);
  assert.equal(input.finance_term_years, 10);
  assert.equal(input.no_finance_discount, 0);
  assert.equal(input.email_body, SEPTEMBER_OFFER_EMAIL_BODY);
  assert.equal(calculated.final_price, 1999);
  assert.equal(calculated.deposit_amount, 0);
  assert.equal(calculated.amount_financed, 1999);
  assert.equal(buildSeptemberOfferToken(hongQuote.id, 'new-token'), `sep26-${hongQuote.id}-new-token`);
});

test('previews an eligible offer without sending or inserting anything', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_ANON_KEY;
  const requested = [];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-key';
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).includes('quote_token=eq.original-token')) {
      return new Response(JSON.stringify([hongQuote]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).includes('quote_token=like.sep26-')) {
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  let statusCode = 200;
  let payload;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return value; },
  };
  try {
    await sendQuoteHandler({
      method: 'POST',
      body: { action: 'preview-september-offer', source_quote_token: 'original-token', agent_name: 'Vignesh' },
    }, res);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = originalKey;
  }

  assert.equal(statusCode, 200);
  assert.equal(payload.eligible, true);
  assert.equal(payload.old_price, 2499);
  assert.equal(payload.new_price, 1999);
  assert.equal(payload.savings, 500);
  assert.equal(requested.length, 2);
});

test('connects the tracker, campaign email and personal quote page', () => {
  const tracker = readFileSync(new URL('../hotwater-nsw/quote-tracker.html', import.meta.url), 'utf8');
  const sender = readFileSync(new URL('../api/hotwater-nsw/send.js', import.meta.url), 'utf8');
  const quote = readFileSync(new URL('../hotwater-nsw/quote.html', import.meta.url), 'utf8');

  assert.match(tracker, /Prepare Offer/);
  assert.match(tracker, /action:'preview-september-offer'/);
  assert.match(tracker, /action:'send-september-offer'/);
  assert.match(sender, /SEPTEMBER_OFFER_SUBJECT/);
  assert.match(sender, /SEPTEMBER_OFFER_EMAIL_BODY/);
  assert.match(quote, /Updated pricing exclusively for previous Goldsure customers/);
  assert.equal(SEPTEMBER_OFFER_SUBJECT, 'September Offer: Your Updated Goldsure Hot Water Quote');
});

test('September offer page scripts compile', () => {
  for (const file of ['../hotwater-nsw/quote-tracker.html', '../hotwater-nsw/quote.html']) {
    const html = readFileSync(new URL(file, import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(([, attrs]) => !/\bsrc\s*=/.test(attrs))
      .map(([, , source]) => source);
    assert.ok(scripts.length > 0, file);
    for (const source of scripts) assert.doesNotThrow(() => new Function(source), file);
  }
});
