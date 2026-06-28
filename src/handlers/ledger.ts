import { Context, Markup } from 'telegraf';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import logger from '../logger';
import {
  ConversationState,
  storeSession,
  getSession,
  setState,
  clearSession,
} from '../services/conversation';
import { searchParties, smartSuggestParty, buildSuggestionMessage } from '../services/fuzzySearch';
import { getSupabaseClient } from '../supabase/client';
import { formatDate, formatIndian } from '../utils/formatters';
import { escapeMd } from '../utils/formatters';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDateRange(period: string): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  switch (period) {
    case 'today': {
      return { dateFrom: today, dateTo: today };
    }
    case 'yesterday': {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const ys = yesterday.toISOString().slice(0, 10);
      return { dateFrom: ys, dateTo: ys };
    }
    case 'this_week': {
      const dayOfWeek = now.getDay();
      const from = new Date(now);
      from.setDate(now.getDate() - dayOfWeek);
      const to = new Date(from);
      to.setDate(from.getDate() + 6);
      return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) };
    }
    case 'this_month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) };
    }
    case 'last_month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) };
    }
    default:
      return { dateFrom: today, dateTo: today };
  }
}

interface LedgerEntry {
  date: string;
  voucher_number: string;
  voucher_type: string;
  description?: string;
  debit: number;
  credit: number;
}

/**
 * Fetch ledger entries for a party within a date range.
 * Groups vouchers into debit/credit columns based on voucher type.
 */
async function fetchLedgerEntries(
  partyName: string,
  dateFrom: string,
  dateTo: string,
  companyId?: string,
): Promise<{ entries: LedgerEntry[]; openingBalance: number; closingBalance: number }> {
  const supabase = getSupabaseClient();
  const logger = (await import('../logger')).default;

  logger.debug('fetchLedgerEntries', { partyName, dateFrom, dateTo, companyId });

  // Fetch opening balance from ledgers table (uses 'name', not 'party_name')
  const { data: ledgerData, error: ledgerErr } = await supabase
    .from('ledgers')
    .select('opening_balance, name, id')
    .ilike('name', partyName)
    .limit(1);

  if (ledgerErr) {
    logger.error('fetchLedgerEntries: ledger query error', { error: ledgerErr.message });
  }

  const openingBalance = Number(ledgerData?.[0]?.opening_balance) || 0;
  const ledgerName = ledgerData?.[0]?.name || partyName;

  logger.debug('fetchLedgerEntries: ledger found', { 
    ledgerId: ledgerData?.[0]?.id, 
    name: ledgerName,
    openingBalance,
  });

  // Fetch vouchers for this party in date range, scoped to company
  let vQuery = supabase
    .from('vouchers')
    .select('voucher_date, voucher_number, voucher_type, amount, party_ledger_name')
    .ilike('party_ledger_name', ledgerName)
    .gte('voucher_date', dateFrom)
    .lte('voucher_date', dateTo);

  if (companyId) {
    vQuery = vQuery.eq('company_id', companyId);
  }

  const { data: vouchers, error: vErr } = await vQuery
    .order('voucher_date', { ascending: true })
    .order('voucher_number', { ascending: true });

  if (vErr) {
    logger.error('fetchLedgerEntries: voucher query error', { error: vErr.message });
  }

  logger.debug('fetchLedgerEntries: vouchers found', { count: (vouchers || []).length });

  const entries: LedgerEntry[] = [];
  let runningBalance = openingBalance;

  for (const v of vouchers ?? []) {
    const type = (v.voucher_type ?? '').toLowerCase();
    const amount = Number(v.amount) || 0;

    // Determine debit/credit based on voucher type
    // Sales, Receipt → Credit (party gives money)
    // Purchase, Payment → Debit (party receives money)
    let debit = 0;
    let credit = 0;

    if (['sales', 'receipt', 'receipt in', 'sales order'].some((t) => type.includes(t))) {
      credit = amount;
      runningBalance += amount;
    } else if (
      ['purchase', 'payment', 'payment out', 'purchase order', 'debit note'].some((t) =>
        type.includes(t),
      )
    ) {
      debit = amount;
      runningBalance -= amount;
    } else if (['credit note'].some((t) => type.includes(t))) {
      credit = amount;
      runningBalance += amount;
    } else if (['journal'].some((t) => type.includes(t))) {
      // For journal entries, assume positive amount = credit, negative = debit
      if (amount >= 0) {
        credit = amount;
        runningBalance += amount;
      } else {
        debit = Math.abs(amount);
        runningBalance -= Math.abs(amount);
      }
    } else {
      // Default: positive = credit, negative = debit
      if (amount >= 0) {
        credit = amount;
        runningBalance += amount;
      } else {
        debit = Math.abs(amount);
        runningBalance -= Math.abs(amount);
      }
    }

    entries.push({
      date: v.voucher_date,
      voucher_number: v.voucher_number || '—',
      voucher_type: v.voucher_type || 'Unknown',
      debit,
      credit,
    });
  }

  return {
    entries,
    openingBalance,
    closingBalance: runningBalance,
  };
}

