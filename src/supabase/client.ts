/**
 * Supabase Client — Corrected for TallyOnMobile Schema
 *
 * Tables:
 *   ledgers  — Parties/customers/suppliers (name, parent, closing_balance, company_id)
 *   vouchers — All transactions (vch_date, voucher_number, voucher_type, party_ledger_name, amount)
 *   stock_items — Inventory items (stock_item_name, hsn_code, unit, quantity, rate)
 *   voucher_ledger_entries — Ledger splits per voucher (voucher_id, name, amount, is_debit)
 *   voucher_stock_entries — Stock item splits per voucher (voucher_id, stock_item_name, qty, rate, amount)
 *   companies — Company master (name, company_id)
 *   sync_history — Sync logs
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import config from '../config';

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}

// ─── Types matching actual schema ─────────────────────────────────────────

export interface LedgerRecord {
  id: string;
  company_id?: string;
  name: string;
  parent?: string;
  closing_balance?: number;
  opening_balance?: number;
  phone?: string;
  gstin?: string;
  email?: string;
  status?: string;
  is_deleted?: boolean;
  created_at?: string;
  [key: string]: any;
}

export interface VoucherRecord {
  id: string;
  company_id?: string;
  voucher_number?: string;
  voucher_type?: string;
  vch_date?: string;
  party_ledger_name?: string;
  amount?: number;
  narration?: string;
  is_deleted?: boolean;
  status?: string;
  invoice_number?: string;
  voucher_id?: string;
  json_data?: any;
  created_at?: string;
  [key: string]: any;
}

export interface StockItemRecord {
  id: string;
  company_id?: string;
  name?: string;
  unit?: string;
  hsn_code?: string;
  current_stock?: number;
  opening_stock?: number;
  rate?: number;
  gst_rate?: number;
  stock_group?: string;
  opening_value?: number;
  closing_value?: number;
  is_deleted?: boolean;
  [key: string]: any;
}

export interface VoucherLedgerEntry {
  id: string;
  voucher_id?: string;
  company_id?: string;
  ledger_name?: string;
  amount?: number;
  is_debit?: boolean;
  [key: string]: any;
}

export interface VoucherStockEntry {
  id: string;
  voucher_id?: string;
  company_id?: string;
  stock_item_name?: string;
  quantity?: number;
  rate?: number;
  amount?: number;
  unit?: string;
  hsn_code?: string;
  tax_rate?: number;
  discount_percent?: number;
  [key: string]: any;
}

export interface CompanyRecord {
  id: string;
  company_id?: string;
  name?: string;
  formal_name?: string;
  address?: string;
  phone?: string;
  is_active?: boolean;
  [key: string]: any;
}

// ─── Party / Ledger Search ─────────────────────────────────────────────

/**
 * Search parties (ledgers table) by name — case-insensitive ILIKE.
 */
export async function searchParties(
  query: string,
  limit: number = 15
): Promise<{ data: LedgerRecord[] | null; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('ledgers')
      .select('*')
      .ilike('name', `%${query}%`)
      .eq('is_deleted', false)
      .order('name', { ascending: true })
      .limit(limit);

    if (error) return { data: null, error: error.message };
    return { data: data as LedgerRecord[], error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Unknown error searching parties' };
  }
}

/**
 * Get a single party/ledger by exact name.
 */
export async function getPartyByName(
  name: string
): Promise<{ data: LedgerRecord | null; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('ledgers')
      .select('*')
      .eq('name', name)
      .eq('is_deleted', false)
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    return { data: data as LedgerRecord | null, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Unknown error' };
  }
}

// ─── Vouchers ───────────────────────────────────────────────────────────

/**
 * Get vouchers for a party, with optional date range.
 */
export async function getVouchers(
  partyName: string,
  limit: number = 20,
  fromDate?: string,
  toDate?: string
): Promise<{ data: VoucherRecord[] | null; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const now = new Date();
    const effectiveFrom = fromDate || new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().slice(0, 10);
    const effectiveTo = toDate || now.toISOString().slice(0, 10);

    let q = supabase
      .from('vouchers')
      .select('*')
      .eq('party_ledger_name', partyName)
      .eq('is_deleted', false)
      .gte('vch_date', effectiveFrom)
      .lte('vch_date', effectiveTo)
      .order('vch_date', { ascending: false })
      .limit(limit);

    const { data, error } = await q;
    if (error) return { data: null, error: error.message };
    return { data: data as VoucherRecord[], error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Unknown error' };
  }
}

/**
 * Get vouchers with pagination (offset-based).
 */
export async function getVouchersPaginated(
  partyName: string,
  page: number = 0,
  pageSize: number = 5,
  fromDate?: string,
  toDate?: string
): Promise<{ data: VoucherRecord[] | null; total: number; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const now = new Date();
    const effectiveFrom = fromDate || '2000-01-01';
    const effectiveTo = toDate || now.toISOString().slice(0, 10);
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await supabase
      .from('vouchers')
      .select('*', { count: 'exact', head: false })
      .eq('party_ledger_name', partyName)
      .eq('is_deleted', false)
      .gte('vch_date', effectiveFrom)
      .lte('vch_date', effectiveTo)
      .order('vch_date', { ascending: false })
      .range(from, to);

    if (error) return { data: null, total: 0, error: error.message };
    return { data: data as VoucherRecord[], total: count || 0, error: null };
  } catch (err: any) {
    return { data: null, total: 0, error: err?.message || 'Unknown error' };
  }
}

