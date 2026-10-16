import { connection } from "next/server";
import { hasAnyUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";
import SetupForm from "@/components/SetupForm";
import CodeForm from "@/components/CodeForm";
import { pendingChallenge } from "./actions";

export default async function LoginPage() {
  await connection();
  const ready = await hasAnyUser();
  const pending = ready ? await pendingChallenge() : null;
  return (
    <main className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Decorative blurred circles */}
      <div className="absolute top-1/4 -left-32 w-64 h-64 rounded-full bg-purple-500/10 blur-[100px]" />
      <div className="absolute bottom-1/4 -right-32 w-64 h-64 rounded-full bg-pink-500/10 blur-[100px]" />

      <div className="animate-fade-up text-center">
        <div className="mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-pink-500/20 to-purple-500/20 border border-white/10 mb-6 shadow-2xl shadow-purple-500/10">
            <span className="text-4xl">💸</span>
          </div>
          <h1
            className="text-5xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight"
            style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}
          >
            Empty Wallet
          </h1>
        </div>
        {pending ? <CodeForm email={pending.email} /> : ready ? <LoginForm /> : <SetupForm />}
      </div>
    </main>
  );
}
