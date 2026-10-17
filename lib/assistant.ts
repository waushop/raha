// "Ask your money": a tool-use loop over the read-only tools in
// lib/assistant-tools.ts, plus a deterministic mock for AI_MOCK=1.
// Server-only. The conversation is never stored; only the question history
// the browser sends back, the system prompt and tool results reach the API.
import type Anthropic from "@anthropic-ai/sdk";
import db from "./db";
import { CATEGORIES, CATEGORY_KEYS, type CategoryKey } from "@/types/expense";
import { addMonths, currentMonth, monthLabel } from "./months";
import { isoDate } from "./subscriptions";
import { AiError, aiMode, createMessage, textOf } from "./claude";
import {
  TOOL_DEFINITIONS, ToolInputError, cashflow, listRows, runTool, spendingBy, subscriptions, goals, netWorth, budgetStatus, monthlyTotals,
  type ToolContext,
} from "./assistant-tools";

export type ChatTurn = { role: "user" | "assistant"; text: string };
export type AskResult = { answer: string; toolsUsed: string[] };

export const MAX_TOOL_ROUNDS = 6;
export const MAX_QUESTION_CHARS = 1000;
const MAX_TURNS_SENT = 12;
const MAX_TURN_CHARS = 4000;
const MAX_TOOL_RESULT_CHARS = 20_000;
const MAX_TOKENS = 4096;
const OVERALL_DEADLINE_MS = 90_000;

const fmt = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/**
 * Validates the browser-held conversation: alternating turns ending with a
 * user question, each bounded. Keeps only the most recent turns (starting
 * with a user turn) so long chats stay cheap.
 */
export function cleanHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new AiError("Ask a question first.");
  const turns: ChatTurn[] = raw.map((t) => {
    const role = (t as ChatTurn)?.role;
    const text = (t as ChatTurn)?.text;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") throw new AiError("That conversation looks broken. Start a new one.");
    return { role, text: text.trim().slice(0, MAX_TURN_CHARS) };
  });
  const last = turns[turns.length - 1];
  if (last.role !== "user" || !last.text) throw new AiError("Ask a question first.");
  if (last.text.length > MAX_QUESTION_CHARS) throw new AiError(`Keep the question under ${MAX_QUESTION_CHARS} characters.`);
  let kept = turns.slice(-MAX_TURNS_SENT);
  while (kept.length && kept[0].role !== "user") kept = kept.slice(1);
  // Drop empty turns and merge same-role neighbours (e.g. after a failed answer).
  const merged: ChatTurn[] = [];
  for (const t of kept) {
    if (!t.text) continue;
    const prev = merged[merged.length - 1];
    if (prev?.role === t.role) prev.text = `${prev.text}\n\n${t.text}`;
    else merged.push({ ...t });
  }
  return merged;
}

async function groupNames(ws: string): Promise<string[]> {
  const [rows] = await db.execute("SELECT NAME FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY SORT_ORDER, NAME LIMIT 50", [ws]);
  return (rows as Array<{ NAME: string }>).map((r) => r.NAME);
}

export function systemPrompt(today: string, groups: string[]): string {
  return [
    "You are the assistant inside Empty Wallet, a personal and household expense tracker. You answer questions about the user's own ledger.",
    `Today is ${today}. Months are YYYY-MM. All amounts are in EUR; write them like 1,234.56 €.`,
    `Category keys: ${CATEGORY_KEYS.join(", ")}.`,
    `The user's groups: ${groups.length ? groups.join(", ") : "(none yet)"}.`,
    "",
    "How to answer:",
    "- Get every figure from the tools. Never invent or estimate numbers that no tool returned; if the data is missing or empty, say so plainly.",
    "- Pick explicit month ranges from today's date (\"this year\" = January of this year to this month, \"last month\" = the previous calendar month).",
    "- Spending means kind=expense unless the user asks about income.",
    "- Be concise: a short direct answer first, then at most a few bullet points. No tables, no headings.",
    "- Answer in the language the user writes in (they may write Estonian).",
    "- Link to what you cite with markdown links to the relative URLs the tools return, e.g. [see the rows](/search?category=groceries&from=2026-01&to=2026-10), a row as [Rimi](/?month=2026-10#e-<id>), or [the plan](/plan?month=2026-10). Only use relative links starting with /.",
    "- For \"can I afford\" questions use the cashflow tool's safe-to-spend figure and say what it assumes.",
  ].join("\n");
}

/** One answer for the conversation, with the names of the tools that ran. */
export async function ask(ctx: ToolContext, history: ChatTurn[]): Promise<AskResult> {
  if (aiMode() === "mock") return mockAnswer(ctx, history[history.length - 1].text);
  const started = Date.now();
  const system = systemPrompt(isoDate(new Date()), await groupNames(ctx.workspaceId));
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.role, content: t.text }));
  const used = new Set<string>();

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (Date.now() - started > OVERALL_DEADLINE_MS) throw new AiError("That question took too long to work out. Try a narrower one.");
    const res = await createMessage({
      max_tokens: MAX_TOKENS,
      system,
      tools: TOOL_DEFINITIONS,
      // After the last allowed tool round the model has to answer with what it has.
      tool_choice: round === MAX_TOOL_ROUNDS ? { type: "none" } : { type: "auto" },
      output_config: { effort: "low" },
      messages,
    });
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason === "tool_use" && calls.length > 0 && round < MAX_TOOL_ROUNDS) {
      // Echo the assistant turn verbatim (thinking blocks included), then all results in one user turn.
      messages.push({ role: "assistant", content: res.content });
      const results = await Promise.all(calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        used.add(call.name);
        try {
          const out = JSON.stringify(await runTool(ctx, call.name, call.input));
          return { type: "tool_result", tool_use_id: call.id, content: out.length > MAX_TOOL_RESULT_CHARS ? `${out.slice(0, MAX_TOOL_RESULT_CHARS)}…(truncated)` : out };
        } catch (e) {
          if (!(e instanceof ToolInputError)) console.error("[assistant] tool failed", call.name, e instanceof Error ? e.name : typeof e);
          return { type: "tool_result", tool_use_id: call.id, is_error: true, content: e instanceof ToolInputError ? e.message : "The tool failed." };
        }
      }));
      messages.push({ role: "user", content: results });
      continue;
    }
    const text = textOf(res);
    if (!text) throw new AiError("The assistant didn't come up with an answer. Try rephrasing.");
    return { answer: res.stop_reason === "max_tokens" ? `${text} …` : text, toolsUsed: [...used] };
  }
  throw new AiError("The assistant didn't come up with an answer. Try rephrasing.");
}

