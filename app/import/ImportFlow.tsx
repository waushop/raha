"use client";

import { useState, useTransition, useCallback } from "react";
import { importTransactions, createImportPattern, deleteImportPattern } from "@/app/actions";
import type { ImportPatternRow } from "@/app/actions";
import type { ParsedTransaction } from "@/lib/import-parser";
import { parseGenericCSV, classifyTransactions } from "@/lib/import-parser";
import { CATEGORIES, CATEGORY_KEYS } from "@/types/expense";
import type { CategoryKey } from "@/types/expense";
import Link from "next/link";
import { useToast } from "@/components/Toast";

type Props = {
  patterns: ImportPatternRow[];
};

type Step = "upload" | "preview" | "done";

export default function ImportFlow({ patterns: initialPatterns }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [patterns, setPatterns] = useState(initialPatterns);
  const [isPending, startTransition] = useTransition();
  const [importedCount, setImportedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const toast = useToast();

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const csv = e.target?.result as string;
      const parsed = parseGenericCSV(csv);
      // Filter to expenses only (debit), skip income
      const expenses = parsed.filter(tx => !tx.isIncome);
      const classified = classifyTransactions(expenses, patterns);
      setTransactions(classified);
      setSelected(new Set(classified.map((_, i) => i)));
      setStep("preview");
    };
    reader.readAsText(file, "UTF-8");
  }, [patterns]);

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
      idx === i ? { ...tx, category, confidence: "pattern" as const } : tx
    ));
  }

  function handleLearnPattern(description: string, category: CategoryKey) {
    // Extract a keyword from the description for the pattern
    const keyword = description.split(/\s*[—\-,]\s*/)[0].trim();
    if (!keyword) return;

    startTransition(async () => {
      const id = await createImportPattern(keyword, category);
      const newPattern = { ID: id, PATTERN: keyword, CATEGORY: category, GROUP_ID: null, PRIORITY: 0 };
      setPatterns(prev => [...prev, newPattern]);
      // Re-classify unmatched transactions with new pattern
      setTransactions(prev => prev.map(tx => {
        if (tx.confidence !== "none") return tx;
        try {
          if (new RegExp(keyword, "i").test(tx.description)) {
            return { ...tx, category, confidence: "pattern" as const, patternId: id };
          }
        } catch {
          if (tx.description.toLowerCase().includes(keyword.toLowerCase())) {
            return { ...tx, category, confidence: "pattern" as const, patternId: id };
          }
        }
        return tx;
      }));
      toast.show(`Pattern "${keyword}" → ${CATEGORIES[category].label} saved`);
    });
  }

  function handleImport() {
    const toImport = transactions.filter((_, i) => selected.has(i));
    startTransition(async () => {
      const count = await importTransactions(
        toImport.map(tx => ({
          category: tx.category,
          groupId: null,
          name: tx.description,
          amount: tx.amount,
          month: tx.month,
          notes: `Imported from bank CSV (${tx.date})`,
        }))
      );
      setImportedCount(count);
      setSkippedCount(toImport.length - count);
      setStep("done");
    });
  }

  // Upload step
  if (step === "upload") {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="card rounded-2xl p-10 text-center border-2 border-dashed border-white/10 hover:border-pink-500/30 transition-colors cursor-pointer group"
        onClick={() => document.getElementById("csv-file")?.click()}
      >
        <input id="csv-file" type="file" accept=".csv" onChange={handleFileInput} className="hidden" />
        <div className="space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto group-hover:bg-pink-500/10 transition-colors">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#5a6380] group-hover:text-pink-400 transition-colors">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Drop CSV file here</p>
            <p className="text-xs text-[#5a6380] mt-1">or click to browse — supports Swedbank Estonia format</p>
          </div>
        </div>
      </div>
    );
  }

  // Done step
  if (step === "done") {
    return (
      <div className="card rounded-2xl p-10 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
            <polyline points="20 6 9 17 4 12" />
          </svg>
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
                const cat = CATEGORIES[tx.category];
                const isSelected = selected.has(i);

                return (
                  <div key={i} className={`px-5 py-3 flex items-center gap-3 transition-colors ${isSelected ? "" : "opacity-40"}`}>
                    {/* Checkbox */}
                    <button onClick={() => toggleSelect(i)} className="shrink-0">
                      <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                        isSelected ? "bg-pink-500 border-pink-500" : "border-white/20 hover:border-white/40"
                      }`}>
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                    </button>

                    {/* Category icon + selector */}
                    <div className="relative group/cat shrink-0">
                      <button className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center text-base hover:bg-white/10 transition-colors">
                        {cat.icon}
                      </button>
                      <div className="absolute left-0 top-full mt-1 z-50 hidden group-hover/cat:flex flex-wrap gap-1 p-2 rounded-xl bg-[#1c2237] border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.5)] w-64">
                        {CATEGORY_KEYS.map(key => (
                          <button key={key} onClick={() => updateCategory(i, key)}
                            className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm transition-all ${
                              tx.category === key ? "bg-purple-500/20 border border-purple-500/40" : "bg-white/5 hover:bg-white/10"
                            }`}
                            title={CATEGORIES[key].label}>
                            {CATEGORIES[key].icon}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Description + date */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{tx.description}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-[#5a6380]">{tx.date}</span>
                        {tx.confidence === "pattern" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400">auto</span>
                        )}
                        {tx.confidence === "guess" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400">guess</span>
                        )}
                        {tx.confidence === "none" && (
                          <button
                            onClick={() => handleLearnPattern(tx.description, tx.category)}
                            className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-[#5a6380] hover:bg-purple-500/10 hover:text-purple-400 transition-colors"
                          >
                            learn
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Amount */}
                    <span className="text-sm font-mono tabular-nums text-white shrink-0">
                      {tx.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} €
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Patterns section */}
      {patterns.length > 0 && (
        <div className="card rounded-2xl px-5 py-4">
          <h3 className="text-xs font-bold text-[#5a6380] uppercase tracking-widest mb-3">Learned patterns</h3>
          <div className="flex flex-wrap gap-1.5">
            {patterns.map(p => (
              <span key={p.ID} className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg bg-white/5 text-[#9ca3c0] border border-white/[0.06]">
                <span>{CATEGORIES[p.CATEGORY as CategoryKey]?.icon}</span>
                <span>{p.PATTERN}</span>
                <button onClick={() => {
                  startTransition(async () => {
                    await deleteImportPattern(p.ID);
                    setPatterns(prev => prev.filter(x => x.ID !== p.ID));
                  });
                }} className="text-[#5a6380] hover:text-red-400 transition-colors ml-0.5">×</button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
