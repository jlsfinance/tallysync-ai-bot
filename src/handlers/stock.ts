import { Context, Markup } from 'telegraf';
import logger from '../logger';
import {
  ConversationState,
  storeSession,
  getSession,
  setState,
} from '../services/conversation';
import { searchItems, smartSuggestParty, buildSuggestionMessage } from '../services/fuzzySearch';
import { getSupabaseClient } from '../supabase/client';
import { formatIndian } from '../utils/formatters';
import { escapeMd } from '../utils/formatters';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface StockDetails {
  item_name: string;
  item_code?: string;
  unit?: string;
  current_stock: number;
  rate?: number;
  mrp?: number;
  hsn_code?: string;
  gst_rate?: number;
  opening_stock?: number;
  reorder_level?: number;
}

/**
 * Fetch detailed stock info from stock_items table.
 */
async function fetchStockDetails(itemName: string): Promise<StockDetails | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('stock_items')
    .select('*')
    .ilike('item_name', `%${itemName}%`)
    .limit(1);

  if (error || !data || data.length === 0) {
    return null;
  }

  const row = data[0];
  return {
    item_name: row.item_name ?? row.name ?? itemName,
    item_code: row.item_code,
    unit: row.unit,
    current_stock: Number(row.current_stock ?? row.opening_stock ?? 0),
    rate: row.rate ? Number(row.rate) : undefined,
    mrp: row.mrp ? Number(row.mrp) : undefined,
    hsn_code: row.hsn_code,
    gst_rate: row.gst_rate ? Number(row.gst_rate) : undefined,
    opening_stock: row.opening_stock ? Number(row.opening_stock) : undefined,
    reorder_level: row.reorder_level ? Number(row.reorder_level) : undefined,
  };
}

/**
 * Format stock details into a readable message.
 */
function formatStockMessage(stock: StockDetails): string {
  const lines: string[] = [
    '📦 *Stock Details*',
    '',
    `📛 *Name:* ${escapeMd(stock.item_name)}`,
  ];

  if (stock.item_code) lines.push(`🔢 *Code:* \`${stock.item_code}\``);
  if (stock.hsn_code) lines.push(`🏷️ *HSN:* \`${stock.hsn_code}\``);
  if (stock.unit) lines.push(`📐 *Unit:* ${stock.unit}`);

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push(`📊 *Current Stock:* **${stock.current_stock}** ${stock.unit ?? ''}`);

  if (stock.rate !== undefined) {
    lines.push(`💰 *Rate:* ${formatIndian(stock.rate)}`);
  }
  if (stock.mrp !== undefined) {
    lines.push(`💲 *MRP:* ${formatIndian(stock.mrp)}`);
  }
  if (stock.gst_rate !== undefined) {
    lines.push(`🧾 *GST:* ${stock.gst_rate}%`);
  }
  if (stock.opening_stock !== undefined) {
    lines.push(`📥 *Opening Stock:* ${stock.opening_stock} ${stock.unit ?? ''}`);
  }
  if (stock.reorder_level !== undefined) {
    lines.push(`⚠️ *Reorder Level:* ${stock.reorder_level}`);
  }

  // Low stock warning
  if (stock.current_stock < 10) {
    lines.push('');
    lines.push('⚠️ *LOW STOCK ALERT!*');
    if (stock.reorder_level !== undefined && stock.current_stock <= stock.reorder_level) {
      lines.push('⛔ Stock is at or below reorder level!');
    }
  }

  if (stock.rate !== undefined && stock.current_stock > 0) {
    const stockValue = stock.rate * stock.current_stock;
    lines.push('');
    lines.push(`📈 *Stock Value:* ${formatIndian(stockValue)}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * /stock command handler.
 */
export async function stockCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const args = text.replace(/^\/stock\s*/i, '').trim();

  if (args) {
    await searchAndShowStockItems(ctx, args);
  } else {
    setState(chatId, ConversationState.AWAITING_PARTY, { reportType: 'stock' });
    await ctx.replyWithMarkdown(
      '📦 *Stock Search*\n\nPlease enter an *item name* to check stock:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚠️ Low Stock Items', callback_data: 'stock_low' }],
            [{ text: '🏠 Main Menu', callback_data: 'start' }],
          ],
        },
      },
    );
  }
}

/**
 * Search items and show matching results.
 */
export async function searchAndShowStockItems(
  ctx: Context,
  query: string,
): Promise<void> {
  const chatId = ctx.chat!.id;
  logger.info('Stock: searching items', { chatId, query });

  await ctx.replyWithMarkdown(`🔍 *Searching items for:* \`${query}\`…`);

  try {
    const matches = await searchItems(query, {
      maxResults: 10,
      additionalFields: 'current_stock,rate,mrp,hsn_code,gst_rate,unit',
    });
    const items = matches.slice(0, 5);

    storeSession(chatId, {
      lastSearchedItem: query,
      reportType: 'stock',
    });

    if (items.length === 0) {
      // Try smart suggestions (reuse party suggester for stock items too)
      const suggestions = await smartSuggestParty(query, 5);
      const suggestionMsg = buildSuggestionMessage(query, suggestions);

      if (suggestionMsg) {
        const rows = suggestions.map((match) => {
          const name = match.item.name;
          return [{ text: name, callback_data: `stock_item:${name}` }];
        });
        rows.push([{ text: '🔍 Try Again', callback_data: 'stock' }]);
        rows.push([{ text: '⚠️ Low Stock Items', callback_data: 'stock_low' }]);
        rows.push([{ text: '🏠 Main Menu', callback_data: 'start' }]);
        await ctx.replyWithMarkdown(suggestionMsg, { reply_markup: { inline_keyboard: rows } });
      } else {
        await ctx.replyWithMarkdown(
          `❌ No items found matching \`${escapeMd(query)}\`.`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔍 Try Again', callback_data: 'stock' }],
                [{ text: '⚠️ Low Stock Items', callback_data: 'stock_low' }],
                [{ text: '🏠 Main Menu', callback_data: 'start' }],
              ],
            },
          },
        );
      }
      return;
    }

    const itemLines = items.map((p, i) => `${i + 1}. ${escapeMd(p.item.item_name)} (${p.method})`);

    const msg = [
      `📦 *Stock — Item Search*`,
      '',
      `Found *${matches.length}* match(es) for \`${query}\`:`,
      '',
      ...itemLines,
      '',
      'Select an item to view details 👇',
    ].join('\n');

    const rows = items.map((match) => {
      const name = match.item.item_name;
      return [Markup.button.callback(name, `stock_item:${name}`)];
    });
    rows.push([Markup.button.callback('⚠️ Low Stock Items', 'stock_low')]);
    rows.push([Markup.button.callback('🏠 Main Menu', 'start')]);

    await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(rows));
  } catch (err: any) {
    logger.error('Stock: search error', { chatId, error: err?.message });
    await ctx.replyWithMarkdown('⚠️ *Error searching items.*');
  }
}

