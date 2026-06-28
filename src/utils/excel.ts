import ExcelJS from 'exceljs';
import {
  VoucherData,
  LedgerEntry,
  StockEntry,
  Transaction,
} from '../pdf/generator';

// ──────────────────────────────────────────────
// Number formatting helpers (mirrored from pdf module)
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
// Style constants
// ──────────────────────────────────────────────

const STYLES = {
  headerFont: { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } },
  headerFill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1B2A4A' } },
  headerBorder: {
    top: { style: 'thin' as const, color: { argb: 'FF1B2A4A' } },
    left: { style: 'thin' as const, color: { argb: 'FF1B2A4A' } },
    bottom: { style: 'thin' as const, color: { argb: 'FF1B2A4A' } },
    right: { style: 'thin' as const, color: { argb: 'FF1B2A4A' } },
  },
  cellBorder: {
    top: { style: 'thin' as const, color: { argb: 'FFD0D3E0' } },
    left: { style: 'thin' as const, color: { argb: 'FFD0D3E0' } },
    bottom: { style: 'thin' as const, color: { argb: 'FFD0D3E0' } },
    right: { style: 'thin' as const, color: { argb: 'FFD0D3E0' } },
  },
  alternateFill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF5F6FA' } },
  titleFont: { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1B2A4A' } },
  subtitleFont: { name: 'Calibri', size: 10, color: { argb: 'FF7F8C8D' } },
  boldFont: { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF2C3E50' } },
  normalFont: { name: 'Calibri', size: 11, color: { argb: 'FF2C3E50' } },
};

// ──────────────────────────────────────────────
// Workbook setup helpers
// ──────────────────────────────────────────────

function addTitleRow(ws: ExcelJS.Worksheet, title: string, subtitle: string, mergeTo: number): void {
  const titleRow = ws.getRow(1);
  titleRow.height = 28;
  const titleCell = titleRow.getCell(1);
  titleCell.value = title;
  titleCell.font = STYLES.titleFont;
  ws.mergeCells(1, 1, 1, mergeTo);

  const subRow = ws.getRow(2);
  subRow.height = 18;
  const subCell = subRow.getCell(1);
  subCell.value = subtitle;
  subCell.font = STYLES.subtitleFont;
  ws.mergeCells(2, 1, 2, mergeTo);
}

function addHeaderRow(ws: ExcelJS.Worksheet, rowNum: number, headers: string[], colStart: number = 1): void {
  const row = ws.getRow(rowNum);
  row.height = 22;
  headers.forEach((h, i) => {
    const cell = row.getCell(colStart + i);
    cell.value = h;
    cell.font = STYLES.headerFont;
    cell.fill = STYLES.headerFill;
    cell.border = STYLES.headerBorder;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
}

function addDataRow(
  ws: ExcelJS.Worksheet,
  rowNum: number,
  values: (string | number | null | undefined)[],
  colStart: number = 1,
  isAlternate: boolean = false,
  isBold: boolean = false,
): void {
  const row = ws.getRow(rowNum);
  row.height = 18;
  values.forEach((v, i) => {
    const cell = row.getCell(colStart + i);
    cell.value = v ?? '';
    cell.font = isBold ? STYLES.boldFont : STYLES.normalFont;
    cell.border = STYLES.cellBorder;
    cell.alignment = { vertical: 'middle', horizontal: typeof v === 'number' ? 'right' : 'left' };
    if (isAlternate) {
      cell.fill = STYLES.alternateFill;
    }
  });
}

function addFooterRow(ws: ExcelJS.Worksheet, rowNum: number, label: string, value: string, colStart: number, mergeSpan: number): void {
  const row = ws.getRow(rowNum);
  row.height = 22;
  const labelCell = row.getCell(colStart);
  labelCell.value = label;
  labelCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  labelCell.fill = STYLES.headerFill;
  labelCell.border = STYLES.headerBorder;
  labelCell.alignment = { vertical: 'middle', horizontal: 'right' };

  const valueCell = row.getCell(colStart + mergeSpan);
  valueCell.value = value;
  valueCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  valueCell.fill = STYLES.headerFill;
  valueCell.border = STYLES.headerBorder;
  valueCell.alignment = { vertical: 'middle', horizontal: 'right' };

  // Merge span for label
  if (mergeSpan > 1) {
    ws.mergeCells(rowNum, colStart, rowNum, colStart + mergeSpan - 1);
  }
}

// ──────────────────────────────────────────────
// generateInvoiceExcel
// ──────────────────────────────────────────────

export async function generateInvoiceExcel(
  voucher: VoucherData,
  entries?: LedgerEntry[],
  stockEntries?: StockEntry[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TallySync AI Bot';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Invoice');

  // Column widths
  ws.columns = [
    { width: 8 },   // A: Sr.No
    { width: 30 },  // B: Item Name
    { width: 10 },  // C: Qty
    { width: 14 },  // D: Rate
    { width: 16 },  // E: Amount
    { width: 12 },  // F: HSN
    { width: 10 },  // G: Tax %
  ];

  // Title
  addTitleRow(ws, voucher.company_name || 'Your Company Name', `GSTIN: ${voucher.gstin || '—'}`, 7);

  // Invoice info
  const infoRow = 4;
  ws.getRow(infoRow).height = 18;
  ws.getCell(infoRow, 1).value = `Invoice No: ${voucher.voucher_number}`;
  ws.getCell(infoRow, 1).font = STYLES.boldFont;
  ws.getCell(infoRow, 5).value = `Date: ${formatDateSimple(voucher.vch_date)}`;
  ws.getCell(infoRow, 5).font = STYLES.boldFont;

  const partyRow = 5;
  ws.getRow(partyRow).height = 18;
  ws.getCell(partyRow, 1).value = `Party: ${voucher.party_ledger_name}`;
  ws.getCell(partyRow, 1).font = STYLES.boldFont;
  ws.getCell(partyRow, 5).value = `Voucher Type: ${voucher.voucher_type}`;
  ws.getCell(partyRow, 5).font = STYLES.boldFont;

  // Headers
  const headers = ['Sr.No', 'Item Name', 'Qty', 'Rate', 'Amount', 'HSN Code', 'Tax %'];
  addHeaderRow(ws, 7, headers);

  // Stock entries
  let row = 8;
  let itemTotal = 0;
  if (stockEntries && stockEntries.length > 0) {
    for (let i = 0; i < stockEntries.length; i++) {
      const item = stockEntries[i];
      addDataRow(ws, row, [
        i + 1,
        item.stock_item_name,
        item.quantity + (item.unit ? ` ${item.unit}` : ''),
        item.rate,
        item.amount,
        item.hsn_code || '',
        item.tax_rate != null ? `${item.tax_rate}%` : '',
      ], 1, i % 2 === 1);
      itemTotal += item.amount;
      row++;
    }
  }

  // Subtotal
  addDataRow(ws, row, ['', 'Item Total', '', '', itemTotal, '', ''], 1, false, true);
  row += 2;

  // Ledger entries section
  if (entries && entries.length > 0) {
    const ledgerHeaders = ['Sr.No', 'Particulars', 'Type (Dr/Cr)', 'Amount'];
    // Clear any existing merge from title for the ledger section
    const ledgerStartRow = row;
    ws.getCell(row, 1).value = 'Ledger Entries';
    ws.getCell(row, 1).font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF1B2A4A' } };
    ws.mergeCells(row, 1, row, 4);
    row++;

    addHeaderRow(ws, row, ledgerHeaders, 1);
    row++;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      addDataRow(ws, row, [
        i + 1,
        entry.name,
        entry.is_debit ? 'Dr' : 'Cr',
        entry.amount,
      ], 1, i % 2 === 1);
      row++;
    }
    row++;
  }

  // Grand total
  addFooterRow(ws, row, 'Grand Total', formatIndianNumber(voucher.amount), 1, 4);
  row += 2;

  // Narration
  if (voucher.narration) {
    ws.getRow(row).height = 18;
    ws.getCell(row, 1).value = `Narration: ${voucher.narration}`;
    ws.getCell(row, 1).font = STYLES.normalFont;
    ws.mergeCells(row, 1, row, 7);
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ──────────────────────────────────────────────
// generateLedgerExcel
// ──────────────────────────────────────────────

export async function generateLedgerExcel(
  partyName: string,
  transactions: Transaction[],
  openingBalance: number,
  fromDate: string,
  toDate: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TallySync AI Bot';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Ledger');

  // Column widths
  ws.columns = [
    { width: 14 },  // A: Date
    { width: 28 },  // B: Particulars
    { width: 16 },  // C: Vch Type
    { width: 16 },  // D: Debit
    { width: 16 },  // E: Credit
    { width: 18 },  // F: Balance
  ];

  // Title
  addTitleRow(ws, partyName, `Ledger from ${formatDateSimple(fromDate)} to ${formatDateSimple(toDate)}`, 6);

  // Headers
  const headers = ['Date', 'Particulars', 'Vch Type', 'Debit (₹)', 'Credit (₹)', 'Balance'];
  addHeaderRow(ws, 4, headers);

  // Opening balance row
  let row = 5;
  const obLabel = openingBalance >= 0 ? 'Opening Balance (Dr)' : 'Opening Balance (Cr)';
  addDataRow(ws, row, [
    '',
    obLabel,
    '',
    openingBalance > 0 ? openingBalance : '',
    openingBalance < 0 ? Math.abs(openingBalance) : '',
    `${formatIndianNumber(Math.abs(openingBalance))} ${openingBalance >= 0 ? 'Dr' : 'Cr'}`,
  ], 1, false, true);
  row++;

  // Transaction rows
  let runningBalance = openingBalance;
  for (let i = 0; i < transactions.length; i++) {
    const txn = transactions[i];
    const isDebit = txn.is_debit ?? true;

    if (isDebit) {
      runningBalance += txn.amount;
    } else {
      runningBalance -= txn.amount;
    }

    addDataRow(ws, row, [
      formatDateSimple(txn.vch_date),
      txn.party_ledger_name,
      txn.voucher_type,
      isDebit ? txn.amount : '',
      !isDebit ? txn.amount : '',
      `${formatIndianNumber(Math.abs(runningBalance))} ${runningBalance >= 0 ? 'Dr' : 'Cr'}`,
    ], 1, i % 2 === 1);
    row++;
  }

  // Closing balance
  const closingLabel = runningBalance >= 0 ? 'Closing Balance (Dr)' : 'Closing Balance (Cr)';
  addDataRow(ws, row, [
    '',
    closingLabel,
    '',
    runningBalance > 0 ? runningBalance : '',
    runningBalance < 0 ? Math.abs(runningBalance) : '',
    `${formatIndianNumber(Math.abs(runningBalance))} ${runningBalance >= 0 ? 'Dr' : 'Cr'}`,
  ], 1, false, true);

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ──────────────────────────────────────────────
// generateStockExcel
// ──────────────────────────────────────────────

export async function generateStockExcel(items: StockEntry[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TallySync AI Bot';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Stock Items');

  // Column widths
  ws.columns = [
    { width: 8 },   // A: Sr.No
    { width: 28 },  // B: Item Name
    { width: 10 },  // C: Qty
    { width: 14 },  // D: Rate
    { width: 16 },  // E: Amount
    { width: 14 },  // F: HSN Code
    { width: 10 },  // G: Tax %
    { width: 10 },  // H: Unit
  ];

  // Title
  addTitleRow(ws, 'Stock Items Report', 'Generated by TallySync AI Bot', 8);

  // Headers
  const headers = ['Sr.No', 'Item Name', 'Qty', 'Rate', 'Amount', 'HSN Code', 'Tax %', 'Unit'];
  addHeaderRow(ws, 4, headers);

  // Data rows
  let row = 5;
  let totalQty = 0;
  let totalAmount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    addDataRow(ws, row, [
      i + 1,
      item.stock_item_name,
      item.quantity,
      item.rate,
      item.amount,
      item.hsn_code || '',
      item.tax_rate != null ? `${item.tax_rate}%` : '',
      item.unit || '',
    ], 1, i % 2 === 1);
    totalQty += item.quantity;
    totalAmount += item.amount;
    row++;
  }

  // Totals row
  addDataRow(ws, row, [
    '',
    'TOTAL',
    totalQty,
    '',
    totalAmount,
    '',
    '',
    '',
  ], 1, false, true);

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}
