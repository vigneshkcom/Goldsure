// "$300 off if installed before 10 November" follow-up offer. Re-issues an
// existing sent quote at its original price less the promotional discount,
// as a new personal quote link, so the customer sees the saving as its own line.
export const DISCOUNT_OFFER_CAMPAIGN = 'discount-300-nov-2026';
export const DISCOUNT_OFFER_TOKEN_PREFIX = 'off300';
export const DISCOUNT_OFFER_AMOUNT = 300;
export const DISCOUNT_OFFER_DEADLINE_ISO = '2026-11-10';
export const DISCOUNT_OFFER_DEADLINE_LABEL = '10 November 2026';
export const DISCOUNT_OFFER_SUBJECT = 'Special Offer: $300 Off Your Goldsure Hot Water Installation';
const BRIGHTE_MINIMUM_FINANCE_AMOUNT = 2000;

const money = (value) => '$' + (Number(value) || 0).toLocaleString('en-AU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function isDiscountOfferToken(token) {
  return String(token || '').startsWith(`${DISCOUNT_OFFER_TOKEN_PREFIX}-`);
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
    && !isDiscountOfferToken(quote.quote_token)
    && !String(quote.quote_token || '').startsWith('sep26-')
    && (Number(quote.final_price) || 0) > DISCOUNT_OFFER_AMOUNT
  );
}

export function buildDiscountOfferInput(source, agentName) {
  const oldPrice = Number(source.final_price) || 0;
  const newPrice = Math.max(0, oldPrice - DISCOUNT_OFFER_AMOUNT);
  // The Brighte loan needs at least $2,000 financed; rather than silently
  // lifting the price back up, drop the loan on quotes that fall under it.
  const keepFinance = source.finance_requested === true && newPrice >= BRIGHTE_MINIMUM_FINANCE_AMOUNT;
  return {
    ...source,
    campaign: DISCOUNT_OFFER_CAMPAIGN,
    source_quote_id: source.id,
    agent_name: String(agentName || source.agent_name || '').trim() || null,
    final_price_override: newPrice,
    previous_price: oldPrice,
    finance_requested: keepFinance,
    finance_dropped: source.finance_requested === true && !keepFinance,
    finance_term_years: source.finance_term_years || 10,
    income_eligible: source.income_eligible || null,
    apply_no_finance_discount: false,
    email_body: buildDiscountOfferEmailBody(oldPrice, newPrice),
  };
}

export function buildDiscountOfferEmailBody(oldPrice, newPrice) {
  return 'Thank you for considering Goldsure for your hot water upgrade. '
    + `As a special promotion, we are happy to take ${money(DISCOUNT_OFFER_AMOUNT)} off your installation if it is completed before ${DISCOUNT_OFFER_DEADLINE_LABEL}. `
    + `Your previous quoted price was ${money(oldPrice)}. Your special offer price is ${money(newPrice)}, saving you ${money(DISCOUNT_OFFER_AMOUNT)}.`;
}

export function buildDiscountOfferToken(sourceId, uniquePart) {
  return `${DISCOUNT_OFFER_TOKEN_PREFIX}-${sourceId}-${uniquePart}`;
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
