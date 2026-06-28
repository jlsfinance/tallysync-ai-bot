import { Context, Markup } from 'telegraf';
import logger from '../logger';
import { getSupabaseClient } from '../supabase/client';
import { storeSession, clearSession, getSession } from '../services/conversation';

/**
 * Get active companies with data.
 */
export async function getActiveCompanies(): Promise<{ id: string; name: string; voucherCount?: number }[]> {
  try {
    const supabase = getSupabaseClient();
    const { data: companies, error } = await supabase
      .from('companies')
      .select('id, name')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error || !companies) return [];

    // Filter to companies that have vouchers
    const result: { id: string; name: string; voucherCount?: number }[] = [];
    for (const comp of companies) {
      const { count } = await supabase
        .from('vouchers')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', comp.id);
      if (count && count > 0) {
        result.push({ ...comp, voucherCount: count });
      }
    }
    return result;
  } catch (err: any) {
    logger.error('Error fetching active companies', { error: err?.message });
    return [];
  }
}

/**
 * Show company selection keyboard.
 */
export async function showCompanyPicker(ctx: Context, message?: string): Promise<void> {
  const companies = await getActiveCompanies();

  if (companies.length === 0) {
    await ctx.replyWithMarkdown('⚠️ No companies found with data. Please sync data first.');
    return;
  }

  if (companies.length === 1) {
    // Auto-select the only company
    const comp = companies[0];
    storeSession(ctx.chat!.id, {
      companyId: comp.id,
      companyName: comp.name,
    });
    logger.info('Auto-selected company', { chatId: ctx.chat!.id, company: comp.name });
    return;
  }

  // Build keyboard rows (2 per row)
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < companies.length; i += 2) {
    const row: ReturnType<typeof Markup.button.callback>[] = [
      Markup.button.callback(
        companies[i].name.length > 30 ? companies[i].name.slice(0, 28) + '…' : companies[i].name,
        `comp_select:${companies[i].id}`,
      ),
    ];
    if (i + 1 < companies.length) {
      row.push(
        Markup.button.callback(
          companies[i + 1].name.length > 30 ? companies[i + 1].name.slice(0, 28) + '…' : companies[i + 1].name,
          `comp_select:${companies[i + 1].id}`,
        ),
      );
    }
    rows.push(row);
  }

  const text = message || '🏢 *Select Company*\n\nMultiple companies found. Please select one to proceed:';
  await ctx.replyWithMarkdown(text, {
    reply_markup: { inline_keyboard: rows },
  });
}

/**
 * Handle company selection callback.
 */
export async function onCompanySelected(ctx: Context, companyId: string): Promise<void> {
  const chatId = ctx.chat!.id;

  // Get company name from database
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .single();

  const companyName = data?.name || companyId;

  storeSession(chatId, {
    companyId,
    companyName,
  });

  logger.info('Company selected', { chatId, companyId, companyName });

  await ctx.replyWithMarkdown(
    [
      `✅ *Company Selected:* ${companyName}`,
      '',
      'You can now use all commands scoped to this company.',
      '',
      'Use /dashboard to see the business summary or tap a button below 👇',
    ].join('\n'),
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Dashboard', callback_data: 'dashboard' }],
          [{ text: '🏢 Change Company', callback_data: 'company' }],
          [{ text: '🏠 Main Menu', callback_data: 'start' }],
        ],
      },
    },
  );
}

/**
 * /company command – shows company selection or current company info.
 */
export async function companyCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const session = getSession(chatId);

  if (session.companyId && session.companyName) {
    await ctx.replyWithMarkdown(
      [
        `🏢 *Current Company:* ${session.companyName}`,
        '',
        'Tap below to switch to a different company:',
      ].join('\n'),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Switch Company', callback_data: 'company' }],
            [{ text: '📊 Dashboard', callback_data: 'dashboard' }],
            [{ text: '🏠 Main Menu', callback_data: 'start' }],
          ],
        },
      },
    );
  } else {
    await showCompanyPicker(ctx, '🏢 *Select a Company*\n\nNo company selected yet. Please choose one:');
  }
}
