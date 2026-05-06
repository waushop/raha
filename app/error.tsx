"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card rounded-2xl p-8 sm:p-12 max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-white mb-2">Something went wrong</h2>
        <p className="text-sm text-[#9ca3c0] mb-6">{error.message || "Try reloading"}</p>
        <button
          onClick={reset}
          className="px-6 py-2.5 rounded-xl gradient-pink text-white text-sm font-bold shadow-lg shadow-pink-500/20 btn-press hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
