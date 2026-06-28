/**
 * Intent Detector
 *
 * Parses user text (Hindi / English / Hinglish) to determine the user's
 * intent and extract entities such as party_name, item_name, voucher_number
 * and date references.
 *
 * Supports intents:
 *   INVOICE, LEDGER, STOCK, SEARCH, DASHBOARD, REPORT, HELP,
 *   START, CUSTOMER, BALANCE, PAYMENT, VOUCHER
 */

// ---------------------------------------------------------------------------
// Types & Enums
// ---------------------------------------------------------------------------

export enum Intent {
  INVOICE = 'INVOICE',
  LEDGER = 'LEDGER',
  STOCK = 'STOCK',
  SEARCH = 'SEARCH',
  DASHBOARD = 'DASHBOARD',
  REPORT = 'REPORT',
  HELP = 'HELP',
  START = 'START',
  CUSTOMER = 'CUSTOMER',
  BALANCE = 'BALANCE',
  PAYMENT = 'PAYMENT',
  VOUCHER = 'VOUCHER',
  UNKNOWN = 'UNKNOWN',
}

export interface IntentResult {
  /** The detected primary intent */
  intent: Intent;
  /** Confidence 0-1 */
  confidence: number;
  /** Extracted entities */
  entities: ExtractedEntities;
  /** Raw matched patterns that contributed to detection */
  matchedPatterns: string[];
  /** Sub-intent or secondary intent, if any */
  subIntent?: Intent;
}

