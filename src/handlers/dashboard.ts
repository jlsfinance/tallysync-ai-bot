import { Context } from 'telegraf';
import logger from '../logger';
import { getSupabaseClient } from '../supabase/client';
import { getSession } from '../services/conversation';
import { formatIndian, formatDate, escapeMd } from '../utils/formatters';

const DEBTOR_PARENTS = [
  'Sundry Debtors', 'Debtor', 'DEBTOR',
  'Debtors', 'Sundry Debtor',
];

const CREDITOR_PARENTS = [
  'Sundry Creditors', 'Creditor', 'CREDITOR',
  'Creditors', 'Sundry Creditor',
];

interface DashboardData {
  todaySales: number;
  todayPurchases: number;
  todayCollections: number;
  receipts: number;
  payments: number;
  outstandingDebtors: number;
  outstandingCreditors: number;
  totalCustomers: number;
  totalSuppliers: number;
  lowStockItems: Array<{ name: string; current_stock: number; unit?: string }>;
  companyName?: string;
  error?: string;
}

/**
 * Fetch all dashboard metrics from Supabase scoped to a company.
 */
async function fetchDashboardData(companyId?: string): Promise<DashboardData> {
  const supabase = getSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  const result: DashboardData = {
    todaySales: 0,
    todayPurchases: 0,
    todayCollections: 0,
    receipts: 0,
    payments: 0,
    outstandingDebtors: 0,
    outstandingCreditors: 0,
    totalCustomers: 0,
    totalSuppliers: 0,
    lowStockItems: [],
  };

  try {
    // Build base query with optional company filter
    const voucherQuery = (col: string) => {
      let q = supabase.from('vouchers').select(col);
      if (companyId) q = q.eq('company_id', companyId);
      q = q.eq('is_deleted', false).gte('vch_date', today).lte('vch_date', today);
      return q;
    };

    // 1. Today's sales
    const { data: salesData } = await voucherQuery('amount').eq('voucher_type', 'Sales');
    if (salesData) result.todaySales = (salesData as any[]).reduce((s, v) => s + (Number(v.amount) || 0), 0);

    // 2. Today's purchases
    const { data: purchaseData } = await voucherQuery('amount').eq('voucher_type', 'Purchase');
    if (purchaseData) result.todayPurchases = (purchaseData as any[]).reduce((s, v) => s + (Number(v.amount) || 0), 0);

    // 3. Today's receipts & payments
    const { data: receiptData } = await voucherQuery('amount').eq('voucher_type', 'Receipt');
    if (receiptData) result.receipts = (receiptData as any[]).reduce((s, v) => s + (Number(v.amount) || 0), 0);

    const { data: paymentData } = await voucherQuery('amount').eq('voucher_type', 'Payment');
    if (paymentData) result.payments = (paymentData as any[]).reduce((s, v) => s + (Number(v.amount) || 0), 0);

    // 4. Outstanding from ledgers using current_balance (the actual balance field)
    let ledgerQuery = supabase.from('ledgers').select('name, parent, current_balance');
    if (companyId) ledgerQuery = ledgerQuery.eq('company_id', companyId);
    ledgerQuery = ledgerQuery.eq('is_deleted', false);

    const { data: ledgers } = await ledgerQuery;

    if (ledgers) {
      for (const l of ledgers) {
        const bal = Number(l.current_balance) || 0;
        const parent = (l.parent || '').trim();
        const isDebtor = DEBTOR_PARENTS.some((p) => parent.startsWith(p));
        const isCreditor = CREDITOR_PARENTS.some((p) => parent.startsWith(p));

        if (isDebtor) {
          result.outstandingDebtors += Math.abs(bal);
          result.totalCustomers++;
        } else if (isCreditor) {
          result.outstandingCreditors += Math.abs(bal);
          result.totalSuppliers++;
        }
      }
    }

    // 5. Low stock items (current_stock < 10)
    let stockQuery = supabase
      .from('stock_items')
      .select('name, current_stock, unit')
      .lt('current_stock', 10)
      .order('current_stock', { ascending: true })
      .limit(10);
    if (companyId) stockQuery = stockQuery.eq('company_id', companyId);

    const { data: stockData } = await stockQuery;
    if (stockData) {
      result.lowStockItems = stockData
        .filter((s) => s.name && s.name !== 'Unknown' && s.name !== 'unknown')
        .map((s) => ({
          name: s.name || 'Unknown',
          current_stock: Number(s.current_stock) || 0,
          unit: s.unit || undefined,
        }));
    }

    return result;
  } catch (err: any) {
    logger.error('Dashboard: unexpected error', { error: err?.message });
    return { ...result, error: err?.message || 'Unexpected error' };
  }
}

