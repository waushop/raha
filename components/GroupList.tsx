"use client";

import { useState, useTransition } from "react";
import { createGroup, updateGroup, deleteGroup, moveGroup } from "@/app/actions";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "./Toast";
import type { ExpenseGroup } from "@/types/expense";
import { GROUP_COLORS, GROUP_COLOR_CLASSES } from "@/types/expense";

const EMOJI_OPTIONS = ["🏠", "🚗", "👶", "📱", "💼", "🎓", "🏥", "✈️", "🎭", "⚽", "🐕", "🎁", "💰", "📦", "🔧", "🍽️", "👕", "📋"];

type Props = { groups: ExpenseGroup[] };

export default function GroupList({ groups }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseGroup | null>(null);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📦");
  const [color, setColor] = useState("blue");
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  function openCreate() {
    setEditing(null);
    setName("");
    setEmoji("📦");
    setColor("blue");
    setShowForm(true);
  }

  function openEdit(g: ExpenseGroup) {
    setEditing(g);
    setName(g.NAME);
    setEmoji(g.EMOJI ?? "📦");
    setColor(g.COLOR);
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    const data = new FormData();
    data.set("name", name.trim());
    data.set("emoji", emoji);
    data.set("color", color);

    startTransition(async () => {
      const res = editing ? await updateGroup(editing.ID, data) : await createGroup(data);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(editing ? `"${name}" updated` : `"${name}" created`);
      setShowForm(false);
      setEditing(null);
    });
  }

  function handleDelete(g: ExpenseGroup) {
    if (!confirm(`Delete group "${g.NAME}"? Expenses will become ungrouped.`)) return;
    startTransition(async () => {
      await deleteGroup(g.ID);
      toast.show(`"${g.NAME}" deleted`);
    });
  }

  return (
    <div className="space-y-4">
      {/* Existing groups */}
      {groups.length > 0 ? (
        <div className="space-y-2">
          {groups.map((g, idx) => {
            const colors = GROUP_COLOR_CLASSES[g.COLOR] ?? GROUP_COLOR_CLASSES.blue;
            return (
              <div key={g.ID} className={`card rounded-2xl p-4 flex items-center justify-between border-l-4 ${colors.border}`}>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col -my-1">
                    <button onClick={() => startTransition(() => moveGroup(g.ID, -1))} disabled={idx === 0 || isPending} aria-label="Move up"
                      className="w-6 h-5 flex items-center justify-center text-[#5a6380] hover:text-white disabled:opacity-20 transition-colors">
                      <ChevronUp size={10} strokeWidth={3} />
                    </button>
                    <button onClick={() => startTransition(() => moveGroup(g.ID, 1))} disabled={idx === groups.length - 1 || isPending} aria-label="Move down"
                      className="w-6 h-5 flex items-center justify-center text-[#5a6380] hover:text-white disabled:opacity-20 transition-colors">
                      <ChevronDown size={10} strokeWidth={3} />
                    </button>
                  </div>
                  <span className="text-2xl">{g.EMOJI}</span>
                  <div>
                    <span className={`text-sm font-bold ${colors.text}`}>{g.NAME}</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(g)} className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-[#5a6380] hover:text-blue-400 transition-colors">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => handleDelete(g)} className="w-8 h-8 rounded-lg hover:bg-red-500/10 flex items-center justify-center text-[#5a6380] hover:text-red-400 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card rounded-2xl p-8 text-center">
          <p className="text-sm text-[#9ca3c0]">No groups yet</p>
          <p className="text-xs text-[#5a6380] mt-1">Create groups to organize your expenses</p>
        </div>
      )}

      {/* Create/Edit form */}
      {showForm ? (
        <form onSubmit={handleSubmit} className="card rounded-2xl p-5 space-y-4 animate-fade-in">
          <h3 className="text-sm font-bold text-white">{editing ? "Edit group" : "New group"}</h3>

          {/* Emoji picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Icon</label>
            <div className="flex flex-wrap gap-1.5">
              {EMOJI_OPTIONS.map(e => (
                <button key={e} type="button" onClick={() => setEmoji(e)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all ${
                    emoji === e ? "bg-purple-500/20 border border-purple-500/40 scale-110" : "bg-white/5 border border-white/[0.06] hover:bg-white/10"
                  }`}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Home, Car, Kids..."
              className="border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all placeholder:text-[#5a6380]" />
          </div>

          {/* Color picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Color</label>
            <div className="flex gap-2">
              {GROUP_COLORS.map(c => {
                const cls = GROUP_COLOR_CLASSES[c];
                return (
                  <button key={c} type="button" onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full ${cls.bg} transition-all ${
                      color === c ? "ring-2 ring-white ring-offset-2 ring-offset-[var(--bg-card-solid)] scale-110" : "opacity-50 hover:opacity-80"
                    }`} />
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={isPending}
              className="flex-1 gradient-pink text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-all btn-press shadow-lg shadow-pink-500/20">
              {isPending ? "Saving..." : editing ? "Save" : "Create"}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }}
              className="px-5 py-2.5 text-sm font-medium border border-white/[0.08] rounded-xl text-[#9ca3c0] hover:bg-white/5 hover:text-white transition-all btn-press">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={openCreate}
          className="w-full py-3 rounded-2xl border border-dashed border-white/10 text-[#5a6380] text-sm font-medium hover:border-pink-500/30 hover:text-pink-400 hover:bg-white/[0.02] transition-all btn-press group">
          <span className="inline-flex items-center gap-2">
            <Plus size={16} className="group-hover:rotate-90 transition-transform duration-200" />
            Add group
          </span>
        </button>
      )}
    </div>
  );
}