/**
 * Show detailed stock info for a selected item.
 */
export async function onStockItemSelected(ctx: Context, itemName: string): Promise<void> {
  const chatId = ctx.chat!.id;
  logger.info('Stock: item selected', { chatId, itemName });

  storeSession(chatId, { lastSearchedItem: itemName });

  await ctx.replyWithMarkdown(`📦 *Fetching details for* \`${itemName}\`…`);

  try {
    const details = await fetchStockDetails(itemName);

    if (!details) {
      await ctx.replyWithMarkdown(
        `❌ No stock details found for \`${itemName}\`.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 Try Again', callback_data: 'stock' }],
              [{ text: '🏠 Main Menu', callback_data: 'start' }],
            ],
          },
        },
      );
      return;
    }

    const message = formatStockMessage(details);

    await ctx.replyWithMarkdown(message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Search Item', callback_data: 'stock' }],
          [{ text: '⚠️ Low Stock Items', callback_data: 'stock_low' }],
          [{ text: '🏠 Main Menu', callback_data: 'start' }],
        ],
      },
    });
  } catch (err: any) {
    logger.error('Stock: fetch details error', { chatId, error: err?.message });
    await ctx.replyWithMarkdown('⚠️ *Error fetching stock details.*');
  }
}

/**
 * Show low stock items (quantity < 10).
 */
export async function onLowStockItems(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  logger.info('Stock: low stock items requested', { chatId });

  await ctx.replyWithMarkdown('⚠️ *Fetching low stock items…*');

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('stock_items')
      .select('item_name, current_stock, unit, rate')
      .lt('current_stock', 10)
      .order('current_stock', { ascending: true })
      .limit(25);

    if (error) {
      throw new Error(error.message);
    }

    if (!data || data.length === 0) {
      await ctx.replyWithMarkdown(
        '✅ *No low stock items found!* All items have sufficient stock.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 Search Item', callback_data: 'stock' }],
              [{ text: '🏠 Main Menu', callback_data: 'start' }],
            ],
          },
        },
      );
      return;
    }

    const lines: string[] = [
      '⚠️ *Low Stock Items (qty < 10)*',
      '',
      '━━━━━━━━━━━━━━━━━━',
    ];

    for (const item of data) {
      const name = item.item_name ?? 'Unknown';
      const qty = Number(item.current_stock) || 0;
      const unit = item.unit ? ` ${item.unit}` : '';
      const value = item.rate ? ` | Value: ${formatIndian(Number(item.rate) * qty)}` : '';
      lines.push(`• *${name}*: **${qty}**${unit}${value}`);
    }

    lines.push('');
    lines.push(`Total: ${data.length} item(s) low on stock`);

    await ctx.replyWithMarkdown(lines.join('\n'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Search Item', callback_data: 'stock' }],
          [{ text: '🔄 Refresh', callback_data: 'stock_low' }],
          [{ text: '🏠 Main Menu', callback_data: 'start' }],
        ],
      },
    });
  } catch (err: any) {
    logger.error('Stock: low stock query error', { chatId, error: err?.message });
    await ctx.replyWithMarkdown('⚠️ *Error fetching low stock items.*');
  }
}
