import { Context, Markup } from 'telegraf';
import logger from '../logger';
import {
  ConversationState,
  storeSession,
  getSession,
  setState,
} from '../services/conversation';
import { searchParties, smartSuggestParty, buildSuggestionMessage } from '../services/fuzzySearch';
import { getSupabaseClient } from '../supabase/client';
import { formatDate, formatVoucherType, formatIndian } from '../utils/formatters';
import { escapeMd } from '../utils/formatters';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PartyExtendedInfo {
  party_name: string;
  party_type?: string;
  group_name?: string;
  opening_balance?: number;
  totalOutstanding?: number;
  lastPayment?: { amount: number; date: string } | null;
  recentInvoices: Array<{ voucher_number: string; date: string; amount: number; voucher_type: string }>;
  totalInvoices: number;
  totalPayments: number;
}

/**
 * Fetch extended party info for the customer dashboard.
 */
async function fetchPartyExtendedInfo(partyName: string): Promise<PartyExtendedInfo | null> {
  const supabase = getSupabaseClient();

  // Fetch from ledgers table
  const { data: ledgerData } = await supabase
    .from('ledgers')
    .select('*')
    .ilike('party_name', partyName)
    .limit(1);

  const ledger = ledgerData?.[0];

  if (!ledger) {
    return null;
  }

  const name = ledger.party_name ?? ledger.name ?? partyName;
  const openingBalance = Number(ledger.opening_balance) || 0;

  // Fetch recent vouchers for this party (last 10)
  const { data: vouchers } = await supabase
    .from('vouchers')
    .select('voucher_number, voucher_date, amount, voucher_type')
    .ilike('party_name', `%${partyName}%`)
    .order('voucher_date', { ascending: false })
    .limit(10);

  const voucherList = (vouchers ?? []).map((v) => ({
    voucher_number: v.voucher_number || '—',
    date: v.voucher_date,
    amount: Number(v.amount) || 0,
    voucher_type: v.voucher_type || 'Unknown',
  }));

  // Find last payment (Receipt/Payment type voucher)
  const lastPaymentVoucher = (vouchers ?? []).find(
    (v) => /payment|receipt/i.test(v.voucher_type ?? ''),
  );
  const lastPayment = lastPaymentVoucher
    ? { amount: Number(lastPaymentVoucher.amount) || 0, date: lastPaymentVoucher.voucher_date }
    : null;

  // Count invoices and payments
  const totalInvoices = voucherList.filter((v) => /sales|invoice/i.test(v.voucher_type)).length;
  const totalPayments = voucherList.filter((v) => /payment|receipt/i.test(v.voucher_type)).length;

  // Compute outstanding from all vouchers
  const totalOutstanding = voucherList.reduce((sum, v) => {
    if (/sales|receipt/i.test(v.voucher_type)) {
      return sum + v.amount;
    } else if (/purchase|payment/i.test(v.voucher_type)) {
      return sum - v.amount;
    }
    return sum;
  }, openingBalance);

  return {
    party_name: name,
    party_type: ledger.party_type,
    group_name: ledger.group_name,
    opening_balance: openingBalance,
    totalOutstanding,
    lastPayment,
    recentInvoices: voucherList.slice(0, 5),
    totalInvoices,
    totalPayments,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * /customer command handler.
 */
export async function customerCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const args = text.replace(/^\/customer\s*/i, '').trim();

  if (args) {
    await searchAndShowCustomerParties(ctx, args);
  } else {
    setState(chatId, ConversationState.AWAITING_PARTY, { reportType: 'customer' });
    await ctx.replyWithMarkdown(
      '👥 *Customer / Party Search*\n\nPlease enter a *party name* to look up:',
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
 * Search parties and show matching results for customer flow.
 */
export async function searchAndShowCustomerParties(
  ctx: Context,
  query: string,
): Promise<void> {
  const chatId = ctx.chat!.id;
  const { getSession } = await import('../services/conversation');
  const session = getSession(chatId);
  const companyId = session.companyId;

  logger.info('Customer: searching parties', { chatId, query, companyId });

  await ctx.replyWithMarkdown(`🔍 *Searching parties for:* \`${escapeMd(query)}\`…`);

  try {
    const matches = await searchParties(query, { maxResults: 10 }, companyId);
    const parties = matches.slice(0, 5);

    storeSession(chatId, {
      lastSearchedParty: query,
      reportType: 'customer',
    });

    if (parties.length === 0) {
      // Try smart suggestions
      const suggestions = await smartSuggestParty(query, 5);
      const suggestionMsg = buildSuggestionMessage(query, suggestions);

      if (suggestionMsg) {
        const rows = suggestions.map((match) => {
          const name = match.item.name;
          return [{ text: name, callback_data: `cust_party:${name}` }];
        });
        rows.push([{ text: '🔍 Try Again', callback_data: 'customer' }]);
        rows.push([{ text: '🏠 Main Menu', callback_data: 'start' }]);
        await ctx.replyWithMarkdown(suggestionMsg, { reply_markup: { inline_keyboard: rows } });
      } else {
        await ctx.replyWithMarkdown(
          `❌ No parties found matching \`${escapeMd(query)}\`.`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔍 Try Again', callback_data: 'customer' }],
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
      `👥 *Customer — Party Search*`,
      '',
      `Found *${matches.length}* match(es) for \`${query}\`:`,
      '',
      ...partyLines,
      '',
      'Select a party to view options 👇',
    ].join('\n');

    const rows = parties.map((match) => {
      const name = match.item.name || match.item.party_name;
      return [Markup.button.callback(name, `cust_party:${name}`)];
    });
    rows.push([Markup.button.callback('🏠 Main Menu', 'start')]);

    await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(rows));
  } catch (err: any) {
    logger.error('Customer: party search error', { chatId, error: err?.message });
    await ctx.replyWithMarkdown('⚠️ *Error searching parties.*');
  }
}

/**
 * Show party action menu (Ledger, Outstanding, Last Payment, Invoices, Statement).
 */
export async function onCustomerPartySelected(ctx: Context, partyName: string): Promise<void> {
  const chatId = ctx.chat!.id;
  storeSession(chatId, { lastSearchedParty: partyName, reportType: 'customer' });

  const msg = [
    `👥 *Customer — ${partyName}*`,
    '',
    'What would you like to know? 👇',
  ].join('\n');

  await ctx.replyWithMarkdown(msg, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📒 Ledger', callback_data: `cust_action:${partyName}:ledger` },
          { text: '💰 Outstanding', callback_data: `cust_action:${partyName}:outstanding` },
        ],
        [
          { text: '💸 Last Payment', callback_data: `cust_action:${partyName}:last_payment` },
          { text: '🧾 Invoices', callback_data: `cust_action:${partyName}:invoices` },
        ],
        [
          { text: '📊 Statement', callback_data: `cust_action:${partyName}:statement` },
        ],
        [
          { text: '🔍 Other Party', callback_data: 'customer' },
          { text: '🏠 Main Menu', callback_data: 'start' },
        ],
      ],
    },
  });
}

/**
 * Handle customer action selection.
 */
export async function onCustomerAction(
  ctx: Context,
  partyName: string,
  action: string,
): Promise<void> {
  const chatId = ctx.chat!.id;

  await ctx.replyWithMarkdown(`⏳ *Fetching ${action.replace(/_/g, ' ')} for* \`${partyName}\`…`);

  try {
    const info = await fetchPartyExtendedInfo(partyName);

    if (!info) {
      await ctx.replyWithMarkdown(
        `❌ No data found for \`${partyName}\`.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 Try Again', callback_data: 'customer' }],
              [{ text: '🏠 Main Menu', callback_data: 'start' }],
            ],
          },
        },
      );
      return;
    }

    switch (action) {
      case 'ledger':
        await showCustomerLedger(ctx, info);
        break;
      case 'outstanding':
        await showCustomerOutstanding(ctx, info);
        break;
      case 'last_payment':
        await showCustomerLastPayment(ctx, info);
        break;
      case 'invoices':
        await showCustomerInvoices(ctx, info);
        break;
      case 'statement':
        await showCustomerStatement(ctx, info);
        break;
      default:
        await ctx.replyWithMarkdown('❌ Unknown action.');
    }
  } catch (err: any) {
    logger.error('Customer: action error', { chatId, partyName, action, error: err?.message });
    await ctx.replyWithMarkdown('⚠️ *Error fetching data.*');
  }
}

/**
 * Show ledger summary.
 */
async function showCustomerLedger(ctx: Context, info: PartyExtendedInfo): Promise<void> {
  // This redirects to the ledger flow
  // In a real integration, we'd use a ledger PDF or inline data
  const msg = [
    `📒 *Ledger Summary — ${info.party_name}*`,
    '',
    `💰 *Opening Balance:* ${formatIndian(info.opening_balance ?? 0)}`,
    `📊 *Current Outstanding:* ${formatIndian(info.totalOutstanding ?? 0)}`,
    '',
    'Use the *Ledger (/ledger)* command for a detailed',
    'statement with full transaction history.',
  ].join('\n');

  await ctx.replyWithMarkdown(msg, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📒 Full Ledger', callback_data: `cust_to_ledger:${info.party_name}` }],
        [{ text: '🔙 Back', callback_data: `cust_party:${info.party_name}` }],
        [{ text: '🏠 Main Menu', callback_data: 'start' }],
      ],
    },
  });
}

/**
 * Show outstanding balance.
 */
async function showCustomerOutstanding(ctx: Context, info: PartyExtendedInfo): Promise<void> {
  const balance = info.totalOutstanding ?? info.opening_balance ?? 0;
  const status = balance >= 0 ? '🔴 *Receivable*' : '🟢 *Payable*';

  const msg = [
    `💰 *Outstanding — ${info.party_name}*`,
    '',
    `${status}`,
    `*Amount:* ${formatIndian(Math.abs(balance))}`,
    '',
    '━━━━━━━━━━━━━━━━━━',
    `📒 Opening Balance: ${formatIndian(info.opening_balance ?? 0)}`,
    `🧾 Total Invoices: ${info.totalInvoices}`,
    `💸 Total Payments: ${info.totalPayments}`,
    '',
    `📅 Last Updated: Recent transactions included.`,
  ].join('\n');

  await ctx.replyWithMarkdown(msg, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Back', callback_data: `cust_party:${info.party_name}` }],
        [{ text: '🏠 Main Menu', callback_data: 'start' }],
      ],
    },
  });
}

/**
 * Show last payment details.
 */
async function showCustomerLastPayment(ctx: Context, info: PartyExtendedInfo): Promise<void> {
  if (info.lastPayment) {
    const msg = [
      `💸 *Last Payment — ${info.party_name}*`,
      '',
      `*Amount:* ${formatIndian(info.lastPayment.amount)}`,
      `*Date:* ${formatDate(info.lastPayment.date)}`,
      '',
      '━━━━━━━━━━━━━━━━━━',
      `🧾 Total Invoices: ${info.totalInvoices}`,
      `💸 Total Payments: ${info.totalPayments}`,
    ].join('\n');

    await ctx.replyWithMarkdown(msg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back', callback_data: `cust_party:${info.party_name}` }],
          [{ text: '🏠 Main Menu', callback_data: 'start' }],
        ],
      },
    });
  } else {
    await ctx.replyWithMarkdown(
      `💸 *Last Payment — ${info.party_name}*`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back', callback_data: `cust_party:${info.party_name}` }],
            [{ text: '🏠 Main Menu', callback_data: 'start' }],
          ],
        },
      },
    );
    await ctx.replyWithMarkdown('📭 No payment records found for this party.');
  }
}

/**
 * Show recent invoices.
 */
async function showCustomerInvoices(ctx: Context, info: PartyExtendedInfo): Promise<void> {
  const invoiceLines = info.recentInvoices.length > 0
    ? info.recentInvoices.map(
        (v, i) =>
          `${i + 1}. ${formatVoucherType(v.voucher_type)} | ${formatDate(v.date)} | ${formatIndian(v.amount)}`,
      ).join('\n')
    : '📭 No recent invoices.';

  const msg = [
    `🧾 *Recent Invoices — ${info.party_name}*`,
    '',
    invoiceLines,
    '',
    `Showing last ${info.recentInvoices.length} of ${info.totalInvoices} transaction(s).`,
  ].join('\n');

  await ctx.replyWithMarkdown(msg, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Back', callback_data: `cust_party:${info.party_name}` }],
        [{ text: '📄 Full Invoice List', callback_data: `cust_full_inv:${info.party_name}` }],
        [{ text: '🏠 Main Menu', callback_data: 'start' }],
      ],
    },
  });
}

/**
 * Show full statement (combined summary).
 */
async function showCustomerStatement(ctx: Context, info: PartyExtendedInfo): Promise<void> {
  const balance = info.totalOutstanding ?? info.opening_balance ?? 0;
  const status = balance >= 0 ? '🔴 *Receivable*' : '🟢 *Payable*';

  const invoiceSummary = info.recentInvoices.length > 0
    ? info.recentInvoices.map(
        (v) =>
          `• ${formatVoucherType(v.voucher_type)} | ${formatDate(v.date)} | ${formatIndian(v.amount)}`,
      ).join('\n')
    : '• No recent transactions';

  const msg = [
    `📊 *Statement — ${info.party_name}*`,
    '',
    '━━━━━━━━━━━━━━━━━━',
    '*Party Info:*',
    `📛 Name: ${info.party_name}`,
    info.group_name ? `📂 Group: ${info.group_name}` : '',
    info.party_type ? `🏷️ Type: ${info.party_type}` : '',
    '',
    '━━━━━━━━━━━━━━━━━━',
    '*Financial Summary:*',
    `💰 Opening Balance: ${formatIndian(info.opening_balance ?? 0)}`,
    `${status}: ${formatIndian(Math.abs(balance))}`,
    `🧾 Total Invoices: ${info.totalInvoices}`,
    `💸 Total Payments: ${info.totalPayments}`,
    '',
    '━━━━━━━━━━━━━━━━━━',
    '*Recent Activity:*',
    invoiceSummary,
    '',
    info.lastPayment
      ? `💸 Last Payment: ${formatIndian(info.lastPayment.amount)} on ${formatDate(info.lastPayment.date)}`
      : '',
  ].filter(Boolean).join('\n');

  await ctx.replyWithMarkdown(msg, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Back', callback_data: `cust_party:${info.party_name}` }],
        [{ text: '📒 Go to Ledger', callback_data: `cust_to_ledger:${info.party_name}` }],
        [{ text: '🏠 Main Menu', callback_data: 'start' }],
      ],
    },
  });
}
