import { Context, Telegraf } from 'telegraf';
import { Update, CallbackQuery } from 'telegraf/typings/core/types/typegram';
import * as http from 'http';
import dotenv from 'dotenv';
import path from 'path';

// Load .env BEFORE any other module that reads process.env
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import config from './config';
import logger from './logger';
import { initSessionCleanup, clearSession } from './services/conversation';
import { configureFuzzySearch } from './services/fuzzySearch';
import { detectIntent, Intent } from './services/intentDetector';
import { startCommand, helpCommand } from './handlers/start';
import { dashboardCommand } from './handlers/dashboard';
import {
  invoiceCommand,
  searchAndShowParties,
  onPartySelected,
  onVoucherPage,
  onVoucherSelected,
  onGeneratePdf,
  onGenerateExcel,
  onBackToVouchers,
} from './handlers/invoice';
import {
  ledgerCommand,
  searchAndShowPartiesForLedger,
  onLedgerPartySelected,
  onLedgerPeriodSelected,
  onCustomDateFrom,
  onCustomDateTo,
} from './handlers/ledger';
import {
  stockCommand,
  searchAndShowStockItems,
  onStockItemSelected,
  onLowStockItems,
} from './handlers/stock';
import {
  customerCommand,
  searchAndShowCustomerParties,
  onCustomerPartySelected,
  onCustomerAction,
} from './handlers/customer';
import {
  companyCommand,
  showCompanyPicker,
  onCompanySelected,
  getActiveCompanies,
} from './handlers/company';

// ---------------------------------------------------------------------------
// Bot setup
// ---------------------------------------------------------------------------

const BOT_TOKEN = config.BOT_TOKEN;
if (!BOT_TOKEN) {
  logger.error('BOT_TOKEN is not defined. Check your .env file.');
  process.exit(1);
}

const bot: Telegraf<Context<Update>> = new Telegraf(BOT_TOKEN);

// ---------------------------------------------------------------------------
// Initialise services
// ---------------------------------------------------------------------------

initSessionCleanup();
configureFuzzySearch(config.SUPABASE_SERVICE_KEY);

// ---------------------------------------------------------------------------
// Company check middleware — ensures company is selected before commands
// ---------------------------------------------------------------------------

bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return next();

  // Get session to check company selection
  const { getSession } = await import('./services/conversation');
  const session = getSession(chatId);

  // Only enforce for commands (not /start, /help, /company)
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const isTextCommand = typeof text === 'string' && text.startsWith('/');
  const cmdName = isTextCommand ? text.split(' ')[0].toLowerCase() : '';
  const whitelistedCmds = ['/start', '/help', '/company', '/cancel'];

  // Skip check for: whitelisted commands, callback queries, non-command text
  if (
    !isTextCommand ||
    ctx.updateType === 'callback_query' ||
    whitelistedCmds.includes(cmdName)
  ) {
    return next();
  }

  // If no company selected, show picker
  if (!session.companyId) {
    const { showCompanyPicker } = await import('./handlers/company');
    await showCompanyPicker(ctx);
    return; // Don't call next() — block the command
  }

  return next();
});

// ---------------------------------------------------------------------------
// Logger middleware
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Logger middleware
// ---------------------------------------------------------------------------

bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;

  logger.info('Incoming update', {
    chatId,
    userId,
    username,
    text,
    updateType: ctx.updateType,
  });

  const start = Date.now();
  try {
    await next();
    const ms = Date.now() - start;
    if (ms > 2000) {
      logger.warn('Slow response', { chatId, ms });
    }
  } catch (err: any) {
    const ms = Date.now() - start;
    logger.error('Handler error', {
      chatId,
      userId,
      text,
      ms,
      error: err?.message,
      stack: err?.stack,
    });

    // Try to notify the user
    try {
      await ctx.replyWithMarkdown(
        '⚠️ *An error occurred.* Please try again later.\n\nIf the problem persists, contact support.',
      );
    } catch (_) {
      // Best-effort
    }
  }
});

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

bot.start(startCommand);
bot.help(helpCommand);