// ---------- mock (AI_MOCK=1) ----------

function categoryIn(q: string): CategoryKey | null {
  for (const key of CATEGORY_KEYS) {
    if (q.includes(key) || q.includes(CATEGORIES[key].label.toLowerCase())) return key;
  }
  return null;
}

/**
 * Deterministic stand-in for the model: picks one real tool from keywords and
 * words its result. Lets e2e assert real numbers without an API key.
 */
export async function mockAnswer(ctx: ToolContext, question: string): Promise<AskResult> {
  const q = question.toLowerCase();
  const ws = ctx.workspaceId;
  const now = currentMonth();

  if (/subscription|tellimus/.test(q)) {
    const r = await subscriptions(ws);
    const up = r.subscriptions.filter((s) => s.previousAmount !== null && s.amount > s.previousAmount);
    const answer = up.length
      ? `${up.length} subscription${up.length === 1 ? "" : "s"} went up:\n${up.map((s) => `- ${s.name}: ${fmt(s.previousAmount!)} → ${fmt(s.amount)}`).join("\n")}\n[Open subscriptions](${r.link})`
      : `None of your ${r.subscriptions.length} subscriptions changed price. [Open subscriptions](${r.link})`;
    return { answer, toolsUsed: ["subscriptions"] };
  }
  if (/afford|safe to spend|cash ?flow|jõuan|jaksan/.test(q)) {
    const r = await cashflow(ws, ctx.userId);
    const answer = r.safeToSpend === null
      ? `I can't tell yet: there's no current balance recorded. Add one on [Cash flow](${r.link}).`
      : `Safe to spend right now: ${fmt(r.safeToSpend)}${r.nextPayday ? ` until ${r.nextPayday.date}` : ""}, keeping a ${fmt(r.buffer)} buffer. [See cash flow](${r.link})`;
    return { answer, toolsUsed: ["cashflow"] };
  }
  if (/goal|eesmärk/.test(q)) {
    const r = await goals(ws);
    const answer = r.goals.length
      ? `${r.goals.map((g) => `- ${g.name}: ${fmt(g.saved)} of ${fmt(g.target)} (${g.pct}%)`).join("\n")}\n[Open goals](${r.link})`
      : `You have no savings goals yet. [Create one](${r.link})`;
    return { answer, toolsUsed: ["goals"] };
  }
  if (/net worth|netovara/.test(q)) {
    const r = await netWorth(ws);
    return { answer: `Net worth in ${monthLabel(r.month)}: ${fmt(r.current.net)}. [Open net worth](${r.link})`, toolsUsed: ["net_worth"] };
  }
  if (/budget|plan\b|eelarve/.test(q)) {
    const r = await budgetStatus(ws, now);
    return { answer: `This month you've spent ${fmt(r.budgets.total.spent)} of ${fmt(r.budgets.total.budget)}. [Open the plan](${r.plan.link})`, toolsUsed: ["budget_status"] };
  }
  if (/biggest|largest|suurim/.test(q)) {
    const month = /last month|eelmise kuu|möödunud kuu/.test(q) ? addMonths(now, -1) : now;
    const r = await listRows(ws, { from_month: month, to_month: month }, 5, "amount_desc");
    const answer = r.rows.length
      ? `Biggest expenses in ${monthLabel(month)}:\n${r.rows.map((x) => `- [${x.name}](${x.link}): ${fmt(x.amount)}`).join("\n")}`
      : `No expenses recorded in ${monthLabel(month)}.`;
    return { answer, toolsUsed: ["list_rows"] };
  }
  const category = categoryIn(q);
  if (category) {
    const from = /this year|sel aastal|tänavu/.test(q) ? `${now.slice(0, 4)}-01` : addMonths(now, -11);
    const r = await spendingBy(ws, "month", { category, from_month: from, to_month: now });
    const answer = r.count
      ? `You spent ${fmt(r.total)} on ${CATEGORIES[category].label.toLowerCase()} from ${monthLabel(r.filters.from)} to ${monthLabel(r.filters.to)} (${r.count} entr${r.count === 1 ? "y" : "ies"}). [See them in search](${r.link})`
      : `No ${CATEGORIES[category].label.toLowerCase()} spending recorded from ${monthLabel(r.filters.from)} to ${monthLabel(r.filters.to)}.`;
    return { answer, toolsUsed: ["spending_by"] };
  }
  const r = await monthlyTotals(ws, addMonths(now, -5), now, "expense");
  return {
    answer: `Spending over the last 6 months: ${fmt(r.total)}.\n${r.months.map((m) => `- ${monthLabel(m.month)}: ${fmt(m.total)}`).join("\n")}\n[Open analytics](/analytics)`,
    toolsUsed: ["monthly_totals"],
  };
}
