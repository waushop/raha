import { connection } from "next/server";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { currentContext } from "@/lib/auth";
import { aiMode } from "@/lib/claude";
import AssistantChat from "@/components/AssistantChat";

export default async function AssistantPage() {
  await connection();
  await currentContext();
  const mode = aiMode();

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1 className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1" style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}>
            Ask your money
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">Questions about your spending, plan, subscriptions and goals, answered from your own ledger.</p>
          <p className="text-[10px] text-[#5a6380] mt-2 inline-flex items-start gap-1.5">
            <ShieldCheck size={12} className="shrink-0 mt-px" />
            <span>Your question and only the figures needed to answer it are sent to Claude (Anthropic). Nothing is saved; the chat is gone when you leave.{mode === "mock" && " Demo mode: answers come from a built-in stand-in, not the AI."}</span>
          </p>
        </div>

        {mode === "off" ? (
          <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.05s" }}>
            <p className="text-sm text-white font-semibold">The assistant isn&apos;t set up yet</p>
            <p className="text-xs text-[#9ca3c0] mt-1">An admin needs to set <span className="font-mono">ANTHROPIC_API_KEY</span> on the server. Everything else in the app works without it.</p>
          </div>
        ) : (
          <div className="animate-fade-up" style={{ animationDelay: "0.05s" }}>
            <AssistantChat />
          </div>
        )}
      </div>
    </main>
  );
}
