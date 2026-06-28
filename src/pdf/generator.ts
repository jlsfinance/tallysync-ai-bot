import PDFDocument from 'pdfkit';
import path from 'path';

// ──────────────────────────────────────────────
// Type definitions
// ──────────────────────────────────────────────

export interface VoucherData {
  voucher_number: string;
  voucher_type: string;
  vch_date: string;
  party_ledger_name: string;
  amount: number;
  narration?: string;
  company_name?: string;
  company_address?: string;
  gstin?: string;
}

export interface LedgerEntry {
  name: string;
  amount: number;
  is_debit: boolean;
}

export interface StockEntry {
  stock_item_name: string;
  quantity: number;
  rate: number;
  amount: number;
  unit?: string;
  hsn_code?: string;
  tax_rate?: number;
  discount_percent?: number;
}

export interface Transaction {
  vch_date: string;
  voucher_number: string;
  voucher_type: string;
  party_ledger_name: string;
  amount: number;
  is_debit?: boolean;
  narration?: string;
}

export interface StockItemData {
  stock_item_name: string;
  unit?: string;
  hsn_code?: string;
  rate?: number;
  quantity?: number;
  tax_rate?: number;
  opening_stock?: number;
}

export interface CustomerSummary {
  partyName: string;
  openingBalance: number;
  currentBalance: number;
  lastTransaction?: { date: string; amount: number; type: string };
  phone?: string;
  gstin?: string;
  totalSales?: number;
  totalPayments?: number;
}

// ──────────────────────────────────────────────
// Color scheme
// ──────────────────────────────────────────────

const COLORS = {
  navy: '#1B2A4A',
  headerBg: '#1B2A4A',
  headerText: '#FFFFFF',
  alternateRow: '#F5F6FA',
  border: '#D0D3E0',
  text: '#2C3E50',
  mutedText: '#7F8C8D',
  white: '#FFFFFF',
  accent: '#2980B9',
};

// ──────────────────────────────────────────────
// Number to Words (Indian English)
// ──────────────────────────────────────────────

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

