// "$300 off if installed before 10 November" follow-up offer. The offer is
// applied to the customer's existing quote in place: the same row, the same
// personal link, the same GHL opportunity. The saving is recorded as a
// negative "Special offer discount" entry in other_extras (flagged with
// offer: 'discount-300'), so no schema change is needed and the quote page and
// email show it as its own line.
import { calculateQuote } from './pricing.js';

export const DISCOUNT_OFFER_CAMPAIGN = 'discount-300-nov-2026';
export const DISCOUNT_OFFER_KEY = 'discount-300';
export const DISCOUNT_OFFER_AMOUNT = 300;
export const DISCOUNT_OFFER_DEADLINE_ISO = '2026-11-10';
export const DISCOUNT_OFFER_DEADLINE_LABEL = '10 November 2026';
export const DISCOUNT_OFFER_SUBJECT = 'Special Offer: $300 Off Your Goldsure Hot Water Installation';
const BRIGHTE_MINIMUM_FINANCE_AMOUNT = 2000;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const money = (value) => '$' + (Number(value) || 0).toLocaleString('en-AU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function findDiscountOffer(quote) {
  const extras = Array.isArray(quote?.other_extras) ? quote.other_extras : [];
  return extras.find((e) => e && e.offer === DISCOUNT_OFFER_KEY) || null;
}

// Offers are only valid up to the deadline (end of that day, Sydney time).
export function isDiscountOfferOpen(now = new Date()) {
  const todaySydney = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(now);
  return todaySydney < DISCOUNT_OFFER_DEADLINE_ISO;
}

export function isDiscountOfferEligibleQuote(quote) {
  return Boolean(
    quote
    && String(quote.status || '').toLowerCase() === 'sent'
    && !quote.accepted_at
    && !findDiscountOffer(quote)
    && (Number(quote.final_price) || 0) > DISCOUNT_OFFER_AMOUNT
  );
}

// Returns the column changes that apply the offer to `source`, plus what the
// customer-facing messages need. `revert` restores the original values if the
// email cannot be sent.
export function buildDiscountOfferUpdate(source, nowIso = new Date().toISOString()) {
  const oldPrice = round2(source.final_price);
  const newPrice = round2(Math.max(0, oldPrice - DISCOUNT_OFFER_AMOUNT));
  // The Brighte loan needs at least $2,000 financed; rather than silently
  // lifting the price back up, drop the loan on quotes that fall under it.
  const keepFinance = source.finance_requested === true && newPrice >= BRIGHTE_MINIMUM_FINANCE_AMOUNT;
  const financeDropped = source.finance_requested === true && !keepFinance;

  const calc = calculateQuote({
    ...source,
    other_extras: Array.isArray(source.other_extras) ? source.other_extras : [],
    final_price_override: newPrice,
    finance_requested: keepFinance,
    finance_term_years: source.finance_term_years || 10,
    income_eligible: source.income_eligible || null,
    apply_no_finance_discount: false,
  });

  const marker = {
    label: 'Special offer discount',
    amount: -DISCOUNT_OFFER_AMOUNT,
    offer: DISCOUNT_OFFER_KEY,
    previous_price: oldPrice,
    applied_at: nowIso,
    deadline: DISCOUNT_OFFER_DEADLINE_ISO,
  };

  const patch = {
    other_extras: [...(Array.isArray(source.other_extras) ? source.other_extras : []), marker],
    total_extras: round2((Number(source.total_extras) || 0) - DISCOUNT_OFFER_AMOUNT),
    final_price: newPrice,
    finance_requested: calc.finance_requested,
    finance_eligibility: calc.finance_eligibility,
    finance_term_years: calc.finance_term_years,
    deposit_amount: calc.deposit_amount,
    amount_financed: calc.amount_financed,
    fortnightly_repayment: calc.fortnightly_repayment,
    monthly_repayment: calc.monthly_repayment,
    updated_at: nowIso,
  };
  const revert = Object.fromEntries(Object.keys(patch).map((k) => [k, source[k] === undefined ? null : source[k]]));

  return {
    oldPrice,
    newPrice,
    financeDropped,
    patch,
    revert,
    emailBody: buildDiscountOfferEmailBody(oldPrice, newPrice, financeDropped),
  };
}

export function buildDiscountOfferEmailBody(oldPrice, newPrice, financeDropped = false) {
  return 'Thank you for considering Goldsure for your hot water upgrade. '
    + `As a special promotion, we are happy to take ${money(DISCOUNT_OFFER_AMOUNT)} off your installation if it is completed before ${DISCOUNT_OFFER_DEADLINE_LABEL}. `
    + `Your previous quoted price was ${money(oldPrice)}. Your special offer price is ${money(newPrice)}, saving you ${money(DISCOUNT_OFFER_AMOUNT)}. `
    + 'Your updated quote is below, and the same personal link you received before now shows the new price.'
    + (financeDropped
      ? ` Please note that with the ${money(DISCOUNT_OFFER_AMOUNT)} off, the total falls below $2,000, and unfortunately we would not be able to offer the Home Energy Saver loan by Brighte on this price, as Brighte's minimum loan amount is $2,000. `
        + 'Whichever way you would prefer, we are happy to work with you: you can take the special offer price, or keep your original quote with the Brighte loan option. Just reply to this email or give us a call and we will sort it out.'
      : '');
}

// Personal text from whoever sent the original quote.
export function buildDiscountOfferSms({ firstName, agentName, previousPrice, newPrice, quoteUrl }) {
  const agent = String(agentName || '').trim();
  const intro = agent
    ? `Hi ${firstName}, ${agent} from Goldsure here.`
    : `Hi ${firstName}, it's the team at Goldsure.`;
  return `${intro} Just wanted to let you know we're running a special promotion. `
    + `We sent you a quote for ${money(previousPrice)} for your heat pump hot water system. `
    + `If you get it installed, or even book it in, before ${DISCOUNT_OFFER_DEADLINE_LABEL}, we're happy to take ${money(DISCOUNT_OFFER_AMOUNT)} off your original quoted amount, `
    + `bringing it down to ${money(newPrice)}.\n\n`
    + `You can view your new offer here: ${quoteUrl}`;
}
