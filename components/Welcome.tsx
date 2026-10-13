import Link from "next/link";

export default function Welcome() {
  return (
    <div className="card rounded-2xl p-8 sm:p-12 text-center max-w-lg mx-auto animate-fade-up">
      <div className="text-6xl mb-4">💸</div>
      <h2
        className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mb-2"
        style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}
      >
        Welcome to Empty Wallet
      </h2>
      <p className="text-sm text-[#9ca3c0] mb-8">
        Your personal expense management platform. Let&apos;s get started.
      </p>

      <div className="space-y-3 text-left max-w-xs mx-auto mb-8">
        <div className="flex items-start gap-3">
          <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
          <div>
            <p className="text-sm font-medium text-white">Create groups</p>
            <p className="text-xs text-[#5a6380]">Organize expenses into custom groups like Home, Car, Kids</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
          <div>
            <p className="text-sm font-medium text-white">Add expenses</p>
            <p className="text-xs text-[#5a6380]">Pick a category, name it, set the amount</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</span>
          <div>
            <p className="text-sm font-medium text-white">Track & analyze</p>
            <p className="text-xs text-[#5a6380]">See trends, compare months, find insights</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link href="/groups" className="px-6 py-2.5 rounded-xl gradient-pink text-white text-sm font-bold shadow-lg shadow-pink-500/20 btn-press hover:opacity-90 transition-opacity">
          Create first group
        </Link>
        <Link href="/" className="px-6 py-2.5 rounded-xl border border-white/[0.08] text-[#9ca3c0] text-sm font-medium hover:bg-white/5 hover:text-white transition-all btn-press">
          Skip to expenses
        </Link>
      </div>
    </div>
  );
}
