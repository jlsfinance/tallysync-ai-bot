/**
 * Groq AI Service
 *
 * Integrates Groq's free Llama 3.1 8B model to serve as the PRIMARY
 * brain for the bot — understands ANY user input in Hindi/English/Hinglish,
 * extracts intent+entities, and generates conversational responses.
 */
import Groq from 'groq-sdk';
import logger from '../logger';

// ─── Groq client singleton ─────────────────────────────────────────────────

let groqClient: Groq | null = null;

function getGroqClient(): Groq {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
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

// ─── Party Name Suggestion ─────────────────────────────────────────────────

export interface PartySuggestion {
  suggestedName: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Use Groq AI to suggest corrections for misspelled party names.
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
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    const suggestions: PartySuggestion[] = JSON.parse(jsonStr);

    return (suggestions || []).slice(0, maxSuggestions).filter(
      s => s.suggestedName && knownParties.includes(s.suggestedName),
    );
  } catch (err: any) {
    logger.warn('Groq AI suggestion failed', { error: err?.message });
    return [];
  }
}

// ─── PRIMARY: AI Process Query (Full NLU + Response) ──────────────────────

export interface AiQueryResult {
  /** One of: dashboard, invoice, ledger, customer, stock, payment, help, unknown */
  intent: string;
  /** Extracted party/customer name (or null) */
  partyName: string | null;
  /** Extracted stock item name (or null) */
  itemName: string | null;
  /** Report type for deeper context: ledger, invoice, statement, outstanding */
  reportType: string | null;
  /** Friendly conversational response in Hinglish/Hindi/English */
  response: string;
  /** Confidence 0-1 */
  confidence: number;
  /** Any error message from AI processing */
  error?: string;
}

/**
 * THE PRIMARY BRAIN — processes ANY user query and returns:
 * - intent (what action to take)
 * - extracted entities (party name, item, etc.)
 * - a friendly conversational response in the user's language
 *
 * Falls back gracefully if Groq is unavailable (returns null).
 */
export async function aiProcessQuery(userText: string): Promise<AiQueryResult | null> {
  if (!isGroqAvailable()) return null;
  if (!userText || userText.trim().length === 0) return null;

  try {
    const client = getGroqClient();

    const response = await client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `You are the AI brain of a Tally accounting Telegram bot named TallySync.
Your user speaks Hindi, English, or Hinglish (mix of both).

Your job:
1. UNDERSTAND what the user wants
2. EXTRACT the key information
3. GENERATE a friendly conversational response in the user's language

The bot can:
- Show DASHBOARD (today's sales, purchases, receipts, payments, outstanding)
- Show INVOICE/BILL for a party (send bill, view invoice)
- Show LEDGER/HISAB for a party (full transaction history)
- Show CUSTOMER/PARTY details (balance, outstanding, last payment)
- Show STOCK/MAL details (current stock, rate, value)
- Help (explain how to use the bot)

Return ONLY a JSON object with these fields:
{
  "intent": "dashboard" | "invoice" | "ledger" | "customer" | "stock" | "help" | "unknown",
  "partyName": string | null,
  "itemName": string | null,
  "reportType": "ledger" | "invoice" | "statement" | "outstanding" | null,
  "response": "Friendly reply to user (in their language, mix of Hindi/English)",
  "confidence": 0.95
}

EXAMPLES:

User: "Bhoparam nimbawas bill bhej"
→ {"intent":"invoice","partyName":"Bhoparam Nimbawas","itemName":null,"reportType":"invoice","response":"🧾 Bhoparam Nimbawas ka invoice dhoondh raha hoon...","confidence":0.95}

User: "Mukesh ka hisab dikhao"
→ {"intent":"ledger","partyName":"Mukesh","itemName":null,"reportType":"ledger","response":"📒 Mukesh ka ledger dikha raha hoon... kaunsa period chahiye?","confidence":0.95}

User: "aaj ka sales kitna hua"
→ {"intent":"dashboard","partyName":null,"itemName":null,"reportType":null,"response":"📊 Aaj ka dashboard check kar raha hoon...","confidence":0.9}

User: "hello"
→ {"intent":"help","partyName":null,"itemName":null,"reportType":null,"response":"Namaste! 👋 Main TallySync AI bot hoon. Aap kya dekhna chahenge? Jaise: 'Mukesh ka balance', 'Aaj ka sales', 'Bhoparam ka bill bhej'","confidence":0.9}

User: "stock me cement kitna hai"
→ {"intent":"stock","partyName":null,"itemName":"Cement","reportType":null,"response":"📦 Cement ka stock check kar raha hoon...","confidence":0.95}

User: "kaisa hai"
→ {"intent":"help","partyName":null,"itemName":null,"reportType":null,"response":"Main theek hoon! 🎉 Aap kya dekhna chahenge? Kisi party ka balance, ledger, bill, ya aaj ka dashboard?","confidence":0.7}

IMPORTANT RULES:
- Always respond in the user's language (Hinglish/Hindi mix is best)
- Keep responses SHORT and FRIENDLY (1-2 lines max)
- If the user mentions a party/customer name, extract it EVEN if misspelled
- If you can't figure out what they want, set intent to "help" and ask them
- NEVER make up data — just set the correct intent for the action handler`,
        },
        {
          role: 'user',
          content: userText,
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    const content = response.choices?.[0]?.message?.content || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    
    const result: AiQueryResult = JSON.parse(jsonStr);
    
    // Validate result
    if (!result.intent) {
      return {
        intent: 'unknown',
        partyName: null,
        itemName: null,
        reportType: null,
        response: 'Samajh nahi aaya. Kya dekhna chahenge? Jaise: "Mukesh ka balance", "Aaj ka sales", "Bhoparam ka bill"',
        confidence: 0,
      };
    }

    // Clean party name (capitalize first letter properly)
    if (result.partyName) {
      result.partyName = result.partyName.trim();
    }
    if (result.itemName) {
      result.itemName = result.itemName.trim();
    }

    return result;
  } catch (err: any) {
    logger.error('Groq AI processQuery failed', { error: err?.message });
    return {
      intent: 'unknown',
      partyName: null,
      itemName: null,
      reportType: null,
      response: '⚠️ Kuch technical issue aaya. Phir se try karo ya /help use karo.',
      confidence: 0,
      error: err?.message,
    };
  }
}
