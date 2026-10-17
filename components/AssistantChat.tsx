"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUp, Eraser, Sparkles } from "lucide-react";
import { askMoney } from "@/app/assistant/actions";
import { parseAnswer } from "@/lib/assistant-text";
import { useToast } from "./Toast";

type Message = { role: "user" | "assistant"; text: string; tools?: string[] };

export const SUGGESTIONS = [
  "How much did we spend on groceries this year?",
  "What subscriptions went up?",
  "Can I afford a 300 € purchase this week?",
  "Biggest expenses last month",
];

const TOOL_LABELS: Record<string, string> = {
  spending_by: "spending totals",
  list_rows: "entries",
  monthly_totals: "monthly totals",
  budget_status: "plan and budgets",
  subscriptions: "subscriptions",
  cashflow: "cash flow",
  goals: "goals",
  net_worth: "net worth",
};

function Answer({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words">
      {parseAnswer(text).map((seg, i) =>
        seg.type === "link"
          ? <Link key={i} href={seg.href} className="text-pink-300 underline decoration-pink-400/40 underline-offset-2 hover:text-pink-200">{seg.text}</Link>
          : <span key={i}>{seg.text}</span>,
      )}
    </p>
  );
}

export default function AssistantChat() {
  // The conversation lives in this component only: never stored, gone on reload.
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [isThinking, startThinking] = useTransition();
  const toast = useToast();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [messages, isThinking]);

  function send(question: string) {
    const q = question.trim();
    if (!q || isThinking) return;
    if (!navigator.onLine) { toast.showError("The assistant needs a connection"); return; }
    const history: Message[] = [...messages, { role: "user", text: q }];
    setMessages(history);
    setDraft("");
    navigator.vibrate?.(10);
    startThinking(async () => {
      try {
        const res = await askMoney(history.map(({ role, text }) => ({ role, text })));
        if (!res.ok) { toast.showError(res.error); return; }
        setMessages((prev) => [...prev, { role: "assistant", text: res.answer, tools: res.toolsUsed }]);
      } catch {
        toast.showError("The assistant is unavailable right now. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 && (
        <div className="card rounded-2xl p-4 animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380] mb-3">Try asking</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} disabled={isThinking}
                className="text-left text-xs px-3 py-2 rounded-xl bg-white/5 border border-white/[0.06] text-[#9ca3c0] hover:text-white hover:bg-white/10 hover:border-white/10 transition-all btn-press disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.length > 0 && (
        <div className="flex flex-col gap-3" aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}>
              <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.role === "user" ? "bg-gradient-to-r from-pink-500/20 to-purple-500/20 border border-pink-500/20 text-white" : "card text-white/90"
              }`} data-testid={m.role === "assistant" ? "assistant-answer" : undefined}>
                {m.role === "assistant" ? <Answer text={m.text} /> : <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                {m.role === "assistant" && m.tools && m.tools.length > 0 && (
                  <p className="text-[10px] text-[#5a6380] mt-1.5">Looked at {m.tools.map((t) => TOOL_LABELS[t] ?? t).join(", ")}</p>
                )}
              </div>
            </div>
          ))}
          {isThinking && (
            <div className="flex justify-start animate-fade-in" aria-label="Thinking">
              <div className="card rounded-2xl px-4 py-3 flex items-center gap-1.5">
                {[0, 1, 2].map((d) => (
                  <span key={d} className="w-1.5 h-1.5 rounded-full bg-pink-400/80 animate-gentle-pulse" style={{ animationDelay: `${d * 0.2}s` }} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div ref={endRef} />

      <form onSubmit={(e) => { e.preventDefault(); send(draft); }}
        className="card rounded-2xl p-2 flex items-end gap-2 sticky bottom-20 lg:bottom-4 z-20" style={{ background: "var(--bg-card-solid)" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }}
          rows={1}
          maxLength={1000}
          placeholder="Ask about your money…"
          aria-label="Ask a question about your money"
          enterKeyHint="send"
          className="flex-1 min-w-0 resize-none max-h-32 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all placeholder:text-[#5a6380]"
        />
        {messages.length > 0 && (
          <button type="button" onClick={() => setMessages([])} disabled={isThinking} aria-label="New conversation" title="New conversation"
            className="shrink-0 w-11 h-11 rounded-xl border border-white/[0.08] text-[#5a6380] hover:text-white hover:bg-white/5 flex items-center justify-center transition-all disabled:opacity-40">
            <Eraser size={16} />
          </button>
        )}
        <button type="submit" disabled={isThinking || !draft.trim()} aria-label="Send question"
          className="shrink-0 w-11 h-11 rounded-xl gradient-pink text-white flex items-center justify-center shadow-lg shadow-pink-500/20 btn-press hover:opacity-90 disabled:opacity-40 transition-opacity">
          {isThinking ? <Sparkles size={16} className="animate-gentle-pulse" /> : <ArrowUp size={16} strokeWidth={2.5} />}
        </button>
      </form>
    </div>
  );
}
