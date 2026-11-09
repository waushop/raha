// Learns categories (and groups) from the user's own ledger. Naive Bayes
// over description tokens: cheap, private, and it gets better every time a
// row is corrected because the next import retrains from the database.
//
// The model is plain JSON so the server can build it and hand it to the
// client-side import preview.
export type ClassifierModel = {
  categories: Record<string, number>;                  // category → rows seen
  tokens: Record<string, Record<string, number>>;      // token → category → count
  // token → category → group id → count. Groups come from the tokens that
  // matched, never from the category alone: "maintenance" rows mostly living
  // under Car must not drag a hardware store there.
  tokenGroups: Record<string, Record<string, Record<string, number>>>;
  // normalised name → "category|groupId" → count: exact merchants seen before.
  merchants: Record<string, Record<string, number>>;
  vocabulary: number;
};

export type Prediction = { category: string; groupId: string | null; confidence: number };

const MIN_TOKEN = 3;
const STOP = new Set([
  "card", "payment", "purchase", "pos", "ee", "eesti", "and", "the", "ou", "as",
  // Places say where, not what: a shop and a petrol station in the same district share nothing.
  "tallinn", "tartu", "pärnu", "parnu", "narva", "viljandi", "rakvere", "haapsalu", "kuressaare", "jõhvi", "maardu", "keila", "saue",
  "mustamäe", "lasnamäe", "kristiine", "haabersti", "õismäe", "kesklinn", "pirita", "nõmme", "kadaka", "ülemiste", "kopli", "annelinn",
]);

export function tokenize(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < MIN_TOKEN || /^\d+$/.test(raw) || STOP.has(raw)) continue;
    out.add(raw);
  }
  return [...out];
}

/**
 * Rows to learn from (expenses of one workspace, bind the workspace id). Rows
 * bank sync filed by itself and nobody has touched since are left out, so a
 * wrong guess is not learned back and repeated on the next sync.
 */
export const TRAINING_ROWS_SQL = `SELECT NAME, CATEGORY, GROUP_ID FROM LEDGER L
  WHERE L.WORKSPACE_ID = ? AND L.KIND = 'expense' AND L.DELETED_AT IS NULL
    AND NOT (L.EXTERNAL_ID IS NOT NULL AND L.NOTES LIKE 'Bank:%'
      AND NOT EXISTS (SELECT 1 FROM LEDGER_AUDIT A WHERE A.LEDGER_ID = L.ID AND A.ACTION = 'update'))`;

export function emptyModel(): ClassifierModel {
  return { categories: {}, tokens: {}, tokenGroups: {}, merchants: {}, vocabulary: 0 };
}

/** Name key for exact-merchant memory: lower case, letters and digits only. */
export function merchantKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function train(rows: Array<{ name: string; category: string; groupId: string | null }>): ClassifierModel {
  const m = emptyModel();
  for (const r of rows) {
    m.categories[r.category] = (m.categories[r.category] ?? 0) + 1;
    const key = merchantKey(r.name);
    if (key) {
      const seen = (m.merchants[key] ??= {});
      const label = `${r.category}|${r.groupId ?? ""}`;
      seen[label] = (seen[label] ?? 0) + 1;
    }
    for (const t of tokenize(r.name)) {
      const bucket = (m.tokens[t] ??= {});
      bucket[r.category] = (bucket[r.category] ?? 0) + 1;
      if (r.groupId) {
        const g = ((m.tokenGroups[t] ??= {})[r.category] ??= {});
        g[r.groupId] = (g[r.groupId] ?? 0) + 1;
      }
    }
  }
  m.vocabulary = Object.keys(m.tokens).length;
  return m;
}

/**
 * Returns the most likely category when the description shares at least one
 * known token and the winner is clearly ahead; otherwise null so the caller
 * can fall back to keyword guesses.
 */
export function predict(model: ClassifierModel, description: string, minConfidence = 0.6): Prediction | null {
  const tokens = tokenize(description).filter((t) => model.tokens[t]);
  if (tokens.length === 0) return null;
  const total = Object.values(model.categories).reduce((s, v) => s + v, 0);
  if (total === 0) return null;

  const scores: Record<string, number> = {};
  for (const [cat, n] of Object.entries(model.categories)) {
    let score = Math.log(n / total);
    // Tokens seen for this category, Laplace-smoothed over the vocabulary.
    const catTokenTotal = Object.values(model.tokens).reduce((s, b) => s + (b[cat] ?? 0), 0);
    for (const t of tokens) {
      score += Math.log(((model.tokens[t][cat] ?? 0) + 1) / (catTokenTotal + model.vocabulary + 1));
    }
    scores[cat] = score;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0];
  // Softmax over the top two gives a usable 0..1 confidence.
  const second = ranked[1]?.[1] ?? bestScore - 10;
  const confidence = 1 / (1 + Math.exp(second - bestScore));
  if (confidence < minConfidence) return null;

  const groupVotes: Record<string, number> = {};
  for (const t of tokens) {
    for (const [g, n] of Object.entries(model.tokenGroups[t]?.[best] ?? {})) groupVotes[g] = (groupVotes[g] ?? 0) + n;
  }
  const groupId = Object.entries(groupVotes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { category: best, groupId, confidence };
}

/**
 * The category and group this exact merchant had before (majority of its
 * rows, at least two thirds of them), or null for a merchant never seen or
 * filed inconsistently.
 */
export function recall(model: ClassifierModel, name: string): Prediction | null {
  const seen = model.merchants?.[merchantKey(name)];
  if (!seen) return null;
  const total = Object.values(seen).reduce((a, b) => a + b, 0);
  const [label, n] = Object.entries(seen).sort((a, b) => b[1] - a[1])[0];
  if (n / total < 2 / 3) return null;
  const [category, groupId] = label.split("|");
  return { category, groupId: groupId || null, confidence: n / total };
}
