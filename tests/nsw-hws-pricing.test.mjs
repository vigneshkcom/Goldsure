import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  calculateQuote,
  DEPOSIT_AMOUNT,
  getBasePrice,
} from '../api/hotwater-nsw/pricing.js';

test('uses the September 2026 D17 and D19 model pricing', () => {
  assert.equal(getBasePrice('electric', 'EG-290FR'), 1999);
  assert.equal(getBasePrice('electric', 'EG-330FR'), 1599);
  assert.equal(getBasePrice('electric', 'ECON-300RVW'), 1999);
  assert.equal(getBasePrice('gas', 'EG-330FR'), 1999);
  assert.equal(getBasePrice('gas', 'ECON-300RVW'), 2399);
  assert.equal(getBasePrice('gas', 'EG-290FR'), 2399);
});

test('always prices EG-290FR the same as ECON-300RVW', () => {
  for (const existingSystem of ['electric', 'gas', 'solar_boosted']) {
    assert.equal(
      getBasePrice(existingSystem, 'EG-290FR'),
      getBasePrice(existingSystem, 'ECON-300RVW'),
      existingSystem,
    );
  }
});

test('retains the previous price for models not listed on the new sheet', () => {
  assert.equal(getBasePrice('gas', 'ECON-300RVW-2.0E'), 2899);
  assert.equal(getBasePrice('solar_boosted', 'EG-330FR'), 3339);
});

test('finances the full installed price with zero upfront payment', () => {
  const quote = calculateQuote({
    existing_system: 'gas',
    heat_pump_model: 'ECON-300RVW',
    tank_staying: true,
    finance_requested: true,
    finance_term_years: 10,
  });

  assert.equal(DEPOSIT_AMOUNT, 0);
  assert.equal(quote.base_price, 2399);
  assert.equal(quote.final_price, 2399);
  assert.equal(quote.deposit_amount, 0);
  assert.equal(quote.amount_financed, 2399);
  assert.equal(quote.fortnightly_repayment, 9.23);
  assert.equal(quote.monthly_repayment, 19.99);
});

test('keeps the browser quote calculator aligned with server pricing', () => {
  const builder = readFileSync(new URL('../hotwater-nsw/quote-builder.html', import.meta.url), 'utf8');

  assert.match(builder, /electric:\{ 'EG-330FR':1599, 'ECON-300RVW':1999/);
  assert.match(builder, /gas:\{ 'EG-330FR':1999, 'ECON-300RVW':2399/);
  assert.match(builder, /const PRICE_EQUIVALENT_MODEL = \{ 'EG-290FR':'ECON-300RVW' \};/);
  assert.match(builder, /const priceModel = PRICE_EQUIVALENT_MODEL\[heatPumpModel\] \|\| heatPumpModel;/);
  assert.match(builder, /const DEPOSIT_AMOUNT = 0;/);
  assert.match(builder, /getBasePrice\(state\.existing_system, state\.heat_pump_model\)/);
  assert.match(builder, /function updateModelPrices\(\)/);
  assert.match(builder, /option\.textContent = state\.existing_system \? `\$\{label\} · \$\{money\(price\)\}` : label/);
});
