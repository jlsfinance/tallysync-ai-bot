/**
 * Advanced Fuzzy Search Engine
 *
 * Combines multiple algorithms in a fallback chain:
 * exact > startsWith > contains > levenshtein > soundex > trigram
 *
 * All Supabase queries use direct REST API calls for performance and
 * to avoid the Supabase JS SDK's column-name validation.
 */
import { getSupabaseClient } from '../supabase/client';
import { escapeMd } from '../utils/formatters';

// ─── Raw REST helper — bypasses supabase-js column validation ─────────────
const SUPABASE_REST_URL = 'https://pfqmqpboomwtxgyfqnsn.supabase.co/rest/v1/';

async function supabaseRestFetch<T>(
  table: string,
  queryParams: Record<string, string>,
  signal?: AbortSignal,
): Promise<T[]> {
  // Get the service key from the existing client config
  // We import the Supabase client lazily to avoid circular deps
  const supabase = getSupabaseClient();
  const serviceKey = (supabase as any).supabaseKey || '';

  const params = new URLSearchParams(queryParams);
  const url = `${SUPABASE_REST_URL}${table}?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
    },
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase REST error ${res.status} (${table}): ${body}`);
  }

  return res.json() as Promise<T[]>;
}

// ─── Text Normalisation ──────────────────────────────────────────────────

export function normalizeIndianName(text: string): string {
  if (!text) return '';
  let s = text.toLowerCase().trim();
  s = s.replace(/\b(?:shri|sri|shree|mrs?|mr|er\.?|dr\.?|ca\.?|adv\.?)\s+/gi, '');
  s = s.replace(/\s+(?:bhai|ji|lal|dev|ram|kumar|singh|prasad|nath|das|mal|chand)\b/gi, '');
  s = s.replace(/^(?:bhai|ji|lal|dev|ram|kumar|singh|prasad|nath|das|mal|chand)\s+/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[^a-z\s]/g, '').trim();
  return s;
}

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

// ─── Algorithms ─────────────────────────────────────────────────────────

function levenshteinDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;
  const matrix: number[][] = [];
  for (let i = 0; i <= bLen; i++) matrix[i] = [i];
  for (let j = 0; j <= aLen; j++) matrix[0][j] = j;
  for (let i = 1; i <= bLen; i++) {
    for (let j = 1; j <= aLen; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[bLen][aLen];
}

function trigrams(s: string): Set<string> {
  const set = new Set<string>();
  const padded = `  ${s} `;
  for (let i = 0; i <= padded.length - 3; i++) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

function trigramSimilarity(a: string, b: string): number {
  const trigA = trigrams(a);
  const trigB = trigrams(b);
  if (trigA.size === 0 && trigB.size === 0) return 1;
  if (trigA.size === 0 || trigB.size === 0) return 0;
  let intersection = 0;
  for (const t of trigA) {
    if (trigB.has(t)) intersection++;
  }
  return (2 * intersection) / (trigA.size + trigB.size);
}

function soundex(s: string): string {
  const cleaned = s.replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (!cleaned) return '';
  const first = cleaned[0];
  const rest = cleaned.slice(1);
  const map: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };
  let encoded = first;
  let prevCode = map[first] || '';
  for (const ch of rest) {
    const code = map[ch] || '';
    if (code && code !== prevCode) {
      encoded += code;
      prevCode = code;
    }
    if (encoded.length >= 4) break;
  }
  return encoded.padEnd(4, '0');
}

// ─── Fuzzy Search Core ──────────────────────────────────────────────────

export interface FuzzyMatchResult<T> {
  item: T;
  score: number;
  method: 'exact' | 'startsWith' | 'contains' | 'levenshtein' | 'soundex' | 'trigram';
  matchedField: string;
  highlighted: string;
}

export function fuzzySearch<T extends Record<string, any>>(
  query: string,
  candidates: T[],
  fields: (keyof T & string)[] = ['name'],
  options?: {
    levenshteinThreshold?: number;
    trigramThreshold?: number;
    maxResults?: number;
  },
): FuzzyMatchResult<T>[] {
  const q = normalize(query);
  const qNorm = normalizeIndianName(query);
  if (!q) return [];

  const levThreshold = options?.levenshteinThreshold ?? 3;
  const triThreshold = options?.trigramThreshold ?? 0.3;
  const maxResults = options?.maxResults ?? 20;
  const results: FuzzyMatchResult<T>[] = [];

  for (const item of candidates) {
    let bestScore = 0;
    let bestMethod: FuzzyMatchResult<T>['method'] = 'trigram';
    let bestField = '';
    let bestHighlighted = '';

    for (const field of fields) {
      const rawValue = item[field];
      if (rawValue == null) continue;

      const value = String(rawValue);
      const vNorm = normalize(value);
      const vNormIndian = normalizeIndianName(value);

      // 1. exact
      if (vNorm === q) {
        if (100 > bestScore) { bestScore = 100; bestMethod = 'exact'; bestField = field; bestHighlighted = value; }
        continue;
      }

      // 2. exact on Indian-normalised
      if (vNormIndian === qNorm) {
        if (99 > bestScore) { bestScore = 99; bestMethod = 'exact'; bestField = field; bestHighlighted = value; }
        continue;
      }

      // 3. startsWith
      if (vNorm.startsWith(q)) {
        const score = 90 - (vNorm.length - q.length) * 0.5;
        if (score > bestScore) { bestScore = Math.max(score, 80); bestMethod = 'startsWith'; bestField = field; bestHighlighted = value; }
      }

      // 4. contains
      if (vNorm.includes(q)) {
        const score = 70 - (vNorm.length - q.length) * 0.3;
        if (score > bestScore) { bestScore = Math.max(score, 50); bestMethod = 'contains'; bestField = field; bestHighlighted = value; }
      }

      // 5. Indian-normalised contains
      if (vNormIndian.includes(qNorm)) {
        const score = 68 - (vNormIndian.length - qNorm.length) * 0.3;
        if (score > bestScore) { bestScore = Math.max(score, 48); bestMethod = 'contains'; bestField = field; bestHighlighted = value; }
      }

      // 6. Levenshtein
      const levDist = levenshteinDistance(vNorm, q);
      if (levDist <= levThreshold && levDist > 0) {
        const score = Math.max(0, 60 - levDist * 10);
        if (score > bestScore) { bestScore = score; bestMethod = 'levenshtein'; bestField = field; bestHighlighted = value; }
      }

      // 7. Soundex
      const soundexQ = soundex(q);
      const soundexV = soundex(vNorm);
      if (soundexQ && soundexV && soundexQ === soundexV) {
        if (40 > bestScore) { bestScore = 40; bestMethod = 'soundex'; bestField = field; bestHighlighted = value; }
      }

      // 8. Trigram
      const triSim = trigramSimilarity(vNorm, q);
      if (triSim >= triThreshold) {
        const score = triSim * 35;
        if (score > bestScore) { bestScore = score; bestMethod = 'trigram'; bestField = field; bestHighlighted = value; }
      }
    }

    if (bestScore > 0) {
      results.push({
        item,
        score: Math.round(bestScore * 100) / 100,
        method: bestMethod,
        matchedField: bestField,
        highlighted: bestHighlighted,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// ─── Supabase Search Functions (corrected for actual schema) ────────────

/**
 * Search parties/ledgers by name — fuzzy search over local data.
 */
export async function searchPartiesFuzzy(
  query: string,
  maxResults: number = 15,
  companyId?: string,
): Promise<FuzzyMatchResult<{ id: string; name: string; parent?: string; closing_balance?: number }>[]> {
  const supabase = getSupabaseClient();
  let queryBuilder = supabase
    .from('ledgers')
    .select('id, name, parent, closing_balance');

  // Note: ledgers table doesn't have is_deleted column

  if (companyId) {
    queryBuilder = queryBuilder.eq('company_id', companyId);
  }

  const { data, error } = await queryBuilder.order('name', { ascending: true });

  if (error || !data) return [];

  return fuzzySearch(query, data, ['name'], { maxResults });
}

/**
 * Search stock items by name — fuzzy search.
 */
export async function searchStockItemsFuzzy(
  query: string,
  maxResults: number = 15,
  companyId?: string,
): Promise<FuzzyMatchResult<{ id: string; name: string; hsn_code?: string; unit?: string }>[]> {
  const supabase = getSupabaseClient();
  let queryBuilder = supabase
    .from('stock_items')
    .select('id, name, hsn_code, unit, current_stock, rate, gst_rate')
    .eq('is_deleted', false);

  if (companyId) {
    queryBuilder = queryBuilder.eq('company_id', companyId);
  }

  const { data, error } = await queryBuilder;

  if (error || !data) return [];

  return fuzzySearch(query, data, ['name'], { maxResults });
}

/**
 * Search vouchers by party name or voucher number — fuzzy search.
 */
export async function searchVouchersFuzzy(
  query: string,
  maxResults: number = 20,
): Promise<FuzzyMatchResult<{ id: string; voucher_number: string; party_ledger_name: string; vch_date: string; voucher_type: string; amount: number }>[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('vouchers')
    .select('id, voucher_number, party_ledger_name, vch_date, voucher_type, amount')
    .eq('is_deleted', false)
    .order('vch_date', { ascending: false });

  if (error || !data) return [];

  return fuzzySearch(query, data, ['voucher_number', 'party_ledger_name'], { maxResults });
}

/**
 * Search across ALL entities (parties, vouchers, stock items) and
 * return a unified list sorted by score.
 */
// ─── Backward-compatible aliases ─────────────────────────────────────────
/**
 * @deprecated Use searchPartiesFuzzy instead
 */
export async function searchParties(query: string, maxResultsOrOptions: number | { maxResults?: number; signal?: AbortSignal; additionalFields?: string } = 15, companyId?: string): Promise<FuzzyMatchResult<any>[]> {
  const maxResults = typeof maxResultsOrOptions === 'number' ? maxResultsOrOptions : (maxResultsOrOptions?.maxResults ?? 15);
  return searchPartiesFuzzy(query, maxResults, companyId);
}

/**
 * @deprecated Use searchStockItemsFuzzy instead  
 */
export async function searchItems(query: string, maxResultsOrOptions: number | { maxResults?: number; signal?: AbortSignal; additionalFields?: string } = 15, companyId?: string): Promise<FuzzyMatchResult<any>[]> {
  const maxResults = typeof maxResultsOrOptions === 'number' ? maxResultsOrOptions : (maxResultsOrOptions?.maxResults ?? 15);
  return searchStockItemsFuzzy(query, maxResults, companyId);
}

/**
 * @deprecated Use searchVouchersFuzzy instead
 */
export async function getVouchersByParty(partyName: string, limitOrOptions: number | { limit?: number; signal?: AbortSignal } = 20, companyId?: string): Promise<any[]> {
  const limit = typeof limitOrOptions === 'number' ? limitOrOptions : (limitOrOptions?.limit ?? 20);
  const supabase = getSupabaseClient();
  let queryBuilder = supabase
    .from('vouchers')
    .select('*')
    .eq('party_ledger_name', partyName)
    .eq('is_deleted', false);

  if (companyId) {
    queryBuilder = queryBuilder.eq('company_id', companyId);
  }

  const { data } = await queryBuilder.order('vch_date', { ascending: false }).limit(limit);
  return data || [];
}

/**
 * @deprecated Was used for init — no longer needed
 */
export function configureFuzzySearch(_key: string): void {
  // No-op: fuzzy search now uses getSupabaseClient() directly
}

/**
 * Smart Suggestions — when no exact/close match found, show top N suggestions
 * Uses a very generous threshold to find similar-sounding names,
 * then falls back to Groq AI for intelligent name correction.
 */
export async function smartSuggestParty(
  query: string,
  maxSuggestions: number = 5,
  companyId?: string,
): Promise<FuzzyMatchResult<{ id: string; name: string; parent?: string; closing_balance?: number }>[]> {
  const supabase = getSupabaseClient();
  let queryBuilder = supabase
    .from('ledgers')
    .select('id, name, parent, closing_balance');

  // Note: ledgers table doesn't have is_deleted column

  if (companyId) {
    queryBuilder = queryBuilder.eq('company_id', companyId);
  }

  const { data, error } = await queryBuilder.order('name', { ascending: true });

  if (error || !data) return [];

  // Step 1: Fuzzy search with generous threshold
  let results = fuzzySearch(query, data, ['name'], {
    levenshteinThreshold: 5,
    trigramThreshold: 0.15,
    maxResults: maxSuggestions,
  });

  // Step 2: If nothing found, try Groq AI for intelligent suggestions
  if (results.length === 0) {
    try {
      const { aiSuggestParties } = await import('./groqAi');
      const partyNames = data.map(p => p.name);
      const aiSuggestions = await aiSuggestParties(query, partyNames, maxSuggestions);
      
      if (aiSuggestions.length > 0) {
        // Map AI suggestions back to actual party data
        results = aiSuggestions
          .map(s => {
            const party = data.find(p => p.name === s.suggestedName);
            if (!party) return null;
            const confScore = s.confidence === 'high' ? 85 : s.confidence === 'medium' ? 60 : 40;
            return {
              item: party,
              score: confScore,
              method: 'soundex' as const, // closest match to 'AI suggested'
              matchedField: 'name',
              highlighted: party.name,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
      }
    } catch {
      // Groq not available, fuzzy results already empty
    }
  }

  return results;
}

/**
 * Build a smart suggestion message string when no exact parties found.
 * Returns null if no suggestions available.
 */
export function buildSuggestionMessage(
  query: string,
  suggestions: FuzzyMatchResult<any>[],
): string | null {
  if (!suggestions || suggestions.length === 0) return null;

  const lines = suggestions.map((s, i) => {
    const name = s.item.name || s.item.party_name || s.item;
    const methodLabel: Record<string, string> = {
      exact: '✅ exact',
      startsWith: '↗️ starts with',
      contains: '🔍 contains',
      levenshtein: '✏️ similar',
      soundex: '🔊 sounds like',
      trigram: '🔤 close',
    };
    const method = methodLabel[s.method] || s.method;
    return `   ${i + 1}. *${escapeMd(String(name))}* (${method})`;
  });

  return [
    `❌ No parties found matching *${escapeMd(query)}*.`,
    '',
    '💡 *Did you mean?*',
    ...lines,
    '',
    'Select one of the suggestions above, or try a different name 👇',
  ].join('\n');
}

export async function searchAllFuzzy(
  query: string,
  maxResults: number = 10,
): Promise<{
  parties: FuzzyMatchResult<any>[];
  vouchers: FuzzyMatchResult<any>[];
  items: FuzzyMatchResult<any>[];
}> {
  const [parties, vouchers, items] = await Promise.all([
    searchPartiesFuzzy(query, maxResults),
    searchVouchersFuzzy(query, maxResults),
    searchStockItemsFuzzy(query, maxResults),
  ]);

  return { parties, vouchers, items };
}