bot.command('dashboard', dashboardCommand);
bot.command('invoice', invoiceCommand);
bot.command('ledger', ledgerCommand);
bot.command('stock', stockCommand);
bot.command('customer', customerCommand);
bot.command('company', companyCommand);

// ---------------------------------------------------------------------------
// Callback Query handler — centralised dispatch for all inline keyboards
// ---------------------------------------------------------------------------

bot.on('callback_query', async (ctx) => {
  const callbackQuery = ctx.callbackQuery;
  // Only process inline keyboard callbacks (with data field)
  if (!('data' in callbackQuery) || !callbackQuery.data) {
    return;
  }
  const chatId = ctx.chat!.id;
  const callbackData = callbackQuery.data;

  // Answer the callback query to remove the loading indicator
  await ctx.answerCbQuery().catch(() => {});

  // ── Main navigation ──
  if (callbackData === 'start') {
    clearSession(chatId);
    return startCommand(ctx);
  }

  if (callbackData === 'help') {
    return helpCommand(ctx);
  }

  if (callbackData === 'company') {
    return showCompanyPicker(ctx, '🏢 *Switch Company*\n\nSelect a company to switch to:');
  }

  if (callbackData.startsWith('comp_select:')) {
    const companyId = callbackData.slice('comp_select:'.length);
    return onCompanySelected(ctx, companyId);
  }



  if (callbackData.startsWith('comp_select:')) {
    const companyId = callbackData.slice('comp_select:'.length);
    return onCompanySelected(ctx, companyId);
  }

  if (callbackData === 'dashboard') {
    return dashboardCommand(ctx);
  }

  // ── Invoice flow ──
  if (callbackData === 'invoice') {
    clearSession(chatId);
    return invoiceCommand(ctx);
  }

  if (callbackData.startsWith('inv_party:')) {
    const partyName = callbackData.slice('inv_party:'.length);
    return onPartySelected(ctx, partyName);
  }

  if (callbackData.startsWith('inv_page:')) {
    const rest = callbackData.slice('inv_page:'.length);
    const lastColon = rest.lastIndexOf(':');
    const partyName = rest.slice(0, lastColon);
    const page = parseInt(rest.slice(lastColon + 1), 10);
    return onVoucherPage(ctx, partyName, page);
  }

  if (callbackData.startsWith('inv_vouch:')) {
    const voucherId = callbackData.slice('inv_vouch:'.length);
    return onVoucherSelected(ctx, voucherId);
  }

  if (callbackData.startsWith('inv_fmt_pdf:')) {
    const voucherId = callbackData.slice('inv_fmt_pdf:'.length);
    return onGeneratePdf(ctx, voucherId);
  }

  if (callbackData.startsWith('inv_fmt_excel:')) {
    const voucherId = callbackData.slice('inv_fmt_excel:'.length);
    return onGenerateExcel(ctx, voucherId);
  }

  if (callbackData.startsWith('inv_back:')) {
    return onBackToVouchers(ctx);
  }

  // ── Ledger flow ──
  if (callbackData === 'ledger') {
    clearSession(chatId);
    return ledgerCommand(ctx);
  }

  if (callbackData.startsWith('led_party:')) {
    const partyName = callbackData.slice('led_party:'.length);
    return onLedgerPartySelected(ctx, partyName);
  }

  if (callbackData.startsWith('led_period:')) {
    const rest = callbackData.slice('led_period:'.length);
    const parts = rest.split(':');
    // partyName:period or partyName:custom
    const period = parts.pop()!;
    const partyName = parts.join(':');
    return onLedgerPeriodSelected(ctx, partyName, period);
  }

  if (callbackData.startsWith('led_period_back:')) {
    const partyName = callbackData.slice('led_period_back:'.length);
    return onLedgerPartySelected(ctx, partyName);
  }

  // ── Stock flow ──
  if (callbackData === 'stock') {
    clearSession(chatId);
    return stockCommand(ctx);
  }

  if (callbackData.startsWith('stock_item:')) {
    const itemName = callbackData.slice('stock_item:'.length);
    return onStockItemSelected(ctx, itemName);
  }

  if (callbackData === 'stock_low') {
    return onLowStockItems(ctx);
  }

  // ── Customer flow ──
  if (callbackData === 'customer') {
    clearSession(chatId);
    return customerCommand(ctx);
  }

  if (callbackData.startsWith('cust_party:')) {
    const partyName = callbackData.slice('cust_party:'.length);
    return onCustomerPartySelected(ctx, partyName);
  }

  if (callbackData.startsWith('cust_action:')) {
    const rest = callbackData.slice('cust_action:'.length);
    const parts = rest.split(':');
    const action = parts.pop()!;
    const partyName = parts.join(':');
    return onCustomerAction(ctx, partyName, action);
  }

  if (callbackData.startsWith('cust_to_ledger:')) {
    const partyName = callbackData.slice('cust_to_ledger:'.length);
    clearSession(chatId);
    return onLedgerPartySelected(ctx, partyName);
  }

  if (callbackData.startsWith('cust_full_inv:')) {
    const partyName = callbackData.slice('cust_full_inv:'.length);
    clearSession(chatId);
    return onPartySelected(ctx, partyName);
  }

  // ── No-op button ──
  if (callbackData === 'noop') {
    return;
  }

  // Unknown callback data
  logger.warn('Unknown callback data', { chatId, callbackData });
  await ctx.replyWithMarkdown(
    '❓ Unknown action. Please use the menu buttons.',
    { reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'start' }]] } },
  );
});

