// api/hotwater-nsw/pricing.js
// Server-side pricing/finance rules for the NSW Hot Water Quote Builder,
// shared by quotes.js and send.js so the numbers a quote is saved with and
// the numbers it's emailed/texted with can never drift apart.
//
// Figures confirmed for this build (2026-08):
//   Base price is driven by existing system only — all 3 heat pump models
//   (290L All-in-One, 290L Split, 330L Split) share the same base price.
//   Back-to-back relocation ($460 flat) is charged IN ADDITION TO any
//   standard per-metre relocation metres entered for the same job (not a
//   replacement) — e.g. a back-to-back job that also needs some pipe run
//   relocated pays $460 + (metres × $155).
//   Solar-boosted-to-heat-pump has no HEER activity code (only D17 electric
//   and D19 gas are eligible activities) — the field is left blank/TBD.

export const BASE_PRICE = {
  electric: 2499,
  gas: 2899,
  solar_boosted: 3339,
};

export const ACTIVITY_CODE = {
  electric: 'D17',
  gas: 'D19',
  solar_boosted: null, // no HEER activity code for solar-boosted → heat pump
};

export const EXISTING_SYSTEM_LABEL = {
  electric: 'Electric hot water',
  gas: 'Gas hot water',
  solar_boosted: 'Solar boosted hot water',
};

export const HEAT_PUMP_LABEL = {
  '290-all-in-one': '290L All-in-One',
  '290-split': '290L Split System',
  '330-split': '330L Split System',
};

export const RELOCATION_PER_METRE = 155;
export const BACK_TO_BACK_FLAT = 460;
export const CABLE_INCLUDED_METRES = 15; // included in the gas base price
export const CABLE_PER_METRE = 20;
export const FINANCE_TERM_YEARS = [1, 2, 3, 5, 7, 10];
export const INCOME_THRESHOLD = 210000;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Recomputes every derived pricing/finance figure from raw inputs. Never
// trusts numbers sent from the client — always the source of truth for what
// gets saved and what gets quoted to the customer.
export function calculateQuote(input = {}) {
  const existingSystem = input.existing_system;
  const basePrice = BASE_PRICE[existingSystem] || 0;
  const activityCode = ACTIVITY_CODE[existingSystem] ?? null;

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
  const finalPrice = round2(basePrice + totalExtras);

  const financeRequested = !!input.finance_requested;
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
  const fortnightlyRepayment = round2(finalPrice / (termYears * 26));
  const monthlyRepayment = round2(finalPrice / (termYears * 12));

  return {
    base_price: basePrice,
    activity_code: activityCode,
    relocation_type: relocationType,
    relocation_metres: relocationMetres,
    relocation_charge: relocationCharge,
    back_to_back_charge: backToBackCharge,
    cable_metres: cableMetres,
    cable_chargeable_metres: cableChargeableMetres,
    cable_charge: cableCharge,
    other_extras: otherExtras,
    total_extras: totalExtras,
    final_price: finalPrice,
    finance_requested: financeRequested,
    income_eligible: incomeEligible,
    finance_eligibility: financeEligibility,
    finance_term_years: termYears,
    fortnightly_repayment: fortnightlyRepayment,
    monthly_repayment: monthlyRepayment,
  };
}
