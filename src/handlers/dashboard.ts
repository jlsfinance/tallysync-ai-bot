import { Context } from 'telegraf';
import logger from '../logger';
import { getSupabaseClient } from '../supabase/client';
import { formatIndian, formatDate } from '../utils/formatters';

interface DashboardData {
  todaySales: number;
  todayPurchases: number;
  todayCollections: number;
  outstandingDebtors: number;
  totalCustomers: number;
  totalSuppliers: number;
  lowStockItems: Array<{ stock_item_name: string; current_stock: number; unit?: string }>;
  error?: string;
}

/**
 * Fetch all dashboard metrics from Supabase.
 */
async function fetchDashboardData(): Promise<DashboardData> {
  const supabase = getSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  const result: DashboardData = {
    todaySales: 0,
    todayPurchases: 0,
    todayCollections: 0,
    outstandingDebtors: 0,
    totalCustomers: 0,
    totalSuppliers: 0,
    lowStockItems: [],
  };

  try {
    // 1. Today's sales: sum of amounts where voucher_type = 'Sales' and date = today
    const { data: salesData, error: salesErr } = await supabase
      .from('vouchers')
      .select('amount')
      .eq('voucher_type', 'Sales')
      .gte('voucher_date', today)
      .lte('voucher_date', today);

    if (salesErr) {
      logger.warn('Dashboard: error fetching today sales', { error: salesErr.message });
    } else if (salesData) {
      result.todaySales = salesData.reduce((sum, v) => sum + (Number(v.amount) || 0), 0);
    }

    // 2. Today's purchases: sum of amounts where voucher_type = 'Purchase' and date = today
    const { data: purchaseData, error: purchaseErr } = await supabase
      .from('vouchers')
      .select('amount')
      .eq('voucher_type', 'Purchase')
      .gte('voucher_date', today)
      .lte('voucher_date', today);

    if (purchaseErr) {
      logger.warn('Dashboard: error fetching today purchases', { error: purchaseErr.message });
    } else if (purchaseData) {
      result.todayPurchases = purchaseData.reduce((sum, v) => sum + (Number(v.amount) || 0), 0);
    }

    // 3. Today's collections: sum of amounts where voucher_type = 'Receipt' and date = today
    const { data: collectionData, error: collectionErr } = await supabase
      .from('vouchers')
      .select('amount')
      .eq('voucher_type', 'Receipt')
      .gte('voucher_date', today)
      .lte('voucher_date', today);

    if (collectionErr) {
      logger.warn('Dashboard: error fetching today collections', { error: collectionErr.message });
    } else if (collectionData) {
      result.todayCollections = collectionData.reduce((sum, v) => sum + (Number(v.amount) || 0), 0);
    }

    // 4. Outstanding from Sundry Debtors (ledgers with parent group matching)
    const { data: debtorsData, error: debtorsErr } = await supabase
      .from('ledgers')
      .select('opening_balance')
      .ilike('group_name', '%Sundry Debtors%');

    if (debtorsErr) {
      logger.warn('Dashboard: error fetching debtors', { error: debtorsErr.message });
    } else if (debtorsData) {
      result.outstandingDebtors = debtorsData.reduce(
        (sum, l) => sum + (Number(l.opening_balance) || 0),
        0,
      );
    }

    // 5. Total customers (count of ledgers in Sundry Debtors group)
    const { count: customerCount, error: customerErr } = await supabase
      .from('ledgers')
      .select('id', { count: 'exact', head: true })
      .ilike('group_name', '%Sundry Debtors%');

    if (customerErr) {
      logger.warn('Dashboard: error counting customers', { error: customerErr.message });
    } else if (customerCount !== null) {
      result.totalCustomers = customerCount;
    }

    // 6. Total suppliers (count of ledgers in Sundry Creditors group)
    const { count: supplierCount, error: supplierErr } = await supabase
      .from('ledgers')
      .select('id', { count: 'exact', head: true })
      .ilike('group_name', '%Sundry Creditors%');

    if (supplierErr) {
      logger.warn('Dashboard: error counting suppliers', { error: supplierErr.message });
    } else if (supplierCount !== null) {
      result.totalSuppliers = supplierCount;
    }

    // 7. Low stock items (quantity < 10)
    const { data: stockData, error: stockErr } = await supabase
      .from('stock_items')
      .select('item_name, current_stock, unit')
      .lt('current_stock', 10)
      .order('current_stock', { ascending: true })
      .limit(10);

    if (stockErr) {
      logger.warn('Dashboard: error fetching low stock items', { error: stockErr.message });
    } else if (stockData) {
      result.lowStockItems = stockData.map((s: any) => ({
        stock_item_name: s.stock_item_name ?? s.name ?? s.item_name ?? 'Unknown',
        current_stock: Number(s.current_stock ?? s.quantity ?? 0) || 0,
        unit: s.unit,
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
  const lines: string[] = [
    '📊 *Dashboard — TallyOnMobile*',
    `📅 *Date:* ${formatDate(new Date().toISOString())}`,
    '',
    '━━━━━━━━━━━━━━━━━━',
    '*📈 Today\'s Summary*',
    `🟢  Sales:       ${formatIndian(data.todaySales)}`,
    `🔴  Purchases:   ${formatIndian(data.todayPurchases)}`,
    `💰  Collections: ${formatIndian(data.todayCollections)}`,
    '',
    '━━━━━━━━━━━━━━━━━━',
    '*📊 Outstanding & Party Counts*',
    `💳  Debtors Outstanding: ${formatIndian(data.outstandingDebtors)}`,
    `👥  Total Customers:     ${data.totalCustomers}`,
    `🏭  Total Suppliers:     ${data.totalSuppliers}`,
    '',
  ];

  // Low stock warning
  if (data.lowStockItems.length > 0) {
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('*⚠️ Low Stock Alerts (qty < 10)*');
    for (const item of data.lowStockItems) {
      const unit = item.unit ? ` ${item.unit}` : '';
      lines.push(`• ${item.stock_item_name}: *${item.current_stock}*${unit}`);
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
 * Fetches full dashboard data and sends a formatted message.
 */
export async function dashboardCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  logger.info('Dashboard requested', { chatId });

  await ctx.replyWithMarkdown('📊 *Fetching your dashboard…* Please wait ⏳');

  const data = await fetchDashboardData();

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

  const message = formatDashboardMessage(data);

  await ctx.replyWithMarkdown(message, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Refresh Dashboard', callback_data: 'dashboard' }],
        [{ text: '🏠 Main Menu', callback_data: 'start' }],
      ],
    },
  });
}