/**
 * Generate a ledger PDF with opening balance, running balance, and debit/credit columns.
 */
async function generateLedgerPdf(
  partyName: string,
  dateFrom: string,
  dateTo: string,
  entries: LedgerEntry[],
  openingBalance: number,
  closingBalance: number,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // ── Header ──
      doc.fontSize(20).font('Helvetica-Bold').text('TallyOnMobile', { align: 'center' });
      doc.fontSize(14).text('Ledger Statement', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica');
      doc.text(`Party: ${partyName}`, { align: 'left' });
      doc.text(`Period: ${formatDate(dateFrom)} — ${formatDate(dateTo)}`, { align: 'left' });
      doc.moveDown();

      // Horizontal rule
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown();

      // ── Opening Balance ──
      doc.font('Helvetica-Bold').fontSize(11);
      doc.text(
        `Opening Balance: ${formatIndian(openingBalance)}`,
        { align: 'left' },
      );
      doc.moveDown();

      // ── Table Header ──
      const tableTop = doc.y;
      const colDate = 50;
      const colVoucher = 140;
      const colType = 230;
      const colDebit = 360;
      const colCredit = 450;

      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Date', colDate, tableTop, { width: 85 });
      doc.text('Voucher #', colVoucher, tableTop, { width: 85 });
      doc.text('Type', colType, tableTop, { width: 125 });
      doc.text('Debit (₹)', colDebit, tableTop, { width: 85, align: 'right' });
      doc.text('Credit (₹)', colCredit, tableTop, { width: 85, align: 'right' });
      doc.moveDown();
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      // ── Table Rows ──
      doc.font('Helvetica').fontSize(8);
      let rowY = doc.y;
      const rowHeight = 14;

      for (const entry of entries) {
        // Check if we need a new page
        if (rowY > 720) {
          doc.addPage();
          rowY = 50;
          // Re-draw header on new page
          doc.fontSize(9).font('Helvetica-Bold');
          doc.text('Date', colDate, rowY, { width: 85 });
          doc.text('Voucher #', colVoucher, rowY, { width: 85 });
          doc.text('Type', colType, rowY, { width: 125 });
          doc.text('Debit (₹)', colDebit, rowY, { width: 85, align: 'right' });
          doc.text('Credit (₹)', colCredit, rowY, { width: 85, align: 'right' });
          rowY += 12;
          doc.moveTo(50, rowY - 2).lineTo(545, rowY - 2).stroke();
          rowY += 2;
          doc.font('Helvetica').fontSize(8);
        }

        const typeLabel = entry.voucher_type.length > 18
          ? entry.voucher_type.slice(0, 16) + '..'
          : entry.voucher_type;

        doc.text(formatDate(entry.date) || '—', colDate, rowY, { width: 85 });
        doc.text(entry.voucher_number, colVoucher, rowY, { width: 85 });
        doc.text(typeLabel, colType, rowY, { width: 125 });
        doc.text(entry.debit > 0 ? formatIndian(entry.debit) : '—', colDebit, rowY, {
          width: 85,
          align: 'right',
        });
        doc.text(entry.credit > 0 ? formatIndian(entry.credit) : '—', colCredit, rowY, {
          width: 85,
          align: 'right',
        });

        rowY += rowHeight;
      }

      doc.y = rowY;
      doc.moveDown();
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown();

      // ── Totals ──
      const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
      const totalCredit = entries.reduce((s, e) => s + e.credit, 0);

      doc.font('Helvetica-Bold').fontSize(10);
      doc.text(`Total Debit:  ${formatIndian(totalDebit)}`, { align: 'left' });
      doc.text(`Total Credit: ${formatIndian(totalCredit)}`, { align: 'left' });
      doc.moveDown();
      doc.text(`Closing Balance: ${formatIndian(closingBalance)}`, { align: 'left' });
      doc.moveDown();

      // ── Footer ──
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown();
      doc.fontSize(8).font('Helvetica').text(
        `Generated by TallyOnMobile AI Bot on ${new Date().toLocaleString()}`,
        { align: 'center' },
      );

      doc.end();
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * /ledger command handler.
 * If a party name is provided inline, search and show matching parties.
 */
export async function ledgerCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const args = text.replace(/^\/ledger\s*/i, '').trim();

  if (args) {
    await searchAndShowPartiesForLedger(ctx, args);
  } else {
    setState(chatId, ConversationState.AWAITING_PARTY, { reportType: 'ledger' });
    await ctx.replyWithMarkdown(
      '📒 *Ledger Statement*\n\nPlease enter a *party name* to view their ledger:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🏠 Main Menu', callback_data: 'start' }],
          ],
        },
      },
    );
  }
}

