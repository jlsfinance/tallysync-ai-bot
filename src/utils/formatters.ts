/**
 * Format a number in Indian numbering style (Lakh/Crore).
 * Example: 123456 -> '₹1,23,456'
 */
export function formatIndian(n: number): string {
  if (typeof n !== 'number' || isNaN(n)) return '₹0';

  const isNegative = n < 0;
  const absNum = Math.abs(n);
  const whole = Math.floor(absNum);
  const decimal = Math.round((absNum - whole) * 100);

  // Indian numbering: last 3 digits, then groups of 2
  const wholeStr = String(whole);
  const lastThree = wholeStr.slice(-3);
  const rest = wholeStr.slice(0, -3);

  let formatted: string;
  if (rest.length > 0) {
    // Group the rest in pairs from right
    const pairs: string[] = [];
    for (let i = rest.length; i > 0; i -= 2) {
      pairs.unshift(rest.slice(Math.max(0, i - 2), i));
    }
    formatted = pairs.join(',') + ',' + lastThree;
  } else {
    formatted = lastThree;
  }

  const sign = isNegative ? '-' : '';
  const paise = decimal > 0 ? `.${String(decimal).padStart(2, '0')}` : '';

  return `${sign}₹${formatted}${paise}`;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format a date string into 'DD MMM YYYY' format.
 * Accepts ISO strings, timestamps, or Date objects.
 */
export function formatDate(d: string | Date | number | null | undefined): string {
  if (!d) return '—';

  try {
    const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;

    if (isNaN(date.getTime())) return '—';

    const day = date.getDate().toString().padStart(2, '0');
    const month = MONTH_NAMES[date.getMonth()];
    const year = date.getFullYear();

    return `${day} ${month} ${year}`;
  } catch {
    return '—';
  }
}

const VOUCHER_TYPE_MAP: Record<string, { emoji: string; label: string }> = {
  sales: { emoji: '🧾', label: 'Sales' },
  purchase: { emoji: '📥', label: 'Purchase' },
  payment: { emoji: '💸', label: 'Payment' },
  receipt: { emoji: '💰', label: 'Receipt' },
  contra: { emoji: '🔄', label: 'Contra' },
  journal: { emoji: '📓', label: 'Journal' },
  'credit note': { emoji: '📝', label: 'Credit Note' },
  'debit note': { emoji: '📝', label: 'Debit Note' },
  'stock journal': { emoji: '📦', label: 'Stock Journal' },
  'payment out': { emoji: '💸', label: 'Payment Out' },
  'receipt in': { emoji: '💰', label: 'Receipt In' },
  'purchase order': { emoji: '📋', label: 'Purchase Order' },
  'sales order': { emoji: '📋', label: 'Sales Order' },
  'material receipt': { emoji: '📦', label: 'Material Receipt' },
  'material issue': { emoji: '📤', label: 'Material Issue' },
  'physical stock': { emoji: '📊', label: 'Physical Stock' },
  'sales return': { emoji: '↩️', label: 'Sales Return' },
  'purchase return': { emoji: '↩️', label: 'Purchase Return' },
};

/**
 * Format voucher type with an emoji and readable name.
 * Falls back to the raw type string if not recognized.
 */
export function formatVoucherType(type: string): string {
  if (!type) return '📄 Unknown';

  const key = type.toLowerCase().trim();
  const entry = VOUCHER_TYPE_MAP[key];

  if (entry) {
    return `${entry.emoji} ${entry.label}`;
  }

  // Try partial match for voucher types like 'Sales Voucher' -> sales
  for (const [knownKey, knownEntry] of Object.entries(VOUCHER_TYPE_MAP)) {
    if (key.includes(knownKey) || knownKey.includes(key)) {
      return `${knownEntry.emoji} ${knownEntry.label}`;
    }
  }

  // Capitalize and return as-is with generic emoji
  return `📄 ${type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()}`;
}

/**
 * Truncate text to a maximum length, appending '...' if truncated.
 */
export function truncate(text: string, max: number): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

const MD_SPECIAL_CHARS = /([_*[\]()~`>#+\-=|{}.!\\])/g;

/**
 * Escape Telegram MarkdownV2 special characters.
 */
export function escapeMd(text: string): string {
  if (!text) return '';
  return String(text).replace(MD_SPECIAL_CHARS, '\\$1');
}
