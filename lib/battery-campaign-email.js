const PORTAL_URL = 'https://portal.goldsure.com.au';

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildBatteryCampaignEmail({ firstName = 'there', callbackUrl = `${PORTAL_URL}/Battery/request-callback.html` } = {}) {
  const name = escapeHtml(String(firstName).trim() || 'there');
  const safeCallbackUrl = escapeHtml(callbackUrl);
  const logo = `${PORTAL_URL}/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Goldsure | Home battery options</title></head>
<body style="margin:0;padding:0;background:#edeae3;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Eligible battery installations certified by 31 December may receive the higher 2026 STC factor.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#edeae3;"><tr><td align="center" style="padding:32px 12px 40px;">
    <table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="width:620px;max-width:620px;background:#fff;">
      <tr><td style="background:#0a0a0a;padding:14px 28px;"><table role="presentation" width="100%"><tr><td><img src="${logo}" alt="Goldsure" width="105" style="display:block;border:0;width:105px;height:auto;"></td><td align="right" style="font-family:Tahoma,Geneva,sans-serif;font-size:9px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#c6a34f;">Home Energy Solutions</td></tr></table></td></tr>
      <tr><td height="3" style="height:3px;background:#b8922a;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td align="center" style="background:#171512;padding:11px 22px;font-family:Tahoma,Geneva,sans-serif;font-size:10px;line-height:16px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#d5b55a;">Battery support changes 1 January 2027</td></tr>
      <tr><td style="background:#0f0f0f;padding:44px;"><p style="margin:0 0 10px;font-family:Tahoma,Geneva,sans-serif;font-size:10px;line-height:16px;letter-spacing:3.5px;font-weight:bold;text-transform:uppercase;color:#c6a34f;">Battery Update</p><h1 style="margin:0 0 14px;font-family:Tahoma,Geneva,sans-serif;font-size:38px;line-height:46px;color:#fff;">Thinking about a home battery?<br><span style="color:#d5b55a;">December matters.</span></h1><p style="margin:0;font-family:Tahoma,Geneva,sans-serif;font-size:17px;line-height:27px;font-weight:bold;color:#c6a34f;">Install by 31 December to access the higher 2026 support factor, if eligible.</p></td></tr>
      <tr><td style="padding:36px 44px 24px;font-size:16px;line-height:27px;color:#3e3b34;"><p style="margin:0 0 18px;">Hi ${name},</p><p style="margin:0 0 16px;">Thank you for choosing Goldsure for your home energy upgrade.</p><p style="margin:0;">We are now installing home batteries for customers who want to store more of the solar power they generate during the day and use it later at night.</p></td></tr>
      <tr><td style="padding:0 44px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2d8c2;"><tr><td style="background:#f7f4ed;padding:20px 24px;border-left:5px solid #b8922a;"><p style="margin:0 0 6px;font-size:10px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#8a7d63;">A quick, no-obligation check</p><p style="margin:0;font-size:15px;line-height:24px;color:#2f2d28;">We can look at your existing solar setup, discuss how you use energy at home, and let you know whether a battery could be a good fit.</p></td></tr><tr><td style="background:#171512;padding:16px 24px;"><p style="margin:0;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#fff;">What changes on 1 January 2027</p></td></tr><tr><td style="background:#fffdf8;padding:20px 24px 22px;"><p style="margin:0 0 10px;font-size:16px;line-height:25px;font-weight:bold;color:#2f2d28;">The STC factor changes from 6.8 to 5.7.</p><p style="margin:0;font-size:14px;line-height:23px;color:#5b554a;">For eligible systems, the applicable factor is based on when the battery is installed and certified. Requesting a quote or booking alone does not secure the 2026 factor.</p></td></tr></table></td></tr>
      <tr><td align="center" style="padding:0 44px 40px;font-size:16px;line-height:27px;color:#3e3b34;"><p style="margin:0 0 24px;">If you are interested, request a call back and one of our team will be in touch. Starting the conversation early gives us more time to assess, recommend and install a suitable system before the changeover.</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td style="background:#b8922a;border-radius:4px;"><a href="${safeCallbackUrl}" style="display:inline-block;padding:17px 34px;font-size:14px;line-height:20px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:#0f0d08;text-decoration:none;">Request a call back</a></td></tr></table><p style="margin:16px 0 0;font-size:14px;line-height:22px;color:#6b665c;">Or call us on <a href="tel:0370502846" style="font-weight:bold;color:#3e3b34;">03 7050 2846</a>.</p></td></tr>
      <tr><td style="background:#f7f4ed;padding:24px 44px 26px;font-size:11px;line-height:17px;color:#7d766b;"><p style="margin:0 0 10px;">Government support is subject to eligibility, applicable program rules, approved products and accredited installation requirements. Any support available for your home will be confirmed in your quote.</p><p style="margin:0;">Goldsure Pty Ltd, Suite 4, Level 1, 293 High Street, Preston VIC 3072</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export function buildBatteryCampaignText({ firstName = 'there', callbackUrl = `${PORTAL_URL}/Battery/request-callback.html` } = {}) {
  return `Hi ${String(firstName).trim() || 'there'},\n\nGoldsure now installs home batteries. For eligible systems, the applicable 2026 STC factor changes on 1 January 2027.\n\nRequest a call back: ${callbackUrl}\n\nGoldsure | 03 7050 2846`;
}
