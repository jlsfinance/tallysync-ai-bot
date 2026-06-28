/**
 * Compute the Levenshtein distance between two strings.
 * Returns the minimum number of single-character edits (insert, delete, substitute).
 */
export function levenshtein(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;

  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  // Use two rows for O(n) space
  let prev: number[] = new Array(bLen + 1);
  let curr: number[] = new Array(bLen + 1);

  for (let j = 0; j <= bLen; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= aLen; i++) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost  // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[bLen];
}

/**
 * Normalize text: lowercase, strip extra spaces, remove special characters
 * while preserving letters, digits, and spaces.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // keep alphanumeric, spaces, hyphens
    .replace(/\s+/g, ' ')          // collapse multiple spaces
    .trim();
}

/**
 * Compute Soundex code for phonetic matching.
 * Handles both English and basic Hindi (Devanagari) transliteration patterns.
 * Returns a 4-character code (letter + 3 digits).
 */
export function soundex(text: string): string {
  const s = text.toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length === 0) return '';

  const first = s[0];
  const rest = s.slice(1);

  const soundexMap: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };

  // Vowels and H, W, Y act as separators (encoded as '0' temporarily for suppression)
  const separators = new Set(['A', 'E', 'I', 'O', 'U', 'H', 'W', 'Y']);

  let code = first;
  let prevCode = soundexMap[first] || '0';
  let codeLen = 1;

  for (const ch of rest) {
    if (codeLen >= 4) break;

    const mapped = soundexMap[ch] || (separators.has(ch) ? '0' : '');

    if (mapped && mapped !== prevCode && mapped !== '0') {
      code += mapped;
      codeLen++;
    }

    // Only update prevCode for actual consonant mappings
    if (mapped !== '0' && mapped !== '') {
      prevCode = mapped;
    } else if (separators.has(ch)) {
      // Vowel separator resets the previous code so same consonant after vowel is re-encoded
      prevCode = '0';
    }
  }

  // Pad with zeros
  return (code + '000').slice(0, 4);
}

/**
 * Compute trigram similarity between two strings (0 to 1).
 * Uses set-based Jaccard similarity on character trigrams.
 */
export function trigramSimilarity(a: string, b: string): number {
  const normA = normalizeText(a);
  const normB = normalizeText(b);

  if (normA === normB) return 1.0;
  if (normA.length === 0 || normB.length === 0) return 0.0;

  const trigramsA = extractTrigrams(normA);
  const trigramsB = extractTrigrams(normB);

  if (trigramsA.size === 0 && trigramsB.size === 0) return 1.0;
  if (trigramsA.size === 0 || trigramsB.size === 0) return 0.0;

  let intersection = 0;
  for (const t of trigramsA) {
    if (trigramsB.has(t)) intersection++;
  }

  const union = trigramsA.size + trigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function extractTrigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const trigrams = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    trigrams.add(padded.slice(i, i + 3));
  }
  return trigrams;
}

/**
 * Compute a combined fuzzy match score between query and target (0 to 1).
 * Blends normalized Levenshtein similarity, trigram similarity, and Soundex match.
 */
export function fuzzyMatch(query: string, target: string): number {
  const normQuery = normalizeText(query);
  const normTarget = normalizeText(target);

  if (normQuery === normTarget) return 1.0;
  if (normQuery.length === 0 || normTarget.length === 0) return 0.0;

  // Check if query is a substring of target or vice versa
  if (normTarget.includes(normQuery) || normQuery.includes(normTarget)) {
    const ratio = Math.min(normQuery.length, normTarget.length) / Math.max(normQuery.length, normTarget.length);
    return 0.6 + 0.4 * ratio;
  }

  // Levenshtein-based similarity
  const dist = levenshtein(normQuery, normTarget);
  const maxLen = Math.max(normQuery.length, normTarget.length);
  const levSim = maxLen === 0 ? 1.0 : 1.0 - dist / maxLen;

  // Trigram similarity
  const triSim = trigramSimilarity(normQuery, normTarget);

  // Soundex match
  const soundexQuery = soundex(normQuery);
  const soundexTarget = soundex(normTarget);
  const soundexMatch = soundexQuery && soundexTarget && soundexQuery === soundexTarget ? 1.0 : 0.0;

  // Weighted blend
  return 0.35 * levSim + 0.40 * triSim + 0.25 * soundexMatch;
}

export interface FuzzyMatchResult {
  item: string;
  score: number;
}

/**
 * Find the best match from a list of candidates.
 * Returns a sorted array of {item, score} from highest to lowest score.
 */
export function bestMatch(query: string, candidates: string[]): FuzzyMatchResult[] {
  const results: FuzzyMatchResult[] = candidates.map((candidate) => ({
    item: candidate,
    score: fuzzyMatch(query, candidate),
  }));

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Get top matches filtered by a minimum score threshold.
 * Default threshold is 0.3, returns at most `limit` results (default 5).
 */
export function getTopMatches(
  query: string,
  candidates: string[],
  limit: number = 5,
  threshold: number = 0.3
): FuzzyMatchResult[] {
  return bestMatch(query, candidates).filter(
    (r) => r.score >= threshold
  ).slice(0, limit);
}
