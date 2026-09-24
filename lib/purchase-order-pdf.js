// lib/purchase-order-pdf.js
// Renders a validated purchase order (see validatedPurchaseOrder in
// api/smoke-alarms/reports/index.js) as a PDF buffer, for emailing to the
// electrician as an attachment alongside the existing HTML email body.

import PDFDocument from 'pdfkit';

function money(value) {
  const amount = Number(value || 0);
  return amount < 0 ? `-$${Math.abs(amount).toFixed(2)}` : `$${amount.toFixed(2)}`;
}

function deductionMoney(value) {
  const amount = Number(value || 0);
  return amount > 0 ? `-${money(amount)}` : money(0);
}

function dmyDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value || '');
}

function jobQuantity(job, key) {
  return (job.items || []).filter(item => item.key === key)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function drawTableRow(doc, x, y, columns, values, options = {}) {
  const { bold = false, fontSize = 8 } = options;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
  let cx = x;
  values.forEach((value, index) => {
    const width = columns[index];
    doc.text(String(value ?? ''), cx, y, { width, align: options.align?.[index] || 'left' });
    cx += width;
  });
}

async function renderDocument(po, { title, jobColumnLabel = 'Earnings inc GST', includeInvoiceNote = false } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  const done = new Promise(resolve => doc.on('end', resolve));

  const electrician = po.electrician || {};
  const totals = po.totals || {};
  const jobs = Array.isArray(po.jobs) ? po.jobs : [];

  doc.rect(36, 36, doc.page.width - 72, 60).fill('#111111');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(title, 46, 52);
  doc.fillColor('#c8aa66').font('Helvetica').fontSize(9).text('Goldsure Pty Ltd', 46, 74);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text(po.poNumber || '', 0, 52, { align: 'right', width: doc.page.width - 46 });
  doc.fillColor('#bbbbbb').font('Helvetica').fontSize(8).text(`Issued ${po.issueDate || ''}`, 0, 68, { align: 'right', width: doc.page.width - 46 });

  doc.fillColor('#000000');
  let y = 116;
  doc.font('Helvetica-Bold').fontSize(11).text(electrician.companyName || electrician.name || '', 36, y);
  y += 16;
  doc.font('Helvetica').fontSize(9).fillColor('#555555');
  const detailLine = [electrician.name, electrician.taxId ? `ABN ${electrician.taxId}` : ''].filter(Boolean).join(' | ');
  if (detailLine) { doc.text(detailLine, 36, y); y += 13; }
  doc.text(`Period: ${po.period || ''}`, 36, y); y += 13;
  doc.font('Helvetica-Bold').fillColor('#765407').text(`Payable date: ${po.payableDate || ''}`, 36, y);
  doc.fillColor('#000000');
  y += 24;

  const columns = [55, 60, 48, 48, 48, 48, 62, 62, 75];
  const headers = ['Installed', 'Job', 'Booking', 'Hardwired', 'Battery', 'Remote', 'Alarms', jobColumnLabel, 'PO payable'];
  const align = ['left', 'left', 'center', 'center', 'center', 'center', 'right', 'right', 'right'];
  const tableX = 36;

  doc.rect(tableX, y, doc.page.width - 72, 18).fill('#d7eef7');
  doc.fillColor('#27323a');
  drawTableRow(doc, tableX + 3, y + 5, columns, headers, { bold: true, fontSize: 7, align });
  y += 18;
  doc.fillColor('#000000');

  jobs.forEach(job => {
    if (y > doc.page.height - 100) { doc.addPage(); y = 40; }
    const hardwired = jobQuantity(job, 'hardwired');
    const battery = jobQuantity(job, 'battery');
    const remote = jobQuantity(job, 'remote');
    const values = [
      dmyDate(job.installedDate),
      job.jobId || '',
      jobQuantity(job, 'booking') || '',
      hardwired || '',
      battery || '',
      remote || '',
      hardwired + battery + remote,
      money(job.grossIncGst),
      money(job.payableIncGst),
    ];
    drawTableRow(doc, tableX + 3, y + 4, columns, values, { fontSize: 7, align });
    doc.moveTo(tableX, y + 16).lineTo(tableX + columns.reduce((a, b) => a + b, 0), y + 16).strokeColor('#eceff2').stroke();
    y += 17;
  });

  y += 14;
  const boxWidth = 220;
  const boxX = doc.page.width - 36 - boxWidth;
  const summaryTop = y;
  if (includeInvoiceNote) {
    const noteWidth = boxX - 36 - 16;
    doc.rect(36, y, noteWidth, 76).fill('#f7f8fa').strokeColor('#e0e0e0').lineWidth(1).stroke();
    doc.fillColor('#333333').font('Helvetica-Bold').fontSize(9).text('Please kindly issue an invoice to:', 46, y + 10, { width: noteWidth - 20 });
    doc.font('Helvetica').fontSize(9).text(
      'Goldsure Pty Ltd\nABN 66 683 305 106\nSuite 4, Level 1, 293 High Street, Preston, Victoria, 3072\nEmail: vignesh@goldsure.com.au',
      46, y + 24, { width: noteWidth - 20, lineGap: 2 },
    );
    doc.fillColor('#000000');
  }
  y = summaryTop;
  const summaryLines = [
    ['Subtotal ex GST', money(totals.subtotalExGst)],
    ['GST', money(totals.gst)],
    ['Additional payments inc GST', money(totals.additionalIncGst)],
    ['Less cash collected', deductionMoney(totals.cashOffset)],
  ];
  doc.font('Helvetica').fontSize(9);
  summaryLines.forEach(([label, value]) => {
    doc.text(label, boxX, y, { width: 130 });
    doc.text(value, boxX + 130, y, { width: 90, align: 'right' });
    y += 15;
  });
  doc.moveTo(boxX, y).lineTo(boxX + boxWidth, y).strokeColor('#111111').lineWidth(1.5).stroke();
  y += 6;
  doc.font('Helvetica-Bold').fontSize(13);
  doc.text('Final PO', boxX, y, { width: 130 });
  doc.fillColor('#9a741c').text(money(totals.totalIncGst), boxX + 130, y, { width: 90, align: 'right' });
  doc.fillColor('#000000');
  y += 20;
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Payable date', boxX, y, { width: 130 });
  doc.text(po.payableDate || '', boxX + 130, y, { width: 90, align: 'right' });

  doc.font('Helvetica').fontSize(8).fillColor('#555555')
    .text('Goldsure Pty Ltd  |  vignesh@goldsure.com.au  |  ABN 66 683 305 106', 36, doc.page.height - 50, { width: doc.page.width - 72, align: 'center' });

  doc.end();
  await done;
  return Buffer.concat(chunks);
}

export async function buildPurchaseOrderPdf(po) {
  return renderDocument(po, { title: 'PURCHASE ORDER', jobColumnLabel: 'Pay inc GST', includeInvoiceNote: true });
}

export async function buildInstallSummaryPdf(po) {
  return renderDocument(po, { title: 'INSTALLATION SUMMARY', jobColumnLabel: 'Earnings inc GST' });
}
