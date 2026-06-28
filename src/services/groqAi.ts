/**
 * Groq AI Service
 *
 * Integrates Groq's free Llama 3.1 8B model for:
 * 1. Smart party name suggestions when fuzzy search fails
 * 2. Correcting misspelled party names
 * 3. Natural language understanding enhancement
 */
import Groq from 'groq-sdk';
import logger from '../logger';

// ─── Groq client singleton ─────────────────────────────────────────────────

let groqClient: Groq | null = null;

function getGroqClient(): Groq {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      logger.warn('GROQ_API_KEY not set — Groq AI features disabled');
      // Return a dummy client — every call will be checked
    }
    groqClient = new Groq({
      apiKey: apiKey || 'dummy-key',
    });
  }
  return groqClient;
}

// ─── Check if Groq is available ────────────────────────────────────────────

export function isGroqAvailable(): boolean {
  return !!process.env.GROQ_API_KEY;
}

// ─── Smart Party Name Suggestion ──────────────────────────────────────────

export interface PartySuggestion {
  suggestedName: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Use Groq AI to suggest corrections for misspelled party names.
 * The AI analyses the user's input and returns the closest matching party name(s).
 */
export async function aiSuggestParties(
  userQuery: string,
  knownParties: string[],
  maxSuggestions: number = 5,
): Promise<PartySuggestion[]> {
  if (!isGroqAvailable()) return [];
  if (!knownParties || knownParties.length === 0) return [];

  try {
    const client = getGroqClient();

    // Take party names sample (limit to avoid huge prompts)
    const partySample = knownParties.slice(0, 50);
    const partyList = partySample.map((n, i) => `${i + 1}. "${n}"`).join('\n');

    const response = await client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `You are an AI assistant for a Tally accounting bot. 
The user typed a party name that didn't match exactly.
Your job: suggest the closest matching party name(s) from the list below.

User typed: "${userQuery}"

Available parties:
${partyList}

Rules:
- Return ONLY a JSON array of objects with fields: suggestedName, confidence ("high"/"medium"/"low"), reason
- If the user's input is clearly a misspelling of a party in the list, return it with high confidence
- If partially matching, return medium confidence
- If no reasonable match exists, return an empty array []
- Do NOT return parties that have nothing in common
- Max ${maxSuggestions} suggestions
- Example: [{"suggestedName": "Bhoparam Ji Nimbawas", "confidence": "high", "reason": "Similar spelling and sound"}]`,
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    const content = response.choices?.[0]?.message?.content || '[]';
    
    // Try to parse JSON from the response (it may be wrapped in markdown code blocks)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    
    const suggestions: PartySuggestion[] = JSON.parse(jsonStr);
    
    // Validate and limit
    return (suggestions || []).slice(0, maxSuggestions).filter(
      s => s.suggestedName && knownParties.includes(s.suggestedName),
    );
  } catch (err: any) {
    logger.warn('Groq AI suggestion failed', { error: err?.message });
    return [];
  }
}

// ─── Natural Language Understanding ────────────────────────────────────────

export interface NluResult {
  intent: string;
  partyName?: string;
  itemName?: string;
  reportType?: string;
  dateFrom?: string;
  dateTo?: string;
  confidence: number;
}

/**
 * Use Groq AI to enhance natural language understanding.
 * Falls back gracefully if Groq is unavailable.
 */
export async function aiDetectIntent(
  userText: string,
): Promise<NluResult | null> {
  if (!isGroqAvailable()) return null;

  try {
    const client = getGroqClient();

    const response = await client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `You are a Tally accounting bot NLP engine. Parse the user's Hinglish/English message.

Return ONLY a JSON object with these fields:
- intent: one of "dashboard", "invoice", "ledger", "customer", "stock", "payment", "report", "help", "unknown"
- partyName: if a party/customer name is mentioned (or null)
- itemName: if a stock item is mentioned (or null)
- reportType: "ledger", "invoice", "statement", "outstanding" (or null)
- dateFrom: ISO date string if mentioned (or null)
- dateTo: ISO date string if mentioned (or null)
- confidence: number 0-1

Examples:
"Bhoparam nimbawas bill bhej" → {"intent":"invoice","partyName":"Bhoparam Nimbawas","reportType":"invoice","confidence":0.95}
"Mukesh ka hisab dikhao" → {"intent":"ledger","partyName":"Mukesh","reportType":"ledger","confidence":0.95}
"aaj ka sales" → {"intent":"dashboard","confidence":0.8}
"stock me kitna maal hai" → {"intent":"stock","confidence":0.9}
"dashboard" → {"intent":"dashboard","confidence":0.95}`,
        },
        {
          role: 'user',
          content: userText,
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
    });

    const content = response.choices?.[0]?.message?.content || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    
    const result: NluResult = JSON.parse(jsonStr);
    return result;
  } catch (err: any) {
    logger.warn('Groq AI intent detection failed', { error: err?.message });
    return null;
  }
}

// ─── Smart Suggestion Formatter ───────────────────────────────────────────

/**
 * Build a user-friendly smart suggestion message using both fuzzy + AI results.
 */
export function formatAiSuggestionMessage(
  userQuery: string,
  suggestions: PartySuggestion[],
): string | null {
  if (!suggestions || suggestions.length === 0) return null;

  const lines = suggestions.map((s, i) => {
    const confEmoji = s.confidence === 'high' ? '✅' : s.confidence === 'medium' ? '🤔' : '❓';
    return `   ${i + 1}. *${s.suggestedName}* ${confEmoji} — ${s.reason}`;
  });

  return [
    `❌ No exact match found for *${userQuery}*.`,
    '',
    '🤖 *AI Suggestions:*',
    ...lines,
    '',
    'Select one above, or try typing more carefully 👇',
  ].join('\n');
}
