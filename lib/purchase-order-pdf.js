// lib/purchase-order-pdf.js
// Renders a validated purchase order (see validatedPurchaseOrder in
// api/smoke-alarms/reports/index.js) as a PDF buffer, for emailing to the
// electrician as an attachment alongside the existing HTML email body.

import PDFDocument from 'pdfkit';

const LOGO_URL = 'https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg';
// Visible artwork inside the 600x230 logo JPEG; everything outside it is white padding.
const LOGO_ART = { imageWidth: 600, left: 58, top: 58, right: 541, bottom: 171 };

const PAGE_MARGIN = 40;
const FOOTER_SPACE = 60;
const CELL_PAD = 5;
const COLORS = {
  ink: '#111111',
  text: '#374151',
  muted: '#6b7280',
  faint: '#9ca3af',
  rule: '#e5e7eb',
  headRule: '#d1d5db',
  headBg: '#f3f4f6',
  zebra: '#fafafa',
  gold: '#b08d2e',
  red: '#b42318',
};

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

let logoBufferPromise = null;

function loadLogoBuffer() {
  if (!logoBufferPromise) {
    logoBufferPromise = fetch(LOGO_URL, { signal: AbortSignal.timeout(5000) })
      .then(res => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`Logo fetch failed (${res.status})`))))
      .then(buf => Buffer.from(buf))
      .catch(err => { logoBufferPromise = null; throw err; });
  }
  return logoBufferPromise;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function money(value) {
  return AUD.format(roundMoney(value));
}

function deduction(value) {
  const amount = roundMoney(value);
  return amount > 0 ? `-${AUD.format(amount)}` : AUD.format(0);
}

function dmyDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value || '');
}

function jobQuantity(job, key) {
  return (job.items || []).filter(item => item.key === key)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

// Single-line text clipped to its box. Passing height stops pdfkit from ever
// auto-adding a page when text sits near the bottom margin.
function line(doc, text, x, y, width, { font = 'Helvetica', size = 8, color = COLORS.text, align = 'left', spacing = 0 } = {}) {
  doc.font(font).fontSize(size).fillColor(color)
    .text(String(text ?? ''), x, y, { width, height: size * 1.4, align, ellipsis: true, lineBreak: false, characterSpacing: spacing });
}

function tableColumns(amountLabel, width) {
  const fixed = [
    { label: 'Installed', width: 58, align: 'left' },
    { label: 'Job', width: 44, align: 'left' },
    { label: 'Booking', width: 44, align: 'center' },
    { label: 'Hardwired', width: 48, align: 'center' },
    { label: 'Battery', width: 42, align: 'center' },
    { label: 'Remote', width: 42, align: 'center' },
    { label: 'Alarms', width: 42, align: 'center' },
    { label: 'Cash offset', width: 60, align: 'right' },
    { label: 'Payable', width: 60, align: 'right' },
  ];
  const amountWidth = width - fixed.reduce((sum, col) => sum + col.width, 0);
  return [
    ...fixed.slice(0, 7),
    { label: amountLabel, width: amountWidth, align: 'right' },
    ...fixed.slice(7),
  ];
}

function headerRowHeight(doc, columns) {
  doc.font('Helvetica-Bold').fontSize(7.5);
  const tallest = Math.max(...columns.map(col => doc.heightOfString(col.label, { width: col.width - CELL_PAD * 2 })));
  return Math.ceil(tallest + 12);
}

function drawHeaderRow(doc, columns, x, y, height) {
  const width = columns.reduce((sum, col) => sum + col.width, 0);
  doc.rect(x, y, width, height).fill(COLORS.headBg);
  doc.moveTo(x, y + height).lineTo(x + width, y + height).lineWidth(0.75).strokeColor(COLORS.headRule).stroke();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.ink);
  let cx = x;
  columns.forEach(col => {
    const textHeight = doc.heightOfString(col.label, { width: col.width - CELL_PAD * 2 });
    doc.text(col.label, cx + CELL_PAD, y + (height - textHeight) / 2, { width: col.width - CELL_PAD * 2, height: textHeight + 2, align: col.align });
    cx += col.width;
  });
}

