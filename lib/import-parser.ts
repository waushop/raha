import type { CategoryKey } from "@/types/expense";
import { predict, type ClassifierModel } from "./classifier";
import { applyRules, type Rule } from "./rules";
import { cleanMerchant } from "./merchants";

export type ParsedTransaction = {
  date: string;          // YYYY-MM-DD
  month: string;         // YYYY-MM
  description: string;   // beneficiary + details
  amount: number;        // always positive (expenses)
  currency: string;
  isIncome: boolean;
  category: CategoryKey;
  confidence: "pattern" | "learned" | "guess" | "manual" | "none";
  patternId?: string;    // which rule matched
  groupId?: string | null; // suggested by a rule or the learned model
  merchant: string;      // cleanMerchant(description): what a human would type
  name?: string;         // rename from the matching rule (SET_NAME)
  tags?: string | null;  // tags from the matching rule (SET_TAGS)
  isRecurring?: boolean; // recurring flag from the matching rule (SET_RECURRING)
};

/** Rules live in lib/rules.ts; the old name is kept for callers. */
export type ImportPattern = Rule;

/**
 * Parse Swedbank Estonia CSV export.
 *
 * Format (semicolon-separated):
 *   Client account; Row type; Date; Beneficiary/Payer; Details; Amount; Currency; D/K; Ref; Type; RefNo; DocNo
 *
 * - Date format: DD.MM.YYYY
 * - Amount uses comma as decimal separator
 * - D = debit (expense), K = credit (income)
 * - Row types AS/LS = opening/closing balance (skip)
 * - Type K2 = card authorization hold (skip)
 */
export function parseSwedbankCSV(csv: string): ParsedTransaction[] {
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const results: ParsedTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i], ";");
    if (fields.length < 8) continue;

    const rowType = fields[1]?.trim();
    // Skip opening/closing balance rows and card holds
    if (["AS", "LS"].includes(rowType)) continue;

    const txType = fields[9]?.trim();
    if (txType === "K2") continue;

    const dateStr = fields[2]?.trim();
    const beneficiary = fields[3]?.trim();
    const details = fields[4]?.trim();
    const amountStr = fields[5]?.trim().replace(",", ".");
    const currency = fields[6]?.trim() || "EUR";
    const dcIndicator = fields[7]?.trim(); // D or K

    const amount = Math.abs(parseFloat(amountStr));
    if (isNaN(amount) || amount === 0) continue;

    const isIncome = dcIndicator === "K";

    // Parse DD.MM.YYYY to YYYY-MM-DD
    const date = parseDate(dateStr);
    if (!date) continue;

    const month = date.substring(0, 7);
    const description = [beneficiary, details].filter(Boolean).join(" — ");

    results.push({
      date,
      month,
      description,
      merchant: cleanMerchant(description),
      amount,
      currency,
      isIncome,
      category: "other",
      confidence: "none",
    });
  }

  return results;
}

/**
 * Try to auto-detect CSV format. Falls back to simple comma-separated.
 * Returns parsed transactions regardless of format.
 */
export function parseGenericCSV(csv: string): ParsedTransaction[] {
  const firstLine = csv.split(/\r?\n/)[0] || "";

  // Detect Swedbank format: semicolon-separated with typical headers
  if (firstLine.includes(";") && (
    firstLine.toLowerCase().includes("client account") ||
    firstLine.toLowerCase().includes("kliendi konto")
  )) {
    return parseSwedbankCSV(csv);
  }

  // Simple format: Date, Name, Amount (comma or semicolon separated)
  const sep = firstLine.includes(";") ? ";" : ",";
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  const results: ParsedTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i], sep);
    if (fields.length < 3) continue;

    const dateStr = fields[0]?.trim();
    const description = fields[1]?.trim().replace(/^"|"$/g, "");
    const amountStr = fields[2]?.trim().replace(",", ".");
    const amount = Math.abs(parseFloat(amountStr));

    if (!description || isNaN(amount) || amount === 0) continue;

    const date = parseDate(dateStr);
    const isIncome = parseFloat(amountStr) > 0;

    results.push({
      date: date || dateStr,
      month: date ? date.substring(0, 7) : "",
      description,
      merchant: cleanMerchant(description),
      amount,
      currency: "EUR",
      isIncome,
      category: "other",
      confidence: "none",
    });
  }

  return results;
}

