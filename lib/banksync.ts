// Bank sync, the pure part: turn Enable Banking transactions into ledger
// rows and decide, per transaction, whether it is already in the ledger
// (skip), was typed in by hand (link the existing row) or is new (insert).
// The database side lives in lib/banksync-db.ts.
import { createHash } from "node:crypto";
import type { BankBalance, BankTransaction } from "./enablebanking";
import type { Kind, CategoryKey } from "@/types/expense";
import { cleanMerchant } from "./merchants";
import { applyRules, type Rule } from "./rules";
import { classifyTransactions, type ParsedTransaction } from "./import-parser";
import type { ClassifierModel } from "./classifier";

export type MappedTx = {
  externalId: string;
  /** YYYY-MM-DD */
  date: string;
  month: string;
  day: number;
  /** Always positive; `kind` carries the direction. */
  amount: number;
  currency: string;
  kind: Kind;
  /** Counterparty name and remittance text, for NOTES and rule matching. */
  rawText: string;
  merchant: string;
  pending: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** Maps one bank transaction; null when it has no usable date or amount. */
export function mapTransaction(tx: BankTransaction): MappedTx | null {
  const date = [tx.booking_date, tx.value_date, tx.transaction_date].find((d): d is string => typeof d === "string" && DATE_RE.test(d))?.slice(0, 10);
  const signed = Number(tx.transaction_amount?.amount);
  if (!date || !Number.isFinite(signed) || signed === 0) return null;
  const kind: Kind = tx.credit_debit_indicator === "CRDT" ? "income" : tx.credit_debit_indicator === "DBIT" ? "expense" : signed < 0 ? "expense" : "income";
  const amount = Math.round(Math.abs(signed) * 100) / 100;
  const counterparty = (kind === "expense" ? tx.creditor?.name : tx.debtor?.name)?.trim() || "";
  const remittance = (tx.remittance_information ?? []).map((s) => s.trim()).filter(Boolean).join(" ");
  const rawText = [counterparty, remittance].filter(Boolean).join(" — ") || (tx.note ?? "").trim() || "Bank transaction";
  const externalId = tx.transaction_id?.trim() || tx.entry_reference?.trim()
    || `h:${createHash("sha256").update(`${date}|${kind}|${amount.toFixed(2)}|${rawText}`).digest("hex").slice(0, 24)}`;
  const pending = tx.status ? tx.status !== "BOOK" : !tx.booking_date;
  return {
    externalId, date, month: date.slice(0, 7), day: Number(date.slice(8, 10)), amount,
    currency: tx.transaction_amount.currency || "EUR", kind, rawText, merchant: cleanMerchant(counterparty || rawText), pending,
  };
}

/**
 * Maps a batch. Transactions without a bank id get a content hash; two
 * identical ones on the same day (two coffees) are told apart by their
 * order in the statement (#2, #3 …), which is stable as long as a sync
 * window always covers whole days.
 */
export function mapTransactions(txs: BankTransaction[]): MappedTx[] {
  const seen = new Map<string, number>();
  const out: MappedTx[] = [];
  for (const t of txs) {
    const m = mapTransaction(t);
    if (!m) continue;
    if (m.externalId.startsWith("h:") && !m.pending) {
      const n = (seen.get(m.externalId) ?? 0) + 1;
      seen.set(m.externalId, n);
      if (n > 1) m.externalId = `${m.externalId}#${n}`;
    }
    out.push(m);
  }
  return out;
}

export type ExistingRow = {
  ID: string;
  MONTH: string;
  DAY: number | null;
  AMOUNT: number;
  KIND: Kind;
  EXTERNAL_ID: string | null;
  /** Soft-deleted rows still own their EXTERNAL_ID (a deleted bank row stays deleted) but are never linked. */
  DELETED?: boolean;
};

export type Decision =
  | { action: "skip"; tx: MappedTx; rowId: string | null }
  | { action: "link"; tx: MappedTx; rowId: string }
  | { action: "insert"; tx: MappedTx }
  | { action: "pending"; tx: MappedTx };

export const AMOUNT_TOLERANCE = 0.005;
export const DAY_TOLERANCE = 3;

/**
 * One decision per transaction. A booked transaction whose id is already in
 * the ledger is skipped; otherwise a hand-entered row (no EXTERNAL_ID) in the
 * same month with the same kind and amount, and no day or a day within ±3,
 * is linked — the closest day wins and each row is claimed once; otherwise
 * it is inserted. Pending transactions are never written.
 */
export function reconcile(bankTxs: MappedTx[], existingRows: ExistingRow[]): Decision[] {
  const byExternal = new Map<string, string>();
  for (const r of existingRows) if (r.EXTERNAL_ID) byExternal.set(r.EXTERNAL_ID, r.ID);
  const candidates = existingRows.filter((r) => !r.EXTERNAL_ID && !r.DELETED);
  const claimed = new Set<string>();
  const decided = new Set<string>();
  const ordered = [...bankTxs].sort((a, b) => a.date.localeCompare(b.date));
  const out: Decision[] = [];
  for (const tx of ordered) {
    if (tx.pending) { out.push({ action: "pending", tx }); continue; }
    const known = byExternal.get(tx.externalId);
    if (known !== undefined || decided.has(tx.externalId)) { out.push({ action: "skip", tx, rowId: known ?? null }); continue; }
    decided.add(tx.externalId);
    const distance = (r: ExistingRow) => (r.DAY === null ? DAY_TOLERANCE + 0.5 : Math.abs(r.DAY - tx.day));
    const match = candidates
      .filter((r) => !claimed.has(r.ID) && r.MONTH === tx.month && r.KIND === tx.kind && Math.abs(r.AMOUNT - tx.amount) <= AMOUNT_TOLERANCE + 1e-9
        && (r.DAY === null || Math.abs(r.DAY - tx.day) <= DAY_TOLERANCE))
      .sort((a, b) => distance(a) - distance(b))[0];
    if (match) {
      claimed.add(match.ID);
      out.push({ action: "link", tx, rowId: match.ID });
    } else {
      out.push({ action: "insert", tx });
    }
  }
  return out;
}

export type NewRow = {
  category: CategoryKey;
  groupId: string | null;
  name: string;
  tags: string | null;
  isRecurring: boolean;
};

/**
 * Category and name for a transaction about to be inserted: the user's rules
 * first (they may also rename, tag and mark recurring), then the classifier
 * trained on the ledger, then the import keyword guesses. Income only takes
 * rules (the classifier learns from expenses).
 */
export function categorize(tx: MappedTx, rules: Rule[], model: ClassifierModel | null): NewRow {
  const text = `${tx.merchant} ${tx.rawText}`;
  if (tx.kind === "income") {
    const patch = applyRules(rules, { text, amount: tx.amount });
    return {
      category: (patch?.category as CategoryKey | undefined) ?? "other",
      groupId: patch?.groupId ?? null,
      name: patch?.name ?? tx.merchant,
      tags: patch?.tags ?? null,
      isRecurring: patch?.isRecurring ?? false,
    };
  }
  const parsed: ParsedTransaction = {
    date: tx.date, month: tx.month, description: text, amount: tx.amount, currency: tx.currency, isIncome: false,
    category: "other", confidence: "none", merchant: tx.merchant,
  };
  const [c] = classifyTransactions([parsed], rules, model);
  return { category: c.category, groupId: c.groupId ?? null, name: c.name ?? tx.merchant, tags: c.tags ?? null, isRecurring: c.isRecurring ?? false };
}

const BALANCE_PREFERENCE = ["CLBD", "ITBD", "XPCD", "ITAV", "CLAV", "OPBD", "OPAV", "PRCD", "VALU", "INFO", "OTHR", "FWAV"];

/** The balance to record: booked (CLBD/ITBD) first, then expected/available. Null when none is usable. */
export function pickBalance(balances: BankBalance[]): { amount: number; type: string } | null {
  const usable = balances
    .map((b) => ({ amount: Number(b.balance_amount?.amount), type: b.balance_type }))
    .filter((b) => Number.isFinite(b.amount));
  if (usable.length === 0) return null;
  const rank = (t: string) => { const i = BALANCE_PREFERENCE.indexOf(t); return i < 0 ? 99 : i; };
  return usable.sort((a, b) => rank(a.type) - rank(b.type))[0];
}

/** Sync window start: max(SYNC_FROM, LAST_BOOKING_DATE − 5 days); 90 days back when neither is set. */
export function syncWindowStart(syncFrom: string | null, lastBooking: string | null, today: string, overlapDays = 5): string {
  const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const fromLast = lastBooking ? shift(lastBooking, -overlapDays) : null;
  const candidates = [syncFrom, fromLast].filter((d): d is string => !!d);
  if (candidates.length === 0) return shift(today, -90);
  return candidates.sort().at(-1)!;
}

export { maskIban, daysLeft } from "./bank-format";
