import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  calculateQuote,
  BRIGHTE_MINIMUM_FINANCE_AMOUNT,
  UPFRONT_PAYMENT_AMOUNT,
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
  for (const existingSystem of ['electric', 'gas', 'solar_boosted', 'existing_heat_pump']) {
    assert.equal(
      getBasePrice(existingSystem, 'EG-290FR'),
      getBasePrice(existingSystem, 'ECON-300RVW'),
      existingSystem,
    );
  }
});

test('retains the previous price for models not listed on the new sheet', () => {
  assert.equal(getBasePrice('gas', 'ECON-300RVW-2.0E'), 2899);
  assert.equal(getBasePrice('solar_boosted', 'EG-330FR'), 2639);
});

test('finances the full installed price when it meets Brighte minimum finance amount', () => {
  const quote = calculateQuote({
    existing_system: 'gas',
    heat_pump_model: 'ECON-300RVW',
    tank_staying: true,
    finance_requested: true,
    finance_term_years: 10,
  });

  assert.equal(BRIGHTE_MINIMUM_FINANCE_AMOUNT, 2000);
  assert.equal(quote.base_price, 2399);
  assert.equal(quote.final_price, 2399);
  assert.equal(quote.deposit_amount, 0);
  assert.equal(quote.finance_available, true);
  assert.equal(quote.amount_financed, 2399);
  assert.equal(quote.fortnightly_repayment, 9.23);
  assert.equal(quote.monthly_repayment, 19.99);
});

test('raises a low-price Brighte loan to the $2,000 minimum finance amount', () => {
  const quote = calculateQuote({
    existing_system: 'electric',
    heat_pump_model: 'EG-330FR',
    tank_staying: true,
    finance_requested: true,
  });

  assert.equal(quote.base_price, 2000);
  assert.equal(quote.final_price, 2000);
  assert.equal(quote.loan_minimum_adjustment, 401);
  assert.equal(quote.finance_available, true);
  assert.equal(quote.amount_financed, 2000);
});

test('keeps the normal upfront payment arrangement when the customer does not use the loan', () => {
  const quote = calculateQuote({
    existing_system: 'gas',
    heat_pump_model: 'ECON-300RVW',
    tank_staying: true,
    finance_requested: false,
  });

  assert.equal(UPFRONT_PAYMENT_AMOUNT, 0);
  assert.equal(quote.deposit_amount, 0);
  assert.equal(quote.amount_financed, 0);
});

test('prices an existing heat pump exactly like a solar boosted system', () => {
  for (const model of ['EG-290FR', 'EG-330FR', 'ECON-300RVW', 'ECON-300RVW-2.0E']) {
    assert.equal(getBasePrice('existing_heat_pump', model), getBasePrice('solar_boosted', model), model);
  }
});

test('keeps the browser quote calculator aligned with server pricing', () => {
  const builder = readFileSync(new URL('../hotwater-nsw/quote-builder.html', import.meta.url), 'utf8');

  assert.match(builder, /electric:\{ 'EG-330FR':1599, 'ECON-300RVW':1999/);
  assert.match(builder, /gas:\{ 'EG-330FR':1999, 'ECON-300RVW':2399/);
  assert.match(builder, /const PRICE_EQUIVALENT_MODEL = \{ 'EG-290FR':'ECON-300RVW' \};/);
  assert.match(builder, /const priceModel = PRICE_EQUIVALENT_MODEL\[heatPumpModel\] \|\| heatPumpModel;/);
  assert.match(builder, /existing_heat_pump:\{ default:2639 \}/);
  assert.match(builder, /BRIGHTE_MINIMUM_FINANCE_AMOUNT = 2000/);
  assert.match(builder, /id="summaryFinanceToggle" onclick="toggleFinanceFromSummary\(\)"/);
  assert.match(builder, /function toggleFinanceFromSummary\(\)\{ setFinance\(!state\.finance_requested\); \}/);
  assert.match(builder, /getBasePrice\(state\.existing_system, state\.heat_pump_model\)/);
  assert.match(builder, /function updateModelPrices\(\)/);
  assert.match(builder, /option\.textContent = state\.existing_system \? `\$\{label\} · \$\{money\(price\)\}` : label/);
});

test('lets an agent override the final price below the calculated total as a discount', () => {
  const quote = calculateQuote({
    existing_system: 'solar_boosted',
    heat_pump_model: 'EG-330FR',
    tank_staying: true,
    final_price_override: 2400,
    finance_requested: true,
    finance_term_years: 10,
  });

  assert.equal(quote.final_price, 2400);
  assert.equal(quote.no_finance_discount, 239);
  assert.equal(quote.base_price + quote.total_extras - quote.no_finance_discount, 2400);
  assert.equal(quote.deposit_amount, 0);
  assert.equal(quote.amount_financed, 2400);
});

test('lets an agent override the final price above the calculated total', () => {
  const quote = calculateQuote({
    existing_system: 'solar_boosted',
    heat_pump_model: 'EG-330FR',
    tank_staying: true,
    final_price_override: 3000,
  });

  assert.equal(quote.final_price, 3000);
  assert.equal(quote.no_finance_discount, 0);
  assert.equal(quote.base_price + quote.total_extras, 3000);
});

test('ignores a blank or invalid final price override', () => {
  for (const final_price_override of [null, '', undefined, 0, -50, 'abc']) {
    const quote = calculateQuote({
      existing_system: 'solar_boosted',
      heat_pump_model: 'EG-330FR',
      tank_staying: true,
      final_price_override,
    });
    assert.equal(quote.final_price, 2639);
  }
});