export function numberToWords(amount: number): string {
  if (amount === 0) return 'Zero Only';

  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const whole = Math.floor(absAmount);
  const paise = Math.round((absAmount - whole) * 100);

  function convertBelowThousand(n: number): string {
    if (n === 0) return '';
    if (n < 20) return ONES[n];
    if (n < 100) {
      const t = Math.floor(n / 10);
      const o = n % 10;
      return TENS[t] + (o ? ' ' + ONES[o] : '');
    }
    const h = Math.floor(n / 100);
    const r = n % 100;
    return ONES[h] + ' Hundred' + (r ? ' ' + convertBelowThousand(r) : '');
  }

  function convertIndian(n: number): string {
    if (n === 0) return '';

    const crore = Math.floor(n / 10000000);
    const lakh = Math.floor((n % 10000000) / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const hundred = n % 1000;

    const parts: string[] = [];
    if (crore > 0) parts.push(convertBelowThousand(crore) + ' Crore');
    if (lakh > 0) parts.push(convertBelowThousand(lakh) + ' Lakh');
    if (thousand > 0) parts.push(convertBelowThousand(thousand) + ' Thousand');
    if (hundred > 0) parts.push(convertBelowThousand(hundred));

    return parts.join(' ');
  }

  let result = '';
  if (isNegative) result += 'Negative ';
  result += convertIndian(whole) + ' Only';

  if (paise > 0) {
    const paiseWords = convertIndian(paise);
    result = result.replace(' Only', '');
    result += ` and ${paiseWords} Paise Only`;
  }

  return result;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatIndianNumber(n: number): string {
  if (typeof n !== 'number' || isNaN(n)) return '₹0';
  const isNegative = n < 0;
  const absNum = Math.abs(n);
  const whole = Math.floor(absNum);
  const decimal = Math.round((absNum - whole) * 100);

  const wholeStr = String(whole);
  const lastThree = wholeStr.slice(-3);
  const rest = wholeStr.slice(0, -3);

  let formatted: string;
  if (rest.length > 0) {
    const pairs: string[] = [];
    for (let i = rest.length; i > 0; i -= 2) {
      pairs.unshift(rest.slice(Math.max(0, i - 2), i));
    }
    formatted = pairs.join(',') + ',' + lastThree;
  } else {
    formatted = lastThree;
  }

  const sign = isNegative ? '-' : '';
  const paise = decimal > 0 ? `.${String(decimal).padStart(2, '0')}` : '';
  return `${sign}₹${formatted}${paise}`;
}

function formatDateSimple(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '—';
  const day = String(date.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

// ──────────────────────────────────────────────
// PDF Drawing Helpers
// ──────────────────────────────────────────────

function drawHeaderBar(doc: typeof PDFDocument.prototype, y: number, text: string, fontSize: number = 12): number {
  doc.rect(40, y, doc.page.width - 80, 24).fill(COLORS.headerBg);
  doc.fillColor(COLORS.headerText).fontSize(fontSize).font('Helvetica-Bold');
  doc.text(text, 50, y + 6, { width: doc.page.width - 100, align: 'center' });
  doc.fillColor(COLORS.text);
  return y + 24;
}

function drawTableHeader(doc: typeof PDFDocument.prototype, y: number, columns: { label: string; x: number; width: number }[]): number {
  doc.rect(40, y, doc.page.width - 80, 20).fill(COLORS.headerBg);
  doc.fillColor(COLORS.headerText).fontSize(8).font('Helvetica-Bold');
  for (const col of columns) {
    doc.text(col.label, col.x, y + 5, { width: col.width, align: col.label === 'Sr.No' || col.label === 'Qty' || col.label === 'Rate' || col.label === 'Amount' ? 'right' : 'left' });
  }
  doc.fillColor(COLORS.text);
  return y + 20;
}

function drawTableRow(
  doc: typeof PDFDocument.prototype,
  y: number,
  columns: { text: string; x: number; width: number; align?: string }[],
  isAlternate: boolean,
  isBold: boolean = false,
): number {
  if (isAlternate) {
    doc.rect(40, y, doc.page.width - 80, 18).fill(COLORS.alternateRow);
  }
  doc.fillColor(COLORS.text).fontSize(8).font(isBold ? 'Helvetica-Bold' : 'Helvetica');
  doc.rect(40, y, doc.page.width - 80, 18).stroke(COLORS.border);
  for (const col of columns) {
    doc.text(col.text, col.x, y + 4, { width: col.width, align: col.align || 'left' });
  }
  return y + 18;
}

function drawHorizontalLine(doc: typeof PDFDocument.prototype, y: number): number {
  doc.moveTo(40, y).lineTo(doc.page.width - 40).strokeColor(COLORS.border).stroke();
  doc.strokeColor(COLORS.text);
  return y;
}

function checkPageBreak(doc: typeof PDFDocument.prototype, y: number, needed: number = 80): number {
  if (y + needed > doc.page.height - 50) {
    doc.addPage();
    return 50;
  }
  return y;
}

// ──────────────────────────────────────────────
// generateInvoicePdf
// ──────────────────────────────────────────────

export function generateInvoicePdf(
  voucher: VoucherData,
  entries?: LedgerEntry[],
  stockEntries?: StockEntry[],
): Buffer {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `Invoice ${voucher.voucher_number}`,
      Author: 'TallySync AI Bot',
      Subject: `Invoice - ${voucher.party_ledger_name}`,
      Creator: 'TallySync AI Bot',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  let y = 40;

  // ── Company Header ──
  doc.fontSize(18).font('Helvetica-Bold').fillColor(COLORS.navy);
  doc.text(voucher.company_name || 'Your Company Name', 40, y, { align: 'center' });
  y += 22;

  doc.fontSize(9).font('Helvetica').fillColor(COLORS.mutedText);
  const addressLines = (voucher.company_address || '123 Business Street, City - 000001').split('\n');
  for (const line of addressLines) {
    doc.text(line, 40, y, { align: 'center' });
    y += 12;
  }
  y += 2;

  if (voucher.gstin) {
    doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.text);
    doc.text(`GSTIN: ${voucher.gstin}`, 40, y, { align: 'center' });
    y += 14;
  }

  // Horizontal separator
  drawHorizontalLine(doc, y);
  y += 6;

  // ── Invoice Title ──
  y = drawHeaderBar(doc, y, 'TAX INVOICE', 14);
  y += 6;

  // ── Invoice Details Section ──
  const leftX = 50;
  const rightX = doc.page.width - 180;

  doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.navy);
  doc.text('Invoice No:', leftX, y);
  doc.text('Date:', leftX, y + 13);
  doc.text('Voucher Type:', leftX, y + 26);

  doc.font('Helvetica').fillColor(COLORS.text);
  doc.text(voucher.voucher_number, leftX + 70, y);
  doc.text(formatDateSimple(voucher.vch_date), leftX + 70, y + 13);
  doc.text(voucher.voucher_type, leftX + 70, y + 26);

  doc.font('Helvetica-Bold').fillColor(COLORS.navy);
  doc.text('Party:', rightX, y);
  doc.text('GSTIN:', rightX, y + 13);

  doc.font('Helvetica').fillColor(COLORS.text);
  doc.text(voucher.party_ledger_name, rightX + 45, y);
  doc.text(voucher.gstin || '—', rightX + 45, y + 13);

  y += 42;
  drawHorizontalLine(doc, y);
  y += 6;

  // ── Stock Items Table ──
  if (stockEntries && stockEntries.length > 0) {
    y = checkPageBreak(doc, y);
    y = drawHeaderBar(doc, y, 'ITEM DETAILS', 10);
    y += 2;

    const colWidths = [30, 230, 40, 60, 80];
    const tableLeft = 50;
    const columns = [
      { label: 'Sr.No', x: tableLeft, width: colWidths[0] },
      { label: 'Item Name', x: tableLeft + colWidths[0], width: colWidths[1] },
      { label: 'Qty', x: tableLeft + colWidths[0] + colWidths[1], width: colWidths[2] },
      { label: 'Rate', x: tableLeft + colWidths[0] + colWidths[1] + colWidths[2], width: colWidths[3] },
      { label: 'Amount', x: tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], width: colWidths[4] },
    ];

    y = drawTableHeader(doc, y, columns);

    let itemTotal = 0;
    for (let i = 0; i < stockEntries.length; i++) {
      y = checkPageBreak(doc, y, 22);
      const item = stockEntries[i];
      const cells = [
        { text: String(i + 1), x: columns[0].x, width: columns[0].width, align: 'right' },
        { text: item.stock_item_name + (item.hsn_code ? ` (${item.hsn_code})` : ''), x: columns[1].x, width: columns[1].width },
        { text: String(item.quantity) + (item.unit ? ` ${item.unit}` : ''), x: columns[2].x, width: columns[2].width, align: 'right' },
        { text: formatIndianNumber(item.rate), x: columns[3].x, width: columns[3].width, align: 'right' },
        { text: formatIndianNumber(item.amount), x: columns[4].x, width: columns[4].width, align: 'right' },
      ];
      y = drawTableRow(doc, y, cells, i % 2 === 1);
      itemTotal += item.amount;
    }

    // Item total row
    const totalCells = [
      { text: '', x: columns[0].x, width: columns[0].width },
      { text: '', x: columns[1].x, width: columns[1].width },
      { text: '', x: columns[2].x, width: columns[2].width },
      { text: 'Total', x: columns[3].x, width: columns[3].width, align: 'right' },
      { text: formatIndianNumber(itemTotal), x: columns[4].x, width: columns[4].width, align: 'right' },
    ];
    y = drawTableRow(doc, y, totalCells, false, true);
    y += 4;
  }

  // ── Ledger Entries / Tax Table ──
  if (entries && entries.length > 0) {
    y = checkPageBreak(doc, y);
    y = drawHeaderBar(doc, y, 'LEDGER ENTRIES', 10);
    y += 2;

    const taxColWidths = [50, 200, 70, 120];
    const taxLeft = 50;
    const taxColumns = [
      { label: 'Sr.No', x: taxLeft, width: taxColWidths[0] },
      { label: 'Particulars', x: taxLeft + taxColWidths[0], width: taxColWidths[1] },
      { label: 'Type', x: taxLeft + taxColWidths[0] + taxColWidths[1], width: taxColWidths[2] },
      { label: 'Amount', x: taxLeft + taxColWidths[0] + taxColWidths[1] + taxColWidths[2], width: taxColWidths[3] },
    ];

    y = drawTableHeader(doc, y, taxColumns);

    for (let i = 0; i < entries.length; i++) {
      y = checkPageBreak(doc, y, 22);
      const entry = entries[i];
      const cells = [
        { text: String(i + 1), x: taxColumns[0].x, width: taxColumns[0].width, align: 'right' },
        { text: entry.name, x: taxColumns[1].x, width: taxColumns[1].width },
        { text: entry.is_debit ? 'Dr' : 'Cr', x: taxColumns[2].x, width: taxColumns[2].width, align: 'center' },
        { text: formatIndianNumber(entry.amount), x: taxColumns[3].x, width: taxColumns[3].width, align: 'right' },
      ];
      y = drawTableRow(doc, y, cells, i % 2 === 1);
    }
    y += 4;
  }

  // ── Grand Total Box ──
  y = checkPageBreak(doc, y, 50);
  drawHorizontalLine(doc, y);
  y += 4;

  doc.rect(40, y, doc.page.width - 80, 28).fill(COLORS.navy);
  doc.fillColor(COLORS.headerText).fontSize(12).font('Helvetica-Bold');
  doc.text(
    `Grand Total: ${formatIndianNumber(voucher.amount)}`,
    50, y + 6,
    { width: doc.page.width - 100, align: 'right' },
  );
  doc.fillColor(COLORS.text);
  y += 32;

  // ── Amount in Words ──
  y = checkPageBreak(doc, y);
  doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.navy);
  doc.text('Amount in Words:', 50, y);
  doc.font('Helvetica').fillColor(COLORS.text);
  doc.text(numberToWords(voucher.amount), 50, y + 13, { width: doc.page.width - 100 });
  y += 30;

  // ── Narration ──
  if (voucher.narration) {
    y = checkPageBreak(doc, y);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.navy);
    doc.text('Narration:', 50, y);
    doc.font('Helvetica').fillColor(COLORS.text);
    doc.text(voucher.narration, 50, y + 13, { width: doc.page.width - 100 });
    y += 26;
  }

  // ── Footer line with auto-generated notice ──
  y = doc.page.height - 50;
  drawHorizontalLine(doc, y);
  doc.fontSize(7).font('Helvetica').fillColor(COLORS.mutedText);
  doc.text('This is a computer-generated invoice generated by TallySync AI Bot.', 40, y + 4, { align: 'center' });

  doc.end();

  return Buffer.concat(chunks);
}

