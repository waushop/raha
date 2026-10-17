"use client";

import { useState, useTransition } from "react";
import { updateImportPattern, deleteImportPattern, applyRulesToExisting } from "@/app/actions";
import type { Rule } from "@/lib/rules";
import type { ExpenseGroup, CategoryKey } from "@/types/expense";
import { CATEGORIES, CATEGORY_KEYS } from "@/types/expense";
import { useToast } from "@/components/Toast";
import CategoryIcon from "@/components/CategoryIcon";
import { Pencil, Trash2, Play, Sparkles } from "lucide-react";

type Props = {
  rules: Rule[];
  groups: ExpenseGroup[];
  onChange: (rules: Rule[]) => void;
};

type Recurring = "leave" | "yes" | "no";

type Draft = {
  pattern: string;
  category: CategoryKey;
  groupId: string;
  priority: string;
  setName: string;
  setTags: string;
  recurring: Recurring;
  amountMin: string;
  amountMax: string;
};

const input = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#5a6380] focus:outline-none focus:border-purple-500/50";
const label = "block text-[10px] font-bold uppercase tracking-widest text-[#5a6380] mb-1";
const ghostBtn = "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-white/[0.08] rounded-xl text-[#9ca3c0] hover:bg-white/5 hover:text-white transition-all btn-press disabled:opacity-50";

function toDraft(r: Rule): Draft {
  return {
    pattern: r.PATTERN,
    category: r.CATEGORY as CategoryKey,
    groupId: r.GROUP_ID ?? "",
    priority: String(r.PRIORITY),
    setName: r.SET_NAME ?? "",
    setTags: r.SET_TAGS ?? "",
    recurring: r.SET_RECURRING === null ? "leave" : r.SET_RECURRING === 1 ? "yes" : "no",
    amountMin: r.AMOUNT_MIN === null ? "" : String(r.AMOUNT_MIN),
    amountMax: r.AMOUNT_MAX === null ? "" : String(r.AMOUNT_MAX),
  };
}

function fromDraft(id: string, d: Draft): Rule {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    ID: id,
    PATTERN: d.pattern.trim(),
    CATEGORY: d.category,
    GROUP_ID: d.groupId || null,
    PRIORITY: Number(d.priority) || 0,
    SET_NAME: d.setName.trim() || null,
    SET_TAGS: d.setTags.trim() || null,
    SET_RECURRING: d.recurring === "leave" ? null : d.recurring === "yes" ? 1 : 0,
    AMOUNT_MIN: num(d.amountMin),
    AMOUNT_MAX: num(d.amountMax),
  };
}

function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2 }) + " €";
}

