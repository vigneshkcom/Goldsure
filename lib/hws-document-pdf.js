import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { calculateDocument, cents } from '../assets/hws-document-model.js';

const regular = readFileSync(new URL('../assets/hws-document-fonts/Poppins-Regular.ttf', import.meta.url));
const semibold = readFileSync(new URL('../assets/hws-document-fonts/Poppins-SemiBold.ttf', import.meta.url));
const bold = readFileSync(new URL('../assets/hws-document-fonts/Poppins-Bold.ttf', import.meta.url));
const extra = readFileSync(new URL('../assets/hws-document-fonts/Poppins-ExtraBold.ttf', import.meta.url));
const logo = readFileSync(new URL('../assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg', import.meta.url));
const notes = [
  'Under Australian Consumer Law, you have 10 business days to change your mind and cancel your installation appointment. This does not apply if the quotation is for less than $100.00, or if contact with us was initiated by you.',
  'Additional charges may have applied that can only be identified by the electrician on the day of installation. These include but are not limited to: hard-wiring/double-wiring of transformer(s), transformers screwed to battens, any safety rectification work, high ceiling access or equipment, dimmer switch installation or deactivation due to incompatibility.',
  'These charges have been explained to you before work was undertaken.',
  'You were under no obligation to accept any additional charges, but if you did not, we may not complete the installation.',
  'All products come with a minimum 1-year warranty.'
];
const money = value => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value / 100);