// ──────────────────────────────────────────────
// generateLedgerPdf
// ──────────────────────────────────────────────

export function generateLedgerPdf(
  partyName: string,
  transactions: Transaction[],
  openingBalance: number,
  fromDate: string,
  toDate: string,
): Buffer {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `Ledger - ${partyName}`,
      Author: 'TallySync AI Bot',
      Subject: `Ledger Report - ${partyName}`,
      Creator: 'TallySync AI Bot',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  let y = 40;

  // ── Header ──
  doc.fontSize(16).font('Helvetica-Bold').fillColor(COLORS.navy);
  doc.text(partyName, 40, y, { align: 'center' });
  y += 22;

  doc.fontSize(10).font('Helvetica').fillColor(COLORS.mutedText);
  doc.text(`Ledger Report from ${formatDateSimple(fromDate)} to ${formatDateSimple(toDate)}`, 40, y, { align: 'center' });
  y += 18;

  drawHorizontalLine(doc, y);
  y += 6;

  // ── Columns ──
  const colWidths = [65, 155, 80, 70, 70, 80];
  const tableLeft = 50;
  const ledgerColumns = [
    { label: 'Date', x: tableLeft, width: colWidths[0] },
    { label: 'Particulars', x: tableLeft + colWidths[0], width: colWidths[1] },
    { label: 'Vch Type', x: tableLeft + colWidths[0] + colWidths[1], width: colWidths[2] },
    { label: 'Debit (₹)', x: tableLeft + colWidths[0] + colWidths[1] + colWidths[2], width: colWidths[3] },
    { label: 'Credit (₹)', x: tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], width: colWidths[4] },
    { label: 'Balance', x: tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], width: colWidths[5] },
  ];

  y = drawTableHeader(doc, y, ledgerColumns);

  // ── Opening Balance Row ──
  const obLabel = openingBalance >= 0 ? 'Opening Balance (Dr)' : 'Opening Balance (Cr)';
  const obCells = [
    { text: '', x: ledgerColumns[0].x, width: ledgerColumns[0].width },
    { text: obLabel, x: ledgerColumns[1].x, width: ledgerColumns[1].width },
    { text: '', x: ledgerColumns[2].x, width: ledgerColumns[2].width },
    { text: openingBalance > 0 ? formatIndianNumber(openingBalance) : '', x: ledgerColumns[3].x, width: ledgerColumns[3].width, align: 'right' },
    { text: openingBalance < 0 ? formatIndianNumber(Math.abs(openingBalance)) : '', x: ledgerColumns[4].x, width: ledgerColumns[4].width, align: 'right' },
    { text: formatIndianNumber(Math.abs(openingBalance)) + (openingBalance >= 0 ? ' Dr' : ' Cr'), x: ledgerColumns[5].x, width: ledgerColumns[5].width, align: 'right' },
  ];
  y = drawTableRow(doc, y, obCells, false, true);
  y += 1;

  // ── Transaction Rows ──
  let runningBalance = openingBalance;

  for (let i = 0; i < transactions.length; i++) {
    y = checkPageBreak(doc, y, 22);
    const txn = transactions[i];
    const isDebit = txn.is_debit ?? true;

    if (isDebit) {
      runningBalance += txn.amount;
    } else {
      runningBalance -= txn.amount;
    }

    const cells = [
      { text: formatDateSimple(txn.vch_date), x: ledgerColumns[0].x, width: ledgerColumns[0].width },
      { text: txn.party_ledger_name, x: ledgerColumns[1].x, width: ledgerColumns[1].width },
      { text: txn.voucher_type, x: ledgerColumns[2].x, width: ledgerColumns[2].width },
      { text: isDebit ? formatIndianNumber(txn.amount) : '', x: ledgerColumns[3].x, width: ledgerColumns[3].width, align: 'right' },
      { text: !isDebit ? formatIndianNumber(txn.amount) : '', x: ledgerColumns[4].x, width: ledgerColumns[4].width, align: 'right' },
      { text: formatIndianNumber(Math.abs(runningBalance)) + (runningBalance >= 0 ? ' Dr' : ' Cr'), x: ledgerColumns[5].x, width: ledgerColumns[5].width, align: 'right' },
    ];
    y = drawTableRow(doc, y, cells, i % 2 === 1);
  }

  y += 2;

  // ── Closing Balance ──
  drawHorizontalLine(doc, y);
  y += 2;

  const closingLabel = runningBalance >= 0 ? 'Closing Balance (Dr)' : 'Closing Balance (Cr)';
  const closeCells = [
    { text: '', x: ledgerColumns[0].x, width: ledgerColumns[0].width },
    { text: closingLabel, x: ledgerColumns[1].x, width: ledgerColumns[1].width + ledgerColumns[2].width },
    { text: '', x: ledgerColumns[2].x, width: ledgerColumns[2].width },
    { text: runningBalance > 0 ? formatIndianNumber(runningBalance) : '', x: ledgerColumns[3].x, width: ledgerColumns[3].width, align: 'right' },
    { text: runningBalance < 0 ? formatIndianNumber(Math.abs(runningBalance)) : '', x: ledgerColumns[4].x, width: ledgerColumns[4].width, align: 'right' },
    { text: formatIndianNumber(Math.abs(runningBalance)) + (runningBalance >= 0 ? ' Dr' : ' Cr'), x: ledgerColumns[5].x, width: ledgerColumns[5].width, align: 'right' },
  ];
  y = drawTableRow(doc, y, closeCells, false, true);

  // ── Footer ──
  y = doc.page.height - 50;
  drawHorizontalLine(doc, y);
  doc.fontSize(7).font('Helvetica').fillColor(COLORS.mutedText);
  doc.text('This is a computer-generated ledger report generated by TallySync AI Bot.', 40, y + 4, { align: 'center' });

  doc.end();
  return Buffer.concat(chunks);
}

