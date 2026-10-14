import PDFDocument from 'pdfkit';
import { CHECKS, DECLARATIONS, hash } from './qld-certificate-model.js';

export async function certificatePdf(request, signed = null) {
  const values = signed || request.prefill || {};
  const doc = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true, info: { Title: `Queensland certificate - ${request.jobNumber || request.id}`, Author: values.contractorName || 'Issuing electrical contractor', CreationDate: new Date(signed?.signedAt || request.createdAt || '2026-01-01') } });
  const chunks = [];
  const ready = new Promise((resolve, reject) => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  const ink = '#18253a', accent = '#516275', muted = '#5e6c80';
  const clean = value => String(value || '-').replace(/[\u2010-\u2015]/g, '-');
  function header(label) {
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(10).text('QUEENSLAND / ELECTRICAL CONTRACTOR CERTIFICATE', 44, 40);
    doc.fillColor(ink).fontSize(22).text(label, 44, 65, { width: 505 });
    doc.fillColor(muted).font('Helvetica').fontSize(9).text(`Job ${request.jobNumber || 'Manual entry'}   |   ${request.id || 'PREVIEW'}`, 44, 118);
    doc.moveTo(44, 140).lineTo(551, 140).strokeColor(accent).stroke(); doc.y = 156;
  }
  function section(title) {
    if (doc.y > 680) { doc.addPage(); doc.y = 44; }
    doc.x = 44;
    doc.moveDown(0.65).font('Helvetica-Bold').fontSize(11).fillColor(ink).text(title).moveDown(0.6);
  }
  function field(label, value) {
    doc.x = 44;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(muted).text(label.toUpperCase());
    doc.font('Helvetica').fontSize(10).fillColor(ink).text(clean(value), { width: 507, lineGap: 3 }).moveDown(0.55);
  }
  header('Certificate of testing and compliance');
  doc.fontSize(9).fillColor(muted).text('Electrical Safety Regulation 2026 | Electrical work in Queensland');
  if (!signed) doc.moveDown().fillColor('#a44421').font('Helvetica-Bold').text('DRAFT PREVIEW - NOT SIGNED OR ISSUED');
  section('01  Customer and work');
  field('Customer', `${request.customerName}\n${request.customerAddress}`);
  field('Work performed for / commissioning party', `${request.workForName}\n${request.workForAddress}`);
  field('Installation location', request.siteAddress);
  field('Electrical work and installation tested', signed?.workDescription || request.workDescription || 'Electrician to complete');
  section('02  Issuing electrical contractor');
  field('Actual date tested', values.testDate || 'Electrician to complete');
  field('Electrical contractor', `${values.contractorName || 'Name to confirm'} | Licence ${values.contractorLicence || 'to confirm'}\nPhone ${values.contractorPhone || 'to confirm'}`);
  doc.fontSize(10).fillColor(ink).text(signed?.declaration || DECLARATIONS.installation, { width: 507, lineGap: 3 });
  doc.moveDown().fontSize(9).fillColor(muted).text(signed ? `Confirmed by ${signed.signerName} on ${new Date(signed.signedAt).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })} (Queensland time). Signature and signing record follow.` : 'The named electrician must review the work, confirm this declaration and sign before this certificate is issued.');
  doc.addPage(); header(request.smokeInspection ? 'Inspection and signing record' : 'Signing record');
  if (request.smokeInspection) {
    section('03  Smoke alarm inspection');
    field('Inspection outcome', values.smokeOutcome ? (values.smokeOutcome === 'compliant' ? 'Compliant' : 'NOT COMPLIANT - see observations') : 'Electrician to confirm');
    CHECKS.forEach((label, i) => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(ink).text(label, 44, y, { width: 390 });
      const end = doc.y;
      doc.font('Helvetica-Bold').fillColor(muted).text(values.checks?.[i] || 'To confirm', 446, y, { width: 105 });
      doc.y = Math.max(doc.y, end) + 9;
    });
    field('Earliest replacement due', values.replacementDate || 'Not recorded');
  }
  field('Observations / defects / exclusions', values.notes || 'None recorded');
  if (doc.y > 535) doc.addPage();
  section('Electronic signature');
  const sy = doc.y;
  doc.roundedRect(44, sy, 310, 82, 5).strokeColor('#d8dfe8').stroke();
  if (signed) {
    doc.save().strokeColor(ink).lineWidth(1.4);
    for (const stroke of signed.strokes) {
      stroke.forEach(([x, y], i) => i ? doc.lineTo(50 + x * 298, sy + 6 + y * 70) : doc.moveTo(50 + x * 298, sy + 6 + y * 70)); doc.stroke();
    }
    doc.restore();
  }
  doc.y = sy + 94;
  field(signed ? 'Signed by' : 'Electrician to sign', signed ? `${signed.signerName}\n${request.electricianEmail || 'Private signing link'}` : request.electricianName);
  if (signed) {
    field('Signed at', `${signed.signedAt} (UTC)`);
    doc.fontSize(8).fillColor(muted).text('The signer confirmed their authority, accuracy of the reviewed details and consent to electronic signing. Access was via a private signing link; no independent identity or licence verification is implied.');
    doc.moveDown().fontSize(7).text(`Signed record SHA-256: ${hash({ request, signed })}`, { width: 507 });
  }
  doc.moveDown().fontSize(8).fillColor(muted).text('Keep this certificate for at least five years. Smoke alarm observations do not replace the electrical certification above. The issuing contractor is responsible for the declarations and applicable requirements.');
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor(muted).text(`${signed ? 'SIGNED CONTRACTOR RECORD' : 'DRAFT / NOT VALID'}   |   Page ${i + 1} of ${range.count}`, 44, 777, { width: 507, lineBreak: false });
  }
  doc.end(); return ready;
}
