// Parses one-line quick entries: "coffee 3.5 #work", "3,50 coffee",
// "+2850 salary" (income), "lunch 12 #work #client". Pure.
import { formatTags, parseTags } from "./tags";

export type QuickAdd = { name: string; amount: number; kind: "expense" | "income"; tags: string | null };

export function parseQuickAdd(input: string): QuickAdd | null {
  const text = input.trim();
  if (!text) return null;
  const tokens = text.split(/\s+/);
  const tags: string[] = [];
  const words: string[] = [];
  let amount: number | null = null;
  let kind: "expense" | "income" = "expense";
  for (const t of tokens) {
    if (t.startsWith("#") && t.length > 1) { tags.push(t); continue; }
    const m = /^([+-])?(\d+(?:[.,]\d{1,2})?)(?:€|eur)?$/i.exec(t);
    if (m && amount === null) {
      amount = Number(m[2].replace(",", "."));
      if (m[1] === "+") kind = "income";
      continue;
    }
    words.push(t);
  }
  if (amount === null || !(amount > 0) || words.length === 0) return null;
  const name = words.join(" ").replace(/\s+/g, " ").trim();
  if (name.length > 120) return null;
  const parsed = parseTags(tags.join(" "));
  return { name, amount: Math.round(amount * 100) / 100, kind, tags: parsed.length ? formatTags(parsed) : null };
}
