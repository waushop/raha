// Learns categories (and groups) from the user's own ledger. Naive Bayes
// over description tokens: cheap, private, and it gets better every time a
// row is corrected because the next import retrains from the database.
//
// The model is plain JSON so the server can build it and hand it to the
// client-side import preview.
export type ClassifierModel = {
  categories: Record<string, number>;                  // category → rows seen
  tokens: Record<string, Record<string, number>>;      // token → category → count
  groupByCategory: Record<string, Record<string, number>>; // category → group id → count
  vocabulary: number;
};

export type Prediction = { category: string; groupId: string | null; confidence: number };

const MIN_TOKEN = 3;
const STOP = new Set(["card", "payment", "purchase", "pos", "ee", "eesti", "tallinn", "tartu", "and", "the", "ou", "as"]);

export function tokenize(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < MIN_TOKEN || /^\d+$/.test(raw) || STOP.has(raw)) continue;
    out.add(raw);
  }
  return [...out];
}

export function emptyModel(): ClassifierModel {
  return { categories: {}, tokens: {}, groupByCategory: {}, vocabulary: 0 };
}

export function train(rows: Array<{ name: string; category: string; groupId: string | null }>): ClassifierModel {
  const m = emptyModel();
  for (const r of rows) {
    m.categories[r.category] = (m.categories[r.category] ?? 0) + 1;
    if (r.groupId) {
      const g = (m.groupByCategory[r.category] ??= {});
      g[r.groupId] = (g[r.groupId] ?? 0) + 1;
    }
    for (const t of tokenize(r.name)) {
      const bucket = (m.tokens[t] ??= {});
      bucket[r.category] = (bucket[r.category] ?? 0) + 1;
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

  const groups = model.groupByCategory[best];
  const groupId = groups ? Object.entries(groups).sort((a, b) => b[1] - a[1])[0][0] : null;
  return { category: best, groupId, confidence };
}
