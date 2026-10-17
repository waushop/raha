// The `/add?amount=&name=&category=&tags=&kind=` deep link (Siri Shortcuts,
// Android intents, the manifest's "Add expense" shortcut). Every parameter is
// validated on its own and dropped when invalid; `complete` says whether there
// is enough to create the row straight away (a valid name and amount).
import type { CategoryKey, Kind } from "@/types/expense";
import { parseAmount, parseCategory, parseName, parseTagsText } from "./validate";

export type AddPrefill = {
  name?: string;
  amount?: number;
  category?: CategoryKey;
  tags?: string;
  kind?: Kind;
};

type Params = { get(name: string): string | null };

function tryParse<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

export function parseAddLink(params: Params): { prefill: AddPrefill; complete: boolean } {
  const raw = (k: string) => params.get(k) ?? "";
  const prefill: AddPrefill = {};
  const name = raw("name").trim() ? tryParse(() => parseName(raw("name"))) : undefined;
  if (name) prefill.name = name;
  const amount = raw("amount").trim() ? tryParse(() => parseAmount(raw("amount"))) : undefined;
  if (amount !== undefined) prefill.amount = amount;
  const category = tryParse(() => parseCategory(raw("category")));
  if (category) prefill.category = category;
  const tags = tryParse(() => parseTagsText(raw("tags")));
  if (tags) prefill.tags = tags;
  const kind = raw("kind").trim();
  if (kind === "income" || kind === "expense") prefill.kind = kind;
  return { prefill, complete: prefill.name !== undefined && prefill.amount !== undefined };
}

/** Query string for the month view's prefilled add form (`/?add=1&…`). */
export function prefillQuery(p: AddPrefill): string {
  const q = new URLSearchParams({ add: "1" });
  for (const [k, v] of Object.entries(p)) if (v !== undefined) q.set(k, String(v));
  return q.toString();
}