function summaryColumns(width) {
  const fixed = [
    { label: 'Installed', width: 56, align: 'left' },
    { label: 'Job', width: 40, align: 'left' },
    null,
    { label: 'Hardwired', width: 48, align: 'center' },
    { label: 'Battery', width: 42, align: 'center' },
    { label: 'Remote', width: 42, align: 'center' },
    { label: 'Alarms', width: 40, align: 'center' },
    { label: 'Earnings inc GST', width: 76, align: 'right' },
  ];
  const addressWidth = width - fixed.filter(Boolean).reduce((sum, col) => sum + col.width, 0);
  return fixed.map(col => col || { label: 'Address', width: addressWidth, align: 'left' });
}

const ADDRESS_MAX_LINES = 2;
const STATE_POSTCODE = /,\s*(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s*,?\s*\d{4}\s*$/i;

function fittedAddress(doc, text, width) {
  const full = String(text || '').trim();
  doc.font('Helvetica').fontSize(8);
  return doc.widthOfString(full) <= width ? full : full.replace(STATE_POSTCODE, '');
}

function addressHeight(doc, text, width) {
  doc.font('Helvetica').fontSize(8);
  const lineHeight = doc.currentLineHeight(true);
  return Math.min(doc.heightOfString(text || '–', { width }), lineHeight * ADDRESS_MAX_LINES);
}

function drawRow(doc, columns, x, y, height, cells, { fill = null, bold = false, topRule = null } = {}) {
  const width = columns.reduce((sum, col) => sum + col.width, 0);
  if (fill) doc.rect(x, y, width, height).fill(fill);
  if (topRule) doc.moveTo(x, y).lineTo(x + width, y).lineWidth(1).strokeColor(topRule).stroke();
  else doc.moveTo(x, y + height).lineTo(x + width, y + height).lineWidth(0.5).strokeColor(COLORS.rule).stroke();
  const size = 8;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  const textY = y + (height - doc.currentLineHeight()) / 2;
  let cx = x;
  columns.forEach((col, index) => {
    const cell = cells[index] ?? '';
    const spec = typeof cell === 'object' ? cell : { text: cell };
    if (spec.wrap) {
      const innerWidth = col.width - CELL_PAD * 2;
      const textHeight = addressHeight(doc, spec.text, innerWidth);
      const trailingGap = doc.currentLineHeight(true) - doc.currentLineHeight();
      doc.font('Helvetica').fontSize(size).fillColor(spec.color || COLORS.text)
        .text(String(spec.text || ''), cx + CELL_PAD, y + (height - textHeight + trailingGap) / 2, { width: innerWidth, height: textHeight + 1, ellipsis: true });
      cx += col.width;
      return;
    }
    line(doc, spec.text, cx + CELL_PAD, textY, col.width - CELL_PAD * 2, {
      font: spec.bold || bold ? 'Helvetica-Bold' : 'Helvetica',
      size,
      color: spec.color || COLORS.ink,
      align: col.align,
    });
    cx += col.width;
  });
}

function quantityCell(value) {
  return value ? String(value) : { text: '–', color: COLORS.faint };
}

async function renderDocument(po, { title, recipientLabel, amountLabel, finalLabel, showReference, includeInvoiceNote, summaryLayout = false }) {
  const logo = await loadLogoBuffer().catch(() => null);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: 20 },
    bufferPages: true,
    info: { Title: `${title} - ${po.poNumber || ''}`.trim(), Author: 'Goldsure Pty Ltd' },
  });
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  const done = new Promise(resolve => doc.on('end', resolve));

  const left = PAGE_MARGIN;
  const contentWidth = doc.page.width - PAGE_MARGIN * 2;
  const right = left + contentWidth;
  const contentBottom = doc.page.height - FOOTER_SPACE;
  const electrician = po.electrician || {};
  const totals = po.totals || {};
  const jobs = Array.isArray(po.jobs) ? po.jobs : [];
  const additionalLines = Array.isArray(po.additionalLines) ? po.additionalLines : [];

  // Header: logo left, document title block right, gold rule underneath.
  const top = PAGE_MARGIN;
  if (logo) {
    const artHeight = 34;
    const scale = artHeight / (LOGO_ART.bottom - LOGO_ART.top);
    doc.image(logo, left - LOGO_ART.left * scale, top - LOGO_ART.top * scale, { width: LOGO_ART.imageWidth * scale });
  } else {
    line(doc, 'Goldsure Pty Ltd', left, top + 10, 220, { font: 'Helvetica-Bold', size: 16, color: COLORS.ink });
  }
  line(doc, title, right - 300, top, 300, { font: 'Helvetica-Bold', size: 18, color: COLORS.ink, align: 'right' });
  let headerLineY = top + 25;
  if (showReference && po.poNumber) {
    line(doc, po.poNumber, right - 330, headerLineY, 330, { size: 8.5, color: COLORS.text, align: 'right' });
    headerLineY += 12;
  }
  line(doc, `Issued ${po.issueDate || ''}`, right - 330, headerLineY, 330, { size: 8.5, color: COLORS.muted, align: 'right' });
  const ruleY = Math.max(top + 50, headerLineY + 20);
  doc.moveTo(left, ruleY).lineTo(right, ruleY).lineWidth(1.5).strokeColor(COLORS.gold).stroke();

  // Recipient (left) and period / payable date (right).
  let y = ruleY + 18;
  const detailTop = y;
  line(doc, recipientLabel.toUpperCase(), left, y, 300, { font: 'Helvetica-Bold', size: 7, color: COLORS.muted, spacing: 0.6 });
  y += 12;
  const displayName = electrician.companyName || electrician.name || '';
  line(doc, displayName, left, y, 300, { font: 'Helvetica-Bold', size: 11, color: COLORS.ink });
  y += 16;
  const detailLines = [
    electrician.name && electrician.name !== displayName ? electrician.name : '',
    electrician.taxId ? `ABN ${electrician.taxId}` : '',
  ].filter(Boolean);
  detailLines.forEach(text => { line(doc, text, left, y, 300, { size: 8.5, color: COLORS.text }); y += 12; });
  const leftBottom = y;

  const metaWidth = 200;
  const metaX = right - metaWidth;
  let my = detailTop;
  line(doc, 'INSTALLATION PERIOD', metaX, my, metaWidth, { font: 'Helvetica-Bold', size: 7, color: COLORS.muted, align: 'right', spacing: 0.6 });
  my += 12;
  line(doc, po.period || '', metaX, my, metaWidth, { font: 'Helvetica-Bold', size: 9.5, color: COLORS.ink, align: 'right' });
  my += 20;
  line(doc, 'PAYABLE DATE', metaX, my, metaWidth, { font: 'Helvetica-Bold', size: 7, color: COLORS.muted, align: 'right', spacing: 0.6 });
  my += 12;
  line(doc, po.payableDate || '', metaX, my, metaWidth, { font: 'Helvetica-Bold', size: 11, color: COLORS.gold, align: 'right' });
  my += 16;

  y = Math.max(leftBottom, my) + 18;

  // Jobs table.
  const columns = summaryLayout ? summaryColumns(contentWidth) : tableColumns(amountLabel, contentWidth);
  const headHeight = headerRowHeight(doc, columns);
  const rowHeight = 20;
  const addressWidth = summaryLayout ? columns[2].width - CELL_PAD * 2 : 0;
  drawHeaderRow(doc, columns, left, y, headHeight);
  y += headHeight;
  jobs.forEach((job, index) => {
    const address = summaryLayout ? fittedAddress(doc, job.address, addressWidth) : '';
    const jobRowHeight = summaryLayout ? Math.max(rowHeight, Math.ceil(addressHeight(doc, address, addressWidth) + 10)) : rowHeight;
    if (y + jobRowHeight > contentBottom) {
      doc.addPage();
      y = PAGE_MARGIN;
      drawHeaderRow(doc, columns, left, y, headHeight);
      y += headHeight;
    }
    const hardwired = jobQuantity(job, 'hardwired');
    const battery = jobQuantity(job, 'battery');
    const remote = jobQuantity(job, 'remote');
    const offset = roundMoney(job.cashOffset);
    const payable = roundMoney(job.payableIncGst);
    if (summaryLayout) {
      drawRow(doc, columns, left, y, jobRowHeight, [
        dmyDate(job.installedDate),
        { text: job.jobId || '', bold: true },
        address ? { text: address, wrap: true } : { text: '–', color: COLORS.faint },
        quantityCell(hardwired),
        quantityCell(battery),
        quantityCell(remote),
        { text: String(hardwired + battery + remote), bold: true },
        money(job.grossIncGst),
      ], { fill: index % 2 ? COLORS.zebra : null });
      y += jobRowHeight;
      return;
    }
    drawRow(doc, columns, left, y, rowHeight, [
      dmyDate(job.installedDate),
      { text: job.jobId || '', bold: true },
      quantityCell(jobQuantity(job, 'booking')),
      quantityCell(hardwired),
      quantityCell(battery),
      quantityCell(remote),
      String(hardwired + battery + remote),
      money(job.grossIncGst),
      offset > 0 ? { text: deduction(offset), color: COLORS.red } : { text: '–', color: COLORS.faint },
      { text: money(payable), bold: true, color: payable < 0 ? COLORS.red : COLORS.ink },
    ], { fill: index % 2 ? COLORS.zebra : null });
    y += rowHeight;
  });

  const jobGross = roundMoney(jobs.reduce((sum, job) => sum + Number(job.grossIncGst || 0), 0));
  const jobOffset = roundMoney(jobs.reduce((sum, job) => sum + Number(job.cashOffset || 0), 0));
  const jobPayable = roundMoney(jobs.reduce((sum, job) => sum + Number(job.payableIncGst || 0), 0));
  if (y + rowHeight > contentBottom) {
    doc.addPage();
    y = PAGE_MARGIN;
  }
  drawRow(doc, columns, left, y, rowHeight + 2, summaryLayout ? [
    'Total',
    '',
    '',
    String(totals.hardwired || 0),
    String(totals.battery || 0),
    String(totals.remote || 0),
    String((totals.hardwired || 0) + (totals.battery || 0) + (totals.remote || 0)),
    money(jobGross),
  ] : [
    'Total',
    '',
    String(totals.booking || 0),
    String(totals.hardwired || 0),
    String(totals.battery || 0),
    String(totals.remote || 0),
    String((totals.hardwired || 0) + (totals.battery || 0) + (totals.remote || 0)),
    money(jobGross),
    jobOffset > 0 ? { text: deduction(jobOffset), color: COLORS.red } : { text: '–', color: COLORS.faint },
    { text: money(jobPayable), color: jobPayable < 0 ? COLORS.red : COLORS.ink },
  ], { fill: COLORS.headBg, bold: true, topRule: COLORS.ink });
  y += rowHeight + 2;

  // Additional payments, when any were added to the PO.
  if (additionalLines.length) {
    const extraColumns = [
      { label: 'Additional payments', width: contentWidth - 110, align: 'left' },
      { label: 'Amount inc GST', width: 110, align: 'right' },
    ];
    const extraHead = headerRowHeight(doc, extraColumns);
    y += 18;
    if (y + extraHead + rowHeight > contentBottom) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    drawHeaderRow(doc, extraColumns, left, y, extraHead);
    y += extraHead;
    additionalLines.forEach((extra, index) => {
      if (y + rowHeight > contentBottom) {
        doc.addPage();
        y = PAGE_MARGIN;
        drawHeaderRow(doc, extraColumns, left, y, extraHead);
        y += extraHead;
      }
      drawRow(doc, extraColumns, left, y, rowHeight, [extra.description || '', money(extra.amountIncGst)], { fill: index % 2 ? COLORS.zebra : null });
      y += rowHeight;
    });
  }

  // Totals (right, aligned to the table's right edge) and invoice note (left).
  const summaryWidth = 230;
  const summaryX = right - summaryWidth;
  const labelWidth = 130;
  const valueX = summaryX + labelWidth;
  const valueWidth = summaryWidth - labelWidth - CELL_PAD;
  const noteWidth = summaryX - left - 24;
  const noteLines = [
    'Goldsure Pty Ltd',
    'ABN 66 683 305 106',
    'Suite 4, Level 1, 293 High Street, Preston, Victoria, 3072',
    'Email: vignesh@goldsure.com.au',
  ];
  doc.font('Helvetica').fontSize(8.5);
  const noteBodyHeight = doc.heightOfString(noteLines.join('\n'), { width: noteWidth - 26, lineGap: 2 });
  const noteHeight = includeInvoiceNote ? noteBodyHeight + 38 : 0;
  const summaryHeight = 150;
  y += 22;
  if (y + Math.max(summaryHeight, noteHeight) > contentBottom) {
    doc.addPage();
    y = PAGE_MARGIN;
  }
  const blockTop = y;

  if (includeInvoiceNote) {
    doc.rect(left, blockTop, noteWidth, noteHeight).lineWidth(0.75).fillAndStroke('#fafafa', COLORS.rule);
    doc.rect(left, blockTop, 3, noteHeight).fill(COLORS.gold);
    line(doc, 'Please kindly issue an invoice to:', left + 16, blockTop + 12, noteWidth - 26, { font: 'Helvetica-Bold', size: 8.5, color: COLORS.ink });
    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.text)
      .text(noteLines.join('\n'), left + 16, blockTop + 28, { width: noteWidth - 26, height: noteBodyHeight + 4, lineGap: 2 });
  }

  const summaryRows = [
    ['Subtotal ex GST', money(totals.subtotalExGst), COLORS.ink],
    ['GST', money(totals.gst), COLORS.ink],
    ['Total inc GST', money(totals.grossIncGst), COLORS.ink],
    ['Less cash collected', deduction(totals.cashOffset), roundMoney(totals.cashOffset) > 0 ? COLORS.red : COLORS.ink],
  ];
  let sy = blockTop;
  summaryRows.forEach(([label, value, color]) => {
    line(doc, label, summaryX, sy, labelWidth, { size: 9, color: COLORS.text });
    line(doc, value, valueX, sy, valueWidth, { size: 9, color, align: 'right' });
    sy += 17;
  });
  sy += 2;
  doc.moveTo(summaryX, sy).lineTo(right, sy).lineWidth(1.25).strokeColor(COLORS.ink).stroke();
  sy += 9;
  line(doc, finalLabel, summaryX, sy, labelWidth, { font: 'Helvetica-Bold', size: 11.5, color: COLORS.ink });
  line(doc, money(totals.totalIncGst), valueX, sy, valueWidth, { font: 'Helvetica-Bold', size: 11.5, color: COLORS.gold, align: 'right' });
  sy += 22;
  line(doc, 'Payable date', summaryX, sy, labelWidth, { font: 'Helvetica-Bold', size: 9, color: COLORS.ink });
  line(doc, po.payableDate || '', valueX, sy, valueWidth, { font: 'Helvetica-Bold', size: 9, color: COLORS.ink, align: 'right' });

  // Footer on every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const footerY = doc.page.height - 44;
    doc.moveTo(left, footerY).lineTo(right, footerY).lineWidth(0.5).strokeColor(COLORS.rule).stroke();
    line(doc, 'Goldsure Pty Ltd  ·  ABN 66 683 305 106  ·  vignesh@goldsure.com.au', left, footerY + 9, contentWidth - 80, { size: 7.5, color: COLORS.muted });
    line(doc, `Page ${i - range.start + 1} of ${range.count}`, right - 80, footerY + 9, 80, { size: 7.5, color: COLORS.muted, align: 'right' });
  }

  doc.end();
  await done;
  return Buffer.concat(chunks);
}

export async function buildPurchaseOrderPdf(po) {
  return renderDocument(po, {
    title: 'PURCHASE ORDER',
    recipientLabel: 'Purchase order to',
    amountLabel: 'Pay inc GST',
    finalLabel: 'Final PO',
    showReference: true,
    includeInvoiceNote: true,
  });
}

export async function buildInstallSummaryPdf(po) {
  return renderDocument(po, {
    title: 'INSTALLATION SUMMARY',
    recipientLabel: 'Prepared for',
    amountLabel: 'Earnings inc GST',
    finalLabel: 'Final payment',
    showReference: false,
    includeInvoiceNote: false,
    summaryLayout: true,
  });
}
