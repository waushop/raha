"use client";

import { useState, useTransition, useCallback } from "react";
import { importTransactions, createImportPattern } from "@/app/actions";
import type { ImportPatternRow } from "@/app/actions";
import type { ParsedTransaction } from "@/lib/import-parser";
import type { ClassifierModel } from "@/lib/classifier";
import { parseGenericCSV, classifyTransactions } from "@/lib/import-parser";
import { applyRules, literalPattern, type Rule } from "@/lib/rules";
import { CATEGORIES, CATEGORY_KEYS } from "@/types/expense";
import type { CategoryKey, ExpenseGroup } from "@/types/expense";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import CategoryIcon from "@/components/CategoryIcon";
import RulesEditor from "./RulesEditor";
import { Check, Upload, Repeat } from "lucide-react";

type Props = {
  patterns: ImportPatternRow[];
  groups: ExpenseGroup[];
  model: ClassifierModel;
};

type Step = "upload" | "preview" | "done";

export default function ImportFlow({ patterns: initialPatterns, groups, model }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [patterns, setPatterns] = useState(initialPatterns);
  const [openPicker, setOpenPicker] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [importedCount, setImportedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const toast = useToast();

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const csv = e.target?.result as string;
      const parsed = parseGenericCSV(csv).filter(tx => tx.month);
      if (parsed.length === 0) {
        toast.showError("No transactions found in that file. Expected Swedbank CSV or Date,Name,Amount.");
        return;
      }
      // Income rows (credits) are kept and imported as income.
      const classified = classifyTransactions(parsed, patterns, model);
      setTransactions(classified);
      setSelected(new Set(classified.map((_, i) => i)));
      setStep("preview");
    };
    reader.readAsText(file, "UTF-8");
  }, [patterns, model, toast]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function toggleSelect(i: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === transactions.length) setSelected(new Set());
    else setSelected(new Set(transactions.map((_, i) => i)));
  }

  function updateCategory(i: number, category: CategoryKey) {
    setTransactions(prev => prev.map((tx, idx) =>
      idx === i ? { ...tx, category, confidence: "manual" as const, patternId: undefined } : tx
    ));
  }

  function handleLearnPattern(tx: ParsedTransaction, category: CategoryKey) {
    // Match on the cleaned merchant name (escaped) and rename rows to it.
    const keyword = literalPattern(tx.merchant);
    if (!keyword) return;

    startTransition(async () => {
      const res = await createImportPattern(keyword, category, tx.groupId ?? null, { setName: tx.merchant });
      if (!res.ok) { toast.showError(res.error); return; }
      const newRule: Rule = {
        ID: res.id, PATTERN: keyword, CATEGORY: category, GROUP_ID: tx.groupId ?? null, PRIORITY: 0,
        SET_NAME: tx.merchant, SET_TAGS: null, SET_RECURRING: null, AMOUNT_MIN: null, AMOUNT_MAX: null,
      };
      setPatterns(prev => [...prev, newRule]);
      // Re-classify unmatched transactions with the new rule
      setTransactions(prev => prev.map(t => {
        if (t.confidence === "pattern") return t;
        const patch = applyRules([newRule], { text: t.description, amount: t.amount });
        if (!patch) return t;
        return { ...t, category, groupId: patch.groupId, confidence: "pattern" as const, patternId: newRule.ID, name: patch.name };
      }));
      toast.show(`Rule "${tx.merchant}" → ${CATEGORIES[category].label} saved`);
    });
  }

  function handleImport() {
    const toImport = transactions.filter((_, i) => selected.has(i));
    startTransition(async () => {
      const res = await importTransactions(
        toImport.map(tx => ({
          category: tx.category,
          // Group suggested by the matching pattern or the learned model.
          groupId: tx.groupId ?? null,
          name: tx.name ?? tx.merchant,
          amount: tx.amount,
          month: tx.month,
          notes: `Imported from bank CSV (${tx.date}): ${tx.description}`,
          kind: tx.isIncome ? "income" as const : "expense" as const,
          day: /^\d{4}-\d{2}-\d{2}$/.test(tx.date) ? Number(tx.date.slice(8, 10)) : null,
          tags: tx.tags ?? null,
          isRecurring: tx.isRecurring ?? false,
        }))
      );
      if (!res.ok) { toast.showError(res.error); return; }
      const count = res.count;
      setImportedCount(count);
      setSkippedCount(toImport.length - count);
      setStep("done");
    });
  }

  const rulesEditor = <RulesEditor rules={patterns} groups={groups} onChange={setPatterns} />;

  // Upload step
  if (step === "upload") {
    return (
      <div className="space-y-4">
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="card rounded-2xl p-10 text-center border-2 border-dashed border-white/10 hover:border-pink-500/30 transition-colors cursor-pointer group"
          onClick={() => document.getElementById("csv-file")?.click()}
        >
          <input id="csv-file" type="file" accept=".csv" onChange={handleFileInput} className="hidden" />
          <div className="space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto group-hover:bg-pink-500/10 transition-colors">
              <Upload size={28} strokeWidth={1.5} className="text-[#5a6380] group-hover:text-pink-400 transition-colors" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Drop CSV file here</p>
              <p className="text-xs text-[#5a6380] mt-1">or click to browse — supports Swedbank Estonia format</p>
            </div>
          </div>
        </div>
        {rulesEditor}
      </div>
    );
  }

  // Done step
  if (step === "done") {
    return (
      <div className="card rounded-2xl p-10 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto">
          <Check size={28} className="text-green-400" />
        </div>
        <div>
          <p className="text-lg font-bold text-white">{importedCount} transactions imported</p>
          {skippedCount > 0 && <p className="text-xs text-[#5a6380] mt-1">{skippedCount} duplicates skipped</p>}
        </div>
        <div className="flex gap-2 justify-center pt-2">
          <Link href="/" className="gradient-pink text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:opacity-90 transition-all btn-press shadow-lg shadow-pink-500/20">
            View expenses
          </Link>
          <button onClick={() => { setStep("upload"); setTransactions([]); }} className="px-5 py-2.5 text-sm font-medium border border-white/[0.08] rounded-xl text-[#9ca3c0] hover:bg-white/5 hover:text-white transition-all btn-press">
            Import more
          </button>
        </div>
      </div>
    );
  }

  // Preview step
  const byMonth = new Map<string, number[]>();
  transactions.forEach((tx, i) => {
    const list = byMonth.get(tx.month) || [];
    list.push(i);
    byMonth.set(tx.month, list);
  });
  const months = [...byMonth.keys()].sort().reverse();
  const selectedCount = selected.size;
  const totalAmount = transactions.filter((_, i) => selected.has(i)).reduce((s, tx) => s + tx.amount, 0);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="card rounded-2xl px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={toggleAll} className="text-xs text-[#5a6380] hover:text-white transition-colors">
            {selected.size === transactions.length ? "Deselect all" : "Select all"}
          </button>
          <span className="text-sm text-white font-mono tabular-nums">
            {selectedCount}/{transactions.length} selected
          </span>
          <span className="text-xs text-[#5a6380]">
            {totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })} €
          </span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setStep("upload"); setTransactions([]); }}
            className="px-4 py-2 text-xs font-medium border border-white/[0.08] rounded-xl text-[#9ca3c0] hover:bg-white/5 hover:text-white transition-all btn-press">
            Back
          </button>
          <button onClick={handleImport} disabled={isPending || selectedCount === 0}
            className="gradient-pink text-white rounded-xl px-5 py-2 text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-all btn-press shadow-lg shadow-pink-500/20">
            {isPending ? "Importing..." : `Import ${selectedCount}`}
          </button>
        </div>
      </div>

      {/* Transactions by month */}
      {months.map(month => {
        const indices = byMonth.get(month)!;
        const monthLabel = new Date(month + "-01").toLocaleDateString("en-US", { year: "numeric", month: "long" });

        return (
          <div key={month} className="card rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">{monthLabel}</h3>
              <span className="text-xs text-[#5a6380]">{indices.length} transactions</span>
            </div>

            <div className="divide-y divide-white/[0.04]">
              {indices.map(i => {
                const tx = transactions[i];
                const isSelected = selected.has(i);

                return (
                  <div key={i} className={`px-5 py-3 flex items-center gap-3 transition-colors ${isSelected ? "" : "opacity-40"}`}>
                    {/* Checkbox */}
                    <button onClick={() => toggleSelect(i)} className="shrink-0">
                      <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                        isSelected ? "bg-pink-500 border-pink-500" : "border-white/20 hover:border-white/40"
                      }`}>
                        {isSelected && (
                          <Check size={12} strokeWidth={3} className="text-white" />
                        )}
                      </div>
                    </button>

                    {/* Category icon + selector */}
                    <div className="relative shrink-0">
                      <button type="button" onClick={() => setOpenPicker(openPicker === i ? null : i)} aria-label="Change category" aria-expanded={openPicker === i}
                        className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center text-base hover:bg-white/10 transition-colors">
                        <CategoryIcon category={tx.category} size={16} className="text-[#9ca3c0]" />
                      </button>
                      <div className={`absolute left-0 top-full mt-1 z-50 ${openPicker === i ? "flex" : "hidden"} flex-wrap gap-1 p-2 rounded-xl panel border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.5)] w-64`}>
                        {CATEGORY_KEYS.map(key => (
                          <button key={key} type="button" onClick={() => { updateCategory(i, key); setOpenPicker(null); }}
                            className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm transition-all ${
                              tx.category === key ? "bg-purple-500/20 border border-purple-500/40" : "bg-white/5 hover:bg-white/10"
                            }`}
                            title={CATEGORIES[key].label}>
                            <CategoryIcon category={key} size={16} className="text-[#9ca3c0]" />
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Name (rule rename or cleaned merchant) + raw description + date */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">
                        {tx.name ?? tx.merchant}
                        {tx.isRecurring && <Repeat size={11} className="inline ml-1.5 -mt-0.5 text-purple-300" aria-label="Recurring" />}
                      </p>
                      {(tx.name ?? tx.merchant) !== tx.description && (
                        <p className="text-[10px] text-[#5a6380] truncate" title={tx.description}>{tx.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-[#5a6380]">{tx.date}</span>
                        {tx.tags && <span className="text-[10px] text-purple-300/80">{tx.tags}</span>}
                        {tx.confidence === "pattern" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400">auto</span>
                        )}
                        {tx.confidence === "learned" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-teal-500/10 text-teal-400" title="Learned from your past entries">learned</span>
                        )}
                        {tx.confidence === "guess" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400">guess</span>
                        )}
                        {tx.confidence === "manual" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-300">edited</span>
                        )}
                        {tx.confidence !== "pattern" && (
                          <button
                            onClick={() => handleLearnPattern(tx, tx.category)}
                            className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-[#5a6380] hover:bg-purple-500/10 hover:text-purple-400 transition-colors"
                          >
                            learn
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Amount */}
                    <span className={`text-sm font-mono tabular-nums shrink-0 ${tx.isIncome ? "text-teal-400" : "text-white"}`}>
                      {tx.isIncome ? "+" : ""}{tx.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} €
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {rulesEditor}
    </div>
  );
}