export default function RulesEditor({ rules, groups, onChange }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const groupName = (id: string | null) => groups.find((g) => g.ID === id)?.NAME ?? null;

  function startEdit(r: Rule) {
    setEditing(r.ID);
    setDraft(toDraft(r));
  }

  function cancelEdit() {
    setEditing(null);
    setDraft(null);
  }

  function save(id: string) {
    if (!draft) return;
    const d = draft;
    startTransition(async () => {
      const res = await updateImportPattern(id, d.pattern, d.category, d.groupId || null, {
        priority: Number(d.priority) || 0,
        setName: d.setName.trim() || null,
        setTags: d.setTags.trim() || null,
        setRecurring: d.recurring === "leave" ? null : d.recurring === "yes",
        amountMin: d.amountMin.trim() === "" ? null : Number(d.amountMin),
        amountMax: d.amountMax.trim() === "" ? null : Number(d.amountMax),
      });
      if (!res.ok) { toast.showError(res.error); return; }
      onChange(rules.map((r) => (r.ID === id ? fromDraft(id, d) : r)));
      navigator.vibrate?.(10);
      toast.show("Rule saved");
      cancelEdit();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await deleteImportPattern(id);
      onChange(rules.filter((r) => r.ID !== id));
      if (editing === id) cancelEdit();
      toast.show("Rule deleted");
    });
  }

  function apply(id?: string) {
    startTransition(async () => {
      const res = await applyRulesToExisting(id);
      if (!res.ok) { toast.showError(res.error); return; }
      navigator.vibrate?.(10);
      toast.show(`${res.changed} ${res.changed === 1 ? "row" : "rows"} updated`);
    });
  }

  return (
    <div className="card rounded-2xl px-5 py-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold text-[#5a6380] uppercase tracking-widest">Rules</h3>
          <p className="text-[11px] text-[#5a6380] mt-0.5">Matched on import and on &ldquo;Apply&rdquo;; the highest priority wins.</p>
        </div>
        {rules.length > 0 && (
          <button type="button" onClick={() => apply()} disabled={isPending} className={ghostBtn}>
            <Sparkles size={13} />
            Apply all rules
          </button>
        )}
      </div>

      {rules.length === 0 ? (
        <p className="text-xs text-[#5a6380]">No rules yet. Use &ldquo;learn&rdquo; on an imported row to create one.</p>
      ) : (
        <div className="divide-y divide-white/[0.04] -mx-5">
          {rules.map((r) => (
            <div key={r.ID} className="px-5 py-3">
              {editing === r.ID && draft ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); save(r.ID); }}
                  className="grid grid-cols-2 sm:grid-cols-4 gap-3"
                >
                  <div className="col-span-2">
                    <span className={label}>Pattern (regex or text)</span>
                    <input value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })} required className={`${input} font-mono`} />
                  </div>
                  <div>
                    <span className={label}>Category</span>
                    <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as CategoryKey })} className={`${input} panel`}>
                      {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORIES[k].label}</option>)}
                    </select>
                  </div>
                  <div>
                    <span className={label}>Group</span>
                    <select value={draft.groupId} onChange={(e) => setDraft({ ...draft, groupId: e.target.value })} className={`${input} panel`}>
                      <option value="">No group</option>
                      {groups.map((g) => <option key={g.ID} value={g.ID}>{g.NAME}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <span className={label}>Rename to</span>
                    <input value={draft.setName} onChange={(e) => setDraft({ ...draft, setName: e.target.value })} placeholder="Leave empty to keep the name" className={input} />
                  </div>
                  <div className="col-span-2">
                    <span className={label}>Tags</span>
                    <input value={draft.setTags} onChange={(e) => setDraft({ ...draft, setTags: e.target.value })} placeholder="#food, #car" className={input} />
                  </div>
                  <div>
                    <span className={label}>Recurring</span>
                    <select value={draft.recurring} onChange={(e) => setDraft({ ...draft, recurring: e.target.value as Recurring })} className={`${input} panel`}>
                      <option value="leave">Leave as is</option>
                      <option value="yes">Mark recurring</option>
                      <option value="no">Mark not recurring</option>
                    </select>
                  </div>
                  <div>
                    <span className={label}>Priority</span>
                    <input type="number" min={-100} max={100} step={1} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} className={input} />
                  </div>
                  <div>
                    <span className={label}>Min amount</span>
                    <input inputMode="decimal" value={draft.amountMin} onChange={(e) => setDraft({ ...draft, amountMin: e.target.value })} placeholder="any" className={input} />
                  </div>
                  <div>
                    <span className={label}>Max amount</span>
                    <input inputMode="decimal" value={draft.amountMax} onChange={(e) => setDraft({ ...draft, amountMax: e.target.value })} placeholder="any" className={input} />
                  </div>
                  <div className="col-span-2 sm:col-span-4 flex justify-end gap-2 pt-1">
                    <button type="button" onClick={cancelEdit} disabled={isPending} className={ghostBtn}>Cancel</button>
                    <button type="submit" disabled={isPending}
                      className="gradient-pink text-white rounded-xl px-4 py-1.5 text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-all btn-press">
                      {isPending ? "Saving..." : "Save rule"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0" title={CATEGORIES[r.CATEGORY as CategoryKey]?.label ?? r.CATEGORY}>
                    <CategoryIcon category={r.CATEGORY} size={16} className="text-[#9ca3c0]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-sm text-white font-mono truncate">{r.PATTERN}</code>
                      <span className="text-xs text-[#9ca3c0]">→ {CATEGORIES[r.CATEGORY as CategoryKey]?.label ?? r.CATEGORY}</span>
                      {groupName(r.GROUP_ID) && <span className="text-xs text-[#5a6380]">in {groupName(r.GROUP_ID)}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {r.PRIORITY !== 0 && <Chip>priority {r.PRIORITY}</Chip>}
                      {r.SET_NAME && <Chip>rename to &ldquo;{r.SET_NAME}&rdquo;</Chip>}
                      {r.SET_TAGS && <Chip>{r.SET_TAGS}</Chip>}
                      {r.SET_RECURRING === 1 && <Chip>recurring</Chip>}
                      {r.SET_RECURRING === 0 && <Chip>not recurring</Chip>}
                      {(r.AMOUNT_MIN !== null || r.AMOUNT_MAX !== null) && (
                        <Chip>
                          {r.AMOUNT_MIN !== null && r.AMOUNT_MAX !== null
                            ? `${money(r.AMOUNT_MIN)} – ${money(r.AMOUNT_MAX)}`
                            : r.AMOUNT_MIN !== null ? `≥ ${money(r.AMOUNT_MIN)}` : `≤ ${money(r.AMOUNT_MAX as number)}`}
                        </Chip>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <IconBtn title="Apply to existing rows" onClick={() => apply(r.ID)} disabled={isPending}><Play size={14} /></IconBtn>
                    <IconBtn title="Edit rule" onClick={() => startEdit(r)} disabled={isPending}><Pencil size={14} /></IconBtn>
                    <IconBtn title="Delete rule" onClick={() => remove(r.ID)} disabled={isPending} danger><Trash2 size={14} /></IconBtn>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-[#9ca3c0] border border-white/[0.06]">{children}</span>;
}

function IconBtn({ children, title, onClick, disabled, danger }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className={`w-8 h-8 rounded-lg flex items-center justify-center text-[#5a6380] transition-colors disabled:opacity-50 ${danger ? "hover:bg-red-500/10 hover:text-red-400" : "hover:bg-white/5 hover:text-white"}`}>
      {children}
    </button>
  );
}