// ---------------------------------------------------------------------------
// Natural language text handler
// ---------------------------------------------------------------------------

bot.on('text', async (ctx) => {
  const chatId = ctx.chat!.id;
  const text = ctx.message.text.trim();

  // Ignore commands (already handled above)
  if (text.startsWith('/')) return;

  logger.info('Natural language input', { chatId, text });

  // Detect intent
  const intentResult = detectIntent(text);
  const { intent, confidence, entities } = intentResult;

  logger.debug('Intent detected', {
    chatId,
    intent,
    confidence,
    entities,
  });

  // Check if we're in an active conversation flow
  const { getSession } = await import('./services/conversation');
  const session = getSession(chatId);

  // Handle multi-step conversation states
  switch (session.state) {
    case 'AWAITING_PARTY': {
      // User typed a party name after being asked
      const reportType = session.reportType ?? 'invoice';
      switch (reportType) {
        case 'invoice':
          return searchAndShowParties(ctx, text);
        case 'ledger':
          return searchAndShowPartiesForLedger(ctx, text);
        case 'stock':
          return searchAndShowStockItems(ctx, text);
        case 'customer':
          return searchAndShowCustomerParties(ctx, text);
        default:
          return searchAndShowParties(ctx, text);
      }
    }

    case 'AWAITING_CUSTOM_DATE_FROM': {
      return onCustomDateFrom(ctx, text);
    }

    case 'AWAITING_CUSTOM_DATE_TO': {
      return onCustomDateTo(ctx, text);
    }

    case 'AWAITING_PERIOD': {
      // Try to interpret date-related text
      const lower = text.toLowerCase();
      if (/today|aaj/i.test(lower)) {
        const partyName = session.lastSearchedParty;
        if (partyName) return onLedgerPeriodSelected(ctx, partyName, 'today');
      }
      if (/yesterday|kal/i.test(lower)) {
        const partyName = session.lastSearchedParty;
        if (partyName) return onLedgerPeriodSelected(ctx, partyName, 'yesterday');
      }
      if (/this\s+week|iss\s+hafte/i.test(lower)) {
        const partyName = session.lastSearchedParty;
        if (partyName) return onLedgerPeriodSelected(ctx, partyName, 'this_week');
      }
      if (/this\s+month|iss\s+mahine/i.test(lower)) {
        const partyName = session.lastSearchedParty;
        if (partyName) return onLedgerPeriodSelected(ctx, partyName, 'this_month');
      }
      if (/last\s+month|pichhle\s+mahine/i.test(lower)) {
        const partyName = session.lastSearchedParty;
        if (partyName) return onLedgerPeriodSelected(ctx, partyName, 'last_month');
      }
      if (/custom|khoob|manual/i.test(lower)) {
        const partyName = session.lastSearchedParty;
        if (partyName) return onLedgerPeriodSelected(ctx, partyName, 'custom');
      }
      // Unknown – ask again
      await ctx.replyWithMarkdown(
        '❌ Please select a valid option from the menu, or type one of: `today`, `yesterday`, `this week`, `this month`, `last month`, `custom`.',
      );
      return;
    }

    case 'AWAITING_FORMAT': {
      const lower = text.toLowerCase();
      if (/pdf/i.test(lower)) {
        const voucherId = session.lastSearchedVoucher;
        if (voucherId) return onGeneratePdf(ctx, voucherId);
      }
      if (/excel|xlsx/i.test(lower)) {
        const voucherId = session.lastSearchedVoucher;
        if (voucherId) return onGenerateExcel(ctx, voucherId);
      }
      await ctx.replyWithMarkdown('Please select 📄 PDF or 📊 Excel from the buttons below.');
      return;
    }

    default:
      // No active state – route by detected intent
      break;
  }

  // ── Route by intent ──
  switch (intent) {
    case Intent.START:
      return startCommand(ctx);

    case Intent.HELP:
      return helpCommand(ctx);

    case Intent.DASHBOARD:
      return dashboardCommand(ctx);

    case Intent.INVOICE:
    case Intent.VOUCHER: {
      // If party name was extracted, search directly; else ask
      if (entities.party_name) {
        return searchAndShowParties(ctx, entities.party_name);
      }
      if (entities.voucher_number || entities.invoice_number) {
        // Could search by voucher number directly
        await ctx.replyWithMarkdown(
          `🔍 *Searching for voucher #${entities.voucher_number || entities.invoice_number}*…\n\nVoucher-level search coming soon. Please search by party name instead.`,
        );
        return;
      }
      // Fallback: strip known keywords to extract party name
      const cleanName = text
        .replace(/\b(bill|invoice|bhej[o]?|dikha[o]?|nikal|send|show|ka|ke|ki|ko|se|ne|do|de|lao)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanName && cleanName.length >= 2) {
        return searchAndShowParties(ctx, cleanName);
      }
      return invoiceCommand(ctx);
    }

    case Intent.LEDGER:
    case Intent.CUSTOMER:
    case Intent.BALANCE: {
      if (entities.party_name) {
        // Determine whether to do ledger or customer lookup
        if (intent === Intent.LEDGER) {
          return searchAndShowPartiesForLedger(ctx, entities.party_name);
        }
        return searchAndShowCustomerParties(ctx, entities.party_name);
      }
      // Check if the whole text looks like a party name
      const { isNameQuery } = await import('./services/intentDetector');
      if (isNameQuery(text)) {
        // Could be a party name – show as customer
        return searchAndShowCustomerParties(ctx, text);
      }
      // Fallback: strip known keywords to extract party name
      const cleanedText = text
        .replace(/\b(hisab|khata|ledger|balance|baaki|baqi|dikha[o]?|bhej[o]?|nikal|send|show|ka|ke|ki|ko|se|ne|do|de|lao|party|customer|gahak)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanedText && cleanedText.length >= 2) {
        const lookupFn = intent === Intent.LEDGER ? searchAndShowPartiesForLedger : searchAndShowCustomerParties;
        return lookupFn(ctx, cleanedText);
      }
      if (intent === Intent.LEDGER) {
        return ledgerCommand(ctx);
      }
      return customerCommand(ctx);
    }

    case Intent.STOCK: {
      if (entities.item_name) {
        return searchAndShowStockItems(ctx, entities.item_name);
      }
      return stockCommand(ctx);
    }

    case Intent.PAYMENT: {
      if (entities.party_name) {
        return onCustomerPartySelected(ctx, entities.party_name);
      }
      await ctx.replyWithMarkdown(
        `💸 *Payment Search*\n\nPlease tell me the party name, e.g., "ABC ka payment dikhao"`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏠 Main Menu', callback_data: 'start' }],
            ],
          },
        },
      );
      return;
    }

    case Intent.REPORT: {
      if (entities.party_name) {
        return onCustomerPartySelected(ctx, entities.party_name);
      }
      return dashboardCommand(ctx);
    }

    case Intent.SEARCH: {
      if (entities.party_name) {
        return searchAndShowCustomerParties(ctx, entities.party_name);
      }
      if (entities.item_name) {
        return searchAndShowStockItems(ctx, entities.item_name);
      }
      // Generic search: show customer search
      return customerCommand(ctx);
    }

    case Intent.UNKNOWN:
    default: {
      // Try a last-resort: maybe it's just a party name
      const { isNameQuery } = await import('./services/intentDetector');
      if (isNameQuery(text) || text.split(/\s+/).length <= 3) {
        // Show customer info as most likely interpretation
        return searchAndShowCustomerParties(ctx, text);
      }
      await ctx.replyWithMarkdown(
        "🤔 *I didn't quite understand that.* Could you please rephrase?\n\nTry:\n"
        + [
          '• "ABC ka hisab dikhao" (ledger)',
          '• "XYZ ka balance" (outstanding)',
          '• "Item ka stock" (stock check)',
          '• "Dashboard" (today\'s summary)',
          '• /help for all commands',
        ].join('\n'),
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❓ Help', callback_data: 'help' }],
              [{ text: '🏠 Main Menu', callback_data: 'start' }],
            ],
          },
        },
      );
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// Health check HTTP server (for Render / cloud deployment health checks)
// ---------------------------------------------------------------------------

