// Persist only columns supported by nsw_hws_quotes. Calculator-only flags
// (finance_available and loan_minimum_adjustment) still drive validation and
// agent previews, but are not database columns. The adjusted base/final price,
// financed amount and repayments below preserve the complete quoted amounts.
export const NSW_QUOTE_PRICING_COLUMNS = Object.freeze([
  'base_price', 'relocation_type', 'relocation_metres', 'relocation_charge',
  'back_to_back_charge', 'cable_metres', 'cable_chargeable_metres', 'cable_charge',
  'other_extras', 'total_extras', 'no_finance_discount', 'final_price',
  'finance_requested', 'income_eligible', 'finance_eligibility', 'finance_term_years',
  'deposit_amount', 'amount_financed', 'fortnightly_repayment', 'monthly_repayment',
]);

export function nswQuotePricingRecord(calculation) {
  return Object.fromEntries(NSW_QUOTE_PRICING_COLUMNS.map(column => [column, calculation[column]]));
}
