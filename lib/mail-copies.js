// Attachments go to the customer (the `to` recipients) only. When a message has
// attachments AND cc/bcc recipients, send the customer their message first with
// no cc/bcc, then send the cc/bcc addresses a separate copy without attachments
// so the internal mailboxes do not fill up with PDFs. Set `keepCopyAttachments`
// on a message to opt out and send one message with the cc/bcc and attachments.
export async function sendWithoutAttachmentCopies(send, mail) {
  const { cc, bcc, attachments, keepCopyAttachments } = mail;
  if (keepCopyAttachments) return send(mail);
  const copyList = [...new Set([...(Array.isArray(cc) ? cc : []), ...(Array.isArray(bcc) ? bcc : [])]
    .map((address) => String(address || '').trim())
    .filter(Boolean))];
  if (!Array.isArray(attachments) || !attachments.length || !copyList.length) return send(mail);

  const { cc: _cc, bcc: _bcc, ...customerMail } = mail;
  const result = await send(customerMail);

  const customers = new Set((Array.isArray(mail.to) ? mail.to : []).map((address) => String(address).toLowerCase()));
  const copyTo = copyList.filter((address) => !customers.has(address.toLowerCase()));
  if (copyTo.length) {
    const { attachments: _attachments, cc: _c, bcc: _b, ...copyMail } = mail;
    try {
      await send({ ...copyMail, to: copyTo });
    } catch (error) {
      // The customer already has their email; a failed internal copy must not fail the send.
      console.error('[mail] attachment-free internal copy failed:', error.message);
    }
  }
  return result;
}
