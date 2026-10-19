import Link from "next/link";

// Plain reading layout for /privacy and /terms: public, no app chrome.
export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-10 sm:py-16">
      <article className="max-w-2xl mx-auto card rounded-2xl px-5 py-6 sm:px-8 sm:py-8 animate-fade-up">
        <Link
          href="/login"
          className="text-3xl leading-none bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent"
          style={{ fontFamily: "var(--font-brand), var(--font-hand), cursive" }}
        >
          Empty Wallet
        </Link>
        <h1 className="text-2xl sm:text-3xl text-white mt-6" style={{ fontFamily: "var(--font-hand), sans-serif" }}>{title}</h1>
        <p className="text-xs text-[#5a6380] mt-1">Last updated {updated}</p>
        <div className="mt-6 space-y-5 text-sm leading-relaxed text-[#9ca3c0] [&_h2]:text-white [&_h2]:font-semibold [&_h2]:text-base [&_h2]:mb-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_strong]:text-white/90">
          {children}
        </div>
        <p className="text-xs text-[#5a6380] mt-8 pt-4 border-t border-white/[0.06] flex gap-4">
          <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
          <Link href="/login" className="hover:text-white transition-colors ml-auto">Sign in</Link>
        </p>
      </article>
    </main>
  );
}