// ──────────────────────────────────────────────
// generateStockPdf
// ──────────────────────────────────────────────

export function generateStockPdf(item: StockItemData): Buffer {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `Stock Item - ${item.stock_item_name}`,
      Author: 'TallySync AI Bot',
      Subject: 'Stock Item Details',
      Creator: 'TallySync AI Bot',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  let y = 40;

  // ── Header ──
  doc.fontSize(16).font('Helvetica-Bold').fillColor(COLORS.navy);
  doc.text('Stock Item Details', 40, y, { align: 'center' });
  y += 26;

  drawHorizontalLine(doc, y);
  y += 10;

  // ── Item Name Banner ──
  doc.rect(40, y, doc.page.width - 80, 28).fill(COLORS.navy);
  doc.fillColor(COLORS.headerText).fontSize(13).font('Helvetica-Bold');
  doc.text(item.stock_item_name, 50, y + 6, { width: doc.page.width - 100, align: 'center' });
  doc.fillColor(COLORS.text);
  y += 36;

  // ── Details Grid ──
  const detailLeft = 60;
  const detailCol1 = 120;
  const detailCol2 = doc.page.width / 2 + 20;
  const detailCol3 = detailCol2 + 120;

  const details: { label: string; value: string; col: number }[] = [
    { label: 'HSN Code:', value: item.hsn_code || '—', col: 0 },
    { label: 'Unit:', value: item.unit || '—', col: 0 },
    { label: 'Rate (₹):', value: item.rate != null ? formatIndianNumber(item.rate) : '—', col: 0 },
    { label: 'Current Stock:', value: item.quantity != null ? String(item.quantity) : '—', col: 1 },
    { label: 'Opening Stock:', value: item.opening_stock != null ? String(item.opening_stock) : '—', col: 1 },
    { label: 'GST Rate:', value: item.tax_rate != null ? `${item.tax_rate}%` : '—', col: 1 },
  ];

  const maxRows = Math.max(
    details.filter((d) => d.col === 0).length,
    details.filter((d) => d.col === 1).length,
  );

  const leftCol = details.filter((d) => d.col === 0);
  const rightCol = details.filter((d) => d.col === 1);

  for (let i = 0; i < maxRows; i++) {
    if (leftCol[i]) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.navy);
      doc.text(leftCol[i].label, detailLeft, y);
      doc.font('Helvetica').fillColor(COLORS.text);
      doc.text(leftCol[i].value, detailLeft + detailCol1, y);
    }
    if (rightCol[i]) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.navy);
      doc.text(rightCol[i].label, detailCol2, y);
      doc.font('Helvetica').fillColor(COLORS.text);
      doc.text(rightCol[i].value, detailCol2 + detailCol1, y);
    }
    y += 18;
  }

  y += 10;
  drawHorizontalLine(doc, y);
  y += 6;

  // ── Godown-wise Stock Section (simulated) ──
  y = drawHeaderBar(doc, y, 'GODOWN-WISE STOCK', 10);
  y += 4;

  const gwColumns = [
    { label: 'Godown', x: 50, width: 200 },
    { label: 'Quantity', x: 250, width: 100 },
    { label: 'Unit', x: 350, width: 100 },
  ];

  y = drawTableHeader(doc, y, gwColumns);

  // Default single godown entry
  const gwRows = [
    { godown: 'Main Location', qty: item.quantity ?? 0, unit: item.unit || 'Nos' },
  ];

  for (let i = 0; i < gwRows.length; i++) {
    y = checkPageBreak(doc, y, 22);
    const row = gwRows[i];
    const cells = [
      { text: row.godown, x: gwColumns[0].x, width: gwColumns[0].width },
      { text: String(row.qty), x: gwColumns[1].x, width: gwColumns[1].width, align: 'right' },
      { text: row.unit, x: gwColumns[2].x, width: gwColumns[2].width, align: 'center' },
    ];
    y = drawTableRow(doc, y, cells, i % 2 === 1);
  }

  // ── Footer ──
  y = doc.page.height - 50;
  drawHorizontalLine(doc, y);
  doc.fontSize(7).font('Helvetica').fillColor(COLORS.mutedText);
  doc.text('This is a computer-generated stock report generated by TallySync AI Bot.', 40, y + 4, { align: 'center' });

  doc.end();
  return Buffer.concat(chunks);
}