/**
 * Get a single voucher by its UUID.
 */
export async function getVoucherById(
  id: string
): Promise<{ data: VoucherRecord | null; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('vouchers')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return { data: null, error: error.message };
    return { data: data as VoucherRecord, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Unknown error' };
  }
}

/**
 * Get voucher ledger entries for a given voucher.
 */
export async function getVoucherLedgerEntries(
  voucherId: string
): Promise<{ data: VoucherLedgerEntry[] | null; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('voucher_ledger_entries')
      .select('*')
      .eq('voucher_id', voucherId);
    if (error) return { data: null, error: error.message };
    return { data: data as VoucherLedgerEntry[], error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Unknown error' };
  }
}

/**
 * Get voucher stock entries for a given voucher.
 */
export async function getVoucherStockEntries(
  voucherId: string
): Promise<{ data: VoucherStockEntry[] | null; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('voucher_stock_entries')
      .select('*')
      .eq('voucher_id', voucherId);
    if (error) return { data: null, error: error.message };
    return { data: data as VoucherStockEntry[], error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Unknown error' };
  }
}

// ─── Stock Items ────────────────────────────────────────────────────────

/**
 * Search stock items by name.
 */
export async function searchStockItems(
  query: string,
  limit: number = 15
): Promise<{ data: StockItemRecord[] | null; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('stock_items')
      .select('*')
      .ilike('name', `%${query}%`)
      .eq('is_deleted', false)
      .order('name', { ascending: true })
      .limit(limit);

    if (error) return { data: null, error: error.message };
    return { data: data as StockItemRecord[], error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Unknown error' };
  }
}

/**
 * Get low stock items (quantity < threshold).
 */
export async function getLowStockItems(
  threshold: number = 10,
  limit: number = 20
): Promise<{ data: StockItemRecord[] | null; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('stock_items')
      .select('*')
      .lt('current_stock', threshold)
      .eq('is_deleted', false)
      .order('current_stock', { ascending: true })
      .limit(limit);

    if (error) return { data: null, error: error.message };
    return { data: data as StockItemRecord[], error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Unknown error' };
  }
}

// ─── Dashboard Queries ──────────────────────────────────────────────────

/**
 * Get today's vouchers grouped by type (Sales, Purchase, Receipt, Payment).
 */
export async function getTodayVouchersByType(): Promise<{
  sales: number;
  purchases: number;
  receipts: number;
  payments: number;
  error: string | null;
}> {
  const result = { sales: 0, purchases: 0, receipts: 0, payments: 0, error: null as string | null };
  try {
    const supabase = getSupabaseClient();
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('vouchers')
      .select('voucher_type, amount')
      .eq('is_deleted', false)
      .gte('vch_date', today)
      .lte('vch_date', today);

    if (error) {
      result.error = error.message;
      return result;
    }

    for (const v of data || []) {
      const amt = Number(v.amount) || 0;
      const type = (v.voucher_type || '').toLowerCase();
      if (type.includes('sales')) result.sales += amt;
      else if (type.includes('purchase')) result.purchases += amt;
      else if (type.includes('receipt')) result.receipts += amt;
      else if (type.includes('payment')) result.payments += amt;
    }
    return result;
  } catch (err: any) {
    result.error = err?.message || 'Unknown error';
    return result;
  }
}

/**
 * Get outstanding (balance) grouped by parent group.
 */
export async function getOutstandingByGroup(): Promise<{
  debtors: number;
  creditors: number;
  error: string | null;
}> {
  const result = { debtors: 0, creditors: 0, error: null as string | null };
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('ledgers')
      .select('name, parent, closing_balance')
      .eq('is_deleted', false);

    if (error) {
      result.error = error.message;
      return result;
    }

    for (const l of data || []) {
      const bal = Number(l.closing_balance) || 0;
      const parent = (l.parent || '').toLowerCase();
      if (parent.includes('debtor') || parent.includes('receivable')) {
        result.debtors += Math.abs(bal);
      } else if (parent.includes('creditor') || parent.includes('payable')) {
        result.creditors += Math.abs(bal);
      }
    }
    return result;
  } catch (err: any) {
    result.error = err?.message || 'Unknown error';
    return result;
  }
}

/**
 * Count ledgers by parent group.
 */
export async function countLedgersByParent(): Promise<{
  customers: number;
  suppliers: number;
  error: string | null;
}> {
  const result = { customers: 0, suppliers: 0, error: null as string | null };
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('ledgers')
      .select('parent')
      .eq('is_deleted', false);

    if (error) {
      result.error = error.message;
      return result;
    }

    for (const l of data || []) {
      const parent = (l.parent || '').toLowerCase();
      if (parent.includes('debtor') || parent.includes('receivable') || parent.includes('customer')) {
        result.customers++;
      } else if (parent.includes('creditor') || parent.includes('payable') || parent.includes('supplier')) {
        result.suppliers++;
      }
    }
    return result;
  } catch (err: any) {
    result.error = err?.message || 'Unknown error';
    return result;
  }
}
