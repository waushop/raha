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
  // "source" = category mapped from another budgeting app's own category.
  confidence: "pattern" | "learned" | "source" | "guess" | "manual" | "none";
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
  csv = csv.replace(/^\uFEFF/, "");
  const firstLine = csv.split(/\r?\n/)[0] || "";

  switch (detectCSVFormat(csv)) {
    case "swedbank": return parseSwedbankCSV(csv);
    case "ynab": return parseYNABCSV(csv);
    case "everydollar": return parseEveryDollarCSV(csv);
    case "rocketmoney": return parseRocketMoneyCSV(csv);
    case "generic": break;
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

export type CSVFormat = "swedbank" | "ynab" | "everydollar" | "rocketmoney" | "generic";

export const CSV_FORMAT_LABELS: Record<CSVFormat, string> = {
  swedbank: "Swedbank statement",
  ynab: "YNAB export",
  everydollar: "EveryDollar export",
  rocketmoney: "Rocket Money export",
  generic: "Date, Name, Amount CSV",
};

/** Sniff the header row to tell which app or bank produced the CSV. */
export function detectCSVFormat(csv: string): CSVFormat {
  const firstLine = (csv.replace(/^\uFEFF/, "").split(/\r?\n/)[0] || "");
  const lower = firstLine.toLowerCase();
  if (lower.includes(";") && (lower.includes("client account") || lower.includes("kliendi konto"))) return "swedbank";
  const cols = new Set(parseCSVLine(firstLine, firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",").map(normHeader));
  if (cols.has("payee") && cols.has("outflow") && cols.has("inflow")) return "ynab";
  if (cols.has("original date") && cols.has("account name") && cols.has("amount") && (cols.has("custom name") || cols.has("institution name"))) return "rocketmoney";
  if (cols.has("date") && cols.has("amount") && (cols.has("description") || cols.has("merchant")) && (cols.has("budget item") || cols.has("budget group"))) return "everydollar";
  return "generic";
}

function normHeader(h: string): string {
  return h.trim().replace(/^"|"$/g, "").toLowerCase();
}

/** Header-indexed rows: [{ "date": "...", "payee": "..." }, ...]. */
function readTable(csv: string): Record<string, string>[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0].includes(",") ? "," : ";";
  const header = parseCSVLine(lines[0], sep).map(normHeader);
  return lines.slice(1).map((line) => {
    const fields = parseCSVLine(line, sep);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = (fields[i] ?? "").trim(); });
    return row;
  });
}

/** "$1,234.56", "(12.00)", "-3,50", "1 234,50 €" → signed number (NaN when unreadable). */
export function parseMoney(raw: string): number {
  let s = (raw ?? "").trim();
  if (!s) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[^\d.,\-]/g, "");
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  s = s.replace(/-/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // Comma is the decimal separator when followed by 1–2 digits ("3,50");
    // otherwise it groups thousands ("1,234").
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : negative ? -n : n;
}

// Other apps' category names → our keys. First match wins, so the more
// specific words come before the broad ones ("auto insurance" → insurance,
// "kids activities" → kids before "entertainment").
const SOURCE_CATEGORY_KEYWORDS: [RegExp, CategoryKey][] = [
  [/insurance/, "insurance"],
  [/\btax(es)?\b/, "tax"],
  [/child ?care|daycare|kindergarten|\bkids?\b|children|baby|babysit/, "kids"],
  [/\bpets?\b|veterinar|\bvet\b/, "pets"],
  [/grocer|supermarket/, "groceries"],
  [/dining|restaurant|eating out|fast food|coffee|takeout|food delivery|\bbars?\b/, "dining"],
  [/\bgas\b|fuel|petrol/, "fuel"],
  [/maintenance|repair|home improvement/, "maintenance"],
  [/\brent\b|mortgage|housing|\bhome\b/, "housing"],
  [/phone|mobile|\bcell\b/, "phone"],
  [/internet|broadband|wifi/, "internet"],
  [/utilit|electric|water|heating|energy|trash/, "utilities"],
  [/health|medical|doctor|dentist|pharmacy|wellness/, "health"],
  [/subscription|streaming|software|membership/, "subscriptions"],
  [/travel|vacation|holiday|hotel|flight|airfare/, "travel"],
  [/clothing|apparel|shopping/, "clothing"],
  [/gift|donation|charit|giving/, "gifts"],
  [/education|tuition|school|books|course/, "education"],
  [/gym|fitness|\bsports?\b/, "sports"],
  [/auto|\bcar\b|vehicle|transport|parking|transit|taxi|ride ?share|uber|lyft/, "transport"],
  [/entertainment|\bfun\b|hobb|movies|music|games/, "entertainment"],
  [/saving|invest|emergency fund|retirement/, "savings"],
  [/loan|debt|credit card payment|student loan/, "loan"],
  [/personal|hair|beauty|self.?care/, "personal"],
];

