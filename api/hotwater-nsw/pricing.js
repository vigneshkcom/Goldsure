// api/hotwater-nsw/pricing.js
// Server-side pricing/finance rules for the NSW Hot Water Quote Builder,
// shared by quotes.js and send.js so the numbers a quote is saved with and
// the numbers it's emailed/texted with can never drift apart.
//
// Figures confirmed for this build (2026-08):
//   Base price is driven by the existing system only — every heat pump model
//   shares the same base price for a given existing system.
//   Back-to-back relocation ($460 flat) is charged IN ADDITION TO any
//   standard per-metre relocation metres entered for the same job (not a
//   replacement) — e.g. a back-to-back job that also needs some pipe run
//   relocated pays $460 + (metres × $155).

export const BASE_PRICE = {
  electric: 2499,
  gas: 2899,
  solar_boosted: 3339,
};

export const EXISTING_SYSTEM_LABEL = {
  electric: 'Electric hot water',
  gas: 'Gas hot water',
  solar_boosted: 'Solar boosted hot water',
};

// Keep legacy model labels here as well so previously saved quotes continue to
// display their original product names correctly.
export const HEAT_PUMP_LABEL = {
  'EG-290FR':          'EG-290FR — 290L Split System',
  'EG-330FR':          'EG-330FR — 330L Split System',
  'ECON-300RVW':       'ECON-300RVW — 290L All-in-One',
  'ECON-300RVW-2.0E':  'ECON-300RVW-2.0E — 290L All-in-One',
  'ECON-300SV-4.2E':  'ECON-300SV-4.2E — 290L Split System',
  'EG-330FRE-WR':     'EG-330FRE-WR — 330L Split System',
};

export const RELOCATION_PER_METRE = 155;
export const BACK_TO_BACK_FLAT = 460;
export const CABLE_INCLUDED_METRES = 15; // included in the gas base price
export const CABLE_PER_METRE = 20;
export const FINANCE_TERM_YEARS = [1, 2, 3, 5, 7, 10];
export const INCOME_THRESHOLD = 210000;
// Minimum customer co-payment under the NSW schemes. Taken up front as the
// deposit that starts the job — it is part of the quoted total, not an extra
// on top of it.
export const DEPOSIT_AMOUNT = 220;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Recomputes every derived pricing/finance figure from raw inputs. Never
// trusts numbers sent from the client — always the source of truth for what
// gets saved and what gets quoted to the customer.
export function calculateQuote(input = {}) {
  const existingSystem = input.existing_system;
  const basePrice = BASE_PRICE[existingSystem] || 0;

  const tankStaying = !!input.tank_staying;
  const relocationType = tankStaying ? null : (input.relocation_type || null);
  const relocationMetres = tankStaying ? 0 : Math.max(0, Number(input.relocation_metres) || 0);
  const relocationCharge = relocationType && relocationMetres > 0
    ? round2(relocationMetres * RELOCATION_PER_METRE)
    : 0;
  const backToBackCharge = relocationType === 'back_to_back' ? BACK_TO_BACK_FLAT : 0;

  const cableMetres = existingSystem === 'gas' ? Math.max(0, Number(input.cable_metres) || 0) : 0;
  const cableChargeableMetres = Math.max(0, cableMetres - CABLE_INCLUDED_METRES);
  const cableCharge = round2(cableChargeableMetres * CABLE_PER_METRE);

  const otherExtras = Array.isArray(input.other_extras) ? input.other_extras : [];
  const otherExtrasTotal = round2(otherExtras.reduce((sum, e) => sum + (Number(e.amount) || 0), 0));

  const totalExtras = round2(relocationCharge + backToBackCharge + cableCharge + otherExtrasTotal);

  // The Home Energy Saver loan by Brighte does not charge Goldsure a vendor fee, so
  // choosing upfront payment must not alter the price automatically. An agent
  // can deliberately apply a discretionary Goldsure discount and choose its
  // amount; never let that reduce the quote below zero.
  const financeRequested = !!input.finance_requested;
  const applyNoFinanceDiscount = !financeRequested && input.apply_no_finance_discount === true;
  const requestedNoFinanceDiscount = round2(Math.max(0, Number(input.no_finance_discount_amount) || 0));
  const noFinanceDiscount = applyNoFinanceDiscount
    ? Math.min(requestedNoFinanceDiscount, basePrice + totalExtras)
    : 0;
  const finalPrice = round2(basePrice + totalExtras - noFinanceDiscount);

  const incomeEligible = input.income_eligible || null; // 'yes' | 'no' | 'needs_confirmation'
  const financeEligibility = !financeRequested
    ? 'n_a'
    : incomeEligible === 'no'
    ? 'not_eligible'
    : incomeEligible === 'yes'
    ? 'potentially_eligible'
    : 'needs_confirmation';

  const termYears = FINANCE_TERM_YEARS.includes(Number(input.finance_term_years))
    ? Number(input.finance_term_years)
    : 10;
  // Brighte finances the balance after the deposit, not the whole job — the $220
  // scheme co-payment is taken up front, so repayments are worked out on what is
  // actually borrowed.
  const amountFinanced = financeRequested
    ? round2(Math.max(0, finalPrice - DEPOSIT_AMOUNT))
    : 0;
  const fortnightlyRepayment = round2(amountFinanced / (termYears * 26));
  const monthlyRepayment = round2(amountFinanced / (termYears * 12));

  return {
    base_price: basePrice,
    relocation_type: relocationType,
    relocation_metres: relocationMetres,
    relocation_charge: relocationCharge,
    back_to_back_charge: backToBackCharge,
    cable_metres: cableMetres,
    cable_chargeable_metres: cableChargeableMetres,
    cable_charge: cableCharge,
    other_extras: otherExtras,
    total_extras: totalExtras,
    no_finance_discount: noFinanceDiscount,
    final_price: finalPrice,
    finance_requested: financeRequested,
    income_eligible: incomeEligible,
    finance_eligibility: financeEligibility,
    finance_term_years: termYears,
    deposit_amount: DEPOSIT_AMOUNT,
    amount_financed: amountFinanced,
    fortnightly_repayment: fortnightlyRepayment,
    monthly_repayment: monthlyRepayment,
  };
}
