import { Context, Markup } from 'telegraf';
import logger from '../logger';
import { clearSession } from '../services/conversation';

const BUSINESS_NAME = 'TallyOnMobile';
const WELCOME_EMOJI = '🤖';

/**
 * Build the main menu inline keyboard.
 */
function mainKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Dashboard', 'dashboard'),
      Markup.button.callback('🧾 Invoice', 'invoice'),
      Markup.button.callback('📒 Ledger', 'ledger'),
    ],
    [
      Markup.button.callback('📦 Stock', 'stock'),
      Markup.button.callback('👥 Customer', 'customer'),
      Markup.button.callback('❓ Help', 'help'),
    ],
  ]);
}

/**
 * /start – Welcome message with business branding and main menu.
 */
export async function startCommand(ctx: Context): Promise<void> {
  const firstName = ctx.from?.first_name ?? 'User';

  clearSession(ctx.chat!.id);

  const welcomeText = [
    `${WELCOME_EMOJI} *Welcome to ${BUSINESS_NAME}!*`,
    '',
    `Hello ${firstName}! I'm your AI-powered business assistant.`,
    'I can help you with:',
    '',
    '📊  **Dashboard** — Today\'s sales, purchases, collections & summaries',
    '🧾  **Invoice** — Search & download invoices / vouchers (PDF/Excel)',
    '📒  **Ledger** — Party-wise ledger with custom date ranges',
    '📦  **Stock** — Item details, stock level & low stock alerts',
    '👥  **Customer** — Party info, outstanding, payments & statements',
    '',
    'You can also chat naturally in *Hindi / English / Hinglish*, e.g.:',
    '• "ABC ka hisab dikhao"',
    '• "XYZ ka balance"',
    '• "Aaj ka sale"',
    '• "Invoice 123 bhejo"',
    '',
    'Select an option below to get started 👇',
  ].join('\n');

  await ctx.replyWithMarkdown(welcomeText, mainKeyboard());
}

/**
 * /help – Show all available commands and tips.
 */
export async function helpCommand(ctx: Context): Promise<void> {
  const helpText = [
    `🆘 *${BUSINESS_NAME} — Help & Commands*`,
    '',
    '━━━━━━━━━━━━━━━━━━',
    '*Available Commands:*',
    '',
    '`/start` — Restart / show welcome menu',
    '`/help` — Show this help message',
    '`/dashboard` — Today\'s business summary',
    '`/invoice <party>` — Search & download invoices',
    '`/ledger <party>` — Get party-wise ledger PDF',
    '`/stock <item>` — Check stock details',
    '`/customer <party>` — Party info & balance',
    '',
    '━━━━━━━━━━━━━━━━━━',
    '*Natural Language Examples:*',
    '',
    '🔹 *Dashboard:*',
    '   "dashboard", "aaj ka summary", "overview"',
    '',
    '🔹 *Invoice / Voucher:*',
    '   "ABC ka invoice", "bill 123 bhejo", "voucher dikhao"',
    '',
    '🔹 *Ledger:*',
    '   "ABC ka hisab", "ledger XYZ", "khata dikhao"',
    '',
    '🔹 *Stock:*',
    '   "item ka stock", "maal check", "stock status"',
    '',
    '🔹 *Customer / Balance:*',
    '   "ABC ka balance", "customer details", "outstanding"',
    '',
    '━━━━━━━━━━━━━━━━━━',
    '💡 *Tip:* You can type party names in *Hindi* or *English*.',
    'The bot understands both!',
    '',
    'Need more help? Contact support.',
  ].join('\n');

  await ctx.replyWithMarkdown(helpText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🏠 Main Menu', callback_data: 'start' }],
      ],
    },
  });
}
