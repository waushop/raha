// Rules: "when the text matches X (and the amount is in range), set category /
// group / name / tags / recurring". They live in IMPORT_PATTERN (the table
// predates the extra columns) and run on CSV import, on "apply to existing
// rows", and — name + tags only — on manual entry. Pure module.
export type Rule = {
  ID: string;
  PATTERN: string;
  CATEGORY: string;
  GROUP_ID: string | null;
  PRIORITY: number;
  SET_NAME: string | null;
  SET_TAGS: string | null;
  /** 1 = mark recurring, 0 = mark not recurring, null = leave alone. */
  SET_RECURRING: number | null;
  AMOUNT_MIN: number | null;
  AMOUNT_MAX: number | null;
};

export type RuleInput = { text: string; amount: number };

export type RulePatch = {
  ruleId: string;
  category: string;
  groupId: string | null;
  name?: string;
  tags?: string;
  isRecurring?: boolean;
};

function textMatches(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return text.toLowerCase().includes(pattern.toLowerCase());
  }
}

export function ruleMatches(rule: Rule, input: RuleInput): boolean {
  if (rule.AMOUNT_MIN !== null && input.amount < rule.AMOUNT_MIN) return false;
  if (rule.AMOUNT_MAX !== null && input.amount > rule.AMOUNT_MAX) return false;
  return textMatches(rule.PATTERN, input.text);
}

/** The highest-priority matching rule, as a patch to apply. */
export function applyRules(rules: Rule[], input: RuleInput): RulePatch | null {
  const sorted = [...rules].sort((a, b) => b.PRIORITY - a.PRIORITY);
  const hit = sorted.find((r) => ruleMatches(r, input));
  if (!hit) return null;
  const patch: RulePatch = { ruleId: hit.ID, category: hit.CATEGORY, groupId: hit.GROUP_ID };
  if (hit.SET_NAME) patch.name = hit.SET_NAME;
  if (hit.SET_TAGS) patch.tags = hit.SET_TAGS;
  if (hit.SET_RECURRING !== null) patch.isRecurring = hit.SET_RECURRING === 1;
  return patch;
}

/** Escapes a merchant name for use as a literal pattern. */
export function literalPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