/**
 * Search parties for ledger and show results.
 */
export async function searchAndShowPartiesForLedger(
  ctx: Context,
  query: string,
): Promise<void> {
  const chatId = ctx.chat!.id;
  logger.info('Ledger: searching parties', { chatId, query });

  await ctx.replyWithMarkdown(`🔍 *Searching parties for:* \`${query}\`…`);

  try {
    const matches = await searchParties(query, { maxResults: 10 });
    const parties = matches.slice(0, 5);

    storeSession(chatId, {
      lastSearchedParty: query,
      reportType: 'ledger',
    });

    if (parties.length === 0) {
      // Try smart suggestions
      const suggestions = await smartSuggestParty(query, 5);
      const suggestionMsg = buildSuggestionMessage(query, suggestions);

      if (suggestionMsg) {
        const rows = suggestions.map((match) => {
          const name = match.item.name;
          return [{ text: name, callback_data: `led_party:${name}` }];
        });
        rows.push([{ text: '🔍 Try Again', callback_data: 'ledger' }]);
        rows.push([{ text: '🏠 Main Menu', callback_data: 'start' }]);
        await ctx.replyWithMarkdown(suggestionMsg, { reply_markup: { inline_keyboard: rows } });
      } else {
        await ctx.replyWithMarkdown(
          `❌ No parties found matching \`${escapeMd(query)}\`.`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔍 Try Again', callback_data: 'ledger' }],
                [{ text: '🏠 Main Menu', callback_data: 'start' }],
              ],
            },
          },
        );
      }
      return;
    }

    const partyLines = parties.map(
      (p, i) => `${i + 1}. ${escapeMd(p.item.party_name || p.item.name || '')} (${p.method})`,
    );

    const msg = [
      `📒 *Ledger — Party Search*`,
      '',
      `Found *${matches.length}* match(es) for \`${query}\`:`,
      '',
      ...partyLines,
      '',
      'Select a party to view their ledger 👇',
    ].join('\n');

    const rows = parties.map((match) => {
      const name = match.item.name || match.item.party_name;
      return [Markup.button.callback(name, `led_party:${name}`)];
    });
    rows.push([Markup.button.callback('🏠 Main Menu', 'start')]);

    await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(rows));
  } catch (err: any) {
    logger.error('Ledger: party search error', { chatId, error: err?.message });
    await ctx.replyWithMarkdown('⚠️ *Error searching parties.*');
  }
}

/**
 * Show date range options for a selected party.
 */
export async function onLedgerPartySelected(ctx: Context, partyName: string): Promise<void> {
  const chatId = ctx.chat!.id;
  storeSession(chatId, {
    lastSearchedParty: partyName,
    reportType: 'ledger',
    state: ConversationState.AWAITING_PERIOD,
  });

  const msg = [
    `📒 *Ledger — ${escapeMd(partyName)}*`,
    '',
    'Select a date range for the statement 👇',
  ].join('\n');

  await ctx.replyWithMarkdown(msg, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📅 Today', callback_data: `led_period:${partyName}:today` },
          { text: '📅 Yesterday', callback_data: `led_period:${partyName}:yesterday` },
        ],
        [
          { text: '📅 This Week', callback_data: `led_period:${partyName}:this_week` },
          { text: '📅 This Month', callback_data: `led_period:${partyName}:this_month` },
        ],
        [
          { text: '📅 Last Month', callback_data: `led_period:${partyName}:last_month` },
          { text: '📅 Custom', callback_data: `led_period:${partyName}:custom` },
        ],
        [
          { text: '🔍 Other Party', callback_data: 'ledger' },
          { text: '🏠 Main Menu', callback_data: 'start' },
        ],
      ],
    },
  });
}

/**
 * Handle date range selection and generate ledger PDF.
 */
export async function onLedgerPeriodSelected(
  ctx: Context,
  partyName: string,
  period: string,
): Promise<void> {
  const chatId = ctx.chat!.id;

  if (period === 'custom') {
    setState(chatId, ConversationState.AWAITING_CUSTOM_DATE_FROM, {
      lastSearchedParty: partyName,
      reportType: 'ledger',
      period: 'custom',
    });
    await ctx.replyWithMarkdown(
      `📅 Please enter the *FROM date* (YYYY-MM-DD):\n\nExample: \`2024-04-01\``,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back', callback_data: `led_period_back:${partyName}` }],
          ],
        },
      },
    );
    return;
  }

  const { dateFrom, dateTo } = getDateRange(period);

  storeSession(chatId, {
    lastSearchedParty: partyName,
    period,
    dateFrom,
    dateTo,
  });

  await generateAndSendLedgerPdf(ctx, chatId, partyName, dateFrom, dateTo);
}