const PORT = config.PORT;

const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      bot: 'TallySync AI Bot',
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

healthServer.listen(PORT, () => {
  logger.info(`Health check server listening on port ${PORT}`);
});

// ---------------------------------------------------------------------------
// Launch bot — auto-detect webhook vs polling
// ---------------------------------------------------------------------------

async function launchBot(): Promise<void> {
  const webhookUrl = process.env.WEBHOOK_URL || '';

  if (webhookUrl.trim().length > 0) {
    // Webhook mode (when a public URL is configured)
    const url = webhookUrl.trim().replace(/\/+$/, '');
    const fullUrl = `${url}/bot${BOT_TOKEN}`;

    logger.info('Starting bot in WEBHOOK mode', { webhookUrl: fullUrl });

    await bot.telegram.setWebhook(fullUrl);
    const server = http.createServer(await bot.webhookCallback(`/bot${BOT_TOKEN}`));
    server.listen(PORT, () => {
      logger.info('Bot webhook started', { port: PORT, webhookUrl: fullUrl });
    });
  } else {
    // Polling mode (Railway / local)
    logger.info('Starting bot in POLLING mode');

    // Drop any stale session first (don't await - fire and forget)
    bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});

    // Start polling - errors are caught, never crash
    const startPolling = async () => {
      try {
        await bot.launch({ allowedUpdates: ['message', 'callback_query'] });
        logger.info('Bot polling connected');
        console.log('✅ Bot polling connected');
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.includes('409')) {
          logger.warn('409 conflict - retrying in 30s');
          setTimeout(startPolling, 30000);
        } else {
          logger.error('Polling error:', { error: msg });
          setTimeout(startPolling, 15000);
        }
      }
    };
    startPolling();

    console.log('✅ Bot started (polling in background)');
    logger.info('Bot started (polling in background)');
  }
}

async function main() {
  console.log('🤖 TallySync AI Bot starting...');
  try {
    await launchBot();
  } catch (err) {
    logger.error('launchBot failed', { error: String(err) });
  }
  console.log('✅ Bot main loop running, health check active');
}

main().catch((err) => {
  logger.error('Critical error in main', { error: err?.message, stack: err?.stack });
  // Stay alive — health check keeps Railway happy
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.once('SIGINT', () => {
  logger.info('Received SIGINT — shutting down gracefully');
  healthServer.close();
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  logger.info('Received SIGTERM — shutting down gracefully');
  healthServer.close();
  bot.stop('SIGTERM');
  process.exit(0);
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err?.message, stack: err?.stack });
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Export bot instance for use by other modules (e.g., tests)
// ---------------------------------------------------------------------------

export default bot;
export { bot };
