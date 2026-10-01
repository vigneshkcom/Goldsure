import { syncAcceptedSmokeQuoteToDataforce } from '../../lib/dataforce-smoke-quote.js';

function statusForReason(reason) {
  if (reason === 'quote-not-found') return 404;
  if (reason === 'quote-not-customer-accepted' || reason === 'quote-not-accepted') return 409;
  if (reason === 'supabase-not-configured') return 503;
  if (String(reason || '').startsWith('quote-lookup-failed-')) return 502;
  return 400;
}

export function createPushDataforceHandler({ sync = syncAcceptedSmokeQuoteToDataforce } = {}) {
  return async function pushDataforceHandler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    }

    const body = req.body || {};
    const expectedPin = String(
      process.env.DATAFORCE_PUSH_PIN || process.env.SMS_DELETE_PIN || '4321'
    );
    if (String(body.pin || '') !== expectedPin) {
      return res.status(403).json({ ok: false, error: 'Incorrect password.' });
    }

    const quoteToken = String(body.quoteToken || '').trim();
    if (!quoteToken) {
      return res.status(400).json({ ok: false, error: 'Quote token is required.' });
    }

    try {
      const result = await sync({ quoteToken });
      if (!result.synced) {
        const customerAcceptanceMissing = result.reason === 'quote-not-customer-accepted';
        return res.status(statusForReason(result.reason)).json({
          ok: false,
          reason: result.reason,
          error: customerAcceptanceMissing
            ? 'Only a quote accepted by the customer can be pushed to Dataforce.'
            : 'This quote could not be pushed to Dataforce.',
        });
      }

      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      console.error('[Smoke tracker Dataforce push]', error.message, error.dataforceDetails || '');
      return res.status(502).json({
        ok: false,
        reason: error.message || 'dataforce-request-failed',
        error: 'Dataforce could not create the job. Please try again.',
      });
    }
  };
}

export default createPushDataforceHandler();