/**
 * Generate and send the ledger PDF.
 */
async function generateAndSendLedgerPdf(
  ctx: Context,
  chatId: number,
  partyName: string,
  dateFrom: string,
  dateTo: string,
): Promise<void> {
  await ctx.replyWithMarkdown('📄 *Generating ledger PDF…* Please wait ⏳');

  try {
    const { getSession } = await import('../services/conversation');
    const session = getSession(chatId);
    const companyId = session.companyId;
    const { entries, openingBalance, closingBalance } = await fetchLedgerEntries(
      partyName,
      dateFrom,
      dateTo,
      companyId,
    );

    const fileName = `ledger_${partyName.replace(/[^a-zA-Z0-9]/g, '_')}_${dateFrom}_${dateTo}.pdf`;
    const outputDir = path.resolve(__dirname, '..', '..', 'temp');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(outputDir, fileName);

    await generateLedgerPdf(
      partyName,
      dateFrom,
      dateTo,
      entries,
      openingBalance,
      closingBalance,
      outputPath,
    );

    await ctx.replyWithDocument(
      { source: outputPath, filename: fileName },
      {
        caption: [
          `📒 *Ledger: ${partyName}*`,
          `📅 ${formatDate(dateFrom)} — ${formatDate(dateTo)}`,
          `💰 Opening: ${formatIndian(openingBalance)}`,
          `💰 Closing: ${formatIndian(closingBalance)}`,
          `📄 Total Entries: ${entries.length}`,
        ].join('\n'),
        parse_mode: 'Markdown',
      },
    );

    // Cleanup
    fs.unlink(outputPath, (err) => {
      if (err) logger.warn('Failed to delete temp ledger PDF', { path: outputPath, error: err.message });
    });

    // Back to main or same party
    await ctx.replyWithMarkdown(
      `✅ *Ledger sent!* What would you like to do next?`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📒 Another Period', callback_data: `led_period_back:${partyName}` }],
            [{ text: '🔍 Other Party', callback_data: 'ledger' }],
            [{ text: '🏠 Main Menu', callback_data: 'start' }],
          ],
        },
      },
    );
  } catch (err: any) {
    logger.error('Ledger: PDF generation error', { chatId, error: err?.message });
    await ctx.replyWithMarkdown('⚠️ *Error generating ledger PDF.* Please try again.');
  }
}

/**
 * Handle custom FROM date input.
 */
export async function onCustomDateFrom(ctx: Context, text: string): Promise<void> {
  const chatId = ctx.chat!.id;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(text.trim())) {
    await ctx.replyWithMarkdown(
      '❌ Invalid date format. Please use *YYYY-MM-DD* (e.g., `2024-04-01`):',
    );
    return;
  }

  const date = new Date(text.trim());
  if (isNaN(date.getTime())) {
    await ctx.replyWithMarkdown('❌ Invalid date. Please enter a valid date in *YYYY-MM-DD* format:');
    return;
  }

  setState(chatId, ConversationState.AWAITING_CUSTOM_DATE_TO, {
    dateFrom: text.trim(),
  });
  await ctx.replyWithMarkdown(
    `📅 FROM date set to \`${text.trim()}\`.\n\nNow enter the *TO date* (YYYY-MM-DD):`,
  );
}

/**
 * Handle custom TO date input and generate ledger.
 */
export async function onCustomDateTo(ctx: Context, text: string): Promise<void> {
  const chatId = ctx.chat!.id;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(text.trim())) {
    await ctx.replyWithMarkdown(
      '❌ Invalid date format. Please use *YYYY-MM-DD* (e.g., `2024-04-30`):',
    );
    return;
  }

  const date = new Date(text.trim());
  if (isNaN(date.getTime())) {
    await ctx.replyWithMarkdown('❌ Invalid date. Please enter a valid date in *YYYY-MM-DD* format:');
    return;
  }

  const session = getSession(chatId);
  const partyName = session.lastSearchedParty;
  if (!partyName) {
    await ctx.replyWithMarkdown('⚠️ *Session expired.* Please start again with /ledger');
    return;
  }

  const dateTo = text.trim();
  const dateFrom = session.dateFrom;

  storeSession(chatId, { dateTo, period: 'custom' });

  if (dateFrom) {
    await generateAndSendLedgerPdf(ctx, chatId, partyName, dateFrom, dateTo);
  } else {
    await ctx.replyWithMarkdown('⚠️ *FROM date not found.* Please start again with /ledger');
  }
}
