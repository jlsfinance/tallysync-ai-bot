/**
 * Conversation State Machine
 *
 * Manages multi-step conversation flows via an in-memory Map keyed by chatId.
 * Supports context memory (last searched party, results, pagination) and
 * automatic cleanup of stale sessions after 30 minutes of inactivity.
 */

// ---------------------------------------------------------------------------
// State Enum
// ---------------------------------------------------------------------------

export enum ConversationState {
  /** No active flow – waiting for a new command */
  IDLE = 'IDLE',
  /** Bot asked for a party name (for ledger / balance lookup) */
  AWAITING_PARTY = 'AWAITING_PARTY',
  /** Bot asked what type of report the user wants */
  AWAITING_REPORT_TYPE = 'AWAITING_REPORT_TYPE',
  /** Bot asked for a period / date range */
  AWAITING_PERIOD = 'AWAITING_PERIOD',
  /** Bot asked for output format (PDF / Excel / text) */
  AWAITING_FORMAT = 'AWAITING_FORMAT',
  /** Bot asked for a custom FROM date */
  AWAITING_CUSTOM_DATE_FROM = 'AWAITING_CUSTOM_DATE_FROM',
  /** Bot asked for a custom TO date */
  AWAITING_CUSTOM_DATE_TO = 'AWAITING_CUSTOM_DATE_TO',
}

// ---------------------------------------------------------------------------
// Context Interface
// ---------------------------------------------------------------------------

export interface ConversationContext {
  /** Current state in the conversation flow */
  state?: ConversationState;

  /** The user's original text that triggered the current flow */
  originalQuery?: string;

  /** Detected intent (if available) */
  intent?: string;
  /** Confidence of the detected intent */
  intentConfidence?: number;

  // ---- Entity memory ----
  /** Last searched / mentioned party name */
  lastSearchedParty?: string;
  /** Last searched / mentioned item / stock name */
  lastSearchedItem?: string;
  /** Last searched voucher number */
  lastSearchedVoucher?: string;

  // ---- Results memory ----
  /** Full list of results from the last search (stored as serialisable JSON) */
  lastResults?: any[];
  /** Current pagination page (0-indexed) */
  currentPage?: number;
  /** Number of items per page */
  pageSize?: number;
  /** Total number of results */
  totalResults?: number;
  /** Cursor / offset for deeper pagination */
  cursor?: string | number;

  // ---- Report configuration ----
  /** Desired report type (e.g. 'ledger', 'stock', 'sales', 'purchase', 'gst') */
  reportType?: string;
  /** Period: 'today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom' */
  period?: string;
  /** Custom FROM date (ISO YYYY-MM-DD) */
  dateFrom?: string;
  /** Custom TO date (ISO YYYY-MM-DD) */
  dateTo?: string;
  /** Output format: 'pdf', 'excel', 'text', 'summary' */
  format?: string;

  // ---- Metadata ----
  /** Timestamp (epoch ms) of the last interaction */
  lastInteractionAt?: number;
  /** Number of interactions in this session */
  interactionCount?: number;
  /** Arbitrary extra data (flexible field for flow-specific data) */
  extra?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Session Store
// ---------------------------------------------------------------------------

const sessions = new Map<number, ConversationContext>();

// ---------------------------------------------------------------------------
// Session TTL (30 minutes)
// ---------------------------------------------------------------------------
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Sweep stale sessions every 5 minutes.
 * Uses setInterval (cleared on module unload if needed).
 */
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function startSweeper(): void {
  if (sweepTimer) return; // already running

  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [chatId, ctx] of Array.from(sessions)) {
      if (ctx.lastInteractionAt && now - ctx.lastInteractionAt > SESSION_TTL_MS) {
        sessions.delete(chatId);
      }
    }
  }, 5 * 60 * 1000); // every 5 minutes

  // Allow the process to exit even if the timer is still running
  if (typeof sweepTimer === 'object' && 'unref' in sweepTimer) {
    sweepTimer.unref();
  }
}

/** Initialise the sweeper (call once at startup) */
export function initSessionCleanup(): void {
  startSweeper();
}

