export const SEPTEMBER_OFFER_CAMPAIGN = 'september-2026';
export const SEPTEMBER_OFFER_TOKEN_PREFIX = 'sep26';
export const SEPTEMBER_OFFER_CUTOFF = '2026-09-15T02:07:16.360Z';
export const SEPTEMBER_OFFER_SUBJECT = 'September Offer: Your Updated Goldsure Hot Water Quote';
export const SEPTEMBER_OFFER_EMAIL_BODY = 'Thank you for speaking with us previously about upgrading your hot water system. '
  + 'For September, Goldsure has new reduced pricing available. We have prepared an updated quote using the latest price. '
  + 'The full installed price can also be included in the Home Energy Saver loan by Brighte with $0 upfront payment, subject to approval and eligibility. '
  + 'This September offer is valid for 21 days from the date of this quote.';

const money = (value) => '$' + (Number(value) || 0).toLocaleString('en-AU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function buildSeptemberOfferEmailBody(oldPrice, newPrice) {
  const saving = Math.max(0, (Number(oldPrice) || 0) - (Number(newPrice) || 0));
  return 'Thank you for speaking with us previously about upgrading your hot water system. '
    + `For September, Goldsure has new reduced pricing. Your previous quoted price was ${money(oldPrice)}. `
    + `Your updated offer is ${money(newPrice)}, saving you ${money(saving)}. `
    + 'The full installed price can also be included in the Home Energy Saver loan by Brighte with $0 upfront payment, subject to approval and eligibility. '
    + 'This September offer is valid for 21 days from the date of this quote.';
}

export function isSeptemberOfferToken(token) {
  return String(token || '').startsWith(`${SEPTEMBER_OFFER_TOKEN_PREFIX}-`);
}

export function isSeptemberOfferEligibleQuote(quote) {
  const sentAt = new Date(quote?.sent_at || quote?.created_at || 0);
  return Boolean(
    quote
    && String(quote.status || '').toLowerCase() === 'sent'
    && !isSeptemberOfferToken(quote.quote_token)
    && !Number.isNaN(sentAt.getTime())
    && sentAt.getTime() <= new Date(SEPTEMBER_OFFER_CUTOFF).getTime()
  );
}

export function buildSeptemberOfferInput(source, agentName) {
  return {
    ...source,
    campaign: SEPTEMBER_OFFER_CAMPAIGN,
    source_quote_id: source.id,
    agent_name: String(agentName || source.agent_name || '').trim() || null,
    finance_requested: true,
    finance_term_years: 10,
    income_eligible: null,
    apply_no_finance_discount: false,
    no_finance_discount: 0,
    email_body: SEPTEMBER_OFFER_EMAIL_BODY,
  };
}

export function buildSeptemberOfferToken(sourceId, uniquePart) {
  return `${SEPTEMBER_OFFER_TOKEN_PREFIX}-${sourceId}-${uniquePart}`;
}