// Uses the supplied A4 template's dimensions, fonts, banking panel and consumer notes.
export async function buildHwsDocumentPdf(data) {
  const name = `${data.number.trim()}- ${data.type === 'quote' ? 'Quote' : 'Tax Invoice'}`;
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: name, Author: 'Goldsure Pty Ltd' } });
  doc.registerFont('regular', regular).registerFont('semibold', semibold).registerFont('bold', bold).registerFont('extra', extra);
  const chunks = [];
  const result = new Promise((resolve, reject) => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  const totals = calculateDocument(data);
  const quote = data.type === 'quote';
  let bodyStart = 286;
  const text = (value, x, y, width, size = 12, font = 'regular', align = 'left', color = '#111111') => {
    doc.fillColor(color).font(font).fontSize(size).text(String(value ?? ''), x, y, { width, align, lineGap: 0, lineBreak: true });
  };
  const line = (x1, y1, x2, y2, color = '#bdbdbd', width = 1) => doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(width).strokeColor(color).stroke();
  const box = (x, y, width, height, fill = '#f7f7f7', stroke = '#bdbdbd') => doc.lineWidth(1).roundedRect(x, y, width, height, 4).fillAndStroke(fill, stroke);
  function page() {
    doc.addPage();
    // Coordinates follow the 794 x 1123 template; prevent PDFKit's unscaled
    // text-flow boundary from inserting pages at y=842 before the transform.
    doc.page.margins.bottom = doc.page.height - 1123;
    doc.scale(doc.page.width / 794);
    text(quote ? 'QUOTE' : 'TAX INVOICE', 48, 30, 390, 52, 'extra');
    doc.rect(48, 100, 64, 6).fill('#ffcb08');
    const scale = 190 / 483;
    doc.save().rect(556, 36, 190, 46).clip().image(logo, 556 - 58 * scale, 36 - 58 * scale, { width: 600 * scale }).restore();
    text('Goldsure Pty Ltd', 330, 94, 416, 11, 'bold', 'right');
    text('Suite 4, Level 1, 293 High Street, Preston, Victoria, 3072', 305, 111, 441, 11, 'regular', 'right');
    text('goldsure.com.au · ABN: 66 683 305 106', 330, 128, 416, 11, 'semibold', 'right');
    line(48, 155, 746, 155, '#111111', 2);
    const [year, month, day] = data.date.split('-');
    const fieldHeight = (value, width) => Math.max(28, doc.font('regular').fontSize(12).heightOfString(String(value), { width: width - 12 }) + 8);
    const firstHeight = Math.max(fieldHeight(data.number, 230), fieldHeight(data.customer, 444));
    const secondY = 170 + 18 + firstHeight + 9;
    const secondHeight = fieldHeight(data.address, 444);
    for (const field of [
      [quote ? 'QUOTE NUMBER' : 'INVOICE NUMBER', data.number, 48, 170, 230],
      [quote ? 'QUOTE DATE' : 'INVOICE DATE', `${day}/${month}/${year}`, 48, secondY, 230],
      ['CUSTOMER NAME', data.customer, 302, 170, 444],
      ['ADDRESS', data.address, 302, secondY, 444]
    ]) {
      const [label, value, x, y, width] = field;
      text(label, x, y, width, 10.5, 'semibold', 'left', '#5c5c5c');
      const height = y === 170 ? firstHeight : secondHeight;
      box(x, y + 18, width, height);
      text(value, x + 6, y + 21, width - 12);
    }
    bodyStart = secondY + 18 + secondHeight + 15;
  }
  const actual = data.items.map((item, index) => ({ ...item, total: totals.lines[index] })).filter(item => item.description.trim() || item.quantity || item.rate);
  const rows = [...actual];
  while (rows.length < 8) rows.push({ description: '', quantity: '', rate: '', total: '' });
  page();
  let y = bodyStart;
  function tableHead() {
    doc.roundedRect(48, y, 698, 34, 8).fill('#111111');
    doc.rect(48, y + 16, 698, 18).fill('#111111');
    text('ITEM', 60, y + 9, 385, 11, 'semibold', 'left', '#ffffff');
    text('QTY', 456, y + 9, 70, 11, 'semibold', 'center', '#ffffff');
    text('UNIT PRICE', 526, y + 9, 110, 11, 'semibold', 'center', '#ffffff');
    text('TOTAL', 636, y + 9, 110, 11, 'semibold', 'center', '#ffcb08');
    y += 34;
  }
  tableHead();
  for (const item of rows) {
    const height = Math.max(28, doc.font('regular').fontSize(11).heightOfString(item.description, { width: 398 }) + 8);
    if (y + height > 1050) { page(); y = bodyStart; tableHead(); }
    text(item.description, 53, y + 5, 398, 11);
    text(item.quantity, 461, y + 5, 60, 11, 'regular', 'right');
    text(item.rate === '' ? '' : Number(item.rate).toFixed(2), 531, y + 5, 100, 11, 'regular', 'right');
    text(item.total === '' ? '' : money(item.total), 641, y + 5, 100, 11, 'regular', 'right');
    for (const x of [48, 456, 526, 636, 746]) line(x, y, x, y + height);
    y += height;
    line(48, y, 746, y);
  }
  const deposit = quote ? cents(data.deposit || 0) : 0;
  const summary = [
    ['Subtotal', totals.subtotal, 'semibold'], ['GST', totals.gst, 'semibold'], ['Total', totals.total, 'bold'],
    ['Small-Scale Technology Certificate Discount', totals.stc], ['Victorian Energy Efficiency Certificate Discount', totals.veec],
    ['Solar Victoria Rebate', totals.solar], ['Grand Total', totals.grandTotal, 'extra'],
    ...(!quote ? [['Payments Received', totals.payments, 'semibold']] : []),
    [quote ? 'Quoted Amount' : 'Amount Due', totals.due, 'extra'],
    ...(deposit ? [['Deposit requested', deposit], ['Balance after deposit payment', totals.grandTotal - deposit]] : [])
  ];
  const blockHeight = Math.max(270, summary.length * 28);
  if (y + 14 + blockHeight > 1060) { page(); y = bodyStart - 14; }
  y += 14;
  const top = y;
  doc.roundedRect(48, top, 270, blockHeight, 8).fill('#ffcb08');
  text('BANKING DETAILS', 68, top + 18, 230, 13, 'bold');
  text('Please make payment to:', 68, top + 48, 230, 11.5);
  for (const [index, [label, value]] of [['Account Name', 'Goldsure Pty Ltd'], ['BSB Number', '063 147'], ['Account Number', '10928147'], ['Reference', data.number]].entries()) {
    const rowY = top + 78 + index * 28;
    text(label, 68, rowY, 110, 12, 'bold');
    if (index === 3) box(188, rowY - 2, 110, 24, '#ffffff', '#ffffff');
    text(value, 178, rowY, 120, 11.5, 'regular', 'right');
  }
  text('For electronic payments, please include your invoice number as your reference and send your remittance to accounts@goldsure.com.au', 68, top + blockHeight - 77, 230, 11);
  summary.forEach(([label, amount, font = 'regular'], index) => {
    const rowY = top + index * 28;
    if (label === 'Grand Total') line(342, rowY, 746, rowY, '#111111', 2);
    const labelSize = label.length > 30 ? 11 : 12;
    text(label, 342, rowY + 4, 272, labelSize, font);
    box(626, rowY + 3, 120, 22, '#f7f7f7', font === 'extra' ? '#111111' : '#bdbdbd');
    text(money(amount), 631, rowY + 5, 110, 11, 'regular', 'right');
  });
  const heights = notes.map(note => doc.font('regular').fontSize(11).heightOfString(note, { width: 683 }));
  const footerHeight = 30 + heights.reduce((sum, height) => sum + height + 4, 0) + 28;
  let footerY = Math.max(top + blockHeight + 18, 1123 - 28 - footerHeight);
  if (footerY + footerHeight > 1095) { page(); footerY = bodyStart; }
  line(48, footerY, 746, footerY, '#d4d4d4');
  text('Important Information for Consumers', 48, footerY + 10, 698, 12.5, 'bold');
  let noteY = footerY + 32;
  notes.forEach((note, index) => {
    doc.rect(48, noteY + 6, 5, 5).fill('#ffcb08');
    text(note, 63, noteY, 683, 11, 'regular', 'left', '#333333');
    noteY += heights[index] + 4;
  });
  text('Goldsure Pty Ltd · ABN 66 683 305 106', 48, noteY + 8, 698, 11, 'regular', 'left', '#5c5c5c');
  doc.end();
  return result;
}