// ──────────────────────────────────────────────
// generateCustomerStatementPdf
// ──────────────────────────────────────────────

export function generateCustomerStatementPdf(
  partyName: string,
  summary: CustomerSummary,
): Buffer {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `Customer Statement - ${partyName}`,
      Author: 'TallySync AI Bot',
      Subject: 'Customer Statement',
      Creator: 'TallySync AI Bot',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  let y = 40;

  // ── Header ──
  doc.fontSize(16).font('Helvetica-Bold').fillColor(COLORS.navy);
  doc.text('Customer Statement', 40, y, { align: 'center' });
  y += 24;

  drawHorizontalLine(doc, y);
  y += 10;

  // ── Customer Banner ──
  doc.rect(40, y, doc.page.width - 80, 28).fill(COLORS.navy);
  doc.fillColor(COLORS.headerText).fontSize(13).font('Helvetica-Bold');
  doc.text(partyName, 50, y + 6, { width: doc.page.width - 100, align: 'center' });
  doc.fillColor(COLORS.text);
  y += 36;

  // ── Contact Details ──
  if (summary.phone || summary.gstin) {
    doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.navy);
    let contactStr = '';
    if (summary.phone) contactStr += `Phone: ${summary.phone}`;
    if (summary.phone && summary.gstin) contactStr += '  |  ';
    if (summary.gstin) contactStr += `GSTIN: ${summary.gstin}`;
    doc.text(contactStr, 50, y);
    y += 18;
    drawHorizontalLine(doc, y);
    y += 8;
  }

  // ── Financial Summary Cards ──
  const cardW = (doc.page.width - 120) / 2;
  const cardH = 60;
  const cardY = y;

  // Outstanding Card
  doc.rect(50, cardY, cardW, cardH).fill(COLORS.navy);
  doc.fillColor(COLORS.headerText).fontSize(9).font('Helvetica');
  doc.text('Outstanding Amount', 60, cardY + 8, { width: cardW - 20, align: 'center' });
  doc.fontSize(16).font('Helvetica-Bold');
  doc.text(formatIndianNumber(summary.currentBalance), 60, cardY + 24, { width: cardW - 20, align: 'center' });
  const balLabel = summary.currentBalance >= 0 ? '(Dr)' : '(Cr)';
  doc.fontSize(9).font('Helvetica');
  doc.text(balLabel, 60, cardY + 46, { width: cardW - 20, align: 'center' });

  // Opening Balance Card
  doc.rect(50 + cardW + 20, cardY, cardW, cardH).fill(COLORS.alternateRow);
  doc.rect(50 + cardW + 20, cardY, cardW, cardH).stroke(COLORS.border);
  doc.fillColor(COLORS.navy).fontSize(9).font('Helvetica-Bold');
  doc.text('Opening Balance', 60 + cardW + 20, cardY + 8, { width: cardW - 20, align: 'center' });
  doc.fontSize(14).font('Helvetica-Bold');
  doc.text(formatIndianNumber(summary.openingBalance), 60 + cardW + 20, cardY + 22, { width: cardW - 20, align: 'center' });
  const obLabel2 = summary.openingBalance >= 0 ? '(Dr)' : '(Cr)';
  doc.fontSize(9).font('Helvetica');
  doc.text(obLabel2, 60 + cardW + 20, cardY + 42, { width: cardW - 20, align: 'center' });

  y = cardY + cardH + 14;
  drawHorizontalLine(doc, y);
  y += 8;

  // ── Sales / Payment Summary Table ──
  y = drawHeaderBar(doc, y, 'TRANSACTION SUMMARY', 10);
  y += 2;

  const summaryColumns = [
    { label: 'Metric', x: 50, width: 200 },
    { label: 'Amount', x: 300, width: 150 },
  ];
  y = drawTableHeader(doc, y, summaryColumns);

  const summaryRows: { metric: string; amount: string }[] = [];
  if (summary.totalSales != null) summaryRows.push({ metric: 'Total Sales', amount: formatIndianNumber(summary.totalSales) });
  if (summary.totalPayments != null) summaryRows.push({ metric: 'Total Payments / Receipts', amount: formatIndianNumber(summary.totalPayments) });
  if (summary.lastTransaction) {
    summaryRows.push({
      metric: `Last ${summary.lastTransaction.type} on ${formatDateSimple(summary.lastTransaction.date)}`,
      amount: formatIndianNumber(summary.lastTransaction.amount),
    });
  }

  for (let i = 0; i < summaryRows.length; i++) {
    y = checkPageBreak(doc, y, 22);
    const cells = [
      { text: summaryRows[i].metric, x: summaryColumns[0].x, width: summaryColumns[0].width },
      { text: summaryRows[i].amount, x: summaryColumns[1].x, width: summaryColumns[1].width, align: 'right' },
    ];
    y = drawTableRow(doc, y, cells, i % 2 === 1);
  }

  // ── Footer ──
  y = doc.page.height - 50;
  drawHorizontalLine(doc, y);
  doc.fontSize(7).font('Helvetica').fillColor(COLORS.mutedText);
  doc.text('This is a computer-generated customer statement generated by TallySync AI Bot.', 40, y + 4, { align: 'center' });

  doc.end();
  return Buffer.concat(chunks);
}