/** Stop the sweeper (useful for tests) */
export function stopSessionCleanup(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Store / update session data for a given chatId.
 * Merges partial data with existing context. Resets the interaction timer.
 */
export function storeSession(chatId: number, data: Partial<ConversationContext>): ConversationContext {
  const existing = sessions.get(chatId) ?? {};
  const merged: ConversationContext = {
    ...existing,
    ...data,
    lastInteractionAt: Date.now(),
    interactionCount: (existing.interactionCount ?? 0) + 1,
  };

  // Clean undefined keys so context stays clean
  for (const key of Object.keys(merged) as (keyof ConversationContext)[]) {
    if (merged[key] === undefined) {
      delete merged[key];
    }
  }

  sessions.set(chatId, merged);
  return merged;
}

/**
 * Retrieve the full session context for a chatId.
 * Returns a default IDLE context if nothing is stored.
 */
export function getSession(chatId: number): ConversationContext {
  const ctx = sessions.get(chatId);
  if (!ctx) {
    const defaultCtx: ConversationContext = {
      state: ConversationState.IDLE,
      lastInteractionAt: Date.now(),
      interactionCount: 0,
    };
    sessions.set(chatId, defaultCtx);
    return defaultCtx;
  }

  // Touch the interaction timestamp
  ctx.lastInteractionAt = Date.now();
  return ctx;
}

/**
 * Clear / reset the session for a chatId.
 * Next `getSession` will return a fresh IDLE context.
 */
export function clearSession(chatId: number): void {
  sessions.delete(chatId);
}

/**
 * Check whether a session exists for the given chatId.
 */
export function hasSession(chatId: number): boolean {
  return sessions.has(chatId);
}

/**
 * Returns the number of active (non-stale) sessions.
 * Stale sessions are cleaned on access, but we provide this for observability.
 */
export function activeSessionCount(): number {
  const now = Date.now();
  let count = 0;
  for (const [, ctx] of Array.from(sessions)) {
    if (ctx.lastInteractionAt && now - ctx.lastInteractionAt <= SESSION_TTL_MS) {
      count++;
    }
  }
  return count;
}

/**
 * Manually expire all sessions that are older than TTL.
 */
export function expireStaleSessions(): number {
  const now = Date.now();
  let removed = 0;
  for (const [chatId, ctx] of Array.from(sessions)) {
    if (ctx.lastInteractionAt && now - ctx.lastInteractionAt > SESSION_TTL_MS) {
      sessions.delete(chatId);
      removed++;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Helper methods for common conversation flows
// ---------------------------------------------------------------------------

/**
 * Set the state and optionally update other context fields.
 * Syntactic sugar over storeSession.
 */
export function setState(
  chatId: number,
  state: ConversationState,
  additionalData?: Partial<ConversationContext>,
): ConversationContext {
  return storeSession(chatId, { state, ...additionalData });
}

/**
 * Returns true if the given chatId is in one of the specified states.
 */
export function isInState(chatId: number, ...states: ConversationState[]): boolean {
  const ctx = sessions.get(chatId);
  if (!ctx || ctx.state === undefined) {
    return states.includes(ConversationState.IDLE);
  }
  return states.includes(ctx.state);
}

/**
 * Store the last search results together with pagination metadata.
 */
export function storeResults(
  chatId: number,
  results: any[],
  options?: { pageSize?: number; cursor?: string | number },
): void {
  storeSession(chatId, {
    lastResults: results,
    totalResults: results.length,
    currentPage: 0,
    pageSize: options?.pageSize ?? 10,
    cursor: options?.cursor,
  });
}

/**
 * Get paginated results for a chatId.
 * Returns the slice for the requested page (or the current page if not specified).
 */
export function getResultsPage(
  chatId: number,
  page?: number,
): { items: any[]; page: number; totalPages: number; totalResults: number } {
  const ctx = getSession(chatId);
  const results = ctx.lastResults ?? [];
  const pageSize = ctx.pageSize ?? 10;
  const totalResults = ctx.totalResults ?? results.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const targetPage = page ?? ctx.currentPage ?? 0;
  const clampedPage = Math.max(0, Math.min(targetPage, totalPages - 1));

  const start = clampedPage * pageSize;
  const items = results.slice(start, start + pageSize);

  // Persist current page
  storeSession(chatId, { currentPage: clampedPage });

  return {
    items,
    page: clampedPage,
    totalPages,
    totalResults,
  };
}

/**
 * Navigate to the next page of results.
 */
export function nextPage(chatId: number): { items: any[]; page: number; totalPages: number } | null {
  const ctx = getSession(chatId);
  const currentPage = ctx.currentPage ?? 0;
  const pageSize = ctx.pageSize ?? 10;
  const totalResults = ctx.totalResults ?? ctx.lastResults?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));

  if (currentPage + 1 >= totalPages) return null; // already at last page

  return getResultsPage(chatId, currentPage + 1);
}

/**
 * Navigate to the previous page of results.
 */
export function prevPage(chatId: number): { items: any[]; page: number; totalPages: number } | null {
  const ctx = getSession(chatId);
  const currentPage = ctx.currentPage ?? 0;
  if (currentPage <= 0) return null; // already at first page

  return getResultsPage(chatId, currentPage - 1);
}

// ---------------------------------------------------------------------------
// Initialise the sweeper on module load (for production usage)
// ---------------------------------------------------------------------------
startSweeper();