/** Map another app's category label ("Category Group: Category" style too) to one of ours. */
export function mapSourceCategory(label: string): CategoryKey {
  const s = (label ?? "").toLowerCase().trim();
  if (!s) return "other";
  for (const [re, key] of SOURCE_CATEGORY_KEYWORDS) if (re.test(s)) return key;
  return "other";
}

function sourceTx(date: string | null, description: string, signed: number, categoryLabel: string, isIncome: boolean): ParsedTransaction | null {
  const amount = Math.abs(signed);
  if (!date || !description || isNaN(amount) || amount === 0) return null;
  const category = isIncome ? "other" : mapSourceCategory(categoryLabel);
  return {
    date,
    month: date.substring(0, 7),
    description,
    merchant: cleanMerchant(description),
    amount: Math.round(amount * 100) / 100,
    currency: "EUR",
    isIncome,
    category,
    confidence: category === "other" ? "none" : "source",
  };
}

/**
 * YNAB register export: Account, Flag, Date, Payee, Category Group/Category,
 * Category Group, Category, Memo, Outflow, Inflow, Cleared. Outflow is an
 * expense, Inflow income; transfers between accounts ("Transfer : …") are skipped.
 */
export function parseYNABCSV(csv: string): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  for (const r of readTable(csv)) {
    const payee = r["payee"] ?? "";
    if (/^transfer\s*:/i.test(payee)) continue;
    const outflow = parseMoney(r["outflow"] ?? "");
    const inflow = parseMoney(r["inflow"] ?? "");
    const signed = (isNaN(inflow) ? 0 : inflow) - (isNaN(outflow) ? 0 : outflow);
    const memo = r["memo"] ?? "";
    const description = [payee, memo].filter(Boolean).join(" — ") || memo;
    const category = r["category"] || r["category group/category"] || r["category group"] || "";
    const tx = sourceTx(parseDate(r["date"] ?? ""), description, signed, category, signed > 0);
    if (tx) out.push(tx);
  }
  return out;
}

/**
 * EveryDollar transaction export: Date, Description, Amount, Budget Item
 * (sometimes also Budget Group / Type). Negative amount = expense, positive
 * = income, matching how the app shows them.
 */
export function parseEveryDollarCSV(csv: string): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  for (const r of readTable(csv)) {
    const signed = parseMoney(r["amount"] ?? "");
    const type = (r["type"] ?? "").toLowerCase();
    const isIncome = type === "income" || type === "credit" ? true : type === "expense" || type === "debit" ? false : signed > 0;
    const category = [r["budget group"], r["budget item"]].filter(Boolean).join(": ");
    const description = r["description"] || r["merchant"] || "";
    const tx = sourceTx(parseDate(r["date"] ?? ""), description, signed, category, isIncome);
    if (tx) out.push(tx);
  }
  return out;
}

/**
 * Rocket Money transaction export: Date, Original Date, Account Type, Account
 * Name, Account Number, Institution Name, Name, Custom Name, Amount,
 * Description, Category, Note, Ignored From, Tax Deductible.
 *
 * Sign convention assumed: Rocket Money exports money leaving the account as a
 * positive amount and money coming in as negative. The "Income" category (or
 * "Paycheck"/"Refund" style categories) overrides the sign, so a file written
 * with the opposite convention still lands paychecks on the income side.
 * Rows marked "Ignored From" everything and internal transfers are skipped.
 */
export function parseRocketMoneyCSV(csv: string): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  for (const r of readTable(csv)) {
    const ignored = (r["ignored from"] ?? "").toLowerCase();
    if (ignored === "everything") continue;
    const category = r["category"] ?? "";
    if (/^(internal )?transfers?$|credit card payment/i.test(category)) continue;
    const signed = parseMoney(r["amount"] ?? "");
    const incomeCategory = /income|paycheck|salary|refund|reimburse/i.test(category);
    const isIncome = incomeCategory || signed < 0;
    const name = r["custom name"] || r["name"] || r["description"] || "";
    const description = [name, r["note"]].filter(Boolean).join(" — ");
    const tx = sourceTx(parseDate(r["date"] || r["original date"] || ""), description, signed, category, isIncome);
    if (tx) out.push(tx);
  }
  return out;
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

    // The exporting app already categorised it: trust that over our guesses.
    if (tx.confidence === "source") return tx;

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

export function parseDate(str: string): string | null {
  str = (str ?? "").trim().replace(/^"|"$/g, "");
  if (!str) return null;

  // DD.MM.YYYY
  const dotMatch = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;

  // YYYY-MM-DD (also with a time part)
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // MM/DD/YYYY (US exports: YNAB, EveryDollar, Rocket Money), M/D/YY too
  const usMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (usMatch) {
    const year = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
    const mm = Number(usMatch[1]), dd = Number(usMatch[2]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

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