/**
 * Format the dashboard data into a Telegram-friendly Markdown message.
 */
function formatDashboardMessage(data: DashboardData): string {
  const lines: string[] = [];

  if (data.companyName) {
    lines.push(`🏢 *${data.companyName}*`);
  }
  lines.push('📊 *Dashboard — TallyOnMobile*');
  lines.push(`📅 *Date:* ${formatDate(new Date().toISOString())}`);
  lines.push('');

  // Today's Summary
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('*📈 Today\'s Summary*');
  lines.push(`🟢  Sales:       ${formatIndian(data.todaySales)}`);
  lines.push(`🔴  Purchases:   ${formatIndian(data.todayPurchases)}`);
  lines.push(`💵  Receipts:    ${formatIndian(data.receipts)}`);
  lines.push(`💳  Payments:    ${formatIndian(data.payments)}`);
  lines.push('');

  // Outstanding
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('*📊 Outstanding Balances*');
  lines.push(`💳  Debtors (Customers):  ${formatIndian(data.outstandingDebtors)}`);
  lines.push(`🏦  Creditors (Suppliers): ${formatIndian(data.outstandingCreditors)}`);
  lines.push(`👥  Total Customers:      ${data.totalCustomers}`);
  lines.push(`🏭  Total Suppliers:      ${data.totalSuppliers}`);
  lines.push('');

  // Low stock warning
  if (data.lowStockItems.length > 0) {
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('*⚠️ Low Stock Alerts (qty < 10)*');
    for (const item of data.lowStockItems) {
      const unit = item.unit ? ` ${item.unit}` : '';
      lines.push(`• ${item.name}: *${item.current_stock}*${unit}`);
    }
  } else {
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('*✅ Stock Status:* No low stock items');
  }

  lines.push('');
  lines.push('Use the menu below to drill down 👇');

  return lines.join('\n');
}

/**
 * /dashboard command handler.
 */
export async function dashboardCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  logger.info('Dashboard requested', { chatId });

  const session = getSession(chatId);
  const companyId = session.companyId;

  await ctx.replyWithMarkdown('📊 *Fetching your dashboard…* Please wait ⏳');

  const data = await fetchDashboardData(companyId);

  if (data.error) {
    await ctx.replyWithMarkdown(
      [
        '⚠️ *Dashboard Error*',
        '',
        'There was a problem fetching some data:',
        `\`${data.error}\``,
        '',
        'Partial data is shown below 👇',
      ].join('\n'),
    );
  }

  // Set company name in data for display
  if (companyId && session.companyName) {
    data.companyName = session.companyName;
  }

  const message = formatDashboardMessage(data);

  const buttons: any[][] = [
    [{ text: '🔄 Refresh Dashboard', callback_data: 'dashboard' }],
  ];
  if (companyId) {
    buttons.push([{ text: '🏢 Change Company', callback_data: 'company' }]);
  }
  buttons.push([{ text: '🏠 Main Menu', callback_data: 'start' }]);

  await ctx.replyWithMarkdown(message, {
    reply_markup: { inline_keyboard: buttons },
  });
}
