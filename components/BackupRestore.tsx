"use client";

import { useRef, useState } from "react";
import { useToast } from "./Toast";

export default function BackupRestore() {
  const jsonRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const toast = useToast();

  async function handleJsonImport() {
    const file = jsonRef.current?.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch("/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error();
      const result = await res.json();
      const parts = [`${result.imported} added`];
      if (result.updated) parts.push(`${result.updated} restored`);
      if (result.skipped) parts.push(`${result.skipped} skipped`);
      toast.show(`Backup applied: ${parts.join(", ")}`);
      window.location.reload();
    } catch { toast.show("JSON import error - check file format"); }
    finally { setImporting(false); }
  }

  async function handleCsvImport() {
    const file = csvRef.current?.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const res = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "text/plain" }, body: text });
      if (!res.ok) throw new Error();
      const result = await res.json();
      toast.show(`${result.imported} imported, ${result.skipped} skipped`);
      window.location.reload();
    } catch { toast.show("CSV import error - check file format"); }
    finally { setImporting(false); }
  }

  return (
    <div className="space-y-4">
      {/* Download */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380] mb-2">Download</p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/backup" className="px-4 py-2 rounded-xl gradient-purple text-white text-xs font-bold shadow-lg shadow-purple-500/20 btn-press hover:opacity-90 transition-opacity inline-flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Backup (JSON)
          </a>
          <a href={`/api/export?year=${new Date().getFullYear()}`} className="px-4 py-2 rounded-xl border border-white/[0.08] text-[#9ca3c0] text-xs font-medium hover:bg-white/5 hover:text-white transition-all btn-press inline-flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Export (CSV)
          </a>
        </div>
      </div>

      {/* Import */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380] mb-2">Import</p>
        <div className="flex flex-wrap gap-2">
          <label className="px-4 py-2 rounded-xl border border-white/[0.08] text-[#9ca3c0] text-xs font-medium hover:bg-white/5 hover:text-white transition-all btn-press cursor-pointer inline-flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            {importing ? "Importing..." : "Restore JSON"}
            <input ref={jsonRef} type="file" accept=".json" onChange={handleJsonImport} disabled={importing} className="sr-only" />
          </label>
          <label className="px-4 py-2 rounded-xl border border-white/[0.08] text-[#9ca3c0] text-xs font-medium hover:bg-white/5 hover:text-white transition-all btn-press cursor-pointer inline-flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>
            {importing ? "Importing..." : "Import CSV"}
            <input ref={csvRef} type="file" accept=".csv" onChange={handleCsvImport} disabled={importing} className="sr-only" />
          </label>
        </div>
        <p className="text-[10px] text-[#5a6380] mt-2">
          Restore JSON puts every row in the backup back to its backed-up values (including deleted ones); rows that exist only here are left alone.
          CSV format: Month, Category, Name, Amount (header row required).
        </p>
      </div>
    </div>
  );
}