/**
 * Auto-categorise parsed transactions: user rules first (lib/rules.ts), then
 * the model learned from the ledger, then built-in keyword guesses.
 */
export function classifyTransactions(
  transactions: ParsedTransaction[],
  rules: Rule[],
  model?: ClassifierModel | null,
): ParsedTransaction[] {
  return transactions.map(tx => {
    const patch = applyRules(rules, { text: tx.description, amount: tx.amount });
    if (patch) {
      const out: ParsedTransaction = {
        ...tx,
        category: patch.category as CategoryKey,
        confidence: "pattern",
        patternId: patch.ruleId,
        groupId: patch.groupId,
      };
      if (patch.name !== undefined) out.name = patch.name;
      if (patch.tags !== undefined) out.tags = patch.tags;
      if (patch.isRecurring !== undefined) out.isRecurring = patch.isRecurring;
      return out;
    }

    // Learned from the user's own history (beats generic keyword guesses).
    if (model) {
      const learned = predict(model, tx.description);
      if (learned) {
        return { ...tx, category: learned.category as CategoryKey, confidence: "learned", groupId: learned.groupId };
      }
    }

    // Guess based on common keywords
    const guessed = guessCategory(tx.description.toLowerCase());
    if (guessed) {
      return { ...tx, category: guessed, confidence: "guess" };
    }

    return tx;
  });
}

function guessCategory(desc: string): CategoryKey | null {
  const rules: [RegExp, CategoryKey][] = [
    [/selver|rimi|coop|prisma|maxima|lidl|grossi|konsum|s[öo]?k/i, "groceries"],
    [/circle\s?k|neste|terminal|olerex|alexela/i, "fuel"],
    [/bolt\s?(food|taxi)?|wolt|uber\s?eat/i, "dining"],
    [/mcdonalds|hesburger|subway|burger|pizza|restoran|kohvik|cafe|restaurant/i, "dining"],
    [/netflix|spotify|disney|hbo|youtube|apple.*music|audible/i, "subscriptions"],
    [/telia|elisa|tele2/i, "phone"],
    [/starman|inet/i, "internet"],
    [/apotheka|apteek|pharmacy|benu/i, "health"],
    [/h&m|zara|reserved|new\s?yorker/i, "clothing"],
    [/lasteaed|kool|school|kindergarten/i, "education"],
    [/laste|kids|baby|pampers/i, "kids"],
    [/bauhaus|espak|k-rauta|decora|bauhof/i, "maintenance"],
    [/ergo|salva|if\s|gjensidige|kindlustus|insurance/i, "insurance"],
    [/\u00fc\u00fcri|rent|laen|pangalaen|mortgage/i, "housing"],
    [/apollo|pilet|cinema|kino|kontsert|ticket/i, "entertainment"],
    [/sportland|myfit|gym|j[o\u00f5]usaal/i, "sports"],
    [/maks.*amet|emta|tax/i, "tax"],
    [/transfer|\u00fclekanne|saving/i, "savings"],
    [/bolt\s?drive|takso|taxi|transport/i, "transport"],
  ];

  for (const [pattern, cat] of rules) {
    if (pattern.test(desc)) return cat;
  }
  return null;
}

function parseDate(str: string): string | null {
  if (!str) return null;

  // DD.MM.YYYY
  const dotMatch = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;

  // YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return str;

  // YYYYMMDD
  const compactMatch = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;

  return null;
}

function parseCSVLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === sep && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
