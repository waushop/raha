// Receipt scanning, pure side: the JSON schema Claude must answer with, the
// validator for what comes back, and the per-category split of the items.
// Client-safe (the add form uses `splitParts`); the API call lives in
// app/assistant/actions.ts.
import { CATEGORY_KEYS, type CategoryKey } from "@/types/expense";
import { daysInMonth } from "./months";

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const MAX_RECEIPT_ITEMS = 30;
export const RECEIPT_MAX_EDGE = 1600;
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ReceiptMediaType = (typeof RECEIPT_TYPES)[number];

/** Structured-output schema for the model's answer (all fields required, no extras). */
export const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["merchant", "total", "currency", "date", "items", "suggestedCategory", "confidence"],
  properties: {
    merchant: { type: "string", description: "Shop or business name as printed on the receipt" },
    total: { type: "number", description: "Grand total actually paid" },
    currency: { type: "string", description: "ISO 4217 code, e.g. EUR" },
    date: { anyOf: [{ type: "string", format: "date" }, { type: "null" }], description: "Purchase date as YYYY-MM-DD, or null if not legible" },
    items: {
      type: "array",
      description: `Line items, at most ${MAX_RECEIPT_ITEMS}; discounts folded into the item they apply to`,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "amount", "category"],
        properties: {
          name: { type: "string" },
          amount: { type: "number", description: "Line total after discounts" },
          category: { type: "string", enum: CATEGORY_KEYS },
        },
      },
    },
    suggestedCategory: { type: "string", enum: CATEGORY_KEYS },
    confidence: { type: "number", description: "0 to 1: how sure you are about the total and date" },
  },
} as const;

export type ReceiptItem = { name: string; amount: number; category: CategoryKey };

/** A validated scan, before the workspace's rules are applied. */
export type Receipt = {
  merchant: string;
  total: number;
  currency: string;
  date: string | null;
  items: ReceiptItem[];
  suggestedCategory: CategoryKey;
  confidence: number;
  /** Sum of the item amounts. */
  itemsTotal: number;
  /** True when the total and the items disagree by more than 1 %, or confidence is low. */
  check: boolean;
};

/** What scanReceipt hands the add form. */
export type ReceiptScan = Receipt & {
  name: string;
  category: CategoryKey;
  groupId: string | null;
  tags: string | null;
  notes: string | null;
};

export class ReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptError";
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const money = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1_000_000 ? round2(v) : null);
const category = (v: unknown): CategoryKey => ((CATEGORY_KEYS as string[]).includes(v as string) ? (v as CategoryKey) : "other");

/** YYYY-MM-DD that exists and is not more than a day ahead of `today` nor over two years old; else null. */
export function cleanDate(v: unknown, today: string): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const day = Number(m[3]);
  if (day < 1 || day > daysInMonth(`${m[1]}-${m[2]}`)) return null;
  const t = Date.parse(`${today}T00:00:00Z`);
  const d = Date.parse(`${v.trim()}T00:00:00Z`);
  if (d > t + 86_400_000 || d < t - 2 * 366 * 86_400_000) return null;
  return v.trim();
}

/**
 * Checks and normalises the model's JSON. Throws ReceiptError when there is no
 * usable total. Items with a non-finite or zero amount are dropped; at most
 * MAX_RECEIPT_ITEMS are kept.
 */
export function validateReceipt(raw: unknown, today: string): Receipt {
  if (!isObj(raw)) throw new ReceiptError("Couldn't read that receipt");
  const total = money(raw.total);
  if (total === null || total <= 0) throw new ReceiptError("Couldn't find the total on that receipt");
  const items: ReceiptItem[] = (Array.isArray(raw.items) ? raw.items : [])
    .filter(isObj)
    .map((it) => ({ name: str(it.name, 60) || "Item", amount: money(it.amount), category: category(it.category) }))
    .filter((it): it is ReceiptItem => it.amount !== null && it.amount !== 0)
    .slice(0, MAX_RECEIPT_ITEMS);
  const itemsTotal = round2(items.reduce((s, it) => s + it.amount, 0));
  const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : 0;
  const agrees = items.length > 0 && Math.abs(itemsTotal - total) <= total * 0.01;
  const currency = str(raw.currency, 3).toUpperCase();
  return {
    merchant: str(raw.merchant, 120) || "Receipt",
    total,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "EUR",
    date: cleanDate(raw.date, today),
    items,
    suggestedCategory: category(raw.suggestedCategory),
    confidence,
    itemsTotal,
    check: !agrees || confidence < 0.6,
  };
}

/** "Milk 1.29, Bread 2.18, …" — at most `max` characters. */
export function itemNotes(items: ReceiptItem[], max = 200): string | null {
  let out = "";
  for (const it of items) {
    const part = `${it.name} ${it.amount.toFixed(2)}`;
    const next = out ? `${out}, ${part}` : part;
    if (next.length > max - 2) return out ? `${out}, …` : null;
    out = next;
  }
  return out || null;
}

/** Item totals per category, largest first (positive totals only). */
export function categoryTotals(items: ReceiptItem[]): Array<{ category: CategoryKey; amount: number }> {
  const map = new Map<CategoryKey, number>();
  for (const it of items) map.set(it.category, (map.get(it.category) ?? 0) + it.amount);
  return [...map.entries()]
    .map(([c, a]) => ({ category: c, amount: round2(a) }))
    .filter((p) => p.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

/** True when a scan's items fall into two or more categories and agree with the total. */
export function canSplit(r: Pick<Receipt, "items" | "check">): boolean {
  return !r.check && categoryTotals(r.items).length >= 2;
}

/**
 * Split parts for `splitExpense` that add up to exactly `amount` (what was
 * saved, which the user may have corrected): per-category item sums, at most
 * `maxParts` (the smallest are folded into the largest), and the difference
 * to `amount` absorbed by the largest part. Null when that leaves fewer than
 * two positive parts.
 */
export function splitParts(items: ReceiptItem[], amount: number, maxParts = 10): Array<{ category: CategoryKey; amount: number }> | null {
  const totals = categoryTotals(items);
  if (totals.length < 2) return null;
  const parts = totals.slice(0, maxParts).map((p) => ({ ...p }));
  for (const extra of totals.slice(maxParts)) parts[0].amount = round2(parts[0].amount + extra.amount);
  const sum = round2(parts.reduce((s, p) => s + p.amount, 0));
  parts[0].amount = round2(parts[0].amount + round2(amount) - sum);
  if (parts.some((p) => p.amount <= 0)) return null;
  return parts;
}

/** Deterministic scan for AI_MOCK=1 (dev without a key, e2e). Items add up to the total. */
export function mockReceipt(today: string): Receipt {
  return validateReceipt({
    merchant: "RIMI HAABERSTI 1234",
    total: 23.47,
    currency: "EUR",
    date: today,
    items: [
      { name: "Milk", amount: 1.29, category: "groceries" },
      { name: "Bread", amount: 2.18, category: "groceries" },
      { name: "Cheese", amount: 4.5, category: "groceries" },
      { name: "Apples", amount: 7.0, category: "groceries" },
      { name: "Toothpaste", amount: 3.2, category: "personal" },
      { name: "Shampoo", amount: 5.3, category: "personal" },
    ],
    suggestedCategory: "groceries",
    confidence: 0.92,
  }, today);
}

/** Sniffs the first bytes: the declared type must match the actual image format. */
export function sniffImageType(bytes: Uint8Array): ReceiptMediaType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