export interface ExtractedEntities {
  party_name?: string;
  item_name?: string;
  voucher_number?: string;
  invoice_number?: string;
  /** ISO date string (YYYY-MM-DD) or relative ("today", "yesterday", "this month") */
  dateFrom?: string;
  dateTo?: string;
  /** Raw numbers mentioned (invoice 125 ⇒ 125) */
  numbers?: number[];
  /** Any other name-like tokens that weren't matched */
  unknownTokens?: string[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface IntentPattern {
  intent: Intent;
  /** Regex patterns that map to this intent */
  patterns: RegExp[];
  /** Minimum confidence when matched */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Hindi / Hinglish action words
// ---------------------------------------------------------------------------
const ACTION_WORDS = [
  'bhej', 'bhejo', 'dikha', 'dikhao', 'nikal', 'daal',
  'khoj', 'dhundh', 'dhundo', 'lao', 'do', 'de',
];

// ---------------------------------------------------------------------------
// Intent patterns (ordered roughly by specificity)
// ---------------------------------------------------------------------------
const INTENT_PATTERNS: IntentPattern[] = [
  // --- HELP ---
  {
    intent: Intent.HELP,
    patterns: [
      /\b(?:help|madad|sahaayata|kaise|guide|instruction|command)\b/i,
      /^(?:h|help|start)$/i,
    ],
    confidence: 0.95,
  },

  // --- START ---
  {
    intent: Intent.START,
    patterns: [
      /^\/start$/,
      /^(?:start|shuru|begin|namaste|namaskar|hello|hi)\s*(?:bot)?$/i,
    ],
    confidence: 0.95,
  },

  // --- DASHBOARD ---
  {
    intent: Intent.DASHBOARD,
    patterns: [
      /\b(?:dashboard|summary|overview|saraansh|डैशबोर्ड)\b/i,
      /^(?:dashboard|home|main menu|mainmenu)$/i,
    ],
    confidence: 0.90,
  },

  // --- INVOICE ---
  {
    intent: Intent.INVOICE,
    patterns: [
      /\b(?:invoice|bill|challan|receipt|rasid|बिल|इनवॉइस)\b/i,
      /\binvoice\s+(?:no|number|#|num)?\s*\d+/i,
      /\bbill\s+(?:no|number|#|num)?\s*\d+/i,
      /(?:bhej|bhejo|send)\s.*\b(?:invoice|bill)\b/i,
    ],
    confidence: 0.85,
  },

  // --- VOUCHER ---
  {
    intent: Intent.VOUCHER,
    patterns: [
      /\b(?:voucher|vou|payment\s*voucher|receipt\s*voucher)\b/i,
      /\bvoucher\s+(?:no|number|#|num)?\s*\d+/i,
      /(?:khoj|dhundh|search|find)\s.*\b(?:voucher|vou)\b/i,
    ],
    confidence: 0.85,
  },

  // --- LEDGER ---
  {
    intent: Intent.LEDGER,
    patterns: [
      /\b(?:ledger|hisab|khata|haat|lejar|लेज़र|हिसाब|खाता)\b/i,
      /(?:hisab|khata|haat|lejar)\s+(?:dikha|dikhao|bhej|bhejo|nikal)/i,
      /\b(?:party|customer)\s+ledger\b/i,
    ],
    confidence: 0.85,
  },

  // --- CUSTOMER / PARTY lookup ---
  {
    intent: Intent.CUSTOMER,
    patterns: [
      /\b(?:customer|party|gahak|ग्राहक)\b/i,
      /(?:kaun|who|details?|info)\s+(?:hai|is)?\s*(?:party|customer)/i,
      /(?:party|customer)\s+(?:ka|ke|ki)\s+(?:details|detail|jaankari)/i,
    ],
    confidence: 0.75,
  },

  // --- BALANCE ---
  {
    intent: Intent.BALANCE,
    patterns: [
      /\b(?:balance|baaki|baqi|बाकी|balance\s*(?:dikha|dikhao|check|nikal))\b/i,
      /(?:kitna|kya)\s+(?:balance|baaki|baqi)\s+(?:hai|h)?/i,
      /(?:balance|baaki|baqi)\s+(?:ka|ke|ki)\s+(?:jaankari|details)/i,
    ],
    confidence: 0.80,
  },

  // --- PAYMENT ---
  {
    intent: Intent.PAYMENT,
    patterns: [
      /\b(?:payment|pay|bhugtaan|bhugtan|जमा|paytm|neft|rtgs|upi)\b/i,
      /(?:payment|pay)\s+(?:dikha|dikhao|dikhaye?|history|record|karo)/i,
      /(?:kis|kaun)\s+(?:ne|se)\s+(?:payment|pay|diya)/i,
    ],
    confidence: 0.80,
  },

  // --- STOCK ---
  {
    intent: Intent.STOCK,
    patterns: [
      /\b(?:stock|maal|samAn|item|product|स्टॉक|माल|सामान)\b/i,
      /(?:stock|maal|samAn|item)\s+(?:dikha|dikhao|check|khoj|dhundh)/i,
      /(?:kitna|kya)\s+(?:stock|maal)\s+(?:hai|bacha|baaki)/i,
    ],
    confidence: 0.85,
  },

  // --- REPORT ---
  {
    intent: Intent.REPORT,
    patterns: [
      /\b(?:report|report card|statement|vivran|रिपोर्ट)\b/i,
      /(?:report|statement)\s+(?:dikha|dikhao|bhej|bhejo|ban|banao|nikal)/i,
      /\b(?:trial\s*balance|p&l|profit\s*(?:and|&)\s*loss|balance\s*sheet|gst|sales|purchase)\b/i,
    ],
    confidence: 0.85,
  },

  // --- SEARCH (generic) ---
  {
    intent: Intent.SEARCH,
    patterns: [
      /\b(?:search|khoj|dhundh|dhundo|find|lookup|query)\b/i,
      /(?:khoj|dhundh|search|find)\s+(?:karo|do|ke)?\s*(?:party|customer|item|maal|voucher|invoice|bill)/i,
    ],
    confidence: 0.70,
  },
];

// ---------------------------------------------------------------------------
// Entity extraction patterns
// ---------------------------------------------------------------------------

const PARTY_NAME_PATTERNS = [
  // "ka party_name" / "ki party_name"
  /(?:party|customer)\s+(?:ka|ke|ki|name|naam)?\s*[:\-]?\s*["']?([A-Za-z\s.&]+?)["']?(?:\s+(?:ka|ke|ki|ko|se|ne|dikha|bhej|nikal))?$/i,
  // "party_name ka hisab/ledger"
  /^([A-Za-z\s.&]+?)\s+(?:ka|ke|ki)\s+(?:hisab|khata|ledger|balance|baaki)/i,
  // "hisab/ledger party_name ka"
  /(?:hisab|khata|ledger|balance)\s+(?:dikha|dikhao|bhej|nikal)?\s*["']?([A-Za-z\s.&]+?)["']?\s+(?:ka|ke|ki)\s*$/i,
  // Trailing name after 'ka' / 'ke' / 'ki'
  /\b(?:ka|ke|ki)\s+["']?([A-Za-z\s.&]{3,})["']?\s*$/i,
];

const ITEM_NAME_PATTERNS = [
  // "item_name ka stock"
  /^([A-Za-z\s.\d]+?)\s+(?:ka|ke|ki)\s+(?:stock|maal|samAn|item)/i,
  // "stock item_name ka"
  /(?:stock|maal|samAn|item)\s+(?:dikha|dikhao|check)?\s*["']?([A-Za-z\s.\d]+?)["']?\s+(?:ka|ke|ki)\s*$/i,
  // "item_name" (after stock-related keywords)
  /(?:stock|maal|samAn|item)\s+(?:ka|ke|ki)?\s*["']?([A-Za-z\s.\d]{3,})["']?$/i,
];

const VOUCHER_NUMBER_PATTERNS = [
  /(?:voucher|vou)\s+(?:no|number|num|#)?\s*[:#]?\s*(\d{3,})/i,
  /(?:invoice|bill)\s+(?:no|number|num|#)?\s*[:#]?\s*(\d{3,})/i,
  /\b(\d{4,})\b(?:\s*(?:voucher|vou|invoice|bill))?/,
];

const DATE_PATTERNS = [
  // Relative dates
  /(?:\baaj\b|today|aaj|aaj ke)/i,
  /\byesterday\b|kal\b/i,
  /\bthis\s+(?:week|month|quarter|year)\b/i,
  /\blast\s+(?:week|month|quarter|year)\b/i,
  // "10 din pehle" / "pichhle 7 din" etc.
  /(?:pichhle?|last|previous)\s+(\d+)\s+(?:din|days?|week|month)/i,
  /(\d+)\s+(?:din|days?)\s+(?:pehle|before|ago)/i,
  // Specific dates
  /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/,
  /\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/,
  // Month names
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(\d{4}))?\b/i,
];

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Normalise Hindi action words to their root form for easier matching */
function normalizeHinglish(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(?:bhej[o]?|bhej)\b/g, 'send')
    .replace(/\b(?:dikha[o]?|dikhaye?)\b/g, 'show')
    .replace(/\bnikal\b/g, 'get')
    .replace(/\bdaal\b/g, 'add')
    .replace(/\b(?:khoj|dhundh|dhundo)\b/g, 'search')
    .replace(/\blao?\b/g, 'bring')
    .replace(/\bdo\b/g, 'give')
    .replace(/\bde\b/g, 'give')
    .replace(/\b(?:ka|ke|ki)\b/g, 'of')      // possessive mapping
    .replace(/\bmein\b/g, 'in')
    .replace(/\bse\b/g, 'from');
}

/** Extract all numbers from text */
function extractNumbers(text: string): number[] {
  const matches = text.match(/\b\d{1,6}\b/g);
  if (!matches) return [];
  return matches.map(Number).filter(
    n => n > 0 && !(n >= 1900 && n <= 2100), // filter out years
  );
}

/** Resolve relative date expressions to ISO strings */
function resolveRelativeDate(expression: string): { dateFrom?: string; dateTo?: string } {
  const lower = expression.toLowerCase();

  if (/^(aaj|today|aaj ke)\b/i.test(expression)) {
    const today = new Date();
    return {
      dateFrom: today.toISOString().slice(0, 10),
      dateTo: today.toISOString().slice(0, 10),
    };
  }

  if (/^(kal|yesterday)\b/i.test(expression)) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      dateFrom: yesterday.toISOString().slice(0, 10),
      dateTo: yesterday.toISOString().slice(0, 10),
    };
  }

  if (/\bthis\s+month\b/i.test(expression)) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10),
    };
  }

  if (/\blast\s+month\b/i.test(expression)) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10),
    };
  }

  if (/\bthis\s+week\b/i.test(expression)) {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const from = new Date(now);
    from.setDate(now.getDate() - dayOfWeek);
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return {
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10),
    };
  }

  if (/\blast\s+week\b/i.test(expression)) {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const endOfLastWeek = new Date(now);
    endOfLastWeek.setDate(now.getDate() - dayOfWeek - 1);
    const startOfLastWeek = new Date(endOfLastWeek);
    startOfLastWeek.setDate(endOfLastWeek.getDate() - 6);
    return {
      dateFrom: startOfLastWeek.toISOString().slice(0, 10),
      dateTo: endOfLastWeek.toISOString().slice(0, 10),
    };
  }

  return {};
}

/** Try to parse a specific date from text */
function extractExplicitDate(text: string): string | undefined {
  // YYYY-MM-DD
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  // DD/MM/YYYY or MM/DD/YYYY
  const slash = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (slash) {
    // Try DD/MM/YYYY first (common in India)
    let d = new Date(`${slash[3]}-${slash[2]}-${slash[1]}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    d = new Date(`${slash[3]}-${slash[1]}-${slash[2]}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  // DD/MM/YY
  const shortSlash = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})\b/);
  if (shortSlash) {
    const year = 2000 + parseInt(shortSlash[3], 10);
    let d = new Date(`${year}-${shortSlash[2]}-${shortSlash[1]}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    d = new Date(`${year}-${shortSlash[1]}-${shortSlash[2]}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  // Month name + day
  const monthDay = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(\d{4}))?\b/i,
  );
  if (monthDay) {
    const months: Record<string, number> = {
      jan: 0, january: 0,
      feb: 1, february: 1,
      mar: 2, march: 2,
      apr: 3, april: 3,
      may: 4,
      jun: 5, june: 5,
      jul: 6, july: 6,
      aug: 7, august: 7,
      sep: 8, september: 8,
      oct: 9, october: 9,
      nov: 10, november: 10,
      dec: 11, december: 11,
    };
    const month = months[monthDay[1].toLowerCase().slice(0, 3)];
    const day = parseInt(monthDay[2], 10);
    const year = monthDay[3] ? parseInt(monthDay[3], 10) : new Date().getFullYear();
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Detect the user's intent from a natural language message (Hindi / English /
 * Hinglish mixed).
 */
export function detectIntent(text: string): IntentResult {
  if (!text || text.trim().length === 0) {
    return {
      intent: Intent.UNKNOWN,
      confidence: 0,
      entities: {},
      matchedPatterns: [],
    };
  }

  const raw = text.trim();
  const normalised = normalizeHinglish(raw);

  const matchedPatterns: string[] = [];
  const intentScores = new Map<Intent, number>();

  // --- Intent matching ---
  for (const ip of INTENT_PATTERNS) {
    for (const re of ip.patterns) {
      if (re.test(raw) || re.test(normalised)) {
        const current = intentScores.get(ip.intent) ?? 0;
        intentScores.set(ip.intent, Math.max(current, ip.confidence));
        matchedPatterns.push(re.source);
      }
    }
  }

  // --- Determine primary intent ---
  let primaryIntent = Intent.UNKNOWN;
  let primaryConfidence = 0;

  for (const [intent, score] of Array.from(intentScores)) {
    if (score > primaryConfidence) {
      primaryConfidence = score;
      primaryIntent = intent;
    }
  }

  // If nothing matched, try a very soft catch-all
  if (primaryIntent === Intent.UNKNOWN && raw.length > 0) {
    // Simple word-level fallback: check for key nouns
    const nounPatterns: [RegExp, Intent, number][] = [
      [/\b(?:bill|invoice|challan)\b/i, Intent.INVOICE, 0.4],
      [/\b(?:hisab|khata|haat|ledger)\b/i, Intent.LEDGER, 0.4],
      [/\b(?:stock|maal|samAn|item)\b/i, Intent.STOCK, 0.4],
      [/\b(?:report|statement|vivran)\b/i, Intent.REPORT, 0.4],
      [/\b(?:balance|baaki)\b/i, Intent.BALANCE, 0.4],
      [/\b(?:payment|pay|bhugtan)\b/i, Intent.PAYMENT, 0.4],
      [/\b(?:voucher|vou)\b/i, Intent.VOUCHER, 0.4],
      [/\b(?:customer|party|gahak)\b/i, Intent.CUSTOMER, 0.4],
    ];

    for (const [re, intent, conf] of nounPatterns) {
      if (re.test(raw)) {
        primaryIntent = intent;
        primaryConfidence = conf;
        matchedPatterns.push(`noun-fallback:${re.source}`);
        break;
      }
    }
  }

  // --- Entity extraction ---
  const entities: ExtractedEntities = {};

  // Voucher / Invoice number
  for (const re of VOUCHER_NUMBER_PATTERNS) {
    const m = raw.match(re);
    if (m) {
      const num = m[1];
      if (/voucher|vou/i.test(re.source)) {
        entities.voucher_number = num;
      } else {
        entities.invoice_number = num;
      }
      break;
    }
  }

  // Party name
  for (const re of PARTY_NAME_PATTERNS) {
    const m = raw.match(re);
    if (m && m[1] && m[1].trim().length >= 2) {
      entities.party_name = m[1].trim();
      break;
    }
  }

  // Item name
  for (const re of ITEM_NAME_PATTERNS) {
    const m = raw.match(re);
    if (m && m[1] && m[1].trim().length >= 2) {
      entities.item_name = m[1].trim();
      break;
    }
  }

  // Date references
  const dateRefs = resolveRelativeDate(raw);
  if (dateRefs.dateFrom) entities.dateFrom = dateRefs.dateFrom;
  if (dateRefs.dateTo) entities.dateTo = dateRefs.dateTo;

  // Explicit date
  const explicitDate = extractExplicitDate(raw);
  if (explicitDate) {
    entities.dateFrom = explicitDate;
    entities.dateTo = entities.dateTo ?? explicitDate;
  }

  // Numbers
  const numbers = extractNumbers(raw);
  if (numbers.length > 0) entities.numbers = numbers;

  // Unknown tokens (potential names not captured above)
  const words = raw.split(/\s+/).filter(
    w => w.length > 2 && /^[A-Za-z]+$/.test(w) && !ACTION_WORDS.includes(w.toLowerCase()),
  );
  const knownWords = new Set([
    ...INTENT_PATTERNS.flatMap(ip =>
      ip.patterns
        .map(r => r.source.toLowerCase())
        .flatMap(s => s.split(/\W+/)),
    ),
    'ka', 'ke', 'ki', 'ko', 'se', 'ne', 'mein', 'me', 'hai', 'hain', 'ho',
    'the', 'thi', 'the', 'dikha', 'dikhao', 'bhej', 'bhejo', 'nikal', 'daal',
    'khoj', 'dhundh', 'dhundo', 'lao', 'do', 'de', 'kar', 'karo', 'kr', 'krdo',
  ]);

  const unknownTokens = words.filter(
    w => !knownWords.has(w.toLowerCase()),
  );
  if (unknownTokens.length > 0) entities.unknownTokens = unknownTokens;

  // Determine sub-intent (if the primary is very general)
  let subIntent: Intent | undefined;
  if (primaryIntent === Intent.SEARCH && entities.voucher_number) {
    subIntent = Intent.VOUCHER;
  } else if (primaryIntent === Intent.SEARCH && entities.party_name) {
    subIntent = Intent.LEDGER;
  } else if (primaryIntent === Intent.SEARCH && entities.item_name) {
    subIntent = Intent.STOCK;
  }

  return {
    intent: primaryIntent,
    confidence: Math.round(primaryConfidence * 100) / 100,
    entities,
    matchedPatterns,
    subIntent,
  };
}

/**
 * Quick check: does the text look like a simple name query (no clear intent)?
 * Useful for conversational fallback.
 */
export function isNameQuery(text: string): boolean {
  const t = text.trim();
  // Single word that looks like a name (capitalized, 3+ chars)
  if (/^[A-Z][a-z]{2,}$/.test(t)) return true;
  // Two word name
  if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(t)) return true;
  return false;
}
